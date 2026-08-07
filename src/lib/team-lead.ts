// Team lead resolution shared by the Hub UI and generation payloads.
//
// A pursuit may designate one "team lead" — the company that fronts the team.
// When unset, the default is our own company in prime mode and the prime
// contractor in sub mode.

export type TeamLeadInput = {
  teamLeadCompanyId?: string | null;
  teamLeadName?: string | null;
  isSelfPrime: boolean;
  selfName: string;
  selfCompanyId?: string | null;
  primeContractorId?: string | null;
  primeContractorName?: string | null;
};

export type ResolvedTeamLead = {
  companyId: string | null;
  name: string;
  /** true when the resolved lead is our own company */
  isSelf: boolean;
  /** true when a lead was explicitly chosen (vs. the mode default) */
  explicit: boolean;
};

export function resolveTeamLead(input: TeamLeadInput): ResolvedTeamLead {
  const explicitName = (input.teamLeadName ?? "").trim();
  const selfId = input.selfCompanyId ?? null;

  if (explicitName) {
    const companyId = input.teamLeadCompanyId ?? null;
    const isSelf =
      (!!selfId && !!companyId && companyId === selfId) ||
      explicitName.toLowerCase() === (input.selfName ?? "").trim().toLowerCase();
    return { companyId, name: explicitName, isSelf, explicit: true };
  }

  if (input.isSelfPrime) {
    return { companyId: selfId, name: input.selfName, isSelf: true, explicit: false };
  }

  const primeName = (input.primeContractorName ?? "").trim();
  if (primeName) {
    return {
      companyId: input.primeContractorId ?? null,
      name: primeName,
      isSelf: false,
      explicit: false,
    };
  }

  return { companyId: selfId, name: input.selfName, isSelf: true, explicit: false };
}

/** Name to send to AI generation, or null when the lead is our own company. */
export function teamLeadNameForGeneration(lead: ResolvedTeamLead | null): string | null {
  if (!lead || lead.isSelf) return null;
  return lead.name || null;
}
