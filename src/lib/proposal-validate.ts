// Lightweight, side-effect-free integrity checks for proposal records.
// Used on proposal load (validateProposal) and after parse-sow (validateComplianceMatrix).

export type ValidationIssue = {
  level: "warn" | "info";
  code: string;
  message: string;
};

export type ProposalValidation = {
  issues: ValidationIssue[];
  needsTeamAssignment: boolean;
};

export function validateProposal(proposal: any, knownSectionIds: string[]): ProposalValidation {
  const issues: ValidationIssue[] = [];

  // Compliance matrix exists but has zero requirements
  const cm = proposal?.compliance_matrix;
  if (cm && Object.keys(cm).length > 0) {
    const reqs = Array.isArray(cm.requirements) ? cm.requirements : null;
    if (!reqs || reqs.length === 0) {
      issues.push({
        level: "warn",
        code: "compliance_matrix_empty",
        message: "Compliance matrix is present but contains zero requirements — likely a corrupted parse. Re-run document parsing.",
      });
    }
  }

  // sections JSON has keys that don't match the SECTIONS array
  const sections = proposal?.sections;
  if (sections && typeof sections === "object") {
    const known = new Set(knownSectionIds);
    const stray = Object.keys(sections).filter((k) => !known.has(k));
    if (stray.length > 0) {
      issues.push({
        level: "warn",
        code: "stray_section_keys",
        message: `Generated sections contain unknown keys (${stray.join(", ")}). They will not export.`,
      });
    }
  }

  // response_deadline in the past but status still "draft"
  if (proposal?.response_deadline && proposal?.status === "draft") {
    const dl = new Date(proposal.response_deadline).getTime();
    if (!isNaN(dl) && dl < Date.now()) {
      issues.push({
        level: "warn",
        code: "deadline_past_draft",
        message: "Response deadline has passed but the proposal is still marked Draft. Update status to Closed or No-Bid.",
      });
    }
  }

  // team_id is null (legacy record — caller should auto-assign)
  const needsTeamAssignment = !proposal?.team_id;
  if (needsTeamAssignment) {
    issues.push({
      level: "info",
      code: "missing_team",
      message: "Proposal is not assigned to a team (legacy record). Auto-assigning to your current team.",
    });
  }

  // customer_intel has citations that are empty strings
  const ci = proposal?.customer_intel;
  if (ci && typeof ci === "object") {
    const citations: any[] = Array.isArray(ci.citations) ? ci.citations : [];
    const blanks = citations.filter((c) => {
      if (!c) return true;
      if (typeof c === "string") return c.trim() === "";
      if (typeof c === "object") return !c.url || String(c.url).trim() === "";
      return false;
    });
    if (blanks.length > 0) {
      issues.push({
        level: "warn",
        code: "empty_citations",
        message: `${blanks.length} customer intel citation${blanks.length === 1 ? "" : "s"} have empty source URLs.`,
      });
    }
  }

  return { issues, needsTeamAssignment };
}

export type MatrixIntegrityResult = {
  fixedCount: number;
  fixes: string[];
  flagged: { req_id: string; reason: string }[];
  matrix: any; // possibly mutated copy
};

// Run after parse-sow returns. Returns a normalized matrix and a count of auto-fixes.
export function validateComplianceMatrix(matrix: any, knownSectionIds: string[]): MatrixIntegrityResult {
  const fixes: string[] = [];
  const flagged: { req_id: string; reason: string }[] = [];
  if (!matrix || !Array.isArray(matrix.requirements)) {
    return { fixedCount: 0, fixes, flagged, matrix };
  }

  const reqs = matrix.requirements.map((r: any) => ({ ...r }));
  const known = new Set(knownSectionIds);

  // Renumber duplicate req_ids
  const seen = new Map<string, number>();
  let renumbered = 0;
  for (let i = 0; i < reqs.length; i++) {
    const rid = String(reqs[i].req_id || "").trim();
    if (!rid) {
      reqs[i].req_id = `R-${String(i + 1).padStart(3, "0")}`;
      renumbered++;
      continue;
    }
    if (seen.has(rid)) {
      const newId = `R-${String(i + 1).padStart(3, "0")}-dup`;
      reqs[i].req_id = newId;
      renumbered++;
    } else {
      seen.set(rid, i);
    }
  }
  if (renumbered > 0) fixes.push(`Renumbered ${renumbered} duplicate or missing requirement ID${renumbered === 1 ? "" : "s"}.`);

  // Flag empty requirement_text
  let flaggedEmpty = 0;
  for (const r of reqs) {
    if (!r.requirement_text || String(r.requirement_text).trim() === "") {
      r.needs_review = true;
      flagged.push({ req_id: r.req_id, reason: "empty_requirement_text" });
      flaggedEmpty++;
    }
  }
  if (flaggedEmpty > 0) fixes.push(`Flagged ${flaggedEmpty} empty requirement${flaggedEmpty === 1 ? "" : "s"} for review.`);

  // proposal_section values that don't match known SECTIONS
  let unknownSection = 0;
  for (const r of reqs) {
    if (r.proposal_section && !known.has(r.proposal_section)) {
      r.proposal_section_unknown = String(r.proposal_section);
      r.proposal_section = null;
      unknownSection++;
    }
  }
  if (unknownSection > 0) fixes.push(`Cleared ${unknownSection} unknown proposal_section mapping${unknownSection === 1 ? "" : "s"}.`);

  return {
    fixedCount: renumbered + flaggedEmpty + unknownSection,
    fixes,
    flagged,
    matrix: { ...matrix, requirements: reqs },
  };
}
