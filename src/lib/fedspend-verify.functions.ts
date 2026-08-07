// Thin server-function wrapper for the fed-spend.com verification harness.
// All runtime helpers live in ./fedspend-verify.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  probe,
  hasRecipientKey,
  type FedSpendTestResult,
  type FedSpendVerifyResponse,
} from "./fedspend-verify";

export const runFedSpendVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FedSpendVerifyResponse> => {
    const { supabase, userId } = context;

    // Authorization: app admin OR team owner/admin (RLS-scoped reads).
    const [{ data: roleRow }, { data: teamRoles }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      supabase.from("team_members").select("role").eq("user_id", userId),
    ]);
    const isAppAdmin = (roleRow as { role?: string } | null)?.role === "admin";
    const isTeamAdmin = ((teamRoles ?? []) as Array<{ role?: string }>).some(
      (r) => r.role === "owner" || r.role === "admin",
    );
    if (!isAppAdmin && !isTeamAdmin) {
      return { error: "forbidden", message: "Fed-Spend verification requires admin or team owner role" };
    }

    const apiKey = process.env["FED_SPEND_API_KEY"];
    if (!apiKey) {
      return { error: "missing_secret", message: "Add FED_SPEND_API_KEY in project secrets first." };
    }

    const [t1, t2, t3] = await Promise.all([
      probe("t1", "T1 — recipient fields (POST /search awards)", apiKey, "/search", {
        method: "POST",
        body: { searchMode: "awards", naicsCode: "541512", maxResults: 25 },
      }),
      probe("t2", "T2 — recompete (GET /recompete)", apiKey, "/recompete?maxDays=180&limit=25", {
        method: "GET",
      }),
      probe("t3", "T3 — opportunity search (POST /search opportunities)", apiKey, "/search", {
        method: "POST",
        body: {
          searchMode: "opportunities",
          naicsCode: "541512",
          agency: "Defense Health Agency",
          maxResults: 10,
        },
      }),
    ]);

    // T1 specifics: first 2 rows verbatim + recipient-field detection.
    const t1Rows = (t1.extras["rows"] as unknown[] | undefined) ?? [];
    t1.extras = {
      ...t1.extras,
      first_two: t1Rows.slice(0, 2),
      fields_have_recipient: t1Rows.slice(0, 2).some((r) => hasRecipientKey(r)),
    };
    delete t1.extras["rows"];

    // T2 specifics: first 3 rows + presence checks.
    const t2Rows = (t2.extras["rows"] as unknown[] | undefined) ?? [];
    const t2First = t2Rows.slice(0, 3);
    const hasKey = (rows: unknown[], key: string) =>
      rows.some((r) => !!r && typeof r === "object" && key in (r as Record<string, unknown>));
    t2.extras = {
      ...t2.extras,
      first_three: t2First,
      has_incumbent: hasKey(t2First, "incumbent"),
      has_expiration_date: hasKey(t2First, "expirationDate"),
      has_recompete_score: hasKey(t2First, "recompeteScore"),
      professional_tier_gated: t2.status === 403,
    };
    delete t2.extras["rows"];

    // T3 specifics: first 2 rows.
    const t3Rows = (t3.extras["rows"] as unknown[] | undefined) ?? [];
    t3.extras = { ...t3.extras, first_two: t3Rows.slice(0, 2) };
    delete t3.extras["rows"];

    // T4: aggregate rate-limit signals observed across the three calls.
    const headersByTest: Record<string, Record<string, string>> = {
      t1: t1.headers, t2: t2.headers, t3: t3.headers,
    };
    const anyHeaders = Object.values(headersByTest).some((h) => Object.keys(h).length > 0);
    const quotaMeta = [t1, t2, t3]
      .filter((t) => t.extras["meta"] !== undefined)
      .map((t) => ({ test: t.id, meta: t.extras["meta"] }));
    const t4: FedSpendTestResult = {
      id: "t4",
      label: "T4 — rate-limit headers & quota metadata",
      ok: true,
      status: null,
      error: null,
      count: null,
      headers: {},
      notes: anyHeaders ? [] : ["no rate-limit headers observed on any call"],
      raw: { headersByTest, quotaMeta } as any,
      extras: { any_rate_limit_headers: anyHeaders, quota_meta_count: quotaMeta.length },
    };

    return { tests: [t1, t2, t3, t4] };
  });
