import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useTeam } from "@/lib/team";
import { createOpportunityTeam, inviteToOpportunityTeam } from "@/lib/opportunity-teams.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityTitle: string;
  source: "starred" | "tracked" | "sam";
  sourceId: string;
  // Optional fields for proposal stub
  noticeId?: string;
  solicitationNumber?: string;
  agency?: string | null;
  naicsCode?: string | null;
  responseDeadline?: string | null;
};

export function CreateOpportunityTeamDialog(props: Props) {
  const { open, onOpenChange, opportunityTitle, source, sourceId } = props;
  const { currentTeam } = useTeam();
  const { user } = useAuth();
  const navigate = useNavigate();
  const createTeam = useServerFn(createOpportunityTeam);
  const inviteFn = useServerFn(inviteToOpportunityTeam);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!currentTeam || currentTeam.team_type !== "organization") {
      toast.error("Switch to your organization team first.");
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      // Create proposal stub first so we can link it
      const sol = props.solicitationNumber ?? `opp-${sourceId.slice(0, 8)}`;
      const { data: prop, error: pErr } = await supabase
        .from("proposals")
        .insert({
          user_id: user.id,
          team_id: currentTeam.id,
          solicitation_number: sol,
          notice_id: props.noticeId ?? null,
          opportunity_title: opportunityTitle.slice(0, 500),
          agency: props.agency ?? null,
          naics_code: props.naicsCode ?? null,
          response_deadline: props.responseDeadline ?? null,
          opportunity_source: source,
          opportunity_source_id: sourceId,
          status: "intake",
        })
        .select("id")
        .single();
      if (pErr) throw pErr;

      const { team } = await createTeam({
        data: {
          parentTeamId: currentTeam.id,
          proposalId: prop.id,
          opportunityTitle,
        },
      });

      const list = emails
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
      if (list.length) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        for (const email of list) {
          try {
            await inviteFn({ data: { teamId: team.id, email, origin } });
          } catch (e) {
            toast.error(`Failed to invite ${email}: ${e instanceof Error ? e.message : "unknown"}`);
          }
        }
        toast.success(`Created opportunity team and sent ${list.length} invite${list.length === 1 ? "" : "s"}.`);
      } else {
        toast.success("Opportunity team created.");
      }
      onOpenChange(false);
      navigate({ to: "/proposals/$proposalId", params: { proposalId: prop.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create opportunity team.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create opportunity team</DialogTitle>
          <DialogDescription>
            Spin up a dedicated team to collaborate on this opportunity. Invited partners only see this proposal — not your other pursuits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Opportunity</Label>
            <div className="mt-1 text-sm font-medium">{opportunityTitle}</div>
          </div>
          <div>
            <Label htmlFor="opp-team-emails">Invite partners (optional)</Label>
            <Textarea
              id="opp-team-emails"
              placeholder="partner1@example.com, partner2@example.com"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={3}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Comma- or newline-separated. They'll get an email invite that lands them on this proposal.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? "Creating…" : "Create team & open proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
