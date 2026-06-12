import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { authenticate, resolveTeamId, authErrorResponse } from "../_shared/auth.ts";
import { wrapUntrusted } from "../_shared/untrusted.ts";

const ALLOWED_CATEGORIES = [
  "past_performance", "personnel", "capability",
  "boilerplate", "pricing", "win_theme", "other",
];

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch (e) {
    console.error("pdf parse failed:", e);
    return "";
  }
}

function decodePlain(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); } catch { return ""; }
}

async function extractFromDocx(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: copy.buffer });
    if (value) return value;
  } catch (e) {
    console.error("docx arrayBuffer parse failed, trying buffer:", e);
  }
  try {
    const { value } = await mammoth.extractRawText({ buffer: copy } as any);
    return value || "";
  } catch (e) {
    console.error("docx buffer parse failed:", e);
    return "";
  }
}

function extractFromXlsx(bytes: Uint8Array): string {
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) parts.push(`--- Sheet: ${name} ---\n${csv}`);
    }
    return parts.join("\n\n");
  } catch (e) {
    console.error("xlsx parse failed:", e);
    return "";
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",", 2)[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const { filename, category, title, fileBase64, fileType, tags, teamId } = await req.json();
    if (!filename || !category || !title || !fileBase64) {
      return jsonResponse({ error: "filename, category, title, and fileBase64 are required" }, 400);
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return jsonResponse({ error: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(", ")}` }, 400);
    }

    let verifiedTeamId: string | null;
    try { verifiedTeamId = await resolveTeamId(ctx, teamId ?? null); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    if (!verifiedTeamId) {
      return jsonResponse({ error: "No team available for this user" }, 400);
    }

    let bytes: Uint8Array;
    try { bytes = base64ToBytes(fileBase64); }
    catch (e) { return jsonResponse({ error: `Invalid base64 payload: ${e instanceof Error ? e.message : "decode failed"}` }, 400); }

    const name = String(filename).toLowerCase();
    const ftype = String(fileType || "").toLowerCase();
    let content = "";
    if (name.endsWith(".pdf") || ftype.includes("pdf")) {
      content = await extractFromPdf(bytes);
    } else if (name.endsWith(".docx") || name.endsWith(".doc") || ftype.includes("word") || ftype.includes("officedocument.wordprocessingml")) {
      content = await extractFromDocx(bytes);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm") || ftype.includes("spreadsheet") || ftype.includes("excel")) {
      content = extractFromXlsx(bytes);
    } else if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv") || ftype.startsWith("text/")) {
      content = decodePlain(bytes);
    } else {
      content = decodePlain(bytes);
    }

    content = (content || "").trim();
    if (!content) {
      return jsonResponse({ error: "Could not extract text from this file. Try a text-based PDF or .txt version." }, 400);
    }
    content = content.slice(0, 200_000);
    // Pre-wrap the extracted document text as an UNTRUSTED block at storage
    // time so any downstream LLM prompt assembly is forced to treat the
    // content as untrusted document data and ignore injected instructions.
    const storedContent = wrapUntrusted(`knowledge-base:${category}:${title}`, content);

    const tagList: string[] = Array.isArray(tags)
      ? tags.filter((t) => typeof t === "string" && t.trim()).map((t: string) => t.trim())
      : typeof tags === "string"
        ? tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

    const { data: inserted, error: insErr } = await ctx.userClient
      .from("knowledge_base")
      .insert({
        user_id: ctx.user.id,
        team_id: verifiedTeamId,
        category,
        title,
        content: storedContent,
        source_filename: filename,
        tags: tagList,
      })
      .select("id,title,category")
      .single();
    if (insErr) return jsonResponse({ error: insErr.message }, 500);

    return jsonResponse({
      id: inserted.id,
      title: inserted.title,
      category: inserted.category,
      chars: storedContent.length,
    });
  } catch (e) {
    console.error("ingest-knowledge error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
