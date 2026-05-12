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
    capture_details: {
      type: "object",
      description: "Intake fields extracted from the solicitation. Leave a field empty/null if not clearly stated in the documents — do NOT guess.",
      properties: {
        opportunity_title: { type: "string" },
        agency: { type: "string", description: "Issuing agency / command / office." },
        solicitation_number: { type: "string" },
        naics_code: { type: "string" },
        set_aside: { type: "string", description: "e.g. 'Total Small Business', '8(a)', 'SDVOSB', 'HUBZone', 'Unrestricted'." },
        contract_type: { type: "string", description: "e.g. 'FFP', 'T&M', 'CPFF', 'IDIQ', 'BPA'." },
        estimated_value: { type: "number", description: "Total estimated contract value in USD if stated." },
        pop_base_months: { type: "integer", description: "Base period of performance in months." },
        pop_option_months: { type: "integer", description: "Total option period months (sum of all options)." },
        clearance_requirement: { type: "string", description: "e.g. 'None', 'Public Trust', 'Secret', 'Top Secret', 'TS/SCI'." },
        response_deadline: { type: "string", description: "ISO 8601 timestamp of proposal due date if stated." },
        incumbent: { type: "string", description: "Name of the incumbent contractor if identified." },
        place_of_performance: { type: "string" },
        key_personnel: { type: "array", items: { type: "string" }, description: "Required key personnel labor categories." },
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
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    return value || "";
  } catch (e) {
    console.error("docx parse failed:", e);
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
      } else if (name.endsWith(".docx") || name.endsWith(".doc")) {
        text = await extractFromDocx(buf);
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
        text = extractFromXlsx(buf);
      } else if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) {
        text = decodePlain(buf);
      } else {
        // best effort plain decode
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

    const system = `You are a federal proposal compliance expert. Read the provided solicitation documents (SOW/PWS, Section L, Section M, attachments) and produce (1) a complete compliance traceability matrix capturing EVERY 'shall', 'must', and 'will' requirement, every Section L submission instruction, and every Section M evaluation factor (use stable req_ids R-001, R-002, …; map each requirement to the proposal section that should respond to it), AND (2) a capture_details object with intake fields extracted verbatim from the documents. For capture_details, leave a field empty/null if it is not clearly stated — do NOT guess.`;

    const user = `OPPORTUNITY METADATA (may be incomplete — prefer values from the documents):\nTitle: ${proposal.opportunity_title}\nAgency: ${proposal.agency}\nSolicitation: ${proposal.solicitation_number}\nNAICS: ${proposal.naics_code}\n\nSOLICITATION DOCUMENTS:\n${combined}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [{ type: "function", function: { name: "return_compliance_matrix", description: "Return structured compliance matrix and capture details.", parameters: MATRIX_SCHEMA } }],
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

    // Build update payload — only set intake fields that are empty in the proposal AND non-empty from AI
    const cap = matrix.capture_details || {};
    const update: Record<string, any> = {
      compliance_matrix: matrix,
      compliance_gaps: gaps,
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

    // Stash extras (incumbent, place_of_performance, key_personnel) into customer_intel without overwriting verified data
    const extras: Record<string, any> = {};
    if (cap.incumbent) extras.incumbent_from_sow = cap.incumbent;
    if (cap.place_of_performance) extras.place_of_performance = cap.place_of_performance;
    if (Array.isArray(cap.key_personnel) && cap.key_personnel.length) extras.key_personnel = cap.key_personnel;
    if (Object.keys(extras).length && !proposal.customer_intel_verified) {
      update.customer_intel = { ...(proposal.customer_intel || {}), ...extras };
    }

    await admin.from("proposals").update(update).eq("id", proposalId);

    return new Response(JSON.stringify({
      matrix,
      capture_details: cap,
      filled_fields: Object.keys(update).filter((k) => k !== "compliance_matrix" && k !== "compliance_gaps"),
      parsed_files: parsed.map((p) => ({ filename: p.filename, chars: p.text.length })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("parse-sow error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
