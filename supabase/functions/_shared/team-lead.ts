// Team lead voice rules shared by every generation prompt.
//
// A pursuit can designate a "team lead" — the company that fronts the team.
// When the lead is NOT the offeror's own company, generated narrative must be
// written in third person using the lead's name instead of "we/us/our team".
// When the lead IS our company (or unset), first person stays as-is.

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

function simplify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c\.|inc|inc\.|incorporated|corp|corp\.|corporation|co\.|company|ltd|limited|llp|pllc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when a team lead is set and it is someone other than the offeror. */
export function isExternalTeamLead(teamLeadName: unknown, ownIdentity: unknown): boolean {
  const lead = simplify(norm(teamLeadName));
  if (!lead) return false;
  const own = simplify(norm(ownIdentity));
  if (!own) return true;
  return !(lead === own || own.includes(lead) || lead.includes(own));
}

/**
 * Prompt block describing the required voice. Returns "" when the lead is our
 * own company or unset, so existing first-person behavior is untouched.
 */
export function renderTeamLeadBlock(teamLeadName: unknown, ownIdentity: unknown): string {
  const lead = norm(teamLeadName);
  if (!isExternalTeamLead(lead, ownIdentity)) return "";
  return `
TEAM LEAD VOICE (mandatory): The designated team lead for this pursuit is "${lead}", which is NOT the offeror. Write in THIRD PERSON using the team lead's name wherever first-person plural ("we", "us", "our team", "our approach") would otherwise appear — e.g. "${lead} will provide…", "${lead}'s approach…", "${lead} and its teammates…". Refer to the offeror by its own name when describing the offeror's specific contribution. Do not use "we/us/our" to speak for the team.
`;
}
