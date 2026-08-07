// Runtime diagnostics smoke-test registry.
//
// Each check returns a controlled result — pass/warn/fail with a short
// detail string. Groups target the failure classes we've hit in production:
//   A. Edge function BOOT — probe each function with an incomplete body and
//      expect a controlled 4xx JSON error. 5xx / network / non-JSON means
//      the function crashed on boot (missing import, bad CORS helper, etc).
//   B. RLS PROBES — SELECT id LIMIT 1 as the logged-in user. Zero rows is
//      pass; a SQL error (missing helper, recursive policy) is fail.
//   C. EXTERNAL API canaries — Tango via search-usaspending, SAM key sanity.
//   D. PLATFORM integrity — cron job alive, stale schema references.
import { supabase } from "@/integrations/supabase/client";
import { checkFedSpendHealth } from "@/lib/fedspend.functions";

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckResult = {
  status: CheckStatus;
  detail: string;
  ms: number;
};
export type CheckDefinition = {
  id: string;
  group: "boot" | "rls" | "external" | "platform";
  label: string;
  run: () => Promise<Omit<CheckResult, "ms">>;
};
export type CheckRun = CheckDefinition & CheckResult;

const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ??
  "https://exmygycifebzmhabnnad.supabase.co";
const SUPABASE_ANON =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ??
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ??
  "";

/** Probe an edge function with an incomplete body. PASS on 4xx JSON with an
 *  error message; FAIL on 5xx, network error, or non-JSON. */
