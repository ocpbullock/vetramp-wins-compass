import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Link2, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  listOpportunityTeamsForOrg,
  linkProposalToOpportunityTeam,
  unlinkProposalFromOpportunityTeam,
} from "@/lib/opportunity-teams.functions";

type Props = {
  proposalId: string;
  parentTeamId: string | null;
  currentOpportunityTeamId: string | null;
  onChanged?: () => void;
};

export function LinkOpportunityTeamCard({
  proposalId,
  parentTeamId,
  currentOpportunityTeamId,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listOpportunityTeamsForOrg);
  const linkFn = useServerFn(linkProposalToOpportunityTeam);
  const unlinkFn = useServerFn(unlinkProposalFromOpportunityTeam);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const teamsQ = useQuery({
    queryKey: ["opp-teams-for-org", parentTeamId],
    enabled: !!parentTeamId,
    queryFn: () => listFn({ data: { parentTeamId: parentTeamId! } }),
  });

  const teams = teamsQ.data?.teams ?? [];
  const current = currentOpportunityTeamId
    ? teams.find((t) => t.id === currentOpportunityTeamId) ?? null
    : null;
  // Eligible for linking: opp teams whose slot is empty OR already this proposal.
  const linkable = teams.filter(
    (t) => !t.linked_proposal || t.linked_proposal.id === proposalId,
  );

  async function link() {
    if (!picked) return;
    setBusy(true);
    try {
      await linkFn({ data: { proposalId, opportunityTeamId: picked } });
      toast.success("Linked to Capture Room");
      setPicked("");
      qc.invalidateQueries({ queryKey: ["opp-teams-for-org", parentTeamId] });
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!currentOpportunityTeamId) return;
    setBusy(true);
    try {
      await unlinkFn({
        data: { proposalId, opportunityTeamId: currentOpportunityTeamId },
      });
      toast.success("Unlinked");
      qc.invalidateQueries({ queryKey: ["opp-teams-for-org", parentTeamId] });
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not unlink");
    } finally {
      setBusy(false);
    }
  }

  if (!parentTeamId) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="w-4 h-4" /> Capture Room
        </CardTitle>
        <CardDescription className="text-xs">
          Link this opportunity to a dedicated Capture Room so external partners can be invited without seeing the rest of your pursuits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {current ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="text-[10px] uppercase">Linked</Badge>
              <span className="font-medium">{current.name}</span>
              {current.status === "archived" && (
                <Badge variant="secondary" className="text-[10px] uppercase">archived</Badge>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={unlink} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link2Off className="w-4 h-4 mr-1" />}
              Unlink
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={picked} onValueChange={setPicked} disabled={teamsQ.isLoading || linkable.length === 0}>
              <SelectTrigger className="min-w-[260px]">
                <SelectValue
                  placeholder={
                    teamsQ.isLoading
                      ? "Loading…"
                      : linkable.length === 0
                        ? "No available Capture Rooms"
                        : "Choose a Capture Room"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {linkable.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{t.status === "archived" ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={link} disabled={busy || !picked}>
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link2 className="w-4 h-4 mr-1" />}
              Link
            </Button>
            {linkable.length === 0 && !teamsQ.isLoading && (
              <p className="text-xs text-muted-foreground">
                Every Capture Room in this org is already linked to another opportunity. Create a new Capture Room from the dashboard.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
