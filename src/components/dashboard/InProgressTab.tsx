import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
};

export function InProgressTab({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("proposals")
      .select("id,opportunity_title,agency,solicitation_number,status,response_deadline,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else {
      setRows(data || []);
      onCountChange?.(data?.length || 0);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  async function remove(id: string) {
    if (!confirm("Delete this proposal draft?")) return;
    const { error } = await (supabase as any).from("proposals").delete().eq("id", id);
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
              <Button size="sm" onClick={() => navigate({ to: "/proposals/$proposalId", params: { proposalId: p.id } })}>
                Resume <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
