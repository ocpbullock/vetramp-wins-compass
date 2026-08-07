// Client-safe shared types for the Fed-Spend integration.
export interface RecompeteRow {
  piid: string;
  title: string | null;
  incumbentName: string | null;
  incumbentUei: string | null;
  agency: string | null;
  naicsCode: string | null;
  value: number | null;
  obligated: number | null;
  endDate: string | null;
  daysUntilExpiration: number | null;
  urgency: string | null;
  pscCode: string | null;
  placeOfPerformance: string | null;
}

export interface SubawardRow {
  partnerName: string;
  amount: number | null;
  date: string | null;
  description: string | null;
  agency: string | null;
  primeAwardId: string | null;
  suspect: boolean;
}

export interface RecompeteResponse {
  rows: RecompeteRow[];
  cached: boolean;
  fetchedAt: string;
  naicsCodes: string[];
  maxDays: number;
  error?: string;
}

export interface SubawardsResponse {
  companyName: string;
  asPrime: SubawardRow[];
  asSub: SubawardRow[];
  cached: boolean;
  fetchedAt: string;
  suspectCount: number;
  error?: string;
}
