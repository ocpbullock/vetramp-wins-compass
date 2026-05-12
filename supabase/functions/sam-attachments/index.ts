// Downloads SAM.gov solicitation attachments using the resourceLinks
// array from the opportunity payload (v2 search). Saves them into the
// proposal-attachments storage bucket.
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  if (n.includes("sow") || n.includes("pws") || n.includes("statement_of_work")) return "sow";
  if (n.includes("section_l") || n.includes("sectionl") || n.includes("section l")) return "section_l";
  if (n.includes("section_m") || n.includes("sectionm") || n.includes("section m")) return "section_m";
  if (n.includes("amend")) return "amendment";
  if (n.includes("q&a") || n.includes("qa") || n.includes("questions")) return "qa";
  if (n.includes("rfp") || n.includes("rfq") || n.includes("solicitation")) return "solicitation";
  return "attachment";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!SAM_KEY) throw new Error("SAM_GOV_API_KEY not configured");
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: ures } = await userClient.auth.getUser();
    const userId = ures?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { proposalId, action } = await req.json();
    if (!proposalId) throw new Error("proposalId required");

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
      for (const link of links) {
        try {
          const r = await fetch(appendKey(link), { redirect: "follow" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const contentType = r.headers.get("content-type") || "application/octet-stream";
          const fallback = `file-${crypto.randomUUID()}`;
          const name = filenameFromHeaders(r.headers, fallback);
          const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const buf = new Uint8Array(await r.arrayBuffer());
          const path = `${userId}/${proposalId}/${crypto.randomUUID()}-${safeName}`;
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
        } catch (e: any) {
          errors.push({ link, error: e.message });
        }
      }
      return new Response(JSON.stringify({ saved, errors, attempted: links.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
