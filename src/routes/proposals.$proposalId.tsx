import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { mergeServerProposal } from "@/lib/intake-merge";
import { userContextFromProposal, USER_CONTEXT_LABELS } from "@/lib/user-context";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Upload, Download, Sparkles, RefreshCw, FileText, CheckCircle2, Circle, AlertTriangle, Trash2, ExternalLink, Search, ListChecks, ShieldCheck, Linkedin } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { exportProposalDocx } from "@/lib/proposal-export";
import { TeamingCard, fetchTeamingForProposal } from "@/components/proposals/TeamingCard";
import { LinkOpportunityTeamCard } from "@/components/proposals/LinkOpportunityTeamCard";
import { PartnerResearch } from "@/components/proposals/PartnerResearch";
import { RelevantPastPerformanceCard } from "@/components/proposals/RelevantPastPerformanceCard";
import { ComplianceStep } from "@/components/proposals/ComplianceStep";
import { MilestoneTimeline } from "@/components/proposals/MilestoneTimeline";
import { SolutionDesignStep } from "@/components/proposals/SolutionDesignStep";
import { classifyFilename, ATTACHMENT_TYPE_OPTIONS } from "@/lib/attachment-classify";
import { composeAttachmentsText } from "@/lib/attachments-text";
import { extractTemplateStructure, findActiveTemplate, type TemplateSection } from "@/lib/proposal-template";
import { DataProvenance } from "@/components/dashboard/DataSourceBadge";
import { OCIScreeningCard, ociStatus, type OciAnswers } from "@/components/proposals/OCIScreeningCard";
import { StepErrorBoundary } from "@/components/StepErrorBoundary";
import { PrimeContractorCombobox } from "@/components/proposals/PrimeContractorCombobox";
import { OfflineBanner, useOnline } from "@/components/OfflineBanner";
import { friendlyError, friendlyFromError, friendlyFromResponse } from "@/lib/api-errors";
import { validateProposal, validateComplianceMatrix, type ValidationIssue } from "@/lib/proposal-validate";

export const Route = createFileRoute("/proposals/$proposalId")({ component: ProposalPipeline });

const PRIME_SECTIONS: { id: string; title: string }[] = [
  { id: "cover_letter", title: "Cover Letter" },
  { id: "executive_summary", title: "Executive Summary" },
  { id: "technical_approach", title: "Technical Approach" },
  { id: "management_approach", title: "Management Approach" },
  { id: "past_performance", title: "Past Performance" },
  { id: "staffing_plan", title: "Staffing Plan" },
  { id: "compliance_matrix", title: "Compliance Cross-Reference Matrix" },
];

// Sub-mode: we produce content ON BEHALF OF the prime's bid — drop-in inputs
// for the prime's proposal volumes (technical / management / PP / key personnel),
// written in the prime's voice where appropriate. The teaming pitch is a
// secondary, optional one-pager.
const SUB_SECTIONS: { id: string; title: string }[] = [
  { id: "sub_technical_input", title: "Technical Volume — Our Inputs" },
  { id: "sub_management_input", title: "Management Volume — Our Inputs" },
  { id: "sub_past_performance_input", title: "Past Performance — Our Entries" },
  { id: "sub_key_personnel_input", title: "Key Personnel — Our Bios" },
  { id: "sub_corporate_overview", title: "Corporate Overview Blurb (for Prime's appendix)" },
  { id: "sub_teaming_pitch", title: "Teaming Pitch (1-page, optional)" },
];

// RFI / Sources Sought response — short, evaluator-facing market research reply.
// Includes acquisition-strategy comments and a set-aside recommendation that
// advocates SDVOSB when the offeror is SDVOSB-certified.
const RFI_SECTIONS: { id: string; title: string }[] = [
  { id: "rfi_cover_response", title: "Response Letter" },
  { id: "rfi_company_overview", title: "Company Overview" },
  { id: "rfi_relevant_capabilities", title: "Relevant Capabilities" },
  { id: "rfi_past_performance_summary", title: "Past Performance Summaries" },
  { id: "rfi_acquisition_strategy_comments", title: "Suggested Acquisition Strategy Comments" },
  { id: "rfi_set_aside_recommendation", title: "Set-Aside Recommendation" },
];

// Standalone capability statement — short marketing-style document.
const CAPABILITY_STATEMENT_SECTIONS: { id: string; title: string }[] = [
  { id: "cs_header", title: "Header & Contact" },
  { id: "cs_company_overview", title: "Company Overview" },
  { id: "cs_core_capabilities", title: "Core Capabilities" },
  { id: "cs_differentiators", title: "Differentiators" },
  { id: "cs_past_performance", title: "Past Performance Highlights" },
  { id: "cs_certifications", title: "Certifications & Codes" },
];

export const PURSUIT_TYPES: { value: string; label: string; short: string; description: string }[] = [
  { value: "rfp_rfq",            label: "RFP / RFQ response",         short: "RFP/RFQ",   description: "Full Section L/M proposal response to a solicitation." },
  { value: "rfi_sources_sought", label: "RFI / Sources Sought",       short: "RFI",       description: "Market-research response. Skips compliance matrix and milestones." },
  { value: "capability_statement", label: "Capability statement",     short: "Cap. Stmt", description: "Standalone marketing-style capability statement, not tied to a solicitation." },
];

export function pursuitTypeLabel(p?: string | null) {
  return PURSUIT_TYPES.find((t) => t.value === p)?.short ?? "RFP/RFQ";
}

function sectionsFor(proposal: any) {
  if (proposal?.pursuit_type === "rfi_sources_sought") return RFI_SECTIONS;
  if (proposal?.pursuit_type === "capability_statement") return CAPABILITY_STATEMENT_SECTIONS;
  return proposal?.engagement_type === "sub" ? SUB_SECTIONS : PRIME_SECTIONS;
}

type Section = { content: string; status: "draft" | "reviewed" | "final"; word_count: number };

