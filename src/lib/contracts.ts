export type NaicsGroup = { label: string; codes: { code: string; name: string }[] };

export const NAICS_GROUPS: NaicsGroup[] = [
  {
    label: "Computer / IT",
    codes: [
      { code: "541511", name: "Custom Programming" },
      { code: "541512", name: "Computer Systems Design" },
      { code: "541513", name: "Computer Facilities Mgmt" },
      { code: "541519", name: "Other Computer Services" },
    ],
  },
  {
    label: "Software / Cloud",
    codes: [
      { code: "511210", name: "Software Publishers" },
      { code: "518210", name: "Cloud / Hosting" },
    ],
  },
  {
    label: "Telecom",
    codes: [
      { code: "517111", name: "Wired Telecom" },
      { code: "517112", name: "Wireless Telecom" },
      { code: "517410", name: "Satellite Telecom" },
      { code: "517810", name: "Other Telecom" },
    ],
  },
  {
    label: "Consulting / Engineering",
    codes: [
      { code: "541611", name: "Mgmt Consulting" },
      { code: "541618", name: "Other Mgmt Consulting" },
      { code: "541690", name: "Other Sci/Tech Consulting" },
      { code: "541330", name: "Engineering Services" },
      { code: "541715", name: "R&D in Phys/Eng/Life Sci" },
    ],
  },
  {
    label: "Hardware",
    codes: [
      { code: "334111", name: "Computer Mfg" },
      { code: "423430", name: "Computer Equip Wholesale" },
      { code: "811213", name: "Computer Repair" },
    ],
  },
];

export const DEFAULT_NAICS = ["541511", "541512", "541513", "541519"];
export const ALL_NAICS = NAICS_GROUPS.flatMap((g) => g.codes.map((c) => c.code));
export const IT_ONLY = DEFAULT_NAICS;

export function naicsName(code: string): string {
  for (const g of NAICS_GROUPS) {
    const f = g.codes.find((c) => c.code === code);
    if (f) return f.name;
  }
  return code;
}

export const SET_ASIDE_MAP: Record<string, string> = {
  SBA: "Small Business",
  SDVOSBC: "SDVOSB",
  SDVOSB: "SDVOSB",
  WOSBSS: "WOSB",
  WOSB: "WOSB",
  "8A": "8(a)",
  "8AN": "8(a)",
  HZC: "HUBZone",
  HZS: "HUBZone",
  VSA: "VOSB",
  VSS: "VOSB",
  ISBEE: "Econ. Disadvantaged WOSB",
  EDWOSB: "Econ. Disadvantaged WOSB",
  SBP: "Small Business",
};

export function mapSetAside(code?: string | null): string {
  if (!code) return "";
  return SET_ASIDE_MAP[code.toUpperCase()] || code;
}

// Notice type letters → label
export const NOTICE_TYPE_LABEL: Record<string, string> = {
  p: "Pre-solicitation",
  k: "Combined Synopsis/Solicitation",
  o: "Solicitation",
  a: "Award",
  r: "Sources Sought",
  s: "Special Notice",
  u: "Justification",
  i: "Intent to Bundle",
  g: "Sale of Surplus",
};

// Notice types eligible for "Propose"
export const PROPOSABLE_TYPES = new Set([
  "Solicitation",
  "Combined Synopsis/Solicitation",
  "Sources Sought",
  "Pre-solicitation",
  "Presolicitation",
]);

export function isProposable(type?: string | null): boolean {
  if (!type) return false;
  if (PROPOSABLE_TYPES.has(type)) return true;
  // Match partial keywords
  const t = type.toLowerCase();
  return (
    t.includes("solicitation") ||
    t.includes("sources sought") ||
    t.includes("combined synopsis")
  );
}

export function badgeClassForType(type?: string | null): string {
  if (!type) return "bg-muted text-muted-foreground";
  const t = type.toLowerCase();
  if (t.includes("award")) return "bg-badge-award text-emerald-900";
  if (t.includes("combined") || t.includes("solicitation"))
    return "bg-badge-solicitation text-blue-900";
  if (t.includes("sources sought")) return "bg-badge-sources text-amber-900";
  if (t.includes("special")) return "bg-badge-special text-purple-900";
  if (t.includes("justification")) return "bg-badge-justification text-pink-900";
  if (t.includes("presol")) return "bg-badge-presol text-sky-900";
  return "bg-muted text-muted-foreground";
}

export function shortAgency(full?: string | null): string {
  if (!full) return "";
  const parts = full.split(/[.>]/).map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || full;
}
