// Recompete watcher: monitors SAM.gov (via Tango) for activity on tracked
// recompete opportunities. Called manually per proposal by an authenticated
// user, or in batch by a scheduled trigger using the service-role key.
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  searchOpportunities,
  mapOpportunityRow,
  checkDailyUsage,
  logUsage,
  TangoError,
} from "../_shared/tango-client.ts";
import {
  authenticate,
  assertProposalAccess,
  authErrorResponse,
  jsonError,
} from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LOOKBACK_DAYS_DEFAULT = 30;
const SCAN_BATCH_SIZE = 20;
const TITLE_OVERLAP_THRESHOLD = 0.35;

type WatchProposal = {
  id: string;
  team_id: string | null;
  opportunity_title: string | null;
  agency: string | null;
  naics_code: string | null;
  solicitation_number: string | null;
  notice_id: string | null;
  response_deadline: string | null;
  last_watched_at: string | null;
  opportunity_data: any;
};

type WatchEvent = {
  proposal_id: string;
  team_id: string | null;
  event_type: "new_notice" | "deadline_change" | "attachment_update";
  notice_id?: string | null;
  notice_type?: string | null;
  title?: string | null;
  posted_date?: string | null;
  detail: string;
  maturity_hint?: string | null;
};

const STOPWORDS = new Set([
  "the","a","an","of","for","and","or","to","in","on","with","by","from","at","as","is",
  "services","service","support","program","contract","solicitation","rfp","rfi","sources",
  "sought","recompete","task","order","fy","request","proposal",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function titleOverlap(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return hits / Math.min(A.size, B.size);
}

function attachmentsFromOppData(od: any): string[] {
  if (!od) return [];
  const links = Array.isArray(od.resourceLinks) ? od.resourceLinks : [];
  return links.filter(Boolean).map(String).sort();
}

function maturityHintFor(noticeType: string | null | undefined): string | null {
  const t = (noticeType || "").toLowerCase();
  if (!t) return null;
  if (t.includes("sources") || t.includes("rfi")) {
    return "Market research stage — sources sought / RFI";
  }
  if (t.includes("presolic") || t.includes("draft")) {
    return "Draft solicitation out — final expected";
  }
  if (t.includes("combined") || t.includes("solicit")) {
    return "Final solicitation posted — proposal clock is running";
  }
  return null;
}

function normalizeSol(s: string | null | undefined): string {
  return (s || "").toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function samShape(row: any) {
  return {
    noticeId: row.notice_id ?? row.raw_data?.noticeId ?? row.tango_id,
    solicitationNumber: row.solicitation_number ?? row.raw_data?.solicitationNumber,
    title: row.title ?? row.raw_data?.title,
    type: row.raw_data?.type ?? row.raw_data?.opportunity_type ?? null,
    postedDate: row.posted_date ?? row.raw_data?.postedDate,
    responseDeadLine: row.response_deadline ?? row.raw_data?.responseDeadLine,
    resourceLinks: row.raw_data?.resourceLinks ?? row.raw_data?.resource_links ?? [],
    raw: row.raw_data ?? {},
  };
}

async function eventExists(
  admin: any,
  proposalId: string,
  event: WatchEvent,
): Promise<boolean> {
  const q = admin
    .from("opportunity_watch_events")
    .select("id", { count: "exact", head: true })
    .eq("proposal_id", proposalId)
    .eq("event_type", event.event_type)
    .eq("detail", event.detail);
  if (event.notice_id) q.eq("notice_id", event.notice_id);
  else q.is("notice_id", null);
  const { count } = await q;
  return (count ?? 0) > 0;
}

/** Watch one proposal. Assumes quota already verified for its team. */
async function watchProposal(admin: any, p: WatchProposal): Promise<{ events: number; log: string[] }> {
  const log: string[] = [];
  const events: WatchEvent[] = [];
  const naics = (p.naics_code || "").trim();
  const agency = (p.agency || "").trim();
  const sol = (p.solicitation_number || "").trim();
  const targetSolKey = normalizeSol(sol);
  const knownAttachments = attachmentsFromOppData(p.opportunity_data);
  const knownAttachKey = knownAttachments.join("|");
  const knownDeadline = p.response_deadline ? new Date(p.response_deadline).toISOString().slice(0, 16) : "";

  // (a) Query SAM for the specific solicitation to detect deadline / attachment changes.
  if (sol) {
    try {
      const resp = await searchOpportunities({
        search: sol,
        page_size: 20,
        active: true,
      } as any);
      await logUsage(admin, { team_id: p.team_id ?? "", endpoint: "/opportunities/", params: { search: sol }, cached: false, response_status: 200 });
      const rows = (resp.results ?? [])
        .map((o: any) => mapOpportunityRow(p.team_id ?? "", o))
        .filter((r: any) => normalizeSol(r.solicitation_number) === targetSolKey || (p.notice_id && r.notice_id === p.notice_id));
      const primary = rows[0];
      if (primary) {
        const s = samShape(primary);

        // Deadline change
        const newDeadline = s.responseDeadLine ? new Date(s.responseDeadLine).toISOString().slice(0, 16) : "";
        if (newDeadline && knownDeadline && newDeadline !== knownDeadline) {
          const oldF = new Date(knownDeadline).toISOString().slice(0, 10);
          const newF = new Date(newDeadline).toISOString().slice(0, 10);
          events.push({
            proposal_id: p.id,
            team_id: p.team_id,
            event_type: "deadline_change",
            notice_id: s.noticeId,
            notice_type: s.type,
            title: s.title,
            posted_date: s.postedDate ? new Date(s.postedDate).toISOString().slice(0, 10) : null,
            detail: `Response deadline moved from ${oldF} to ${newF}.`,
            maturity_hint: null,
          });
        }

        // Attachment update (compare list of resourceLinks)
        const newAttachments: string[] = Array.isArray(s.resourceLinks)
          ? s.resourceLinks.filter(Boolean).map(String).sort()
          : [];
        const newAttachKey = newAttachments.join("|");
        if (knownAttachments.length > 0 && newAttachKey !== knownAttachKey) {
          const added = newAttachments.filter((l) => !knownAttachments.includes(l)).length;
          const removed = knownAttachments.filter((l) => !newAttachments.includes(l)).length;
          events.push({
            proposal_id: p.id,
            team_id: p.team_id,
            event_type: "attachment_update",
            notice_id: s.noticeId,
            notice_type: s.type,
            title: s.title,
            posted_date: s.postedDate ? new Date(s.postedDate).toISOString().slice(0, 10) : null,
            detail: `Attachment list changed (${added} added, ${removed} removed). Total ${newAttachments.length}.`,
            maturity_hint: null,
          });
        }

        // Notice-type change / new notice version — treat as new_notice event
        const currentType = (p.opportunity_data?.type || p.opportunity_data?.noticeType || "").toString();
        if (s.type && currentType && s.type !== currentType) {
          events.push({
            proposal_id: p.id,
            team_id: p.team_id,
            event_type: "new_notice",
            notice_id: s.noticeId,
            notice_type: s.type,
            title: s.title,
            posted_date: s.postedDate ? new Date(s.postedDate).toISOString().slice(0, 10) : null,
            detail: `Notice type advanced from "${currentType}" to "${s.type}".`,
            maturity_hint: maturityHintFor(s.type),
          });
        }
      } else {
        log.push(`No SAM match for solicitation ${sol}`);
      }
    } catch (e) {
      const te = e as TangoError;
      log.push(`Solicitation query failed (${te.status}): ${te.message}`);
    }
  }

  // (b) Search recent notices matching NAICS + agency and title-similar to ours.
  if (naics && agency) {
    const since = p.last_watched_at
      ? new Date(p.last_watched_at)
      : new Date(Date.now() - LOOKBACK_DAYS_DEFAULT * 86_400_000);
    try {
      const resp = await searchOpportunities({
        naics,
        first_notice_date_after: since.toISOString().slice(0, 10),
        first_notice_date_before: new Date().toISOString().slice(0, 10),
        active: true,
        page_size: 100,
      } as any);
      await logUsage(admin, { team_id: p.team_id ?? "", endpoint: "/opportunities/", params: { naics, since }, cached: false, response_status: 200 });
      const candidates = (resp.results ?? []).map((o: any) => mapOpportunityRow(p.team_id ?? "", o));
      const oppTitle = p.opportunity_title || "";
      for (const c of candidates) {
        const s = samShape(c);
        const agencyMatch = (c.agency || "").toLowerCase().includes(agency.toLowerCase()) ||
          agency.toLowerCase().includes((c.agency || "").toLowerCase());
        if (!agencyMatch) continue;
        const solMatch = targetSolKey && normalizeSol(s.solicitationNumber) === targetSolKey;
        const overlap = titleOverlap(oppTitle, s.title || "");
        if (!solMatch && overlap < TITLE_OVERLAP_THRESHOLD) continue;
        // Skip our own baseline notice
        if (p.notice_id && s.noticeId === p.notice_id) continue;
        events.push({
          proposal_id: p.id,
          team_id: p.team_id,
          event_type: "new_notice",
          notice_id: s.noticeId,
          notice_type: s.type,
          title: s.title,
          posted_date: s.postedDate ? new Date(s.postedDate).toISOString().slice(0, 10) : null,
          detail: `New SAM notice matched (${s.type ?? "notice"}${solMatch ? ", solicitation number match" : `, ${Math.round(overlap * 100)}% title overlap`}).`,
          maturity_hint: maturityHintFor(s.type),
        });
      }
      log.push(`Related-notice scan: ${candidates.length} candidates, ${events.filter((e) => e.event_type === "new_notice").length} kept`);
    } catch (e) {
      const te = e as TangoError;
      log.push(`Related notice search failed (${te.status}): ${te.message}`);
    }
  }

  // Dedupe and insert
  let inserted = 0;
  for (const ev of events) {
    if (await eventExists(admin, p.id, ev)) continue;
    const { error } = await admin.from("opportunity_watch_events").insert(ev);
    if (error) {
      log.push(`Insert failed: ${error.message}`);
    } else {
      inserted++;
    }
  }

  await admin.from("proposals").update({ last_watched_at: new Date().toISOString() }).eq("id", p.id);
  return { events: inserted, log };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { proposalId, scanAll } = body ?? {};

    // Batch mode — only allowed with service-role bearer (from a scheduled trigger).
    if (scanAll) {
      const auth = req.headers.get("Authorization") || "";
      if (!SERVICE_KEY || auth !== `Bearer ${SERVICE_KEY}`) {
        return jsonError(401, "scanAll requires service-role authorization", corsHeaders);
      }
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: props, error } = await admin
        .from("proposals")
        .select("id, team_id, opportunity_title, agency, naics_code, solicitation_number, notice_id, response_deadline, last_watched_at, opportunity_data")
        .eq("watch_enabled", true)
        .order("last_watched_at", { ascending: true, nullsFirst: true })
        .limit(SCAN_BATCH_SIZE);
      if (error) return jsonError(500, error.message, corsHeaders);

      const results: any[] = [];
      const quotaByTeam = new Map<string, boolean>();
      for (const p of (props ?? []) as WatchProposal[]) {
        const team = p.team_id ?? "";
        if (team) {
          let allowed = quotaByTeam.get(team);
          if (allowed === undefined) {
            const q = await checkDailyUsage(admin, team);
            allowed = q.allowed;
            quotaByTeam.set(team, allowed);
          }
          if (!allowed) { results.push({ proposalId: p.id, skipped: "daily_quota" }); continue; }
        }
        const r = await watchProposal(admin, p);
        results.push({ proposalId: p.id, ...r });
      }
      return new Response(JSON.stringify({ processed: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Manual per-proposal mode — authenticated user with proposal access.
    if (!proposalId) return jsonError(400, "proposalId required", corsHeaders);

    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    try { await assertProposalAccess(ctx, proposalId); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const admin = ctx.admin;
    const { data: p, error } = await admin
      .from("proposals")
      .select("id, team_id, opportunity_title, agency, naics_code, solicitation_number, notice_id, response_deadline, last_watched_at, opportunity_data")
      .eq("id", proposalId)
      .single();
    if (error || !p) return jsonError(404, error?.message ?? "Proposal not found", corsHeaders);

    if (p.team_id) {
      const q = await checkDailyUsage(admin, p.team_id);
      if (!q.allowed) {
        return new Response(
          JSON.stringify({ events: 0, log: [`Daily SAM.gov limit approaching (${q.used}/100). Try again tomorrow.`], rateLimited: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    const r = await watchProposal(admin, p as WatchProposal);
    return new Response(JSON.stringify(r), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("recompete-watch error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