async function probeFunctionBoot(
  name: string,
  body: Record<string, unknown> = {},
  expectPhrases: string[] = [],
): Promise<Omit<CheckResult, "ms">> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? SUPABASE_ANON;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }

    if (res.status >= 500) {
      return { status: "fail", detail: `HTTP ${res.status} — likely boot crash. Body: ${text.slice(0, 240)}` };
    }
    if (!json || typeof json !== "object") {
      return { status: "fail", detail: `HTTP ${res.status} but non-JSON body: ${text.slice(0, 240)}` };
    }
    if (res.status >= 200 && res.status < 300) {
      // Unexpected success — treat as warn (means the function accepted empty input).
      return { status: "warn", detail: `HTTP ${res.status} — function accepted empty body (expected controlled 4xx).` };
    }
    const errMsg: string = String(json.error ?? json.message ?? "");
    if (expectPhrases.length > 0 && !expectPhrases.some((p) => errMsg.toLowerCase().includes(p.toLowerCase()))) {
      return { status: "warn", detail: `HTTP ${res.status} but error text unexpected: "${errMsg.slice(0, 200)}"` };
    }
    return { status: "pass", detail: `Boot ok — HTTP ${res.status}: ${errMsg.slice(0, 160)}` };
  } catch (e) {
    return { status: "fail", detail: `Network / invoke error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** SELECT id LIMIT 1 as the current user. Zero rows still means the policy
 *  chain resolved cleanly. */
async function probeRls(table: string): Promise<Omit<CheckResult, "ms">> {
  const { error } = await supabase.from(table as any).select("id").limit(1);
  if (error) {
    return { status: "fail", detail: `${error.code ?? ""} ${error.message}`.trim() };
  }
  return { status: "pass", detail: "RLS chain resolved (row visibility not checked)." };
}

// ---------- Registry ----------

const EDGE_FUNCTIONS: Array<{ name: string; body?: Record<string, unknown>; expect?: string[] }> = [
  { name: "capture-analysis", expect: ["proposalid required", "proposalid"] },
  { name: "customer-intel", expect: ["required", "opportunity"] },
  { name: "extract-intel", expect: ["required", "transcript", "text"] },
  { name: "generate-proposal-section", expect: ["required"] },
  { name: "generate-teaming-outreach", expect: ["required"] },
  { name: "parse-sow", expect: ["required"] },
  { name: "competitive-intel", expect: ["required"] },
  { name: "search-sam", expect: ["required", "naics"] },
  { name: "search-usaspending", expect: ["required", "naics"] },
  { name: "search-entities", expect: ["required"] },
  { name: "sam-attachments", expect: ["required"] },
  { name: "vendor-profile", expect: ["required", "recipient"] },
  { name: "usaspending-detail", expect: ["required", "generatedinternalid"] },
  { name: "recompete-watch", expect: ["required", "proposal", "unauthorized"] },
];

const RLS_TABLES = [
  "proposals",
  "tracked_opportunities",
  "opportunity_intel",
  "opportunity_activities",
  "opportunity_watch_events",
  "proposal_teaming",
  "companies",
  "contract_vehicles",
  "vehicle_registry",
  "vehicle_awardees",
  "proposal_attachments",
  "past_performance",
];

function buildRegistry(): CheckDefinition[] {
  const checks: CheckDefinition[] = [];

  for (const fn of EDGE_FUNCTIONS) {
    checks.push({
      id: `boot:${fn.name}`,
      group: "boot",
      label: `Edge function boot — ${fn.name}`,
      run: () => probeFunctionBoot(fn.name, fn.body ?? {}, fn.expect ?? []),
    });
  }

  for (const t of RLS_TABLES) {
    checks.push({
      id: `rls:${t}`,
      group: "rls",
      label: `RLS chain — ${t}`,
      run: () => probeRls(t),
    });
  }

  // External canaries
  checks.push({
    id: "ext:tango-dha-541512",
    group: "external",
    label: "Tango canary — NAICS 541512 @ DHA",
    run: async () => {
      const end = new Date();
      const start = new Date(end);
      start.setFullYear(end.getFullYear() - 2);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const { data, error } = await supabase.functions.invoke("search-usaspending", {
        body: {
          naicsCodes: ["541512"],
          startDate: iso(start),
          endDate: iso(end),
          agency: "DEFENSE HEALTH AGENCY (DHA)",
          maxResults: 25,
        },
      });
      if (error) return { status: "fail" as const, detail: error.message };
      const count = data?.results?.length ?? 0;
      const dbg = data?._debug ? ` debug=${JSON.stringify(data._debug)}` : "";
      if (count > 0) return { status: "pass" as const, detail: `${count} awards.${dbg}` };
      return { status: "warn" as const, detail: `0 awards for DHA/541512.${dbg}` };
    },
  });

  checks.push({
    id: "ext:tango-quota",
    group: "external",
    label: "Tango daily quota usage",
    run: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data, error, count } = await supabase
        .from("tango_api_usage")
        .select("id", { count: "exact", head: true })
        .gte("called_at", since.toISOString());
      if (error) return { status: "fail", detail: error.message };
      const used = count ?? data?.length ?? 0;
      // Tango free tier: ~500/day (informational; we can't read the limit).
      const LIMIT = 500;
      const pct = Math.round((used / LIMIT) * 100);
      if (used >= LIMIT) return { status: "fail", detail: `Used ${used}/${LIMIT} (${pct}%) — at limit.` };
      if (pct >= 70) return { status: "warn", detail: `Used ${used}/${LIMIT} (${pct}%).` };
      return { status: "pass", detail: `Used ${used}/${LIMIT} (${pct}%).` };
    },
  });

  checks.push({
    id: "ext:sam-key",
    group: "external",
    label: "SAM.gov API key configured",
    run: async () => {
      // search-sam returns 400 on bad input if key is present; 500 with
      // "SAM_GOV_API_KEY" message if missing.
      const res = await probeFunctionBoot("search-sam", {}, ["required", "naics"]);
      if (res.status === "fail" && /sam_gov_api_key|api key/i.test(res.detail)) {
        return { status: "fail", detail: `SAM.gov API key not configured: ${res.detail}` };
      }
      return res;
    },
  });

  // Platform integrity via diagnostics-meta
  checks.push({
    id: "plat:cron-recompete",
    group: "platform",
    label: "Cron job — recompete-watch-daily active",
    run: async () => {
      const { data, error } = await supabase.functions.invoke("diagnostics-meta", { body: {} });
      if (error) return { status: "fail", detail: error.message };
      const jobs: any[] = data?.cronJobs ?? [];
      const job = jobs.find((j) => j.jobname === "recompete-watch-daily");
      if (!job) return { status: "fail", detail: "Cron job 'recompete-watch-daily' not found." };
      if (!job.active) return { status: "fail", detail: `Cron job exists but is inactive (schedule ${job.schedule}).` };
      const last = data?.lastWatchRun;
      return { status: "pass", detail: `Active on ${job.schedule}. Last watch run: ${last ?? "never"}.` };
    },
  });

  checks.push({
    id: "plat:stale-schema",
    group: "platform",
    label: "No stale public.is_team_member / public.has_role references",
    run: async () => {
      const { data, error } = await supabase.functions.invoke("diagnostics-meta", { body: {} });
      if (error) return { status: "fail", detail: error.message };
      const stale: any[] = data?.staleSchemaFunctions ?? [];
      if (stale.length > 0) {
        return {
          status: "fail",
          detail: `Found ${stale.length} function(s) still referencing legacy public.* helpers: ` +
            stale.slice(0, 5).map((r) => `${r.schema_name}.${r.function_name}→${r.needle}`).join(", "),
        };
      }
      return { status: "pass", detail: "No stale references." };
    },
  });

  // Fed-Spend provider health (boot = key present + client callable,
  // probe = live query returns rows).
  checks.push({
    id: "ext:fedspend-boot",
    group: "external",
    label: "Fed-Spend API key configured",
    run: async () => {
      const health = await checkFedSpendHealth();
      return health.bootOk
        ? { status: "pass", detail: "FED_SPEND_API_KEY is configured." }
        : { status: "fail", detail: health.message };
    },
  });

  checks.push({
    id: "ext:fedspend-probe",
    group: "external",
    label: "Fed-Spend live probe (awards search)",
    run: async () => {
      const health = await checkFedSpendHealth();
      if (!health.bootOk) return { status: "warn", detail: "Skipped — API key not configured." };
      return health.probeOk
        ? { status: "pass", detail: health.message }
        : { status: "fail", detail: health.message };
    },
  });

  return checks;
}


export const DIAGNOSTICS_CHECKS = buildRegistry();

export async function runAllChecks(
  onProgress?: (result: CheckRun) => void,
): Promise<CheckRun[]> {
  const out: CheckRun[] = [];
  for (const check of DIAGNOSTICS_CHECKS) {
    const started = performance.now();
    let result: Omit<CheckResult, "ms">;
    try {
      result = await check.run();
    } catch (e) {
      result = { status: "fail", detail: e instanceof Error ? e.message : String(e) };
    }
    const run: CheckRun = { ...check, ...result, ms: Math.round(performance.now() - started) };
    out.push(run);
    onProgress?.(run);
  }
  return out;
}

export function summarize(results: CheckRun[]) {
  const passed = results.filter((r) => r.status === "pass").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const failed = results.filter((r) => r.status === "fail").length;
  return { total: results.length, passed, warned, failed };
}
