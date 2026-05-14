import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Download, Save, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useTeamId } from "@/lib/team";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import type { SamOpportunity } from "@/lib/api";

export function ProposalModal({ opp, onClose }: { opp: SamOpportunity | null; onClose: () => void }) {
  const open = !!opp;
  const { user } = useAuth();
  const teamId = useTeamId();
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);

  async function generate() {
    if (!opp) return;
    setGenerating(true);
    setContent("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-proposal`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ opportunity: opp }),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Failed" }));
        toast.error(err.error || `HTTP ${resp.status}`);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let done = false;
      while (!done) {
        const r = await reader.read();
        if (r.done) break;
        buf += decoder.decode(r.value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) { acc += c; setContent(acc); }
          } catch { buf = line + "\n" + buf; break; }
        }
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setGenerating(false); }
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(content);
    toast.success("Copied");
  }

  async function downloadDocx() {
    if (!opp) return;
    const paragraphs = content.split("\n").map((line) => {
      if (line.startsWith("# ")) return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(line.slice(2))] });
      if (line.startsWith("## ")) return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(line.slice(3))] });
      if (line.startsWith("### ")) return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(line.slice(4))] });
      return new Paragraph({ children: [new TextRun(line)] });
    });
    const doc = new Document({
      styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: paragraphs,
      }],
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Proposal-${opp.solicitationNumber || "draft"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveDraft() {
    if (!opp || !user) return;
    const { error } = await supabase.from("proposal_drafts").insert({
      user_id: user.id,
      solicitation_number: opp.solicitationNumber || "unknown",
      opportunity_title: opp.title,
      agency: opp.fullParentPathName,
      naics_code: opp.naicsCode,
      response_deadline: opp.responseDeadLine || null,
      draft_content: content,
    });
    if (error) toast.error(error.message);
    else toast.success("Draft saved");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{opp?.title}</DialogTitle>
          <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
            <div>Sol #: <span className="font-mono">{opp?.solicitationNumber}</span> · {opp?.fullParentPathName}</div>
            <div>Deadline: {opp?.responseDeadLine?.slice(0, 10)} · NAICS {opp?.naicsCode} · {opp?.type}</div>
          </div>
        </DialogHeader>

        <div className="flex gap-2 flex-wrap">
          <Button onClick={generate} disabled={generating} className="bg-primary">
            <Sparkles className="w-4 h-4 mr-1" />
            {generating ? "Generating..." : content ? "Regenerate" : "Generate Proposal"}
          </Button>
          <Button variant="outline" onClick={copyToClipboard} disabled={!content}><Copy className="w-4 h-4 mr-1" /> Copy</Button>
          <Button variant="outline" onClick={downloadDocx} disabled={!content}><Download className="w-4 h-4 mr-1" /> .docx</Button>
          <Button variant="outline" onClick={saveDraft} disabled={!content}><Save className="w-4 h-4 mr-1" /> Save Draft</Button>
        </div>

        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Click Generate Proposal to draft a full SDVOSB proposal tailored to this solicitation..."
          className="flex-1 font-mono text-xs resize-none"
        />
      </DialogContent>
    </Dialog>
  );
}
