import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

type Proposal = {
  id: string;
  opportunity_title: string | null;
  agency: string | null;
  solicitation_number: string | null;
  status: string | null;
  response_deadline: string | null;
  updated_at: string;
  oci_screening: any;
};

export function InProgressTab({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  const [overdueByProposal, setOverdueByProposal] = useState<Record<string, number>>({});

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("proposals")
      .select("id,opportunity_title,agency,solicitation_number,status,response_deadline,updated_at,oci_screening")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else {
      setRows(data || []);
      onCountChange?.(data?.length || 0);
      const ids = (data || []).map((p) => p.id);
      if (ids.length > 0) {
        const { reconcileOverdue } = await import("@/lib/milestones");
        await reconcileOverdue(ids);
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
    const { error } = await supabase.from("proposals").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!rows.length) return <div className="text-sm text-muted-foreground">No proposals in progress yet. Click "Propose" on an opportunity to start one.</div>;

  return (
    <div className="space-y-2">
      {rows.map((p) => (
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
              <Badge variant="secondary" className="capitalize">{p.status || "intake"}</Badge>
              {overdueByProposal[p.id] > 0 && (
                <Badge className="bg-destructive">{overdueByProposal[p.id]} overdue</Badge>
              )}
              <Button size="sm" onClick={() => navigate({ to: "/proposals/$proposalId", params: { proposalId: p.id } })}>
                Resume <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost">
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
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
