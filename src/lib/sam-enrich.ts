import { supabase } from "@/integrations/supabase/client";
import { searchSam, type SamOpportunity } from "@/lib/api";

export type EnrichResult = {
  matched: boolean;
  updatedFields: string[];
  attachmentResults?: any;
  attachmentsSaved?: number;
};

const norm = (s: string | null | undefined) =>
  (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "");

/**
 * Enrich a proposal from live SAM.gov data and pull its attachments.
 *
 * Strategy:
 * 1. Load the proposal's solicitation_number / notice_id / naics_code.
 * 2. If notice_id is missing, run search-sam (keyword = solicitation number,
 *    NAICS-scoped, past 365 days) and match the result by solicitation number.
 * 3. Patch proposal columns that are still blank (notice_id, response_deadline,
 *    set_aside, sub_agency, source_url, description).
 * 4. Call the sam-attachments edge function to download supporting documents
 *    into proposal_attachments. Reuses the same endpoint as
 *    src/routes/proposals.$proposalId.tsx so attachment handling is consistent.
 */
export async function enrichProposalFromSam(proposalId: string): Promise<EnrichResult> {
  const { data: proposal, error } = await supabase
    .from("proposals")
    .select(
      "id, opportunity_title, agency, naics_code, solicitation_number, notice_id, response_deadline, set_aside",
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!proposal) throw new Error("Proposal not found");

  const updates: Record<string, any> = {};
  const updatedFields: string[] = [];
  let matched = false;
  let noticeId: string | null = proposal.notice_id ?? null;

  if (!noticeId) {
    const sol = (proposal.solicitation_number ?? "").trim();
    if (!sol) {
      throw new Error("No solicitation number or notice ID on this opportunity");
    }
    const naics = (proposal.naics_code ?? "").trim();
    if (!naics) {
      throw new Error("Add a NAICS code before enriching from SAM.gov");
    }
    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 365);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const { opportunities = [] } = await searchSam({
      naicsCodes: [naics],
      postedFrom: fmt(past),
      postedTo: fmt(today),
      keyword: sol,
    });
    const target = norm(sol);
    let hit: SamOpportunity | undefined = opportunities.find(
      (o) => norm(o.solicitationNumber) === target,
    );
    if (!hit) hit = opportunities.find((o) => norm(o.noticeId) === target);
    if (!hit) {
      throw new Error(
        `No SAM.gov match for solicitation "${sol}". Try broadening NAICS or refining the number.`,
      );
    }
    matched = true;
    if (hit.noticeId) { noticeId = hit.noticeId; updates.notice_id = hit.noticeId; updatedFields.push("notice_id"); }
    if (!proposal.response_deadline && hit.responseDeadLine) {
      updates.response_deadline = hit.responseDeadLine;
      updatedFields.push("response_deadline");
    }
    const setAside = hit.setAside ?? hit.typeOfSetAside;
    if (!proposal.set_aside && setAside) {
      updates.set_aside = setAside;
      updatedFields.push("set_aside");
    }
    if (!proposal.source_url && hit.uiLink) {
      updates.source_url = hit.uiLink;
      updatedFields.push("source_url");
    }
    if (!proposal.description && hit.description) {
      updates.description = hit.description;
      updatedFields.push("description");
    }
  } else {
    matched = true;
  }

  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await supabase.from("proposals").update(updates).eq("id", proposalId);
    if (upErr) throw new Error(upErr.message);
  }

  if (!noticeId) {
    return { matched, updatedFields };
  }

  // Pull attachments via the existing edge function so storage + DB rows
  // follow the same path as the proposal detail route.
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sam-attachments`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ proposalId, noticeId, action: "download" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(j?.error || `sam-attachments failed (${r.status})`);
  }
  const saved = Array.isArray(j?.saved) ? j.saved.length : 0;
  return { matched, updatedFields, attachmentResults: j, attachmentsSaved: saved };
}

export function canEnrichFromSam(p: {
  solicitation_number?: string | null;
  notice_id?: string | null;
  naics_code?: string | null;
}): boolean {
  if (p.notice_id) return true;
  return Boolean(p.solicitation_number && p.naics_code);
}
