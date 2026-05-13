import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const ALLOWED_CATEGORIES = [
  "past_performance", "personnel", "capability",
  "boilerplate", "pricing", "win_theme", "other",
];

function decodePlain(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); } catch { return ""; }
}

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch (e) { console.error("pdf parse failed:", e); return ""; }
}

async function extractFromDocx(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: copy.buffer });
    return value || "";
  } catch (e) { console.error("docx parse failed:", e); return ""; }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",", 2)[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { fileBase64, filename, category, title } = await req.json();
    if (!fileBase64 || !filename || !category || !title) {
      throw new Error("fileBase64, filename, category, and title are required");
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      throw new Error(`Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(", ")}`);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) throw new Error("Unauthorized");

    // Check admin role
    const { data: roleRow } = await admin.from("user_roles")
      .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    const isAdmin = !!roleRow;

    const bytes = base64ToBytes(fileBase64);
    const name = filename.toLowerCase();
    let content = "";
    if (name.endsWith(".pdf")) content = await extractFromPdf(bytes);
    else if (name.endsWith(".docx")) content = await extractFromDocx(bytes);
    else if (name.endsWith(".txt") || name.endsWith(".md")) content = decodePlain(bytes);
    else throw new Error("Unsupported file type. Use .pdf, .docx, .txt, or .md");

    content = content.trim();
    if (!content) throw new Error("Could not extract any text from the file.");

    const row = {
      user_id: isAdmin ? null : user.id, // admins ingest as org-wide
      category,
      title,
      content: content.slice(0, 200_000),
      source_filename: filename,
      tags: [],
    };

    const { data: inserted, error: insErr } = await admin
      .from("knowledge_base").insert(row).select().single();
    if (insErr) throw new Error(insErr.message);

    return new Response(JSON.stringify({ entry: inserted, chars: content.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ingest-knowledge error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
