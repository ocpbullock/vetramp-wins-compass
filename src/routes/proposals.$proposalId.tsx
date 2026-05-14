import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { RelevantPastPerformanceCard } from "@/components/proposals/RelevantPastPerformanceCard";
import { ComplianceStep } from "@/components/proposals/ComplianceStep";
import { MilestoneTimeline } from "@/components/proposals/MilestoneTimeline";
import { SolutionDesignStep } from "@/components/proposals/SolutionDesignStep";
import { classifyFilename, ATTACHMENT_TYPE_OPTIONS } from "@/lib/attachment-classify";
import { DataProvenance } from "@/components/dashboard/DataSourceBadge";
import { OCIScreeningCard, ociStatus, type OciAnswers } from "@/components/proposals/OCIScreeningCard";
import { StepErrorBoundary } from "@/components/StepErrorBoundary";
import { OfflineBanner, useOnline } from "@/components/OfflineBanner";
import { friendlyError, friendlyFromError, friendlyFromResponse } from "@/lib/api-errors";

export const Route = createFileRoute("/proposals/$proposalId")({ component: ProposalPipeline });

const SECTIONS: { id: string; title: string }[] = [
  { id: "cover_letter", title: "Cover Letter" },
  { id: "executive_summary", title: "Executive Summary" },
  { id: "technical_approach", title: "Technical Approach" },
  { id: "management_approach", title: "Management Approach" },
  { id: "past_performance", title: "Past Performance" },
  { id: "staffing_plan", title: "Staffing Plan" },
  { id: "compliance_matrix", title: "Compliance Cross-Reference Matrix" },
];

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
      setProposal(p);
      setCompanyProfile(cp?.profile_data ?? null);
      setAttachments(atts ?? []);
      setLoading(false);
    })();
  }, [user, proposalId, navigate]);

  async function patchProposal(patch: TablesUpdate<"proposals">) {
    setProposal((p: any) => ({ ...p, ...patch }));
    const { error } = await supabase.from("proposals").update(patch).eq("id", proposalId);
    if (error) toast.error(error.message);
  }

  async function uploadFile(file: File, fileType?: string) {
    if (!user) return null;
    const ft = fileType || classifyFilename(file.name);
    const path = `${user.id}/${proposalId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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

  async function deleteAttachment(att: any) {
    await supabase.storage.from("proposal-attachments").remove([att.storage_path]);
    await supabase.from("proposal_attachments").delete().eq("id", att.id);
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
      if (fresh) setProposal(fresh);
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

  async function generateSection(sectionId: string, sectionTitle: string) {
    if (!online) { toast.error("You're offline. Reconnect to run AI tasks."); return; }
    if (aiBusy) { toast.error("Another AI task is running — please wait."); return; }
    if (!companyProfile) { toast.error("Company profile missing"); return; }
    setSectionGen((s) => ({ ...s, [sectionId]: true }));
    setAiBusy(true);
    try {
      // gather attachment text (parsed_content) when available
      const attachmentsText = attachments.map((a) => a.parsed_content).filter(Boolean).join("\n\n---\n\n");
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
        }),
      });
      if (!resp.ok || !resp.body) {
        const j = await resp.json().catch(() => ({ error: "Failed" }));
        toast.error(friendlyError({ status: resp.status, message: j.error, code: j.code })); return;
      }
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
              const next = { ...(proposal.sections || {}), [sectionId]: { content: acc, status: "draft", word_count: wc } };
              setProposal((p: any) => ({ ...p, sections: next }));
            }
          } catch { buf = line + "\n" + buf; break; }
        }
      }
      const wc = acc.split(/\s+/).filter(Boolean).length;
      const finalSections = { ...(proposal.sections || {}), [sectionId]: { content: acc, status: "draft", word_count: wc } };
      await patchProposal({ sections: finalSections });
      toast.success(`Generated ${sectionTitle}`);
    } catch (e: any) {
      toast.error(friendlyFromError(e));
    } finally {
      setSectionGen((s) => ({ ...s, [sectionId]: false }));
      setAiBusy(false);
    }
  }

  async function generateAll() {
    const remaining = SECTIONS.filter((s) => !proposal.sections?.[s.id]?.content);
    if (remaining.length === 0) { toast.info("All sections already drafted"); return; }
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      setGenProgress({ current: i + 1, total: remaining.length, label: s.title });
      try {
        await generateSection(s.id, s.title);
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
      await exportProposalDocx({ proposal, companyProfile, sectionDefs: SECTIONS });
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
    const generated = SECTIONS.filter((s) => proposal.sections?.[s.id]?.content).length;
    score += Math.round((generated / SECTIONS.length) * 20);
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
          <Badge variant="outline">{proposal.status}</Badge>
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

        <MilestoneTimeline proposalId={proposalId} responseDeadline={proposal.response_deadline} />

        <Tabs value={step} onValueChange={setStep}>
          <TabsList>
            <TabsTrigger value="intake">1. Intake</TabsTrigger>
            <TabsTrigger value="intel">2. Customer Intel</TabsTrigger>
            <TabsTrigger value="compliance">3. Compliance</TabsTrigger>
            <TabsTrigger value="solution">4. Solution Design</TabsTrigger>
            <TabsTrigger value="generate">5. Generate</TabsTrigger>
          </TabsList>

          <TabsContent value="intake" className="mt-4 space-y-4">
            <StepErrorBoundary label="intake">
              <IntakeStep proposal={proposal} attachments={attachments} onPatch={patchProposal} onUpload={uploadFile} onDelete={deleteAttachment} onAutoFetch={autoFetchSamAttachments} onParse={parseDocuments} parsing={parsing} parseProgress={parseProgress} proposalId={proposalId} fetchResults={fetchResults} fetching={fetching} onUpdateAttachmentType={updateAttachmentType} />
            </StepErrorBoundary>
          </TabsContent>
          <TabsContent value="intel" className="mt-4">
            <StepErrorBoundary label="intel">
              <CustomerIntelStep proposal={proposal} proposalId={proposalId} companyProfile={companyProfile} onPatch={patchProposal} attachments={attachments.filter((a) => a.file_type === "customer_intel")} onUpload={uploadFile} onDelete={deleteAttachment} aiBusy={aiBusy} setAiBusy={setAiBusy} online={online} />
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
              <GenerateStep proposal={proposal} sectionGen={sectionGen} aiBusy={aiBusy} genProgress={genProgress} onGenerate={generateSection} onGenerateAll={generateAll} onPatchSection={(id: string, content: string) => {
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

function IntakeStep({ proposal, attachments, onPatch, onUpload, onDelete, onAutoFetch, onParse, parsing, parseProgress, proposalId, fetchResults, fetching, onUpdateAttachmentType }: any) {
  const sowAttachments = attachments.filter((a: any) => a.file_type !== "customer_intel");
  const totalChars = sowAttachments.reduce((s: number, a: any) => s + (a.parsed_content?.length || 0), 0);
  const largeDoc = totalChars > 300_000;
  const [local, setLocal] = useState(proposal);
  useEffect(() => setLocal(proposal), [proposal.id]);
  const save = () => onPatch({
    opportunity_type: local.opportunity_type, estimated_value: local.estimated_value || null,
    contract_type: local.contract_type, pop_base_months: local.pop_base_months || null,
    pop_option_months: local.pop_option_months || null, clearance_requirement: local.clearance_requirement, user_notes: local.user_notes,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
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
              <Select value={local.opportunity_type ?? ""} onValueChange={(v) => setLocal({ ...local, opportunity_type: v })}>
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
              <Select value={local.contract_type ?? ""} onValueChange={(v) => setLocal({ ...local, contract_type: v })}>
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
              <Input type="number" value={local.estimated_value ?? ""} onChange={(e) => setLocal({ ...local, estimated_value: Number(e.target.value) || null })} />
            </div>
            <div>
              <Label>Clearance</Label>
              <Select value={local.clearance_requirement ?? ""} onValueChange={(v) => setLocal({ ...local, clearance_requirement: v })}>
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
              <Input type="number" value={local.pop_base_months ?? ""} onChange={(e) => setLocal({ ...local, pop_base_months: Number(e.target.value) || null })} />
            </div>
            <div>
              <Label>Option months (total)</Label>
              <Input type="number" value={local.pop_option_months ?? ""} onChange={(e) => setLocal({ ...local, pop_option_months: Number(e.target.value) || null })} />
            </div>
            <div className="col-span-2">
              <Label>Internal notes</Label>
              <Textarea rows={3} value={local.user_notes ?? ""} onChange={(e) => setLocal({ ...local, user_notes: e.target.value })} />
            </div>
            <div className="col-span-2"><Button onClick={save} size="sm">Save details</Button></div>
          </CardContent>
        </Card>

        <TeamingCard
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
        <CardHeader><CardTitle className="text-base">Solicitation documents</CardTitle><CardDescription>SOW, Section L/M, amendments</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={onAutoFetch} variant="outline" size="sm" className="w-full" disabled={fetching}>
            {fetching ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            {fetching ? "Fetching from SAM.gov…" : "Try auto-fetch from SAM.gov"}
          </Button>

          <SamFetchResults results={fetchResults} samUrl={proposal.opportunity_data?.uiLink} />

          <DropZoneUpload onUpload={onUpload} />

          <Button
            onClick={onParse}
            disabled={parsing || sowAttachments.length === 0}
            size="sm"
            className="w-full"
          >
            {parsing ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <ListChecks className="w-4 h-4 mr-1" />}
            {parsing ? (parseProgress || "Parsing…") : proposal.compliance_matrix ? "Re-parse documents" : "Parse documents & auto-fill capture"}
          </Button>
          {parsing && proposal.parsing_status === "parsing" && (
            <div className="text-[11px] text-muted-foreground">Do not navigate away — parsing in progress.</div>
          )}
          <div className="text-[11px] text-muted-foreground">
            Parsing extracts requirements (Section L/M, "shall" statements) AND auto-fills capture details below — title, agency, contract type, value, PoP, clearance, etc.
          </div>
          {largeDoc && (
            <div className="text-[11px] rounded border border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 px-2 py-1.5">
              <AlertTriangle className="w-3 h-3 inline-block mr-1" />
              Large solicitation detected ({Math.round(totalChars / 1000)}K chars) — parsing may take several minutes and multiple AI passes.
            </div>
          )}
          <div className="space-y-1">
            {sowAttachments.length === 0 && <div className="text-xs text-muted-foreground">No files yet.</div>}
            {sowAttachments.map((a: any) => {
              const chars = a.parsed_content?.length || 0;
              const empty = a.parsed_content !== null && a.parsed_content !== undefined && chars === 0;
              return (
                <div key={a.id} className="border border-border rounded px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <FileText className="w-3 h-3 text-muted-foreground" />
                    <span className="flex-1 truncate" title={a.filename}>{a.filename}</span>
                    <Select value={a.file_type ?? "other"} onValueChange={(v) => onUpdateAttachmentType(a, v)}>
                      <SelectTrigger className="h-6 px-1.5 text-[10px] w-[110px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ATTACHMENT_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button onClick={() => onDelete(a)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  {chars > 0 && (
                    <div className="text-[10px] text-muted-foreground pl-5">{chars.toLocaleString()} chars extracted</div>
                  )}
                  {empty && (
                    <div className="text-[10px] text-destructive pl-5">
                      Could not extract text — try uploading a text-based PDF instead of a scanned image.
                    </div>
                  )}
                </div>
              );
            })}
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

function GenerateStep({ proposal, sectionGen, aiBusy, genProgress, onGenerate, onGenerateAll, onPatchSection, onExport }: any) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const sections = proposal.sections || {};
  const generatedCount = SECTIONS.filter((s) => sections[s.id]?.content).length;
  const current = sections[active] as Section | undefined;
  const anySectionBusy = Object.values(sectionGen || {}).some(Boolean);
  const lockButtons = !!aiBusy || anySectionBusy;
  const eta = genProgress ? Math.max(0, (genProgress.total - genProgress.current + 1) * 30) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
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
          <CardDescription className="text-xs">{generatedCount} of {SECTIONS.length} drafted</CardDescription>
        </CardHeader>
        <CardContent className="p-2 space-y-1">
          <Button size="sm" className="w-full mb-2" onClick={onGenerateAll} disabled={lockButtons} title={lockButtons ? "Another AI task is running — please wait." : undefined}><Sparkles className="w-4 h-4 mr-1" />Generate all remaining</Button>
          {SECTIONS.map((s) => {
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
            <CardTitle className="text-base">{SECTIONS.find((s) => s.id === active)?.title}</CardTitle>
            <CardDescription className="text-xs">{current?.word_count ?? 0} words</CardDescription>
          </div>
          <Button size="sm" onClick={() => onGenerate(active, SECTIONS.find((s) => s.id === active)!.title)} disabled={lockButtons} title={lockButtons ? "Another AI task is running — please wait." : undefined}>
            <Sparkles className="w-4 h-4 mr-1" />{sectionGen[active] ? "Generating…" : current?.content ? "Regenerate" : "Generate"}
          </Button>
        </CardHeader>
        <CardContent>
          <Textarea
            value={current?.content ?? ""}
            onChange={(e) => onPatchSection(active, e.target.value)}
            placeholder="Click Generate to produce this section. The output will stream in. You can edit inline."
            className="font-mono text-xs min-h-[60vh]"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerIntelStep({ proposal, companyProfile, onPatch, attachments = [], onUpload, onDelete }: any) {
  const [busy, setBusy] = useState(false);
  const intel = proposal.customer_intel || {};
  const [notes, setNotes] = useState<string>(intel.notes || "");

  async function research() {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-intel`;
      const attachmentsText = attachments
        .map((a: any) => a.parsed_content)
        .filter(Boolean)
        .join("\n\n---\n\n");
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
          attachmentsText: attachmentsText || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || `HTTP ${r.status}`); return; }
      const merged = { ...intel, ...j.intel, notes };
      await onPatch({ customer_intel: merged });
      toast.success("Customer intelligence drafted");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
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
            <Button onClick={research} disabled={busy} size="sm" className="w-full">
              {busy ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
              {busy ? "Researching…" : intel.customer_summary ? "Re-run research" : "Run research"}
            </Button>
            {attachments.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Research will include text from {attachments.length} reference document{attachments.length === 1 ? "" : "s"}.
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <input id="verified" type="checkbox" checked={!!proposal.customer_intel_verified} onChange={(e) => onPatch({ customer_intel_verified: e.target.checked })} />
              <Label htmlFor="verified" className="text-xs">I have reviewed this intel</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reference documents</CardTitle>
            <CardDescription className="text-xs">Incumbent past performance, agency strategic plans, org charts, prior task order SOWs — anything that gives the AI more context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block">
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && onUpload) onUpload(f, "customer_intel"); e.target.value = ""; }} />
              <div className="border-2 border-dashed border-border rounded-md p-3 text-center text-xs cursor-pointer hover:bg-muted">
                <Upload className="w-3 h-3 inline-block mr-1" />Upload reference document
              </div>
            </label>
            <div className="space-y-1">
              {attachments.length === 0 && <div className="text-[11px] text-muted-foreground">No reference documents yet.</div>}
              {attachments.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-xs border border-border rounded px-2 py-1.5">
                  <FileText className="w-3 h-3 text-muted-foreground" />
                  <span className="flex-1 truncate" title={a.filename}>{a.filename}</span>
                  <button onClick={() => onDelete && onDelete(a)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
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

