import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Loader2, Copy, Download, RefreshCw, Sparkles, Save, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import { RELATIONSHIP_MODELS, type RelationshipModel } from "@/lib/pwin";

export type OutreachPartnerInput = {
  id?: string | null;
  company_name: string;
  uei?: string | null;
  certifications?: string[];
  naics_codes?: string[];
  capabilities_summary?: string | null;
  past_performance_summary?: string | null;
  poc_name?: string | null;
  poc_email?: string | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
};

type Outreach = {
  email_subject: string;
  email_body: string;
  brief_message: string;
  fit_rationale?: string[];
};

type OutreachType = "email" | "briefing" | "call_script" | "linkedin";
type OutreachStatus = "draft" | "copied" | "sent_externally" | "archived";

type DraftRow = {
  id: string;
  proposal_id: string;
  partner_id: string | null;
  partner_name: string;
  generated_by: string;
  outreach_type: OutreachType;
  relationship_model: string;
  subject: string | null;
  content: string;
  fit_rationale: string[] | null;
  status: OutreachStatus;
  created_at: string;
  updated_at: string;
};

const TYPE_LABEL: Record<OutreachType, string> = {
  email: "Email",
  briefing: "Briefing",
  call_script: "Call script",
  linkedin: "LinkedIn message",
};

const STATUS_LABEL: Record<OutreachStatus, string> = {
  draft: "Draft",
  copied: "Copied",
  sent_externally: "Sent externally",
  archived: "Archived",
};

