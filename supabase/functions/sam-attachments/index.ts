// Downloads SAM.gov solicitation attachments using the resourceLinks
// array from the opportunity payload (v2 search). Saves them into the
// proposal-attachments storage bucket.
import { corsHeaders } from "../_shared/cors.ts";

import { authenticate, assertProposalAccess, authErrorResponse } from "../_shared/auth.ts";

const SAM_KEY = Deno.env.get("SAM_GOV_API_KEY");

function appendKey(url: string) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}api_key=${SAM_KEY}`;
}

function filenameFromHeaders(headers: Headers, fallback: string) {
  const cd = headers.get("content-disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?["]?([^";]+)["]?/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : fallback;
}

function classify(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("sow") || n.includes("pws") || n.includes("statement_of_work") || n.includes("statement of work")) return "sow";
  if (n.includes("section_l") || n.includes("section l") || n.includes("section_m") || n.includes("section m") || n.includes("instructions")) return "instructions";
  if (n.includes("amend") || n.includes("mod ") || n.includes("_mod") || n.includes("modification")) return "amendment";
  if (n.includes("qasp") || n.includes("cdrl") || n.includes("dd254") || n.includes("dd_254")) return "attachment";
  return "other";
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "file";
    return decodeURIComponent(last);
  } catch { return "file"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!SAM_KEY) throw new Error("SAM_GOV_API_KEY not configured");

    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const supabase = ctx.admin;

    const { proposalId, action } = await req.json();

    // Verify the caller can see this proposal BEFORE using service-role to read.
    try { await assertProposalAccess(ctx, proposalId); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    // Pull the proposal and its opportunity_data to find resourceLinks
    const { data: prop, error: propErr } = await supabase
      .from("proposals").select("opportunity_data, notice_id").eq("id", proposalId).single();
    if (propErr) throw propErr;


    const od: any = prop?.opportunity_data ?? {};
    const links: string[] = Array.isArray(od.resourceLinks) ? od.resourceLinks.filter(Boolean) : [];

    if (action === "list") {
      return new Response(JSON.stringify({ links }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "download") {
      if (links.length === 0) {
        return new Response(JSON.stringify({ saved: [], errors: [], attempted: 0, message: "No resourceLinks on this opportunity. Upload manually." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const saved: any[] = [];
      const errors: any[] = [];
      const results: any[] = [];
      for (const link of links) {
        const guessedName = nameFromUrl(link);
        try {
          const r = await fetch(appendKey(link), { redirect: "follow" });
          if (r.status === 401 || r.status === 403) {
            results.push({ link, filename: guessedName, status: "auth_required", httpStatus: r.status });
            errors.push({ link, error: `HTTP ${r.status} — SAM.gov login required` });
            continue;
          }
          if (!r.ok) {
            results.push({ link, filename: guessedName, status: "error", httpStatus: r.status, error: `HTTP ${r.status}` });
            errors.push({ link, error: `HTTP ${r.status}` });
            continue;
          }
          const contentType = r.headers.get("content-type") || "application/octet-stream";
          // SAM sometimes returns the login HTML page with 200 — detect that
          if (contentType.includes("text/html")) {
            results.push({ link, filename: guessedName, status: "auth_required", httpStatus: r.status, error: "Received HTML (login page)" });
            errors.push({ link, error: "SAM.gov returned HTML (login required)" });
            continue;
          }
          const fallback = `file-${crypto.randomUUID()}`;
          const name = filenameFromHeaders(r.headers, guessedName || fallback);
          const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const buf = new Uint8Array(await r.arrayBuffer());
          // Proposal-scoped path so opportunity-team collaborators can access
          // via storage RLS (see "Read proposal files by proposal access").
          const path = `proposals/${proposalId}/${crypto.randomUUID()}-${safeName}`;
          const { error: upErr } = await supabase.storage.from("proposal-attachments")
            .upload(path, buf, { contentType, upsert: true });
          if (upErr) throw upErr;
          const { data: row, error: insErr } = await supabase.from("proposal_attachments").insert({
            proposal_id: proposalId,
            filename: name,
            file_type: classify(name),
            storage_path: path,
            source: "sam_auto",
            size_bytes: buf.byteLength,
          }).select().single();
          if (insErr) throw insErr;
          saved.push(row);
          results.push({ link, filename: name, status: "downloaded", size: buf.byteLength });
        } catch (e: any) {
          results.push({ link, filename: guessedName, status: "error", error: e.message });
          errors.push({ link, error: e.message });
        }
      }
      return new Response(JSON.stringify({ saved, errors, results, attempted: links.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
