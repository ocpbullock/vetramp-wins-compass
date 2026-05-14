import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { callAI as sharedCallAI, AIRateLimitError, AICreditsError, AITimeoutError, AIBudgetExceededError, pickModel, hashCacheKey, getCachedResponse, setCachedResponse } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PER_FILE_LIMIT = 150_000;
const COMBINED_LIMIT = 500_000;
const CHUNK_SIZE = 100_000;
const CHUNK_OVERLAP = 2_000;

const MATRIX_SCHEMA = {
  type: "object",
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          req_id: { type: "string", description: "Stable id like R-001, R-002…" },
          source_section: { type: "string", description: "e.g. 'PWS 3.2.1', 'Section L', 'Section M.4'" },
          requirement_text: { type: "string", description: "Verbatim or near-verbatim requirement statement." },
          type: { type: "string", enum: ["shall", "should", "may", "evaluation_criterion", "submission_instruction"] },
          category: { type: "string" },
          proposal_section: { type: "string" },
          notes: { type: "string" },
        },
        required: ["req_id", "source_section", "requirement_text", "type", "proposal_section"],
      },
    },
    evaluation_factors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          factor: { type: "string" },
          weight: { type: "string" },
          description: { type: "string" },
        },
        required: ["factor"],
      },
    },
    submission_instructions: { type: "array", items: { type: "string" } },
    page_limits: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    capture_details: {
      type: "object",
      properties: {
        opportunity_title: { type: "string" },
        agency: { type: "string" },
        solicitation_number: { type: "string" },
        naics_code: { type: "string" },
        set_aside: { type: "string" },
        contract_type: { type: "string" },
        estimated_value: { type: "number" },
        pop_base_months: { type: "integer" },
        pop_option_months: { type: "integer" },
        clearance_requirement: { type: "string" },
        response_deadline: { type: "string" },
        incumbent: { type: "string" },
        place_of_performance: { type: "string" },
        key_personnel: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["requirements", "summary"],
};

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
  } catch (e) { console.error("docx arrayBuffer parse failed:", e); }
  try {
    const { value } = await mammoth.extractRawText({ buffer: copy } as any);
    return value || "";
  } catch (e) { console.error("docx buffer parse failed:", e); return ""; }
}

function extractFromXlsx(bytes: Uint8Array): string {
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
      if (csv.trim()) parts.push(`--- Sheet: ${name} ---\n${csv}`);
    }
    return parts.join("\n\n");
  } catch (e) { console.error("xlsx parse failed:", e); return ""; }
}

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

function normReq(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Dice coefficient on word bigrams — fast fuzzy similarity
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, ca] of A) {
    const cb = B.get(g);
    if (cb) inter += Math.min(ca, cb);
  }
  const total = (a.length - 1) + (b.length - 1);
  return (2 * inter) / total;
}

function dedupeRequirements(reqs: any[]): any[] {
  const kept: any[] = [];
  const norms: string[] = [];
  for (const r of reqs) {
    const n = normReq(String(r.requirement_text || ""));
    if (!n) continue;
    let dup = false;
    for (let i = 0; i < norms.length; i++) {
      if (similarity(n, norms[i]) > 0.9) {
        // merge: keep the one with more metadata
        if (Object.values(r).filter(Boolean).length > Object.values(kept[i]).filter(Boolean).length) {
          kept[i] = r;
          norms[i] = n;
        }
        dup = true;
        break;
      }
    }
    if (!dup) { kept.push(r); norms.push(n); }
  }
  // renumber
  return kept.map((r, i) => ({ ...r, req_id: `R-${String(i + 1).padStart(3, "0")}` }));
}

function mergeCapture(a: any, b: any): any {
  const out: any = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) {
      out[k] = Array.from(new Set([...(out[k] || []), ...v]));
    } else if (out[k] === undefined || out[k] === null || out[k] === "") {
      out[k] = v;
    }
  }
  return out;
}

