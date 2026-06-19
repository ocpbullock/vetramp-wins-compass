import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useTeam } from "@/lib/team";
import {
  createOpportunityTeam,
  inviteToOpportunityTeam,
  listLinkableProposalsForOrg,
} from "@/lib/opportunity-teams.functions";
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

type Mode = "new" | "existing";

export function CreateOpportunityTeamDialog(props: Props) {
  const { open, onOpenChange, opportunityTitle, source, sourceId } = props;
  const { currentTeam } = useTeam();
  const { user } = useAuth();
  const navigate = useNavigate();
  const createTeam = useServerFn(createOpportunityTeam);
  const inviteFn = useServerFn(inviteToOpportunityTeam);
  const listLinkable = useServerFn(listLinkableProposalsForOrg);
  const [mode, setMode] = useState<Mode>("new");
  const [selectedProposalId, setSelectedProposalId] = useState<string>("");
  const [proposalSearch, setProposalSearch] = useState("");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);

  const isOrg = !!currentTeam && currentTeam.team_type === "organization";

  const proposalsQ = useQuery({
    queryKey: ["linkable-proposals", currentTeam?.id],
    enabled: open && mode === "existing" && isOrg,
    queryFn: () => listLinkable({ data: { parentTeamId: currentTeam!.id } }),
  });

  const filteredProposals = (proposalsQ.data?.proposals ?? []).filter((p) => {
    const q = proposalSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.opportunity_title ?? "").toLowerCase().includes(q) ||
      (p.solicitation_number ?? "").toLowerCase().includes(q) ||
      (p.agency ?? "").toLowerCase().includes(q)
    );
  });

  async function handleCreate() {
    if (!currentTeam || currentTeam.team_type !== "organization") {
      toast.error("Switch to your organization team first.");
      return;
    }
    if (!user) return;
    if (mode === "existing" && !selectedProposalId) {
      toast.error("Pick a proposal to link, or switch to 'Start a new proposal'.");
      return;
    }
    setBusy(true);
    try {
      let proposalId: string;

      if (mode === "new") {
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
        proposalId = prop.id;
      } else {
        proposalId = selectedProposalId;
      }

      const { team } = await createTeam({
        data: {
          parentTeamId: currentTeam.id,
          proposalId,
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
        toast.success(`Created Capture Room and sent ${list.length} invite${list.length === 1 ? "" : "s"}.`);
      } else {
        toast.success("Capture Room created.");
      }
      onOpenChange(false);
      navigate({ to: "/proposals/$proposalId", params: { proposalId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create Capture Room.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Proposal</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="mt-2 grid grid-cols-1 gap-2"
            >
              <Label className="flex items-start gap-2 border rounded-md p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="new" className="mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium">Start a new proposal</div>
                  <div className="text-xs text-muted-foreground">Creates a fresh proposal stub from this opportunity.</div>
                </div>
              </Label>
              <Label className="flex items-start gap-2 border rounded-md p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="existing" className="mt-0.5" />
                <div className="text-sm flex-1">
                  <div className="font-medium">Link an existing proposal</div>
                  <div className="text-xs text-muted-foreground">Choose one of your organization's proposals that isn't already linked to an opportunity team.</div>
                </div>
              </Label>
            </RadioGroup>
          </div>

          {mode === "existing" && (
            <div className="space-y-2">
              <Input
                placeholder="Search title, sol #, agency…"
                value={proposalSearch}
                onChange={(e) => setProposalSearch(e.target.value)}
              />
              <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                {!isOrg && (
                  <div className="p-3 text-xs text-muted-foreground">Switch to an organization team to link existing proposals.</div>
                )}
                {isOrg && proposalsQ.isLoading && (
                  <div className="p-3 text-xs text-muted-foreground">Loading…</div>
                )}
                {isOrg && !proposalsQ.isLoading && filteredProposals.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">
                    {proposalsQ.data?.proposals?.length === 0
                      ? "No unlinked proposals available in this organization."
                      : "No proposals match your search."}
                  </div>
                )}
                {filteredProposals.map((p) => {
                  const active = selectedProposalId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProposalId(p.id)}
                      className={`w-full text-left p-2.5 hover:bg-accent flex items-start gap-2 ${active ? "bg-accent/60" : ""}`}
                    >
                      <input type="radio" readOnly checked={active} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {p.opportunity_title || p.solicitation_number || "Untitled proposal"}
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                          {p.agency && <span>{p.agency}</span>}
                          {p.solicitation_number && <span className="font-mono">Sol# {p.solicitation_number}</span>}
                          {p.response_deadline && <span>Due {p.response_deadline.slice(0, 10)}</span>}
                          {p.status && <span className="capitalize">· {p.status}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
          <Button
            onClick={handleCreate}
            disabled={busy || (mode === "existing" && !selectedProposalId)}
          >
            {busy ? "Creating…" : mode === "existing" ? "Link & open proposal" : "Create team & open proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
