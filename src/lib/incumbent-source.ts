// Single source of truth for "who is the incumbent on this pursuit?"
// Preference order:
//   1. proposal.customer_intel.predecessor_contract.incumbent  (proprietary human intel)
//   2. market_snapshot.incumbent.topRecipient  (data-derived, confidence !== 'none')
//   3. proposal.known_incumbent                (user's Overview input)

export type IncumbentSource =
  | "customer_intel"
  | "market_snapshot"
  | "user_input"
  | null;

export type EffectiveIncumbent = {
  name: string | null;
  source: IncumbentSource;
};

export function getEffectiveIncumbent(proposal: any): EffectiveIncumbent {
  const intel = (proposal?.customer_intel?.predecessor_contract?.incumbent ?? "").toString().trim();
  if (intel) return { name: intel, source: "customer_intel" };

  const snap = proposal?.market_snapshot?.incumbent;
  const snapName = (snap?.topRecipient ?? "").toString().trim();
  if (snapName && snap?.confidence && snap.confidence !== "none") {
    return { name: snapName, source: "market_snapshot" };
  }

  const user = (proposal?.known_incumbent ?? "").toString().trim();
  if (user) return { name: user, source: "user_input" };

  return { name: null, source: null };
}

export function incumbentSourceBadge(source: IncumbentSource): string | null {
  if (source === "customer_intel") return "from customer intel";
  if (source === "market_snapshot") return "data-derived";
  if (source === "user_input") return "from your input";
  return null;
}
