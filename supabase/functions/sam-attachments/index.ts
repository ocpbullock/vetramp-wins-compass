// Lists attachments for a SAM.gov notice and (optionally) downloads them
// into the proposal-attachments storage bucket.
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SAM_KEY = Deno.env.get("SAM_GOV_API_KEY");

async function fetchResourceList(noticeId: string) {
  const url = `https://api.sam.gov/opportunities/v3/${encodeURIComponent(noticeId)}/resources?api_key=${SAM_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`SAM resources HTTP ${r.status}`);
  const j = await r.json();
  const list: any[] = [];
  const oal = j?._embedded?.opportunityAttachmentList ?? j?.embedded?.opportunityAttachmentList ?? [];
  for (const grp of oal) {
    for (const a of grp.attachments ?? []) {
      list.push({
        resourceId: a.resourceId ?? a.attachmentId,
        name: a.name ?? a.fileName ?? "attachment",
        type: a.type ?? a.mimeType ?? null,
        size: a.size ?? null,
      });
    }
  }
  return list;
}

async function downloadResource(resourceId: string): Promise<{ blob: Uint8Array; contentType: string }> {
  const url = `https://api.sam.gov/opportunities/v3/resources/files/${encodeURIComponent(resourceId)}/download?api_key=${SAM_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`SAM download HTTP ${r.status}`);
  const contentType = r.headers.get("content-type") || "application/octet-stream";
  const buf = new Uint8Array(await r.arrayBuffer());
  return { blob: buf, contentType };
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

    const { proposalId, noticeId, action } = await req.json();
    if (!noticeId) throw new Error("noticeId required");

    const list = await fetchResourceList(noticeId);

    if (action === "list") {
      return new Response(JSON.stringify({ attachments: list }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "download") {
      if (!proposalId) throw new Error("proposalId required");
      const saved: any[] = [];
      const errors: any[] = [];
      for (const a of list) {
        try {
          const { blob, contentType } = await downloadResource(a.resourceId);
          const safeName = (a.name || `file-${a.resourceId}`).replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `${userId}/${proposalId}/${a.resourceId}-${safeName}`;
          const { error: upErr } = await supabase.storage.from("proposal-attachments")
            .upload(path, blob, { contentType, upsert: true });
          if (upErr) throw upErr;
          const ext = safeName.toLowerCase();
          const fileType = ext.includes("sow") ? "sow"
            : ext.includes("pws") ? "sow"
            : ext.includes("section_l") || ext.includes("sectionl") ? "section_l"
            : ext.includes("section_m") || ext.includes("sectionm") ? "section_m"
            : ext.includes("amend") ? "amendment"
            : ext.includes("q&a") || ext.includes("qa") ? "qa"
            : "attachment";
          const { data: row, error: insErr } = await supabase.from("proposal_attachments").insert({
            proposal_id: proposalId,
            filename: a.name,
            file_type: fileType,
            storage_path: path,
            source: "sam_auto",
            size_bytes: blob.byteLength,
          }).select().single();
          if (insErr) throw insErr;
          saved.push(row);
        } catch (e: any) {
          errors.push({ name: a.name, error: e.message });
        }
      }
      return new Response(JSON.stringify({ saved, errors, attempted: list.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
