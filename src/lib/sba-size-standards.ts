// SBA Table of Small Business Size Standards — values assumed per the
// 13 CFR 121.201 table as revised effective 2022-12-19 (with the 2022
// inflation adjustment). Receipts standards are average annual receipts in
// USD; employee standards are number of employees.
//
// IMPORTANT: SBA revises this table periodically. Users MUST verify the
// applicable standard for a specific solicitation against the current SBA
// table / the size standard stated in the solicitation itself. Codes we are
// not confident about are intentionally omitted rather than guessed —
// getSizeStandard() returns null for those.

export type SizeStandard =
  | { type: "receipts"; value: number }
  | { type: "employees"; value: number };

export type SizeStandardEntry = {
  code: string;
  standard: SizeStandard;
};

function receipts(value: number): SizeStandard {
  return { type: "receipts", value };
}
function employees(value: number): SizeStandard {
  return { type: "employees", value };
}

const M = 1_000_000;

const TABLE: Record<string, SizeStandard> = {
  // ---- 5112xx Software publishers ----
  "511210": receipts(47 * M),

  // ---- 517xxx / 5182xx Telecom, data processing & hosting ----
  "517111": receipts(41.5 * M),
  "517112": employees(1500),
  "517121": receipts(41.5 * M),
  "517122": employees(1500),
  "517410": receipts(44 * M),
  "517810": receipts(35 * M),
  "517919": receipts(35 * M),
  "518210": receipts(40 * M),

  // ---- 5415xx Computer systems design & related services ----
  "541511": receipts(34 * M),
  "541512": receipts(34 * M),
  "541513": receipts(34 * M),
  "541519": receipts(34 * M),

  // ---- 5416xx Management, scientific & technical consulting ----
  "541611": receipts(24.5 * M),
  "541612": receipts(29 * M),
  "541613": receipts(19 * M),
  "541614": receipts(20 * M),
  "541618": receipts(19 * M),
  "541620": receipts(19 * M),
  "541690": receipts(19 * M),

  // ---- 5417xx Scientific research & development ----
  "541713": employees(1000),
  "541714": employees(1000),
  "541715": employees(1000),
  "541720": receipts(28 * M),

  // ---- other 5413xx / 5414xx engineering & design commonly used ----
  "541330": receipts(25.5 * M),
  "541380": receipts(19 * M),
  "541990": receipts(19 * M),

  // ---- 5613xx Employment services ----
  "561311": receipts(30 * M),
  "561312": receipts(30 * M),
  "561320": receipts(34 * M),
  "561330": receipts(41.5 * M),

  // ---- 5617xx Services to buildings & dwellings ----
  "561710": receipts(10 * M),
  "561720": receipts(22 * M),
  "561730": receipts(9.5 * M),
  "561740": receipts(6 * M),
  "561790": receipts(9.5 * M),

  // ---- 3341xx Computer & peripheral equipment manufacturing ----
  "334111": employees(1250),
  "334112": employees(1250),
  "334118": employees(1000),

  // ---- misc codes referenced by NAICS_GROUPS ----
  "423430": employees(250),
  "811213": receipts(12.5 * M),
};

/** Returns the SBA size standard for a 6-digit NAICS code, or null if unknown. */
export function getSizeStandard(code: string | null | undefined): SizeStandardEntry | null {
  const c = (code ?? "").toString().trim();
  if (!c) return null;
  const std = TABLE[c];
  if (!std) return null;
  return { code: c, standard: std };
}

/** All codes covered by this table (useful for coverage tests / UI hints). */
export const SIZE_STANDARD_CODES = Object.keys(TABLE);
