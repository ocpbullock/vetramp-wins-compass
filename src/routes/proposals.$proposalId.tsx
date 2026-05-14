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
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { TeamingCard, fetchTeamingForProposal } from "@/components/proposals/TeamingCard";
import { RelevantPastPerformanceCard } from "@/components/proposals/RelevantPastPerformanceCard";
import { ComplianceStep } from "@/components/proposals/ComplianceStep";
import { MilestoneTimeline } from "@/components/proposals/MilestoneTimeline";

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

  async function uploadFile(file: File, fileType: string) {
    if (!user) return;
    const path = `${user.id}/${proposalId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("proposal-attachments").upload(path, file);
    if (upErr) { toast.error(upErr.message); return; }
    const { data: row, error: insErr } = await supabase.from("proposal_attachments").insert({
      proposal_id: proposalId, filename: file.name, file_type: fileType, storage_path: path, source: "manual", size_bytes: file.size,
    }).select().single();
    if (insErr) { toast.error(insErr.message); return; }
    setAttachments((a) => [row, ...a]);
    toast.success(`Uploaded ${file.name}`);
  }

  async function deleteAttachment(att: any) {
    await supabase.storage.from("proposal-attachments").remove([att.storage_path]);
    await supabase.from("proposal_attachments").delete().eq("id", att.id);
    setAttachments((a) => a.filter((x) => x.id !== att.id));
  }

  const [parsing, setParsing] = useState(false);
  async function parseDocuments() {
    const sowAtts = attachments.filter((a) => a.file_type === "sow");
    if (sowAtts.length === 0) { toast.error("Upload a SOW/PWS document first"); return; }
    setParsing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-sow`;
      toast.info("Parsing solicitation documents… this can take a minute");
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
        body: JSON.stringify({ proposalId }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || `HTTP ${r.status}`); return; }
      // The edge function may have updated capture fields server-side; refetch for the latest state
      const { data: fresh } = await supabase.from("proposals").select("*").eq("id", proposalId).maybeSingle();
      if (fresh) setProposal(fresh);
      const filled = j.filled_fields?.length ?? 0;
      toast.success(`Extracted ${j.matrix?.requirements?.length ?? 0} requirements${filled ? ` · auto-filled ${filled} field${filled === 1 ? "" : "s"}` : ""}`);
    } catch (e: any) { toast.error(e.message); } finally { setParsing(false); }
  }

  async function autoFetchSamAttachments() {
    if (!proposal?.notice_id) { toast.error("No notice ID on this opportunity"); return; }
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    toast.info("Fetching attachments from SAM.gov…");
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sam-attachments`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ proposalId, noticeId: proposal.notice_id, action: "download" }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || "Fetch failed"); return; }
      toast.success(`Downloaded ${j.saved?.length ?? 0} of ${j.attempted ?? 0}`);
      const { data: atts } = await supabase.from("proposal_attachments").select("*").eq("proposal_id", proposalId).order("uploaded_at", { ascending: false });
      setAttachments(atts ?? []);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function generateSection(sectionId: string, sectionTitle: string) {
    if (!companyProfile) { toast.error("Company profile missing"); return; }
    setSectionGen((s) => ({ ...s, [sectionId]: true }));
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
        toast.error(j.error || `HTTP ${resp.status}`); return;
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
      toast.error(e.message);
    } finally {
      setSectionGen((s) => ({ ...s, [sectionId]: false }));
    }
  }

  async function generateAll() {
    for (const s of SECTIONS) {
      // skip already generated unless user wants regen
      if (proposal.sections?.[s.id]?.content) continue;
      await generateSection(s.id, s.title);
    }
  }

  async function exportDocx() {
    const sections = proposal.sections || {};
    const children: Paragraph[] = [];
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(proposal.opportunity_title || "Proposal")] }));
    children.push(new Paragraph({ children: [new TextRun(`Solicitation #: ${proposal.solicitation_number}`)] }));
    children.push(new Paragraph({ children: [new TextRun(`Agency: ${proposal.agency || ""}`)] }));
    children.push(new Paragraph({ children: [new TextRun(`Submitted by: LGE Consulting, LLC dba VetRamp | UEI: N8HBYAZ9VGQ5 | CAGE: 9PKK3`)] }));
    children.push(new Paragraph({ children: [new TextRun("")] }));
    for (const s of SECTIONS) {
      const sec = sections[s.id];
      if (!sec?.content) continue;
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s.title)] }));
      for (const line of sec.content.split("\n")) {
        if (line.startsWith("# ")) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(line.slice(2))] }));
        else if (line.startsWith("## ")) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(line.slice(3))] }));
        else if (line.startsWith("### ")) children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(line.slice(4))] }));
        else children.push(new Paragraph({ children: [new TextRun(line)] }));
      }
    }
    const doc = new Document({
      styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children,
      }],
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Proposal-${proposal.solicitation_number || "draft"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
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
    if (proposal.staffing_plan) score += 10;
    const generated = SECTIONS.filter((s) => proposal.sections?.[s.id]?.content).length;
    score += Math.round((generated / SECTIONS.length) * 20);
    return Math.min(100, score);
  }, [proposal, attachments]);

  if (loading || !proposal) return <div className="min-h-screen bg-background"><Header /><div className="p-8 text-muted-foreground">Loading proposal…</div></div>;

  const cd = countdown(proposal.response_deadline);

  return (
    <div className="min-h-screen bg-background">
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
            <IntakeStep proposal={proposal} attachments={attachments} onPatch={patchProposal} onUpload={uploadFile} onDelete={deleteAttachment} onAutoFetch={autoFetchSamAttachments} onParse={parseDocuments} parsing={parsing} proposalId={proposalId} />
          </TabsContent>
          <TabsContent value="intel" className="mt-4">
            <CustomerIntelStep proposal={proposal} companyProfile={companyProfile} onPatch={patchProposal} attachments={attachments.filter((a) => a.file_type === "customer_intel")} onUpload={uploadFile} onDelete={deleteAttachment} />
          </TabsContent>
          <TabsContent value="compliance" className="mt-4">
            <ComplianceStep proposal={proposal} onPatch={patchProposal} onGoToIntake={() => setStep("intake")} />
          </TabsContent>
          <TabsContent value="solution" className="mt-4">
            <ComingSoon title="Solution Design (Phase 3)" description="Build staffing, technical approach, management plan, transition timeline, and price strategy with AI assistance. For now, capture freeform solution notes." fieldLabel="Solution design notes" value={proposal.technical_approach?.notes || ""} onSave={(v) => patchProposal({ technical_approach: { ...(proposal.technical_approach || {}), notes: v } })} />
          </TabsContent>
          <TabsContent value="generate" className="mt-4 space-y-4">
            <GenerateStep proposal={proposal} sectionGen={sectionGen} onGenerate={generateSection} onGenerateAll={generateAll} onPatchSection={(id: string, content: string) => {
              const wc = content.split(/\s+/).filter(Boolean).length;
              const next = { ...(proposal.sections || {}), [id]: { ...(proposal.sections?.[id] || { status: "draft" }), content, word_count: wc } };
              patchProposal({ sections: next });
            }} onExport={exportDocx} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function IntakeStep({ proposal, attachments, onPatch, onUpload, onDelete, onAutoFetch, onParse, parsing, proposalId }: any) {
  const sowAttachments = attachments.filter((a: any) => a.file_type !== "customer_intel");
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
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Solicitation documents</CardTitle><CardDescription>SOW, Section L/M, amendments</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={onAutoFetch} variant="outline" size="sm" className="w-full"><RefreshCw className="w-4 h-4 mr-1" />Try auto-fetch from SAM.gov</Button>
          <label className="block">
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f, "sow"); e.target.value = ""; }} />
            <div className="border-2 border-dashed border-border rounded-md p-4 text-center text-sm cursor-pointer hover:bg-muted">
              <Upload className="w-4 h-4 inline-block mr-1" />Upload document
            </div>
          </label>
          <Button
            onClick={onParse}
            disabled={parsing || sowAttachments.length === 0}
            size="sm"
            className="w-full"
          >
            {parsing ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <ListChecks className="w-4 h-4 mr-1" />}
            {parsing ? "Parsing…" : proposal.compliance_matrix ? "Re-parse documents" : "Parse documents & auto-fill capture"}
          </Button>
          <div className="text-[11px] text-muted-foreground">
            Parsing extracts requirements (Section L/M, "shall" statements) AND auto-fills capture details below — title, agency, contract type, value, PoP, clearance, etc.
          </div>
          <div className="space-y-1">
            {sowAttachments.length === 0 && <div className="text-xs text-muted-foreground">No files yet.</div>}
            {sowAttachments.map((a: any) => (
              <div key={a.id} className="flex items-center gap-2 text-xs border border-border rounded px-2 py-1.5">
                <FileText className="w-3 h-3 text-muted-foreground" />
                <span className="flex-1 truncate" title={a.filename}>{a.filename}</span>
                <Badge variant="outline" className="text-[10px]">{a.file_type}</Badge>
                <button onClick={() => onDelete(a)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
            <AlertTriangle className="w-3 h-3 inline-block mr-1 text-yellow-500" />
            Auto-fetch may fail when SAM.gov requires login for restricted attachments. Upload manually if needed.
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

function GenerateStep({ proposal, sectionGen, onGenerate, onGenerateAll, onPatchSection, onExport }: any) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const sections = proposal.sections || {};
  const generatedCount = SECTIONS.filter((s) => sections[s.id]?.content).length;
  const current = sections[active] as Section | undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Generation queue</CardTitle>
          <CardDescription className="text-xs">{generatedCount} of {SECTIONS.length} drafted</CardDescription>
        </CardHeader>
        <CardContent className="p-2 space-y-1">
          <Button size="sm" className="w-full mb-2" onClick={onGenerateAll}><Sparkles className="w-4 h-4 mr-1" />Generate all remaining</Button>
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
          <Button size="sm" onClick={() => onGenerate(active, SECTIONS.find((s) => s.id === active)!.title)} disabled={sectionGen[active]}>
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
              <div className="text-xs font-semibold mb-1">Sources</div>
              <ul className="text-xs space-y-0.5 text-muted-foreground">{intel.citations.map((c: string, i: number) => <li key={i} className="truncate"><a href={c} target="_blank" rel="noreferrer" className="text-primary hover:underline">{c}</a></li>)}</ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}