async function callAI(_apiKey: string, system: string, user: string, teamId: string | null, userId: string | null, proposalId: string | null): Promise<any> {
  const data = await sharedCallAI({
    functionName: "parse-sow",
    teamId,
    userId,
    proposalId,
    body: {
      model: pickModel("parse-sow"),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{ type: "function", function: { name: "return_compliance_matrix", description: "Return structured compliance matrix and capture details.", parameters: MATRIX_SCHEMA } }],
      tool_choice: { type: "function", function: { name: "return_compliance_matrix" } },
    },
  });
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return args ? JSON.parse(args) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { proposalId, skipCache } = await req.json().catch(() => ({}));
  if (!proposalId) {
    return new Response(JSON.stringify({ error: "proposalId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceKey);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
      };
      const fail = async (msg: string) => {
        await admin.from("proposals").update({ parsing_status: "error" }).eq("id", proposalId);
        send("error", { error: msg });
        try { controller.close(); } catch {}
      };

      try {
        if (!apiKey) return await fail("LOVABLE_API_KEY not configured");

        await admin.from("proposals").update({ parsing_status: "parsing" }).eq("id", proposalId);
        send("status", { phase: "loading", message: "Loading proposal…" });

        const { data: proposal, error: pe } = await userClient.from("proposals").select("*").eq("id", proposalId).maybeSingle();
        if (pe || !proposal) return await fail("Proposal not found or not accessible");

        const { data: atts, error: ae } = await userClient.from("proposal_attachments").select("*").eq("proposal_id", proposalId);
        if (ae) return await fail(ae.message);
        if (!atts || atts.length === 0) return await fail("No attachments to parse. Upload the SOW/PWS/RFP first.");

        send("status", { phase: "extracting", message: `Extracting text from ${atts.length} file${atts.length === 1 ? "" : "s"}…` });

        const parsed: Array<{ id: string; filename: string; text: string; chars: number; truncated: boolean; empty: boolean }> = [];
        for (const a of atts) {
          const { data: blob, error: dlErr } = await admin.storage.from("proposal-attachments").download(a.storage_path);
          if (dlErr || !blob) { console.error("download failed", a.storage_path, dlErr); continue; }
          const buf = new Uint8Array(await blob.arrayBuffer());
          let text = "";
          const name = (a.filename || "").toLowerCase();
          if (name.endsWith(".pdf") || (a.file_type && String(a.file_type).toLowerCase().includes("pdf"))) text = await extractFromPdf(buf);
          else if (name.endsWith(".docx") || name.endsWith(".doc")) text = await extractFromDocx(buf);
          else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) text = extractFromXlsx(buf);
          else text = decodePlain(buf);

          const fullChars = text.length;
          const trimmed = text.slice(0, PER_FILE_LIMIT);
          parsed.push({
            id: a.id,
            filename: a.filename,
            text: trimmed,
            chars: fullChars,
            truncated: fullChars > PER_FILE_LIMIT,
            empty: fullChars === 0,
          });
          await admin.from("proposal_attachments").update({ parsed_content: trimmed }).eq("id", a.id);
        }

        send("files", { files: parsed.map((p) => ({ filename: p.filename, chars: p.chars, truncated: p.truncated, empty: p.empty })) });

        const combined = parsed.map((p) => `=== ${p.filename} ===\n${p.text}`).join("\n\n").slice(0, COMBINED_LIMIT);
        if (!combined.trim()) return await fail("Could not extract text from attachments. Upload a text-based PDF or .txt version of the SOW.");

        // ----- Cache check -----
        const { data: { user } = { user: null } } = await userClient.auth.getUser();
        const userId = user?.id ?? null;
        const teamId = proposal.team_id ?? null;
        const cacheKey = await hashCacheKey({
          combined_hash: await hashCacheKey(combined),
          opportunity_title: proposal.opportunity_title,
          agency: proposal.agency,
          solicitation_number: proposal.solicitation_number,
          naics_code: proposal.naics_code,
        });
        if (!skipCache) {
          const cached = await getCachedResponse("parse-sow", cacheKey);
          if (cached) {
            send("status", { phase: "cache_hit", message: "Returning cached parse result (less than 24h old)…" });
            const matrix = cached.response_data;
            await admin.from("proposals").update({ compliance_matrix: matrix, parsing_status: "complete" }).eq("id", proposalId);
            send("done", {
              matrix,
              cached: true,
              cached_at: cached.created_at,
              requirements_count: matrix?.requirements?.length ?? 0,
              chunks: matrix?.parse_metadata?.total_chunks ?? 0,
            });
            try { controller.close(); } catch {}
            return;
          }
        }

        const chunks = chunkText(combined);
        send("status", { phase: "chunked", totalChunks: chunks.length, totalChars: combined.length });

        const system = `You are a federal proposal compliance expert. Read the provided solicitation excerpt and produce (1) a partial compliance traceability matrix capturing EVERY 'shall', 'must', 'will' requirement, every Section L submission instruction, and every Section M evaluation factor that appears IN THIS EXCERPT (use req_ids R-001, R-002, … local to this excerpt; map each requirement to the proposal section that should respond to it), AND (2) a capture_details object with intake fields extracted verbatim. For capture_details, leave a field empty/null if not clearly stated — do NOT guess. Multiple excerpts will be merged later, so be exhaustive within this excerpt and avoid speculation about missing context.`;

        const meta = `OPPORTUNITY METADATA (may be incomplete — prefer values from the documents):\nTitle: ${proposal.opportunity_title}\nAgency: ${proposal.agency}\nSolicitation: ${proposal.solicitation_number}\nNAICS: ${proposal.naics_code}\n`;

        const partials: any[] = [];
        for (let i = 0; i < chunks.length; i++) {
          send("progress", { chunk: i + 1, total: chunks.length, message: `Parsing chunk ${i + 1} of ${chunks.length}…` });
          const userMsg = `${meta}\nEXCERPT ${i + 1} of ${chunks.length}:\n${chunks[i]}`;
          try {
            const partial = await callAI(apiKey, system, userMsg, teamId, userId, proposalId);
            if (partial) partials.push(partial);
          } catch (e: any) {
            if (e instanceof AIRateLimitError) return await fail("Rate limit exceeded. Try again in a few minutes.");
            if (e instanceof AICreditsError) return await fail("AI credits exhausted.");
            if (e instanceof AIBudgetExceededError) return await fail(e.message);
            if (e instanceof AITimeoutError) return await fail(e.message);
            console.error("chunk failed:", i + 1, e);
            send("warn", { message: `Chunk ${i + 1} failed: ${e.message}` });
          }
        }

        if (partials.length === 0) return await fail("All chunks failed to parse.");

        send("progress", { phase: "merging", message: "Merging results…" });

        const allReqs = partials.flatMap((p) => Array.isArray(p.requirements) ? p.requirements : []);
        const requirements = dedupeRequirements(allReqs);
        const evaluation_factors = partials.flatMap((p) => Array.isArray(p.evaluation_factors) ? p.evaluation_factors : []);
        const submission_instructions = Array.from(new Set(partials.flatMap((p) => Array.isArray(p.submission_instructions) ? p.submission_instructions : [])));
        const page_limits = Array.from(new Set(partials.flatMap((p) => Array.isArray(p.page_limits) ? p.page_limits : [])));
        const summary = partials.map((p) => p.summary).filter(Boolean).join("\n\n");
        const capture_details = partials.reduce((acc, p) => mergeCapture(acc, p.capture_details || {}), {} as any);

        const parse_metadata = {
          total_chars: combined.length,
          total_chunks: chunks.length,
          successful_chunks: partials.length,
          parsed_files: parsed.map((p) => ({ filename: p.filename, chars: p.chars, truncated: p.truncated, empty: p.empty })),
          truncated_any: parsed.some((p) => p.truncated),
          parsed_at: new Date().toISOString(),
        };
        const matrix = { requirements, evaluation_factors, submission_instructions, page_limits, summary, capture_details, parse_metadata };
        const gaps = requirements.filter((r: any) => !r.proposal_section).length;

        const cap = capture_details;
        const update: Record<string, any> = {
          compliance_matrix: matrix,
          compliance_gaps: gaps,
          parsing_status: "complete",
        };
        const fillIfEmpty = (col: string, value: any) => {
          if (value === undefined || value === null || value === "") return;
          const current = (proposal as any)[col];
          const isEmpty = current === null || current === undefined || current === "" || current === 0;
          if (isEmpty) update[col] = value;
        };
        fillIfEmpty("opportunity_title", cap.opportunity_title);
        fillIfEmpty("agency", cap.agency);
        fillIfEmpty("solicitation_number", cap.solicitation_number);
        fillIfEmpty("naics_code", cap.naics_code);
        fillIfEmpty("set_aside", cap.set_aside);
        fillIfEmpty("contract_type", cap.contract_type);
        fillIfEmpty("estimated_value", typeof cap.estimated_value === "number" ? cap.estimated_value : null);
        fillIfEmpty("pop_base_months", typeof cap.pop_base_months === "number" ? cap.pop_base_months : null);
        fillIfEmpty("pop_option_months", typeof cap.pop_option_months === "number" ? cap.pop_option_months : null);
        fillIfEmpty("clearance_requirement", cap.clearance_requirement);
        if (cap.response_deadline && !proposal.response_deadline) {
          const d = new Date(cap.response_deadline);
          if (!isNaN(d.getTime())) update.response_deadline = d.toISOString();
        }
        const extras: Record<string, any> = {};
        if (cap.incumbent) extras.incumbent_from_sow = cap.incumbent;
        if (cap.place_of_performance) extras.place_of_performance = cap.place_of_performance;
        if (Array.isArray(cap.key_personnel) && cap.key_personnel.length) extras.key_personnel = cap.key_personnel;
        if (Object.keys(extras).length && !proposal.customer_intel_verified) {
          update.customer_intel = { ...(proposal.customer_intel || {}), ...extras };
        }

        await admin.from("proposals").update(update).eq("id", proposalId);

        // Cache final matrix for 24h
        try { await setCachedResponse({ functionName: "parse-sow", cacheKey, teamId, responseData: matrix, model: pickModel("parse-sow") }); } catch (e) { console.error("cache write failed:", e); }

        send("done", {
          matrix,
          capture_details: cap,
          filled_fields: Object.keys(update).filter((k) => k !== "compliance_matrix" && k !== "compliance_gaps" && k !== "parsing_status"),
          parsed_files: parsed.map((p) => ({ filename: p.filename, chars: p.chars, truncated: p.truncated })),
          chunks: chunks.length,
          requirements_count: requirements.length,
        });
        try { controller.close(); } catch {}
      } catch (e: any) {
        console.error("parse-sow error:", e);
        await fail(e?.message || "Unknown error");
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
