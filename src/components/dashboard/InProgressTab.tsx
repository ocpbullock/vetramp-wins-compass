import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Trash2, ArrowRight, ShieldAlert, Eye } from "lucide-react";
import { ociStatus } from "@/components/proposals/OCIScreeningCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";
import { toast } from "sonner";

type Proposal = {
  id: string;
  user_id: string | null;
  team_id: string | null;
  opportunity_title: string | null;
  agency: string | null;
  solicitation_number: string | null;
  status: string | null;
  response_deadline: string | null;
  updated_at: string;
  oci_screening: any;
  opportunity_source: string | null;
  opportunity_source_id: string | null;
  engagement_type: string | null;
  prime_contractor_name: string | null;
};


export function InProgressTab({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const { user, isAdmin } = useAuth();
  const { userRole } = useTeam();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  const [overdueByProposal, setOverdueByProposal] = useState<Record<string, number>>({});

  async function load() {
    if (!user) return;
    setLoading(true);
    // Rely on RLS for visibility: a user sees proposals they own, proposals
    // owned by an org team they belong to, and proposals on an opportunity
    // team they were invited to. Filtering by user_id here would hide
    // teammates' proposals even though RLS would allow reading them.
    const { data, error } = await supabase
      .from("proposals")
      .select("id,user_id,team_id,opportunity_title,agency,solicitation_number,status,response_deadline,updated_at,oci_screening,opportunity_source,opportunity_source_id,engagement_type,prime_contractor_name")
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else {
      setRows(data || []);
      onCountChange?.(data?.length || 0);
      const ids = (data || []).map((p) => p.id);
      if (ids.length > 0) {
        // Guard reconcileOverdue so it doesn't write to proposal_milestones on
        // every tab mount. 15-minute throttle via sessionStorage.
        const RECONCILE_INTERVAL = 15 * 60 * 1000;
        try {
          const lastRun = Number(sessionStorage.getItem("vetramp_last_reconcile") || "0");
          if (Date.now() - lastRun > RECONCILE_INTERVAL) {
            const { reconcileOverdue } = await import("@/lib/milestones");
            await reconcileOverdue(ids);
            sessionStorage.setItem("vetramp_last_reconcile", String(Date.now()));
          }
        } catch { /* sessionStorage unavailable — skip reconcile */ }
        const { data: ms } = await supabase
          .from("proposal_milestones")
          .select("proposal_id,status")
          .in("proposal_id", ids)
          .eq("status", "overdue");
        const counts: Record<string, number> = {};
        for (const m of ms || []) counts[m.proposal_id] = (counts[m.proposal_id] || 0) + 1;
        setOverdueByProposal(counts);
      }
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  async function remove(id: string) {
    const { data, error } = await supabase.from("proposals").delete().eq("id", id).select("id");
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) {
      return toast.error("You don't have permission to delete this proposal — ask a team owner/admin");
    }
    toast.success("Deleted");
    load();
  }

  function canDeleteProposal(p: Proposal): boolean {
    if (isAdmin) return true;
    if (user && p.user_id === user.id) return true;
    if (userRole === "owner" || userRole === "admin") return true;
    return false;
  }

  function viewOpportunity(p: Proposal) {
    // Map the stored opportunity_source to the right dashboard tab. Stash the
    // id in sessionStorage so the destination tab can scroll to + highlight it.
    const src = p.opportunity_source;
    let tab = "opportunities";
    let id: string | null = null;
    if (src === "tracked") { tab = "tracked"; id = p.opportunity_source_id; }
    else if (src === "starred") { tab = "starred"; id = p.opportunity_source_id; }
    else { tab = "opportunities"; id = p.opportunity_source_id ?? p.solicitation_number; }
    if (id) {
      try { sessionStorage.setItem("dash:highlight", JSON.stringify({ source: src ?? "sam", id })); } catch { /* ignore */ }
    }
    navigate({ to: "/", hash: tab });
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!rows.length) return <div className="text-sm text-muted-foreground">No proposals in progress yet. Click "Propose" on an opportunity to start one.</div>;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-2">
        {rows.map((p) => {
          const deletable = canDeleteProposal(p);
          return (
          <Card key={p.id} className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{p.opportunity_title || "Untitled"}</div>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {p.agency && <span>{p.agency}</span>}
                  {p.solicitation_number && <span className="font-mono">Sol# {p.solicitation_number}</span>}
                  {p.response_deadline && <span>Due {p.response_deadline.slice(0, 10)}</span>}
                  <span>Updated {new Date(p.updated_at).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.engagement_type === "sub" ? (
                  <Badge className="bg-amber-500 hover:bg-amber-500/90" title={p.prime_contractor_name ? `Sub to: ${p.prime_contractor_name}` : "Subcontractor pursuit"}>
                    SUB{p.prime_contractor_name ? ` · ${p.prime_contractor_name}` : ""}
                  </Badge>
                ) : (
                  <Badge className="bg-blue-600 hover:bg-blue-600/90">PRIME</Badge>
                )}
                <Badge variant="secondary" className="capitalize">{p.status || "intake"}</Badge>
                {overdueByProposal[p.id] > 0 && (
                  <Badge className="bg-destructive">{overdueByProposal[p.id]} overdue</Badge>
                )}
                {ociStatus(p.oci_screening) === "flagged" && (
                  <Badge variant="destructive" title="Potential OCI detected — consult legal counsel"><ShieldAlert className="w-3 h-3 mr-1" />OCI flag</Badge>
                )}
                <Button size="sm" variant="outline" onClick={() => viewOpportunity(p)} title="View originating opportunity">
                  <Eye className="w-3 h-3 mr-1" /> View Opportunity
                </Button>
                <Button size="sm" onClick={() => navigate({ to: "/proposals/$proposalId", params: { proposalId: p.id } })}>
                  Resume <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
                {deletable ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" title="Delete proposal">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this proposal?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes "{p.opportunity_title || "Untitled"}" and all of its associated data (attachments, parsed content, intake fields). This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(p.id)}>Delete proposal</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button size="sm" variant="ghost" disabled aria-disabled="true">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Only the proposal creator or a team owner/admin can delete this proposal.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </Card>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
