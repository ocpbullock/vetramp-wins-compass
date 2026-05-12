import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
          category: { type: "string", description: "e.g. Technical, Management, Past Performance, Pricing, Personnel, Security, Transition, Reporting." },
          proposal_section: { type: "string", description: "Which proposal section will respond to this (Cover Letter / Executive Summary / Technical Approach / Management Approach / Past Performance / Staffing Plan / Pricing / Compliance Matrix)." },
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
    summary: { type: "string", description: "1-2 paragraph executive summary of what's required and how to win." },
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { proposalId } = await req.json();
    if (!proposalId) throw new Error("proposalId required");

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    // user-scoped client to enforce RLS on read
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: proposal, error: pe } = await userClient.from("proposals").select("*").eq("id", proposalId).maybeSingle();
    if (pe || !proposal) throw new Error("Proposal not found or not accessible");

    const { data: atts, error: ae } = await userClient.from("proposal_attachments").select("*").eq("proposal_id", proposalId);
    if (ae) throw ae;
    if (!atts || atts.length === 0) throw new Error("No attachments to parse. Upload the SOW/PWS/RFP first.");

    // download + extract text per attachment
    const parsed: Array<{ id: string; filename: string; text: string }> = [];
    for (const a of atts) {
      const { data: blob, error: dlErr } = await admin.storage.from("proposal-attachments").download(a.storage_path);
      if (dlErr || !blob) { console.error("download failed", a.storage_path, dlErr); continue; }
      const buf = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      const name = (a.filename || "").toLowerCase();
      if (name.endsWith(".pdf") || (a.file_type && String(a.file_type).toLowerCase().includes("pdf"))) {
        text = await extractFromPdf(buf);
      } else if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) {
        text = decodePlain(buf);
      } else {
        // best effort plain decode (won't help for docx but won't crash)
        text = decodePlain(buf);
      }
      // truncate per file to keep prompt size sane
      const trimmed = text.slice(0, 60_000);
      parsed.push({ id: a.id, filename: a.filename, text: trimmed });
      // cache parsed_content
      await admin.from("proposal_attachments").update({ parsed_content: trimmed }).eq("id", a.id);
    }

    const combined = parsed.map((p) => `=== ${p.filename} ===\n${p.text}`).join("\n\n").slice(0, 180_000);
    if (!combined.trim()) throw new Error("Could not extract text from attachments. Upload a text-based PDF or .txt version of the SOW.");

    const system = `You are a federal proposal compliance expert. Read the provided solicitation documents (SOW/PWS, Section L, Section M, attachments) and produce a complete compliance traceability matrix. Capture EVERY 'shall', 'must', and 'will' requirement, every Section L submission instruction, and every Section M evaluation factor. Be exhaustive. Use stable req_ids like R-001, R-002. Map each requirement to the proposal section that should respond to it.`;

    const user = `OPPORTUNITY METADATA:\nTitle: ${proposal.opportunity_title}\nAgency: ${proposal.agency}\nSolicitation: ${proposal.solicitation_number}\nNAICS: ${proposal.naics_code}\n\nSOLICITATION DOCUMENTS:\n${combined}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [{ type: "function", function: { name: "return_compliance_matrix", description: "Return structured compliance matrix.", parameters: MATRIX_SCHEMA } }],
        tool_choice: { type: "function", function: { name: "return_compliance_matrix" } },
      }),
    });

    if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `AI gateway error: ${t}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const matrix = args ? JSON.parse(args) : null;
    if (!matrix) throw new Error("No matrix returned");

    const gaps = (matrix.requirements || []).filter((r: any) => !r.proposal_section).length;
    await admin.from("proposals").update({
      compliance_matrix: matrix,
      compliance_gaps: gaps,
    }).eq("id", proposalId);

    return new Response(JSON.stringify({ matrix, parsed_files: parsed.map((p) => ({ filename: p.filename, chars: p.text.length })) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("parse-sow error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
