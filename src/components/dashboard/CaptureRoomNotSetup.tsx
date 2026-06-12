import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Briefcase, Link2, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/dashboard/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam, type Team } from "@/lib/team";
import {
  listLinkableProposalsForOrg,
  linkProposalToOpportunityTeam,
} from "@/lib/opportunity-teams.functions";

type Props = { team: Team };

export function CaptureRoomNotSetup({ team }: Props) {
  const { user } = useAuth();
  const { availableTeams, setCurrentTeam } = useTeam();
  const qc = useQueryClient();
  const parentTeamId = team.parent_team_id;
  const parentTeam = availableTeams.find((t) => t.id === parentTeamId) ?? null;

  const [parentRole, setParentRole] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!parentTeamId || !user) { setParentRole(null); return; }
    (async () => {
      const { data } = await supabase
        .from("team_members")
        .select("role")
        .eq("team_id", parentTeamId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setParentRole((data?.role as string) ?? null);
    })();
    return () => { cancelled = true; };
  }, [parentTeamId, user]);

  const canManage = parentRole === "owner" || parentRole === "admin";

  const listFn = useServerFn(listLinkableProposalsForOrg);
  const linkFn = useServerFn(linkProposalToOpportunityTeam);
  const propsQ = useQuery({
    queryKey: ["linkable-proposals-for-org", parentTeamId],
    enabled: !!parentTeamId && canManage,
    queryFn: () => listFn({ data: { parentTeamId: parentTeamId! } }),
  });
  const proposals = propsQ.data?.proposals ?? [];

  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);

  async function link() {
    if (!picked) return;
    setBusy(true);
    try {
      await linkFn({ data: { proposalId: picked, opportunityTeamId: team.id } });
      toast.success("Proposal linked to this capture room");
      qc.invalidateQueries({ queryKey: ["linkable-proposals-for-org", parentTeamId] });
      // The dashboard guard will pick up the new link on next render via
      // its own server-fn call; nudge the user to reload the room.
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link proposal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-2xl mx-auto px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Briefcase className="w-5 h-5" /> {team.name}
            </CardTitle>
            <CardDescription>
              This capture room has no proposal linked yet. Until a proposal is
              linked, there's nothing to collaborate on here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {canManage ? (
              <div className="space-y-3">
                <div className="text-sm font-medium">Link a proposal</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    value={picked}
                    onValueChange={setPicked}
                    disabled={propsQ.isLoading || proposals.length === 0}
                  >
                    <SelectTrigger className="min-w-[280px]">
                      <SelectValue
                        placeholder={
                          propsQ.isLoading
                            ? "Loading…"
                            : proposals.length === 0
                              ? "No unlinked proposals in this org"
                              : "Choose a proposal"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {proposals.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.opportunity_title || p.solicitation_number || p.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={link} disabled={busy || !picked}>
                    {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link2 className="w-4 h-4 mr-1" />}
                    Link
                  </Button>
                </div>
                {proposals.length === 0 && !propsQ.isLoading && (
                  <p className="text-xs text-muted-foreground">
                    Create a proposal from your organization dashboard first,
                    then return here to link it.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  Only an owner or admin of the parent organization can link a
                  proposal to this capture room. Ask them to set it up.
                </div>
              </div>
            )}

            {parentTeam && (
              <div className="text-sm text-muted-foreground border-t pt-4">
                Need your organization dashboard?{" "}
                <Button
                  variant="link"
                  className="px-1 h-auto"
                  onClick={() => setCurrentTeam(parentTeam.id)}
                >
                  Switch to {parentTeam.name}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