function countdown(deadline?: string | null) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms < 0) return "PAST DUE";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hrs = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${days}d ${hrs}h`;
}

function ProposalPipeline() {
  const { proposalId } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [proposal, setProposal] = useState<any>(null);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("intake");
  const [sectionGen, setSectionGen] = useState<Record<string, boolean>>({});
  const [dataIssues, setDataIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => { if (!authLoading && !user) navigate({ to: "/auth" }); }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [{ data: p, error: pe }, { data: cp }, { data: atts }] = await Promise.all([
        supabase.from("proposals").select("*").eq("id", proposalId).maybeSingle(),
        supabase.from("company_profile").select("profile_data").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("proposal_attachments").select("*").eq("proposal_id", proposalId).order("uploaded_at", { ascending: false }),
      ]);
      if (pe || !p) { toast.error("Proposal not found"); navigate({ to: "/" }); return; }

      // Run integrity checks; auto-assign team_id if missing
      let proposalRow: any = p;
      const knownSectionIds = [...PRIME_SECTIONS, ...SUB_SECTIONS].map((s) => s.id);
      const initial = validateProposal(proposalRow, knownSectionIds);
      if (initial.needsTeamAssignment) {
        const { data: tm } = await supabase
          .from("team_members")
          .select("team_id")
          .eq("user_id", user.id)
          .order("joined_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (tm?.team_id) {
          await supabase.from("proposals").update({ team_id: tm.team_id }).eq("id", proposalId);
          proposalRow = { ...proposalRow, team_id: tm.team_id };
        }
      }
      const finalCheck = validateProposal(proposalRow, knownSectionIds);
      if (finalCheck.issues.length) {
        // eslint-disable-next-line no-console
        console.warn("[proposal data integrity]", finalCheck.issues);
      }
      setDataIssues(finalCheck.issues);

      setProposal(proposalRow);
      setCompanyProfile(cp?.profile_data ?? null);
      setAttachments(atts ?? []);
      setLoading(false);
    })();
  }, [user, proposalId, navigate]);

  async function patchProposal(patch: TablesUpdate<"proposals">) {
    // Capture the pre-patch values for just the keys we're changing so we
    // can revert if the server rejects the write (error or RLS no-op),
    // without clobbering concurrent edits to other fields.
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    let prevValues: Partial<Record<string, any>> = {};
    setProposal((p: any) => {
      prevValues = {};
      for (const k of keys) prevValues[k as string] = p?.[k as string];
      return { ...p, ...patch };
    });
    const revert = () => {
      setProposal((p: any) => {
        const next: any = { ...p };
        for (const k of keys) next[k as string] = prevValues[k as string];
        return next;
      });
    };
    // .select("id") forces PostgREST to return the affected rows. When RLS
    // filters out the update target, the request succeeds with zero rows —
    // without this we'd silently appear to save.
    const { data, error } = await supabase
      .from("proposals")
      .update(patch)
      .eq("id", proposalId)
      .select("id");
    if (error) {
      revert();
      toast.error(error.message);
      throw error;
    }
    if (!data || data.length === 0) {
      revert();
      const msg = "You don't have permission to edit this proposal";
      toast.error(msg);
      throw new Error(msg);
    }
  }

  async function uploadFile(file: File, fileType?: string) {
    if (!user) return null;
    const ft = fileType || classifyFilename(file.name);
    // Proposal-scoped path so opportunity-team collaborators (not just uploader)
    // can read/manage attachments via storage RLS.
    const path = `proposals/${proposalId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("proposal-attachments").upload(path, file);
    if (upErr) { toast.error(upErr.message); return null; }
    const { data: row, error: insErr } = await supabase.from("proposal_attachments").insert({
      proposal_id: proposalId, filename: file.name, file_type: ft, storage_path: path, source: "manual", size_bytes: file.size,
    }).select().single();
    if (insErr) { toast.error(insErr.message); return null; }
    setAttachments((a) => [row, ...a]);
    return row;
  }

  async function updateAttachmentType(att: any, fileType: string) {
    const { error } = await supabase.from("proposal_attachments").update({ file_type: fileType }).eq("id", att.id);
    if (error) { toast.error(error.message); return; }
    setAttachments((a) => a.map((x) => (x.id === att.id ? { ...x, file_type: fileType } : x)));
  }

  async function updateAttachmentNotes(att: any, notes: string) {
    const { error } = await supabase.from("proposal_attachments").update({ notes }).eq("id", att.id);
    if (error) { toast.error(error.message); return; }
    setAttachments((a) => a.map((x) => (x.id === att.id ? { ...x, notes } : x)));
  }

  async function addPastedReference({ title, text, notes }: { title: string; text: string; notes?: string }) {
    if (!user) return null;
    const trimmed = (text || "").trim();
    if (!trimmed) { toast.error("Paste some text first."); return null; }
    const filename = (title?.trim() || `Pasted reference ${new Date().toLocaleString()}`).slice(0, 200);
    const { data: row, error } = await supabase.from("proposal_attachments").insert({
      proposal_id: proposalId,
      filename,
      file_type: "reference",
      storage_path: null,
      source: "pasted",
      size_bytes: trimmed.length,
      parsed_content: trimmed,
      notes: notes?.trim() || null,
    }).select().single();
    if (error) { toast.error(error.message); return null; }
    setAttachments((a) => [row, ...a]);
    toast.success("Reference text saved");
    return row;
  }

  async function deleteAttachment(att: any) {
    const { data, error } = await supabase.from("proposal_attachments").delete().eq("id", att.id).select("id");
    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error("You don't have permission to delete this attachment — ask a team owner/admin");
      return;
    }
    // Only remove the underlying storage object once the row delete succeeded —
    // otherwise a failed RLS delete would leave us with a dangling file removal.
    if (att.storage_path) {
      await supabase.storage.from("proposal-attachments").remove([att.storage_path]);
    }
    setAttachments((a) => a.filter((x) => x.id !== att.id));
  }

  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [useCache, setUseCache] = useState(true);
  const online = useOnline();
  async function parseDocuments(opts?: { skipCache?: boolean }) {
    if (!online) { toast.error("You're offline. Reconnect to run AI tasks."); return; }
    if (aiBusy) { toast.error("Another AI task is running — please wait."); return; }
    const sowAtts = attachments.filter((a) => a.file_type === "sow");
    if (sowAtts.length === 0) { toast.error("Upload a SOW/PWS document first"); return; }
    setParsing(true); setAiBusy(true);
    setParseProgress("Starting…");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-sow`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
        body: JSON.stringify({ proposalId, skipCache: opts?.skipCache ?? !useCache }),
      });
      if (!r.ok || !r.body) {
        toast.error(await friendlyFromResponse(r));
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done: any = null;
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const evt of events) {
          const lines = evt.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
          const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
          if (!eventLine || !dataLine) continue;
          let payload: any = {};
          try { payload = JSON.parse(dataLine); } catch {}
          if (eventLine === "status" || eventLine === "progress") {
            if (payload.message) setParseProgress(payload.message);
            else if (payload.phase === "merging") setParseProgress("Merging results…");
          } else if (eventLine === "files") {
            const empties = (payload.files || []).filter((f: any) => f.empty);
            for (const f of empties) {
              toast.error(`Could not extract text from ${f.filename} — try uploading a text-based PDF instead of a scanned image.`);
            }
          } else if (eventLine === "warn") {
            toast.warning(payload.message || "Partial parse warning");
          } else if (eventLine === "error") {
            toast.error(friendlyError({ message: payload.error || "Parse failed", code: payload.code }));
          } else if (eventLine === "done") {
            done = payload;
          }
        }
      }
      const { data: fresh } = await supabase.from("proposals").select("*").eq("id", proposalId).maybeSingle();
      let freshRow: any = fresh;
      // Client-side compliance matrix integrity pass
      if (freshRow?.compliance_matrix) {
        const knownIds = [...PRIME_SECTIONS, ...SUB_SECTIONS].map((s) => s.id);
        const { fixedCount, fixes, matrix: cleaned } = validateComplianceMatrix(freshRow.compliance_matrix, knownIds);
        if (fixedCount > 0) {
          await supabase.from("proposals").update({ compliance_matrix: cleaned }).eq("id", proposalId);
          freshRow = { ...freshRow, compliance_matrix: cleaned };
          toast.message(`Auto-fixed ${fixedCount} issue${fixedCount === 1 ? "" : "s"} in the parsed matrix.`, { description: fixes.join(" ") });
        }
        // Refresh data issues banner
        setDataIssues(validateProposal(freshRow, knownIds).issues);
      }
      if (freshRow) setProposal(freshRow);
      const { data: freshAtts } = await supabase.from("proposal_attachments").select("*").eq("proposal_id", proposalId).order("uploaded_at", { ascending: false });
      if (freshAtts) setAttachments(freshAtts);
      if (done) {
        const filled = done.filled_fields?.length ?? 0;
        toast.success(`Extracted ${done.requirements_count ?? done.matrix?.requirements?.length ?? 0} requirements across ${done.chunks ?? 1} pass${(done.chunks ?? 1) === 1 ? "" : "es"}${filled ? ` · auto-filled ${filled} field${filled === 1 ? "" : "s"}` : ""}`);
      }
    } catch (e: any) {
      toast.error(friendlyFromError(e));
      await supabase.from("proposals").update({ parsing_status: "idle" }).eq("id", proposalId);
    } finally {
      setParsing(false); setAiBusy(false);
      setParseProgress("");
    }
  }

  const [fetchResults, setFetchResults] = useState<any>(null);
  const [fetching, setFetching] = useState(false);
  async function autoFetchSamAttachments() {
    if (!proposal?.notice_id) { toast.error("No notice ID on this opportunity"); return; }
    setFetching(true);
    setFetchResults(null);
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sam-attachments`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ proposalId, noticeId: proposal.notice_id, action: "download" }),
      });
      const j = await r.json();
      if (!r.ok) {
        const msg = friendlyError({ status: r.status, message: j.error || "Fetch failed", code: j.code });
        toast.error(msg);
        setFetchResults({ error: msg, results: [], attempted: 0, saved: [] });
        return;
      }
      setFetchResults(j);
      const { data: atts } = await supabase.from("proposal_attachments").select("*").eq("proposal_id", proposalId).order("uploaded_at", { ascending: false });
      setAttachments(atts ?? []);
    } catch (e: any) {
      const msg = friendlyFromError(e);
      toast.error(msg);
      setFetchResults({ error: msg, results: [], attempted: 0, saved: [] });
    } finally {
      setFetching(false);
    }
  }

  async function generateSection(sectionId: string, sectionTitle: string, opts?: { template?: { filename: string; structure: string[]; boilerplate: string } | null }) {
    if (!online) { toast.error("You're offline. Reconnect to run AI tasks."); return; }
    if (aiBusy) { toast.error("Another AI task is running — please wait."); return; }
    if (!companyProfile) { toast.error("Company profile missing"); return; }
    setSectionGen((s) => ({ ...s, [sectionId]: true }));
    setAiBusy(true);
    try {
      // gather attachment text (parsed_content + per-file user notes) when available
      const attachmentsText = composeAttachmentsText(attachments);
      const teamingEntries = await fetchTeamingForProposal(proposalId);
      const teaming = teamingEntries.map((e) => ({
        company_name: e.partner?.company_name,
        role: e.role,
        work_share_pct: e.work_share_pct,
        certifications: e.partner?.certifications ?? [],
        naics_codes: e.partner?.naics_codes ?? [],
        naics_contribution: e.naics_contribution,
        capabilities_summary: e.partner?.capabilities_summary,
        past_performance_summary: e.partner?.past_performance_summary,
      }));
      let pastPerformance: any[] = [];
      const selectedPpIds: string[] = proposal.selected_past_performance ?? [];
      if (selectedPpIds.length > 0) {
        const { data: pp } = await supabase.from("past_performance").select("*").in("id", selectedPpIds);
        pastPerformance = pp ?? [];
      }
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-proposal-section`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          sectionId, sectionTitle,
          userId: session?.user?.id,
          proposalId,
          teamId: proposal.team_id ?? null,
          opportunity: proposal.opportunity_data ?? {
            title: proposal.opportunity_title, solicitationNumber: proposal.solicitation_number,
            fullParentPathName: proposal.agency, naicsCode: proposal.naics_code, type: proposal.opportunity_type,
            responseDeadLine: proposal.response_deadline, setAside: proposal.set_aside,
          },
          companyProfile,
          customerIntel: proposal.customer_intel,
          complianceMatrix: proposal.compliance_matrix,
          solutionDesign: {
            staffing: proposal.staffing_plan, technical: proposal.technical_approach,
            management: proposal.management_approach, transition: proposal.transition_plan,
          },
          teaming: teaming.length ? teaming : undefined,
          pastPerformance: pastPerformance.length ? pastPerformance : undefined,
          attachmentsText: attachmentsText || undefined,
          engagementType: proposal.engagement_type ?? "prime",
          pursuitType: proposal.pursuit_type ?? "rfp_rfq",
          primeContractorName: proposal.prime_contractor_name ?? null,
          primeContractorId: proposal.prime_contractor_id ?? null,
          targetedScopeAreas: proposal.targeted_scope_areas ?? null,
          template: opts?.template ?? undefined,
          userContext: userContextFromProposal(proposal),
        }),
      });
      if (!resp.ok || !resp.body) {
        const j = await resp.json().catch(() => ({ error: "Failed" }));
        toast.error(friendlyError({ status: resp.status, message: j.error, code: j.code })); return;
      }
      const appliedHeader = resp.headers.get("x-user-context-applied") ?? "";
      const userContextApplied = appliedHeader.split(",").map((s) => s.trim()).filter(Boolean);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", acc = "", done = false;
      while (!done) {
        const r = await reader.read();
        if (r.done) break;
        buf += decoder.decode(r.value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) {
              acc += c;
              const wc = acc.split(/\s+/).filter(Boolean).length;
              // Functional update so concurrent / sequential generations merge
              // into the LATEST sections snapshot, not the stale render closure.
              setProposal((p: any) => ({
                ...p,
                sections: { ...(p?.sections || {}), [sectionId]: { content: acc, status: "draft", word_count: wc, user_context_applied: userContextApplied } },
              }));
            }
          } catch { buf = line + "\n" + buf; break; }
        }
      }
      const wc = acc.split(/\s+/).filter(Boolean).length;
      // Compute the final merged sections from the latest state inside the
      // functional updater so the DB patch persists every section generated
      // earlier in this run (e.g. during generateAll's sequential loop).
      let finalSections: Record<string, any> = {};
      setProposal((p: any) => {
        finalSections = { ...(p?.sections || {}), [sectionId]: { content: acc, status: "draft", word_count: wc, user_context_applied: userContextApplied } };
        return { ...p, sections: finalSections };
      });
      const { error: saveErr } = await supabase
        .from("proposals")
        .update({ sections: finalSections })
        .eq("id", proposalId);
      if (saveErr) toast.error(saveErr.message);
      toast.success(`Generated ${sectionTitle}`);
    } catch (e: any) {
      toast.error(friendlyFromError(e));
    } finally {
      setSectionGen((s) => ({ ...s, [sectionId]: false }));
      setAiBusy(false);
    }
  }

  async function generateAll(sections?: { id: string; title: string }[], opts?: { template?: { filename: string; structure: string[]; boilerplate: string } | null }) {
    const baseList = sections && sections.length > 0 ? sections : sectionsFor(proposal);
    const remaining = baseList.filter((s) => !proposal.sections?.[s.id]?.content);
    if (remaining.length === 0) { toast.info("All sections already drafted"); return; }
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      setGenProgress({ current: i + 1, total: remaining.length, label: s.title });
      try {
        await generateSection(s.id, s.title, opts);
      } catch (e) {
        // continue with next; per-section toast already shown
      }
      if (i < remaining.length - 1) {
        // 2s pacing between calls to avoid hammering the gateway
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    setGenProgress(null);
  }

  async function exportDocx() {
    try {
      await exportProposalDocx({ proposal, companyProfile, sectionDefs: sectionsFor(proposal) });
      toast.success("Proposal exported");
    } catch (e: any) {
      toast.error(`Export failed: ${e?.message ?? e}`);
    }
  }

  const readiness = useMemo(() => {
    if (!proposal) return 0;
    let score = 0;
    if (proposal.pop_base_months) score += 10;
    if (proposal.opportunity_type) score += 5;
    if (proposal.estimated_value) score += 5;
    if (proposal.contract_type) score += 5;
    if (proposal.clearance_requirement) score += 5;
    if (attachments.length) score += 10;
    if (proposal.customer_intel_verified) score += 15;
    if (proposal.compliance_matrix) score += 15;
    // Verification percentage of compliance requirements (up to 10 pts)
    const reqs = proposal.compliance_matrix?.requirements || [];
    if (reqs.length) {
      const verified = reqs.filter((r: any) => r.verified).length;
      score += Math.round((verified / reqs.length) * 10);
    }
    if (proposal.staffing_plan) score += 10;
    const secs = sectionsFor(proposal);
    const generated = secs.filter((s) => proposal.sections?.[s.id]?.content).length;
    score += Math.round((generated / secs.length) * 20);
    if (ociStatus(proposal.oci_screening) === "incomplete") score -= 5;
    return Math.max(0, Math.min(100, score));
  }, [proposal, attachments]);

  if (loading || !proposal) return <div className="min-h-screen bg-background"><Header /><div className="p-8 text-muted-foreground">Loading proposal…</div></div>;

  const cd = countdown(proposal.response_deadline);

  return (
    <div className="min-h-screen bg-background">
      <OfflineBanner />
      <Header />
      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to opportunities</Link>
          <div className="flex-1" />
          {proposal.engagement_type === "sub" ? (
            <Badge className="bg-amber-500 hover:bg-amber-500/90" title={proposal.prime_contractor_name ? `Pursuing as sub — supporting ${proposal.prime_contractor_name}'s bid` : "Pursuing as sub"}>
              {proposal.prime_contractor_name
                ? `Pursuing as sub — supporting ${proposal.prime_contractor_name}'s bid`
                : "Pursuing as sub"}
            </Badge>
          ) : (
            <Badge className="bg-blue-600 hover:bg-blue-600/90">PRIME</Badge>
          )}
          <Badge
            variant="outline"
            className={
              proposal.pursuit_type === "rfi_sources_sought"
                ? "border-purple-500/60 text-purple-700 dark:text-purple-400"
                : proposal.pursuit_type === "capability_statement"
                ? "border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
                : "border-blue-500/60 text-blue-700 dark:text-blue-400"
            }
            title={PURSUIT_TYPES.find((t) => t.value === (proposal.pursuit_type ?? "rfp_rfq"))?.description}
          >
            {pursuitTypeLabel(proposal.pursuit_type)}
          </Badge>
          <Badge variant="outline">{proposal.status}</Badge>
          {dataIssues.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400 cursor-help">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Data issues detected ({dataIssues.length})
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <ul className="text-xs space-y-1 list-disc list-inside">
                    {dataIssues.map((i) => <li key={i.code}>{i.message}</li>)}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {cd && <Badge className={cd === "PAST DUE" ? "bg-destructive" : ""}>{cd === "PAST DUE" ? cd : `${cd} until deadline`}</Badge>}
          <Button onClick={exportDocx} variant="outline"><Download className="w-4 h-4 mr-1" />Export .docx</Button>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{proposal.opportunity_title || "Untitled opportunity"}</CardTitle>
            <CardDescription className="text-xs">
              Sol #: <span className="font-mono">{proposal.solicitation_number}</span> · {proposal.agency} · NAICS {proposal.naics_code}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted-foreground w-32">Proposal readiness</div>
              <Progress value={readiness} className="h-2 flex-1" />
              <div className="text-xs font-mono w-10 text-right">{readiness}%</div>
            </div>
          </CardContent>
        </Card>

        {proposal.pursuit_type !== "rfi_sources_sought" && proposal.pursuit_type !== "capability_statement" && (
          <MilestoneTimeline proposalId={proposalId} responseDeadline={proposal.response_deadline} />
        )}

        <Tabs value={step} onValueChange={setStep}>
          <TabsList>
            <TabsTrigger value="intake">1. Intake</TabsTrigger>
            <TabsTrigger value="intel">2. Customer Intel</TabsTrigger>
            {proposal.pursuit_type !== "rfi_sources_sought" && proposal.pursuit_type !== "capability_statement" && (
              <TabsTrigger value="compliance">3. Compliance</TabsTrigger>
            )}
            <TabsTrigger value="solution">
              {proposal.pursuit_type === "rfi_sources_sought" || proposal.pursuit_type === "capability_statement"
                ? "3. Inputs"
                : `4. ${proposal.engagement_type === "sub" ? "Sub Inputs" : "Solution Design"}`}
            </TabsTrigger>
            <TabsTrigger value="generate">
              {proposal.pursuit_type === "rfi_sources_sought" || proposal.pursuit_type === "capability_statement" ? "4." : "5."} Generate
            </TabsTrigger>
          </TabsList>

          <TabsContent value="intake" className="mt-4 space-y-4">
            <StepErrorBoundary label="intake">
              <IntakeStep proposal={proposal} attachments={attachments} onPatch={patchProposal} onUpload={uploadFile} onDelete={deleteAttachment} onAutoFetch={autoFetchSamAttachments} onParse={parseDocuments} parsing={parsing} parseProgress={parseProgress} proposalId={proposalId} fetchResults={fetchResults} fetching={fetching} onUpdateAttachmentType={updateAttachmentType} onUpdateAttachmentNotes={updateAttachmentNotes} onAddPastedReference={addPastedReference} onRefreshProposal={async () => {
                const { data: fresh } = await supabase.from("proposals").select("opportunity_team_id").eq("id", proposalId).maybeSingle();
                if (fresh) setProposal((p: any) => ({ ...p, opportunity_team_id: fresh.opportunity_team_id ?? null }));
              }} />
            </StepErrorBoundary>
          </TabsContent>
          <TabsContent value="intel" className="mt-4">
            <StepErrorBoundary label="intel">
              <CustomerIntelStep proposal={proposal} proposalId={proposalId} companyProfile={companyProfile} onPatch={patchProposal} aiBusy={aiBusy} setAiBusy={setAiBusy} online={online} />
            </StepErrorBoundary>
          </TabsContent>
          <TabsContent value="compliance" className="mt-4">
            <StepErrorBoundary label="compliance">
              <ComplianceStep proposal={proposal} onPatch={patchProposal} onGoToIntake={() => setStep("intake")} />
            </StepErrorBoundary>
          </TabsContent>
          <TabsContent value="solution" className="mt-4">
            <StepErrorBoundary label="solution">
              <SolutionDesignStep proposal={proposal} proposalId={proposalId} onPatch={patchProposal} />
            </StepErrorBoundary>
          </TabsContent>
          <TabsContent value="generate" className="mt-4 space-y-4">
            <StepErrorBoundary label="generate">
              <GenerateStep proposal={proposal} attachments={attachments} sectionGen={sectionGen} aiBusy={aiBusy} genProgress={genProgress} onGenerate={generateSection} onGenerateAll={generateAll} onPatchSection={(id: string, content: string) => {
                const wc = content.split(/\s+/).filter(Boolean).length;
                const next = { ...(proposal.sections || {}), [id]: { ...(proposal.sections?.[id] || { status: "draft" }), content, word_count: wc } };
                patchProposal({ sections: next });
              }} onExport={exportDocx} />
            </StepErrorBoundary>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SamFetchResults({ results, samUrl }: { results: any; samUrl?: string }) {
  if (!results) return null;
  const { saved = [], results: items = [], attempted = 0, error } = results;
  const downloaded = saved.length;
  const authReq = items.filter((r: any) => r.status === "auth_required").length;
  const failed = items.filter((r: any) => r.status === "error").length;
  const zero = attempted === 0;
  return (
    <div className="space-y-2">
      {zero ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
          <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> No attachments returned by SAM.gov
          </div>
          <div className="text-muted-foreground">
            This usually means the files require authentication. Visit the listing on SAM.gov to download manually, then upload them below.
          </div>
          {samUrl && (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={samUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" />Open opportunity on SAM.gov</a>
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs space-y-1.5">
          <div className="font-medium">
            Found {attempted} attachment{attempted === 1 ? "" : "s"}.{" "}
            <span className="text-emerald-600 dark:text-emerald-400">Downloaded {downloaded}.</span>{" "}
            {authReq > 0 && <span className="text-destructive">{authReq} require SAM.gov login.</span>}
            {failed > 0 && <span className="text-destructive"> {failed} failed.</span>}
          </div>
          <div className="space-y-1">
            {items.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                {r.status === "downloaded" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                )}
                <span className="truncate flex-1" title={r.filename}>{r.filename}</span>
                {r.status !== "downloaded" && (
                  <span className="text-[10px] text-destructive">
                    {r.status === "auth_required" ? "Requires SAM.gov login" : (r.error || "Failed")}
                  </span>
                )}
              </div>
            ))}
          </div>
          {(authReq > 0 || failed > 0) && samUrl && (
            <a href={samUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary text-[11px] mt-1">
              <ExternalLink className="w-3 h-3" />Download manually from SAM.gov
            </a>
          )}
        </div>
      )}
      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

function DropZoneUpload({ onUpload }: { onUpload: (f: File, type?: string) => Promise<any> }) {
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ name: string; status: "uploading" | "done" | "error"; type?: string }[]>([]);

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setProgress((p) => [...arr.map((f) => ({ name: f.name, status: "uploading" as const, type: classifyFilename(f.name) })), ...p]);
    for (const f of arr) {
      try {
        await onUpload(f, classifyFilename(f.name));
        setProgress((p) => p.map((x) => (x.name === f.name && x.status === "uploading" ? { ...x, status: "done" } : x)));
      } catch {
        setProgress((p) => p.map((x) => (x.name === f.name && x.status === "uploading" ? { ...x, status: "error" } : x)));
      }
    }
    setTimeout(() => setProgress((p) => p.filter((x) => x.status === "uploading")), 2500);
  }

  return (
    <div className="space-y-2">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        className={`block border-2 border-dashed rounded-md p-4 text-center text-sm cursor-pointer transition ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
        }`}
      >
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
        />
        <Upload className="w-4 h-4 inline-block mr-1" />
        Drop files here or click to browse
        <div className="text-[11px] text-muted-foreground mt-1">Multiple files supported. Type auto-detected.</div>
      </label>
      {progress.length > 0 && (
        <div className="space-y-1">
          {progress.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              {p.status === "uploading" ? (
                <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
              ) : p.status === "done" ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-3 h-3 text-destructive" />
              )}
              <span className="truncate flex-1">{p.name}</span>
              {p.type && <Badge variant="outline" className="text-[10px]">{p.type}</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PasteReferenceText({ onAdd }: { onAdd: (input: { title: string; text: string; notes?: string }) => Promise<any> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!text.trim()) { toast.error("Paste some text first."); return; }
    setSaving(true);
    try {
      const row = await onAdd({ title, text, notes });
      if (row) {
        setTitle(""); setText(""); setNotes(""); setOpen(false);
      }
    } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <FileText className="w-3.5 h-3.5 mr-1" /> Paste text as reference
      </Button>
    );
  }

  return (
    <div className="border border-border rounded p-2 space-y-2 bg-muted/30">
      <div className="text-[11px] font-medium">Add reference text (no file required)</div>
      <Input
        placeholder="Short title (e.g. 'Agency RFI Q&A')"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-7 text-xs"
      />
      <Textarea
        placeholder="Paste any text the AI should treat as authoritative context — emails, RFI responses, conversation notes, prior solicitation language, etc."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="text-xs"
      />
      <Textarea
        placeholder="Optional note: how should the AI use this? (e.g. 'Customer confirmed the incumbent contract is being recompeted as-is')"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="text-xs"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving || !text.trim()}>
          {saving ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
          Save reference
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setTitle(""); setText(""); setNotes(""); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AttachmentRow({ att, onDelete, onUpdateAttachmentType, onUpdateAttachmentNotes }: {
  att: any;
  onDelete: (a: any) => void;
  onUpdateAttachmentType: (a: any, t: string) => void;
  onUpdateAttachmentNotes: (a: any, n: string) => void;
}) {
  const [notesDraft, setNotesDraft] = useState<string>(att.notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  useEffect(() => { if (!editingNotes) setNotesDraft(att.notes ?? ""); }, [att.notes, editingNotes]);

  const chars = att.parsed_content?.length || 0;
  const empty = att.parsed_content !== null && att.parsed_content !== undefined && chars === 0;
  const isPasted = att.source === "pasted" || !att.storage_path;

  async function commitNotes() {
    const next = notesDraft.trim();
    if ((att.notes ?? "") === next) { setEditingNotes(false); return; }
    setSavingNotes(true);
    try {
      await onUpdateAttachmentNotes(att, next);
    } finally {
      setSavingNotes(false);
      setEditingNotes(false);
    }
  }

  return (
    <div className="border border-border rounded px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <FileText className="w-3 h-3 text-muted-foreground" />
        <span className="flex-1 truncate" title={att.filename}>
          {att.filename}
          {isPasted && <Badge variant="outline" className="ml-1.5 text-[9px] py-0">pasted</Badge>}
        </span>
        <Select value={att.file_type ?? "other"} onValueChange={(v) => onUpdateAttachmentType(att, v)}>
          <SelectTrigger className="h-6 px-1.5 text-[10px] w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ATTACHMENT_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button onClick={() => onDelete(att)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
      </div>
      {chars > 0 && (
        <div className="text-[10px] text-muted-foreground pl-5">{chars.toLocaleString()} chars {isPasted ? "saved" : "extracted"}</div>
      )}
      {empty && (
        <div className="text-[10px] text-destructive pl-5">
          Could not extract text — try uploading a text-based PDF instead of a scanned image.
        </div>
      )}
      <div className="pl-5">
        {editingNotes ? (
          <div className="space-y-1">
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Note for the AI: what should it know about this document? (e.g. 'This is the final amendment — supersedes original Section L')"
              rows={2}
              className="text-[11px]"
              autoFocus
              onBlur={commitNotes}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setNotesDraft(att.notes ?? ""); setEditingNotes(false); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitNotes(); }
              }}
            />
            <div className="text-[10px] text-muted-foreground">
              {savingNotes ? "Saving…" : "Click outside or press ⌘/Ctrl+Enter to save"}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            className="text-[11px] text-left w-full text-muted-foreground hover:text-foreground italic"
          >
            {att.notes?.trim() ? <span className="not-italic">📝 {att.notes}</span> : "+ Add note for AI context"}
          </button>
        )}
      </div>
    </div>
  );
}

function IntakeStep({ proposal, attachments, onPatch, onUpload, onDelete, onAutoFetch, onParse, parsing, parseProgress, proposalId, fetchResults, fetching, onUpdateAttachmentType, onUpdateAttachmentNotes, onAddPastedReference, onRefreshProposal }: any) {
  const sowAttachments = attachments.filter((a: any) => a.file_type !== "customer_intel");
  const totalChars = sowAttachments.reduce((s: number, a: any) => s + (a.parsed_content?.length || 0), 0);
  const largeDoc = totalChars > 300_000;
  const [local, setLocal] = useState<any>(proposal);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Record<string, any>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Re-sync local from the server proposal, but never clobber in-progress edits.
  useEffect(() => {
    setLocal((prev: any) =>
      mergeServerProposal(prev, proposal, { dirty: dirtyRef.current, inFlight: inFlightRef.current }),
    );
  }, [proposal]);

  // Cleanup the debounce timer on unmount so a pending save still flushes.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const patch = pendingPatchRef.current;
        if (Object.keys(patch).length > 0) {
          // Fire-and-forget flush on unmount.
          onPatch(patch);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushSave = async () => {
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    inFlightRef.current += 1;
    setSaveState("saving");
    try {
      await onPatch(patch);
      if (inFlightRef.current === 1 && Object.keys(pendingPatchRef.current).length === 0) {
        dirtyRef.current = false;
        setSaveState("saved");
      }
    } catch {
      setSaveState("error");
    } finally {
      inFlightRef.current -= 1;
    }
  };

  const scheduleSave = (patch: Record<string, any>) => {
    dirtyRef.current = true;
    setSaveState("saving");
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, 800);
  };

  const update = (patch: Record<string, any>) => {
    setLocal((p: any) => ({ ...p, ...patch }));
    scheduleSave(patch);
  };

  const saveLabel =
    saveState === "saving" ? "Saving…" :
    saveState === "saved" ? "Saved" :
    saveState === "error" ? "Save failed — retry" :
    "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pursuit type</CardTitle>
            <CardDescription className="text-xs">What kind of response are we producing? RFI / Sources Sought skips the compliance matrix and deadline milestones.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {PURSUIT_TYPES.map((t) => {
                const active = (proposal.pursuit_type ?? "rfp_rfq") === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => onPatch({ pursuit_type: t.value })}
                    className={`rounded-md border-2 p-3 text-left transition ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                  >
                    <div className="text-sm font-semibold">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{t.description}</div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/40">
          <CardHeader className="pb-2"><CardTitle className="text-base">Engagement type</CardTitle><CardDescription className="text-xs">This fundamentally changes the pipeline. Choose carefully.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onPatch({ engagement_type: "prime", prime_contractor_id: null, prime_contractor_name: null })}
                className={`rounded-md border-2 p-4 text-left transition ${proposal.engagement_type !== "sub" ? "border-blue-600 bg-blue-600/5" : "border-border hover:bg-muted"}`}
              >
                <div className="text-sm font-semibold">Pursuing as Prime</div>
                <div className="text-[11px] text-muted-foreground mt-1">Full Section L/M proposal volumes. We own the response.</div>
              </button>
              <button
                type="button"
                onClick={() => onPatch({ engagement_type: "sub" })}
                className={`rounded-md border-2 p-4 text-left transition ${proposal.engagement_type === "sub" ? "border-amber-500 bg-amber-500/5" : "border-border hover:bg-muted"}`}
              >
                <div className="text-sm font-semibold">Pursuing as Sub</div>
                <div className="text-[11px] text-muted-foreground mt-1">Produce drop-in inputs for the prime's volumes (technical, management, past performance, key personnel), written in the prime's voice. Includes an optional 1-page teaming pitch.</div>
              </button>
            </div>
            {proposal.engagement_type === "sub" && (
              <div className="space-y-3 pt-2 border-t border-border">
                <div>
                  <Label>Prime contractor *</Label>
                  <PrimeContractorCombobox
                    teamId={proposal.team_id}
                    valueId={proposal.prime_contractor_id}
                    valueName={proposal.prime_contractor_name}
                    onChange={(next) => {
                      setLocal((p: any) => ({ ...p, prime_contractor_name: next.prime_contractor_name }));
                      // Combobox writes both id + name; persist immediately (not debounced).
                      void onPatch(next);
                    }}
                  />
                  <div className="text-[11px] text-muted-foreground mt-1">Pull from your teaming partner roster, or type a new prime to use as free text.</div>
                </div>
                <div>
                  <Label>Relevant scope areas *</Label>
                  <Textarea
                    rows={3}
                    value={local.targeted_scope_areas ?? ""}
                    onChange={(e) => update({ targeted_scope_areas: e.target.value || null })}
                    placeholder="Describe the portion of work you're targeting under the prime."
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Auto-populated from SAM.gov</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Solicitation #</div><div className="font-mono">{proposal.solicitation_number}</div></div>
            <div><div className="text-xs text-muted-foreground">Notice ID</div><div className="font-mono text-xs">{proposal.notice_id || "—"}</div></div>
            <div className="col-span-2"><div className="text-xs text-muted-foreground">Title</div><div>{proposal.opportunity_title}</div></div>
            <div><div className="text-xs text-muted-foreground">Agency</div><div>{proposal.agency || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">NAICS</div><div>{proposal.naics_code || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Set-aside</div><div>{proposal.set_aside || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Response deadline</div><div>{proposal.response_deadline?.slice(0, 10) || "—"}</div></div>
            {proposal.opportunity_data?.uiLink && (
              <div className="col-span-2"><a href={proposal.opportunity_data.uiLink} target="_blank" rel="noreferrer" className="text-primary text-xs inline-flex items-center gap-1">Open on SAM.gov <ExternalLink className="w-3 h-3" /></a></div>
            )}
          </CardContent>
        </Card>


        <Card>
          <CardHeader><CardTitle className="text-base">Capture details (you fill these in)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div>
              <Label>Opportunity type</Label>
              <Select value={local.opportunity_type ?? ""} onValueChange={(v) => update({ opportunity_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New requirement</SelectItem>
                  <SelectItem value="recompete">Re-compete</SelectItem>
                  <SelectItem value="task_order">Task Order</SelectItem>
                  <SelectItem value="idiq_order">IDIQ order</SelectItem>
                  <SelectItem value="sources_sought">Sources Sought response</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contract type</Label>
              <Select value={local.contract_type ?? ""} onValueChange={(v) => update({ contract_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ffp">FFP</SelectItem>
                  <SelectItem value="tm">T&amp;M</SelectItem>
                  <SelectItem value="cost_plus">Cost-Plus</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estimated value (USD)</Label>
              <Input type="number" value={local.estimated_value ?? ""} onChange={(e) => update({ estimated_value: Number(e.target.value) || null })} />
            </div>
            <div>
              <Label>Clearance</Label>
              <Select value={local.clearance_requirement ?? ""} onValueChange={(v) => update({ clearance_requirement: v })}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="public_trust">Public Trust</SelectItem>
                  <SelectItem value="secret">Secret</SelectItem>
                  <SelectItem value="ts">TS</SelectItem>
                  <SelectItem value="ts_sci">TS-SCI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PoP base (months)</Label>
              <Input type="number" value={local.pop_base_months ?? ""} onChange={(e) => update({ pop_base_months: Number(e.target.value) || null })} />
            </div>
            <div>
              <Label>Option months (total)</Label>
              <Input type="number" value={local.pop_option_months ?? ""} onChange={(e) => update({ pop_option_months: Number(e.target.value) || null })} />
            </div>
            <div className="col-span-2">
              <Label>Internal notes</Label>
              <Textarea rows={3} value={local.user_notes ?? ""} onChange={(e) => update({ user_notes: e.target.value })} />
            </div>
            <div className="col-span-2 flex items-center justify-end gap-2 text-xs text-muted-foreground" aria-live="polite" data-testid="intake-save-status">
              {saveLabel && (
                <span className={saveState === "error" ? "text-destructive" : ""}>
                  {saveState === "saving" && <RefreshCw className="w-3 h-3 mr-1 inline animate-spin" />}
                  {saveState === "saved" && <CheckCircle2 className="w-3 h-3 mr-1 inline text-emerald-600" />}
                  {saveLabel}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What we know (offeror-authoritative)</CardTitle>
            <CardDescription className="text-xs">
              Anything you enter here overrides AI assumptions in every analysis (competitive intel, customer intel, proposal draft).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div>
              <Label>Known incumbent</Label>
              <Input
                value={local.known_incumbent ?? ""}
                onChange={(e) => update({ known_incumbent: e.target.value || null })}
                placeholder="e.g. Acme Federal Solutions"
              />
            </div>
            <div>
              <Label>Incumbent notes</Label>
              <Input
                value={local.incumbent_notes ?? ""}
                onChange={(e) => update({ incumbent_notes: e.target.value || null })}
                placeholder="PoP end, performance gossip, key staff"
              />
            </div>
            <div className="col-span-2">
              <Label>Customer notes</Label>
              <Textarea
                rows={2}
                value={local.customer_notes ?? ""}
                onChange={(e) => update({ customer_notes: e.target.value || null })}
                placeholder="End user, hot buttons, KO/COR names, prior interactions"
              />
            </div>
            <div className="col-span-2">
              <Label>Competitive notes</Label>
              <Textarea
                rows={2}
                value={local.competitive_notes ?? ""}
                onChange={(e) => update({ competitive_notes: e.target.value || null })}
                placeholder="Likely bidders, teaming rumors, pricing dynamics"
              />
            </div>
            <div className="col-span-2">
              <Label>General capture notes</Label>
              <Textarea
                rows={2}
                value={local.capture_notes ?? ""}
                onChange={(e) => update({ capture_notes: e.target.value || null })}
                placeholder="Anything else relevant to this pursuit"
              />
            </div>
          </CardContent>
        </Card>



        <LinkOpportunityTeamCard
          proposalId={proposalId}
          parentTeamId={proposal.team_id ?? null}
          currentOpportunityTeamId={proposal.opportunity_team_id ?? null}
          onChanged={onRefreshProposal}
        />

        <TeamingCard
          proposalId={proposalId}
          teamId={proposal.team_id ?? null}
          opportunityNaics={proposal.naics_code}
          proposal={proposal}
        />

        <PartnerResearch
          proposalId={proposalId}
          teamId={proposal.team_id ?? null}
          opportunityNaics={proposal.naics_code}
        />

        <RelevantPastPerformanceCard
          teamId={proposal.team_id ?? null}
          naics={proposal.naics_code}
          agency={proposal.agency}
          opportunityTitle={proposal.opportunity_title}
          selectedIds={proposal.selected_past_performance ?? []}
          onChange={(ids) => onPatch({ selected_past_performance: ids })}
        />

        <OCIScreeningCard
          value={(proposal.oci_screening as OciAnswers) ?? {}}
          onChange={(v) => onPatch({ oci_screening: v as never })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {proposal.engagement_type === "sub" ? "Scope reference (optional)" : "Solicitation documents"}
          </CardTitle>
          <CardDescription>
            {proposal.engagement_type === "sub"
              ? "Sub mode: only attach the scope blurb or partner brief if you have one. Full SOW parsing is skipped."
              : "SOW, Section L/M, amendments"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {proposal.engagement_type !== "sub" && (
            <>
              <Button onClick={onAutoFetch} variant="outline" size="sm" className="w-full" disabled={fetching}>
                {fetching ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                {fetching ? "Fetching from SAM.gov…" : "Try auto-fetch from SAM.gov"}
              </Button>
              <SamFetchResults results={fetchResults} samUrl={proposal.opportunity_data?.uiLink} />
            </>
          )}

          <DropZoneUpload onUpload={onUpload} />

          <PasteReferenceText onAdd={onAddPastedReference} />

          {proposal.engagement_type !== "sub" && (
            <>
              <Button
                onClick={onParse}
                disabled={parsing || sowAttachments.length === 0}
                size="sm"
                className="w-full"
              >
                {parsing ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <ListChecks className="w-4 h-4 mr-1" />}
                {parsing ? (parseProgress || "Parsing…") : proposal.compliance_matrix ? "Re-parse documents" : "Parse documents & auto-fill capture"}
              </Button>
              {proposal.compliance_matrix && !parsing && (
                <Button
                  onClick={() => onParse?.({ skipCache: true })}
                  variant="ghost"
                  size="sm"
                  className="w-full text-[11px] h-7"
                  disabled={sowAttachments.length === 0}
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Force regenerate (bypass cache)
                </Button>
              )}
              {parsing && proposal.parsing_status === "parsing" && (
                <div className="text-[11px] text-muted-foreground">Do not navigate away — parsing in progress.</div>
              )}
              <div className="text-[11px] text-muted-foreground">
                Parsing extracts requirements (Section L/M, "shall" statements) AND auto-fills capture details below — title, agency, contract type, value, PoP, clearance, etc.
              </div>
            </>
          )}
          {largeDoc && (
            <div className="text-[11px] rounded border border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 px-2 py-1.5">
              <AlertTriangle className="w-3 h-3 inline-block mr-1" />
              Large solicitation detected ({Math.round(totalChars / 1000)}K chars) — parsing may take several minutes and multiple AI passes.
            </div>
          )}
          <div className="space-y-1">
            {sowAttachments.length === 0 && <div className="text-xs text-muted-foreground">No files yet.</div>}
            {sowAttachments.map((a: any) => (
              <AttachmentRow
                key={a.id}
                att={a}
                onDelete={onDelete}
                onUpdateAttachmentType={onUpdateAttachmentType}
                onUpdateAttachmentNotes={onUpdateAttachmentNotes}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ComingSoon({ title, description, fieldLabel, value, onSave }: { title: string; description: string; fieldLabel: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label>{fieldLabel}</Label>
        <Textarea rows={10} value={v} onChange={(e) => setV(e.target.value)} placeholder="Capture anything you know about the customer, requirements, or solution. The proposal generator will weave this in." />
        <Button size="sm" onClick={() => onSave(v)}>Save notes</Button>
      </CardContent>
    </Card>
  );
}

function GenerateStep({ proposal, attachments, sectionGen, aiBusy, genProgress, onGenerate, onGenerateAll, onPatchSection, onExport }: any) {
  const defaultSecs = sectionsFor(proposal);

  // Detect an active proposal template attachment (parsed) and derive its outline.
  const templateAtt = useMemo(() => findActiveTemplate(attachments ?? []), [attachments]);
  const extracted = useMemo(
    () => (templateAtt ? extractTemplateStructure(templateAtt.parsed_content) : null),
    [templateAtt],
  );
  const templateOutline: TemplateSection[] = extracted?.sections ?? [];
  const hasUsableTemplate = !!templateAtt && templateOutline.length > 0;

  // Default ON when a usable template is present, but let the user revert.
  const [useTemplate, setUseTemplate] = useState<boolean>(hasUsableTemplate);
  useEffect(() => { setUseTemplate(hasUsableTemplate); }, [hasUsableTemplate, templateAtt?.id]);

  const followingTemplate = useTemplate && hasUsableTemplate;
  const SECS: { id: string; title: string }[] = followingTemplate
    ? templateOutline.map((s) => ({ id: s.id, title: s.title }))
    : defaultSecs;

  const templatePayload = followingTemplate && extracted && templateAtt
    ? {
        filename: templateAtt.filename as string,
        structure: templateOutline.map((s) => s.title),
        boilerplate: extracted.boilerplate,
      }
    : null;

  const [active, setActive] = useState(SECS[0]?.id);
  useEffect(() => {
    if (!SECS.find((s) => s.id === active)) setActive(SECS[0]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followingTemplate, templateAtt?.id]);

  const sections = proposal.sections || {};
  const generatedCount = SECS.filter((s) => sections[s.id]?.content).length;
  const current = active ? (sections[active] as Section | undefined) : undefined;
  const anySectionBusy = Object.values(sectionGen || {}).some(Boolean);
  const lockButtons = !!aiBusy || anySectionBusy;
  const eta = genProgress ? Math.max(0, (genProgress.total - genProgress.current + 1) * 30) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      {templateAtt && (
        <div className="lg:col-span-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
          <FileText className="w-3.5 h-3.5 text-primary" />
          {followingTemplate ? (
            <>
              <span className="font-medium">Following template: {templateAtt.filename}</span>
              {templateOutline.length > 0 && (
                <span className="text-muted-foreground">· {templateOutline.length} section{templateOutline.length === 1 ? "" : "s"} detected</span>
              )}
              {!hasUsableTemplate && (
                <span className="text-amber-600">· no headings detected — using default outline</span>
              )}
            </>
          ) : (
            <span className="font-medium text-muted-foreground">Template available: {templateAtt.filename} (using default outline)</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 text-[11px] px-2"
            disabled={!hasUsableTemplate}
            onClick={() => setUseTemplate((v) => !v)}
            title={!hasUsableTemplate ? "No headings extracted from the template — cannot follow its structure." : undefined}
          >
            {followingTemplate ? "Revert to default structure" : "Follow this template"}
          </Button>
        </div>
      )}
      {genProgress && (
        <div className="lg:col-span-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs flex items-center gap-2">
          <RefreshCw className="w-3 h-3 animate-spin text-primary" />
          <span className="font-medium">Generating section {genProgress.current} of {genProgress.total}: {genProgress.label}</span>
          <span className="text-muted-foreground">· est. ~{Math.ceil(eta / 60)} min remaining</span>
        </div>
      )}
      <Card className="lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Generation queue</CardTitle>
          <CardDescription className="text-xs">
            {generatedCount} of {SECS.length} drafted
            {proposal.engagement_type === "sub" && <span className="ml-1 text-amber-600">· Sub-to-prime inputs{proposal.prime_contractor_name ? ` for ${proposal.prime_contractor_name}` : ""}</span>}
            {followingTemplate && <span className="ml-1 text-primary">· Template-driven</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2 space-y-1">
          <Button size="sm" className="w-full mb-2" onClick={() => onGenerateAll(SECS, { template: templatePayload })} disabled={lockButtons} title={lockButtons ? "Another AI task is running — please wait." : undefined}><Sparkles className="w-4 h-4 mr-1" />Generate all remaining</Button>
          {SECS.map((s) => {
            const has = !!sections[s.id]?.content;
            const busy = sectionGen[s.id];
            return (
              <button key={s.id} onClick={() => setActive(s.id)} className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-2 ${active === s.id ? "bg-muted" : "hover:bg-muted/50"}`}>
                {busy ? <RefreshCw className="w-3 h-3 animate-spin text-primary" /> : has ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Circle className="w-3 h-3 text-muted-foreground" />}
                <span className="flex-1 truncate">{s.title}</span>
                {has && <span className="text-[10px] text-muted-foreground">{sections[s.id].word_count}w</span>}
              </button>
            );
          })}
          <Button onClick={onExport} variant="outline" size="sm" className="w-full mt-3"><Download className="w-4 h-4 mr-1" />Export .docx</Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">{SECS.find((s) => s.id === active)?.title ?? "—"}</CardTitle>
            <CardDescription className="text-xs">{current?.word_count ?? 0} words</CardDescription>
          </div>
          <Button size="sm" onClick={() => active && onGenerate(active, SECS.find((s) => s.id === active)!.title, { template: templatePayload })} disabled={lockButtons || !active} title={lockButtons ? "Another AI task is running — please wait." : undefined}>
            <Sparkles className="w-4 h-4 mr-1" />{active && sectionGen[active] ? "Generating…" : current?.content ? "Regenerate" : "Generate"}
          </Button>
        </CardHeader>
        <CardContent>
          <Textarea
            value={current?.content ?? ""}
            onChange={(e) => active && onPatchSection(active, e.target.value)}
            placeholder="Click Generate to produce this section. The output will stream in. You can edit inline."
            className="font-mono text-xs min-h-[60vh]"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerIntelStep({ proposal, proposalId, companyProfile, onPatch, aiBusy, setAiBusy, online }: any) {
  const [busy, setBusy] = useState(false);
  const [skipCache, setSkipCache] = useState(false);
  const intel = proposal.customer_intel || {};
  const [notes, setNotes] = useState<string>(intel.notes || "");
  const locked = busy || (aiBusy && !busy);

  async function research() {
    if (online === false) { toast.error("You're offline. Reconnect to run AI tasks."); return; }
    if (aiBusy) { toast.error("Another AI task is running — please wait."); return; }
    setBusy(true);
    setAiBusy?.(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-intel`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          opportunity: proposal.opportunity_data ?? {
            title: proposal.opportunity_title, solicitationNumber: proposal.solicitation_number,
            agency: proposal.agency, naicsCode: proposal.naics_code, setAside: proposal.set_aside,
            responseDeadLine: proposal.response_deadline, type: proposal.opportunity_type,
          },
          companyProfile,
          extraNotes: notes || undefined,
          userId: session?.user?.id,
          proposalId,
          teamId: proposal.team_id ?? null,
          engagementType: proposal.engagement_type ?? "prime",
          pursuitType: proposal.pursuit_type ?? "rfp_rfq",
          primeContractorName: proposal.prime_contractor_name ?? null,
          primeContractorId: proposal.prime_contractor_id ?? null,
          targetedScopeAreas: proposal.targeted_scope_areas ?? null,
          userContext: userContextFromProposal(proposal),
          skipCache,
        }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || `HTTP ${r.status}`); return; }
      const merged = { ...intel, ...j.intel, notes };
      await onPatch({ customer_intel: merged });
      if (j.cached && j.cached_at) {
        const ms = Date.now() - new Date(j.cached_at).getTime();
        const mins = Math.max(1, Math.round(ms / 60000));
        const ago = mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} d ago`;
        toast.success(`Using cached intel from ${ago}`, { description: "Toggle 'Skip cache' to force a fresh AI run." });
      } else {
        toast.success("Customer intelligence drafted");
      }
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); setAiBusy?.(false); }
  }

  const list = (label: string, items?: string[]) => items?.length ? (
    <div><div className="text-xs font-semibold mb-1">{label}</div><ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  ) : null;

  const linkedinUrl = (name: string) =>
    `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${proposal.agency || ""}`.trim())}`;

  return (
    <TooltipProvider delayDuration={200}>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 space-y-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Run AI research</CardTitle><CardDescription className="text-xs">Profiles the buyer, recent contracts, evaluation signals, and win themes.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <Label className="text-xs">Optional context to bias research</Label>
            <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 'I think the incumbent is XYZ', 'KO is Jane Smith', anything from prior conversations…" />
            <Button onClick={research} disabled={locked} size="sm" className="w-full" title={aiBusy && !busy ? "Another AI task is running — please wait." : undefined}>
              {busy ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
              {busy ? "Researching…" : intel.customer_summary ? "Re-run research" : "Run research"}
            </Button>
            <div className="flex items-center gap-2">
              <input id="skipCacheIntel" type="checkbox" checked={skipCache} onChange={(e) => setSkipCache(e.target.checked)} />
              <Label htmlFor="skipCacheIntel" className="text-[11px] text-muted-foreground">Skip cache (force fresh AI run)</Label>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <input id="verified" type="checkbox" checked={!!proposal.customer_intel_verified} onChange={(e) => onPatch({ customer_intel_verified: e.target.checked })} />
              <Label htmlFor="verified" className="text-xs">I have reviewed this intel</Label>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-base">Customer profile</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {intel.customer_summary && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>This intelligence was generated by AI based on public information and the model's training data. <strong>Verify key claims</strong> before using in your proposal.</span>
            </div>
          )}
          {!intel.customer_summary && <div className="text-muted-foreground text-xs">No intel yet. Click "Run research".</div>}
          {intel._user_context_applied?.length > 0 && (
            <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1">
              <span>Your facts applied:</span>
              {intel._user_context_applied.map((k: string) => (
                <Badge key={k} variant="outline" className="text-[10px]">{USER_CONTEXT_LABELS[k as keyof typeof USER_CONTEXT_LABELS] ?? k}</Badge>
              ))}
            </div>
          )}
          {intel.customer_summary && <p className="text-sm leading-relaxed">{intel.customer_summary}</p>}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {intel.end_user_unit && <div><div className="text-muted-foreground">End-user unit</div><div>{intel.end_user_unit}</div></div>}
            {intel.parent_command && <div><div className="text-muted-foreground">Parent command</div><div>{intel.parent_command}</div></div>}
            {intel.location && <div><div className="text-muted-foreground">Location</div><div>{intel.location}</div></div>}
            {intel.predecessor_contract?.incumbent && <div><div className="text-muted-foreground">Incumbent</div><div>{intel.predecessor_contract.incumbent} {intel.predecessor_contract.value && `· ${intel.predecessor_contract.value}`}</div></div>}
          </div>
          {list("Mission priorities", intel.mission_priorities)}
          {list("Technology environment", intel.technology_environment)}
          {list("Evaluation signals", intel.evaluation_signals)}
          {list("Recommended win themes", intel.win_themes)}
          {list("Risks", intel.risks)}
          {intel.key_personnel?.length > 0 && (
            <div><div className="text-xs font-semibold mb-1">Key personnel</div>
              <div className="space-y-1 text-xs">{intel.key_personnel.map((p: any, i: number) => (
                <div key={i} className="border border-border rounded px-2 py-1 flex items-center gap-2">
                  <div className="flex-1">
                    <span className="font-semibold">{p.name}</span> — {p.role} {p.notes && <span className="text-muted-foreground">· {p.notes}</span>}
                  </div>
                  {p.name && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={linkedinUrl(p.name)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-primary inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent"
                          aria-label={`Search LinkedIn for ${p.name}`}
                        >
                          <Linkedin className="w-3.5 h-3.5" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>Search LinkedIn</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              ))}</div>
            </div>
          )}
          {intel.citations?.length > 0 && (
            <div className="border-t border-border pt-2">
              <div className="text-xs font-semibold mb-1 flex items-center gap-1">
                Sources
                <Tooltip>
                  <TooltipTrigger asChild><AlertTriangle className="w-3 h-3 text-amber-500" /></TooltipTrigger>
                  <TooltipContent>⚠️ AI-generated link — verify before relying on it</TooltipContent>
                </Tooltip>
              </div>
              <ul className="text-xs space-y-1">
                {intel.citations.map((c: string, i: number) => {
                  const verified = !!(intel.citation_verified || {})[c];
                  return (
                    <li key={i} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={verified}
                        onChange={(e) => {
                          const map = { ...(intel.citation_verified || {}) };
                          if (e.target.checked) map[c] = true; else delete map[c];
                          onPatch({ customer_intel: { ...intel, citation_verified: map } });
                        }}
                        title="Mark this source as manually verified"
                      />
                      <a href={c} target="_blank" rel="noreferrer" className={`flex-1 truncate ${verified ? "text-emerald-600 dark:text-emerald-400" : "text-primary"} hover:underline`}>{c}</a>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {intel.customer_summary && (
            <div className="border-t border-border pt-2">
              <DataProvenance source="AI (Lovable AI Gateway)" fetchedAt={intel._fetched_at} note="Generated by AI from public information and model training data — not a primary source." />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}