export function TeamingOutreachModal({
  open, onOpenChange, proposal, partner,
  defaultProposedRole, defaultProposedWorkSharePct, defaultScopeAreas,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  proposal: {
    id: string;
    team_id: string | null;
    engagement_type?: "prime" | "sub" | null;
    opportunity_data?: any;
  };
  partner: OutreachPartnerInput | null;
  defaultProposedRole?: string;
  defaultProposedWorkSharePct?: number | null;
  defaultScopeAreas?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [outreach, setOutreach] = useState<Outreach | null>(null);
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [brief, setBrief] = useState("");
  const [proposedRole, setProposedRole] = useState(defaultProposedRole ?? "");
  const [proposedShare, setProposedShare] = useState<string>(
    defaultProposedWorkSharePct != null ? String(defaultProposedWorkSharePct) : ""
  );
  const [scopeAreas, setScopeAreas] = useState(defaultScopeAreas ?? "");
  const [relationshipModel, setRelationshipModel] = useState<RelationshipModel>(
    proposal.engagement_type === "sub" ? "sub_to_prime" : "prime_with_subs",
  );

  // load company profile
  const { data: companyProfile } = useQuery({
    queryKey: ["company-profile-outreach", proposal.team_id],
    enabled: !!proposal.team_id && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("company_profile").select("profile_data")
        .eq("team_id", proposal.team_id!).maybeSingle();
      return (data?.profile_data ?? null) as any;
    },
  });

  // load prior drafts for this proposal + partner
  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ["outreach-history", proposal.id, partner?.id ?? partner?.company_name ?? null],
    enabled: open && !!partner,
    queryFn: async (): Promise<DraftRow[]> => {
      const base = supabase
        .from("proposal_outreach_drafts")
        .select("*")
        .eq("proposal_id", proposal.id);
      const query = partner?.id
        ? base.eq("partner_id", partner.id)
        : base.eq("partner_name", partner!.company_name);
      const { data } = await query.order("created_at", { ascending: false });
      return (data ?? []) as DraftRow[];
    },
  });

  useEffect(() => {
    if (!open) {
      setOutreach(null);
      setSubject(""); setEmailBody(""); setBrief("");
    }
  }, [open]);

  const persistDraft = async (
    outreachType: OutreachType,
    content: string,
    opts?: { subject?: string | null; fitRationale?: string[] | null },
  ) => {
    if (!partner) return null;
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return null;
    const { data, error } = await supabase
      .from("proposal_outreach_drafts")
      .insert({
        proposal_id: proposal.id,
        partner_id: partner.id ?? null,
        partner_name: partner.company_name,
        generated_by: uid,
        outreach_type: outreachType,
        relationship_model: relationshipModel,
        subject: opts?.subject ?? null,
        content,
        fit_rationale: (opts?.fitRationale ?? []) as any,
        status: "draft",
      })
      .select()
      .single();
    if (error) {
      toast.error(`Couldn't save to history: ${error.message}`);
      return null;
    }
    refetchHistory();
    return data as DraftRow;
  };

  const generate = async (skipCache = false) => {
    if (!partner || !companyProfile) {
      toast.error(!companyProfile ? "Complete your company profile in Capture Intel first." : "No partner selected.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-teaming-outreach", {
        body: {
          opportunity: proposal.opportunity_data ?? {},
          companyProfile,
          partner,
          engagementType: proposal.engagement_type ?? "prime",
          proposedRole,
          proposedWorkSharePct: proposedShare === "" ? null : Number(proposedShare),
          proposedScopeAreas: scopeAreas,
          teamId: proposal.team_id,
          proposalId: proposal.id,
          skipCache,
        },
      });
      if (error) throw error;
      const o = (data as any)?.outreach as Outreach;
      if (!o) throw new Error("No outreach returned");
      setOutreach(o);
      setSubject(o.email_subject || "");
      setEmailBody(o.email_body || "");
      setBrief(o.brief_message || "");

      // Auto-save both variants to the proposal history.
      const fit = o.fit_rationale ?? [];
      await Promise.all([
        persistDraft("email", o.email_body || "", { subject: o.email_subject, fitRationale: fit }),
        o.brief_message
          ? persistDraft("linkedin", o.brief_message, { fitRationale: fit })
          : Promise.resolve(null),
      ]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate outreach");
    } finally {
      setLoading(false);
    }
  };

  // auto-generate on open when no history exists for this partner
  useEffect(() => {
    if (open && partner && companyProfile && !outreach && !loading && history.length === 0) {
      generate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partner?.company_name, companyProfile, history.length]);

  const copy = async (text: string, label: string, draftId?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
      if (draftId) await updateStatus(draftId, "copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const updateStatus = async (id: string, status: OutreachStatus) => {
    const { error } = await supabase
      .from("proposal_outreach_drafts")
      .update({ status })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    refetchHistory();
  };

  const deleteDraft = async (id: string) => {
    const { error } = await supabase.from("proposal_outreach_drafts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Draft removed");
    refetchHistory();
  };

  const downloadDocx = async (subj: string, body: string, name: string) => {
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
      const paragraphs = [
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `Subject: ${subj}`, bold: true })] }),
        new Paragraph({ children: [new TextRun("")] }),
        ...body.split(/\n+/).map((line) =>
          new Paragraph({ children: [new TextRun(line)] })),
      ];
      const doc = new Document({ sections: [{ children: paragraphs }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outreach-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    }
  };

  // Convert the current email draft to a saved row of a chosen type.
  const saveAs = async (type: OutreachType) => {
    const body = type === "linkedin" ? brief : emailBody;
    if (!body.trim()) { toast.error("Nothing to save yet."); return; }
    const row = await persistDraft(type, body, {
      subject: type === "email" ? subject : null,
      fitRationale: outreach?.fit_rationale ?? [],
    });
    if (row) toast.success(`Saved as ${TYPE_LABEL[type].toLowerCase()}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Teaming outreach
            {partner && <span className="text-muted-foreground font-normal">— {partner.company_name}</span>}
          </DialogTitle>
          <DialogDescription>
            AI-drafted outreach. Drafts are saved to the proposal history automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">Relationship</Label>
              <Select value={relationshipModel} onValueChange={(v) => setRelationshipModel(v as RelationshipModel)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_MODELS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Proposed role</Label>
              <Input value={proposedRole} onChange={(e) => setProposedRole(e.target.value)}
                placeholder={proposal.engagement_type === "sub" ? "Prime" : "Sub"} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Work share %</Label>
              <Input type="number" min={0} max={100} value={proposedShare}
                onChange={(e) => setProposedShare(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Scope areas</Label>
              <Input value={scopeAreas} onChange={(e) => setScopeAreas(e.target.value)}
                placeholder="e.g. cyber, logistics" className="h-8 text-sm" />
            </div>
          </div>

          {outreach?.fit_rationale && outreach.fit_rationale.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {outreach.fit_rationale.map((r, i) => (
                <Badge key={i} variant="secondary" className="text-[11px]">{r}</Badge>
              ))}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating outreach…
            </div>
          )}

          <Tabs defaultValue="email">
            <TabsList>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="brief">Brief / LinkedIn</TabsTrigger>
              <TabsTrigger value="history">
                <History className="w-3.5 h-3.5 mr-1" /> History ({history.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="space-y-2">
              <div>
                <Label className="text-xs">Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Body</Label>
                <Textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
                  rows={14} className="font-sans text-sm" />
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => saveAs("briefing")}>
                  <Save className="w-3.5 h-3.5 mr-1" /> Save as briefing
                </Button>
                <Button variant="outline" size="sm" onClick={() => saveAs("call_script")}>
                  <Save className="w-3.5 h-3.5 mr-1" /> Save as call script
                </Button>
                <Button variant="outline" size="sm"
                  onClick={() => copy(`Subject: ${subject}\n\n${emailBody}`, "Email")}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadDocx(subject, emailBody, partner?.company_name || "partner")}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Download .docx
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="brief" className="space-y-2">
              <Textarea value={brief} onChange={(e) => setBrief(e.target.value)}
                rows={10} className="font-sans text-sm" />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => saveAs("linkedin")}>
                  <Save className="w-3.5 h-3.5 mr-1" /> Save as LinkedIn
                </Button>
                <Button variant="outline" size="sm" onClick={() => copy(brief, "Message")}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="history" className="space-y-2">
              {history.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed rounded-md p-6 text-center">
                  No outreach drafts yet for this partner. Generate one to start the history.
                </div>
              ) : (
                history.map((d) => (
                  <HistoryRow
                    key={d.id}
                    draft={d}
                    onCopy={(text) => copy(text, TYPE_LABEL[d.outreach_type], d.id)}
                    onDownload={() => downloadDocx(d.subject ?? "", d.content, `${d.partner_name}-${d.outreach_type}`)}
                    onStatus={(s) => updateStatus(d.id, s)}
                    onDelete={() => deleteDraft(d.id)}
                    onLoad={() => {
                      if (d.outreach_type === "email") {
                        setSubject(d.subject ?? "");
                        setEmailBody(d.content);
                      } else if (d.outreach_type === "linkedin") {
                        setBrief(d.content);
                      } else {
                        setEmailBody(d.content);
                      }
                      toast.success(`Loaded ${TYPE_LABEL[d.outreach_type].toLowerCase()} draft`);
                    }}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>

          <div className="flex justify-between pt-2 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => generate(true)} disabled={loading || !partner}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Regenerate
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryRow({
  draft, onCopy, onDownload, onStatus, onDelete, onLoad,
}: {
  draft: DraftRow;
  onCopy: (text: string) => void;
  onDownload: () => void;
  onStatus: (s: OutreachStatus) => void;
  onDelete: () => void;
  onLoad: () => void;
}) {
  const created = new Date(draft.created_at);
  const modelLabel = RELATIONSHIP_MODELS.find((r) => r.value === draft.relationship_model)?.label ?? draft.relationship_model;
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[draft.outreach_type]}</Badge>
            <Badge variant="secondary" className="text-[10px]">{modelLabel}</Badge>
            <span className="text-[11px] text-muted-foreground">{created.toLocaleString()}</span>
          </div>
          {draft.subject && <div className="text-sm font-medium mt-1 truncate">{draft.subject}</div>}
        </div>
        <Select value={draft.status} onValueChange={(v) => onStatus(v as OutreachStatus)}>
          <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABEL) as OutreachStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{draft.content}</div>
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onLoad}>Load to editor</Button>
        <Button variant="outline" size="sm"
          onClick={() => onCopy(draft.outreach_type === "email" && draft.subject
            ? `Subject: ${draft.subject}\n\n${draft.content}` : draft.content)}>
          <Copy className="w-3.5 h-3.5 mr-1" /> Copy
        </Button>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="w-3.5 h-3.5 mr-1" /> .docx
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
