// Helpers to render a company profile into prompt text dynamically.
// No hardcoded company identity should ever appear in proposal generation
// prompts — everything comes from the companyProfile object the client sends.

import { corsHeaders } from "./cors.ts";

export type CompanyProfile = Record<string, any>;

function arr(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
}

function val(v: any, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

export function hasCompanyProfile(cp: any): boolean {
  if (!cp || typeof cp !== "object") return false;
  // Must at least have a legal name to be considered usable.
  return !!val(cp.legal_name);
}

export function missingProfileResponse(corsH: Record<string, string> = corsHeaders): Response {
  return new Response(
    JSON.stringify({
      error:
        "Company profile is required. Please complete your profile in Capture Intel before generating proposals.",
    }),
    { status: 400, headers: { ...corsH, "Content-Type": "application/json" } },
  );
}

/** Short company identifier used in the persona sentence. */
export function companyIdentity(cp: CompanyProfile): string {
  const legal = val(cp.legal_name, "[Company name — update in Capture Intel]");
  const dba = val(cp.dba_name);
  return dba ? `${legal} dba ${dba}` : legal;
}

/** Detailed company profile block injected into system prompts. */
export function renderCompanyProfileBlock(cp: CompanyProfile): string {
  const naics = arr(cp.naics_codes);
  const certs = arr(cp.certifications);
  const services = arr(cp.core_services);
  const diffs = arr(cp.differentiators);
  const city = val(cp.city);
  const state = val(cp.state);
  const location = [city, state].filter(Boolean).join(", ");
  const founderName = val(cp.founder_name);
  const founderBg = val(cp.founder_background);

  const lines = [
    `- Legal name: ${val(cp.legal_name, "[Not provided — update in Capture Intel]")}`,
  ];
  if (val(cp.dba_name)) lines.push(`- DBA: ${val(cp.dba_name)}`);
  lines.push(
    `- UEI: ${val(cp.uei, "[Not provided — update in Capture Intel]")}`,
    `- CAGE: ${val(cp.cage_code, "[Not provided — update in Capture Intel]")}`,
    `- Primary NAICS: ${naics.length ? naics.join(", ") : "[Not provided]"}`,
    `- Certifications: ${certs.length ? certs.join(", ") : "[Not provided]"}`,
    `- Core Services: ${services.length ? services.join(", ") : "[Not provided]"}`,
    `- Differentiators: ${diffs.length ? diffs.join(", ") : "[Not provided]"}`,
    `- Location: ${location || "[Not provided]"}`,
  );
  if (founderName) {
    lines.push(
      `- Founder: ${founderName}${founderBg ? ` — ${founderBg}` : ""}`,
    );
  }
  return lines.join("\n");
}
