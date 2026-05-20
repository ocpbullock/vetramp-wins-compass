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
import { Loader2, Copy, Download, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

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

  useEffect(() => {
    if (!open) {
      setOutreach(null);
      setSubject(""); setEmailBody(""); setBrief("");
    }
  }, [open]);

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
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate outreach");
    } finally {
      setLoading(false);
    }
  };

  // auto-generate on open
  useEffect(() => {
    if (open && partner && companyProfile && !outreach && !loading) {
      generate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partner?.company_name, companyProfile]);

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied`); }
    catch { toast.error("Copy failed"); }
  };

  const downloadDocx = async () => {
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
      const paragraphs = [
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `Subject: ${subject}`, bold: true })] }),
        new Paragraph({ children: [new TextRun("")] }),
        ...emailBody.split(/\n+/).map((line) =>
          new Paragraph({ children: [new TextRun(line)] })),
      ];
      const doc = new Document({ sections: [{ children: paragraphs }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outreach-${(partner?.company_name || "partner").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    }
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
            AI-drafted outreach. Edit before copying or downloading.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
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

          {!loading && outreach && (
            <Tabs defaultValue="email">
              <TabsList>
                <TabsTrigger value="email">Email</TabsTrigger>
                <TabsTrigger value="brief">Brief / LinkedIn</TabsTrigger>
              </TabsList>
              <TabsContent value="email" className="space-y-2">
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Body</Label>
                  <Textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
                    rows={16} className="font-sans text-sm" />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => copy(`Subject: ${subject}\n\n${emailBody}`, "Email")}>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadDocx}>
                    <Download className="w-3.5 h-3.5 mr-1" /> Download .docx
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="brief" className="space-y-2">
                <Textarea value={brief} onChange={(e) => setBrief(e.target.value)}
                  rows={10} className="font-sans text-sm" />
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => copy(brief, "Message")}>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          )}

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
