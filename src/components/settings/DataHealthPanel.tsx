import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, Archive, Calendar, FileWarning } from "lucide-react";

type Finding = {
  id: string;
  category: "stale_proposal" | "watching_past_deadline" | "expired_pp" | "vehicle_expiring";
  title: string;
  detail: string;
  actionLabel: string;
  run: () => Promise<void>;
};

export function DataHealthPanel() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const out: Finding[] = [];
    const now = Date.now();
    const in90Days = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date(now).toISOString().slice(0, 10);

    // 1. Proposals with no attachments and no compliance matrix
    const { data: proposals } = await supabase
      .from("proposals")
      .select("id, opportunity_title, solicitation_number, compliance_matrix, status")
      .neq("status", "archived");
    if (proposals?.length) {
      const ids = proposals.map((p) => p.id);
      const { data: atts } = await supabase
        .from("proposal_attachments")
        .select("proposal_id")
        .in("proposal_id", ids);
      const withAtt = new Set((atts || []).map((a) => a.proposal_id));
      for (const p of proposals) {
        const cmEmpty = !p.compliance_matrix || (Array.isArray((p.compliance_matrix as any)?.requirements) && (p.compliance_matrix as any).requirements.length === 0);
        if (!withAtt.has(p.id) && cmEmpty) {
          out.push({
            id: `prop:${p.id}`,
            category: "stale_proposal",
            title: p.opportunity_title || p.solicitation_number || "Untitled proposal",
            detail: "No attachments and no compliance matrix — likely abandoned.",
            actionLabel: "Archive",
            run: async () => {
              const { error } = await supabase.from("proposals").update({ status: "archived" }).eq("id", p.id);
              if (error) throw error;
            },
          });
        }
      }
    }

    // 2. Tracked opportunities past deadline still 'Watching'
    const { data: tracked } = await supabase
      .from("tracked_opportunities")
      .select("id, title, response_deadline, status")
      .eq("status", "Watching")
      .lt("response_deadline", today);
    (tracked || []).forEach((t) => {
      out.push({
        id: `tracked:${t.id}`,
        category: "watching_past_deadline",
        title: t.title,
        detail: `Deadline passed ${t.response_deadline}. Still marked "Watching".`,
        actionLabel: "Mark No-Bid",
        run: async () => {
          const { error } = await supabase.from("tracked_opportunities").update({ status: "No-Bid" }).eq("id", t.id);
          if (error) throw error;
        },
      });
    });

    // 3. Past performance with expired PoP end dates
    const { data: pp } = await supabase
      .from("past_performance")
      .select("id, contract_title, period_of_performance_end")
      .lt("period_of_performance_end", today);
    (pp || []).forEach((p) => {
      out.push({
        id: `pp:${p.id}`,
        category: "expired_pp",
        title: p.contract_title,
        detail: `PoP ended ${p.period_of_performance_end}. Confirm it's still relevant.`,
        actionLabel: "Acknowledge",
        run: async () => {
          // Acknowledge by setting created_at touch — no schema change. Just dismiss locally.
          // No DB write needed; the dismiss removes from current view.
        },
      });
    });

    // 4. Contract vehicles within 90 days of expiring
    const { data: vehicles } = await supabase
      .from("contract_vehicles")
      .select("id, vehicle_name, period_of_performance_end, status")
      .eq("status", "active")
      .gte("period_of_performance_end", today)
      .lte("period_of_performance_end", in90Days);
    (vehicles || []).forEach((v) => {
      out.push({
        id: `vehicle:${v.id}`,
        category: "vehicle_expiring",
        title: v.vehicle_name,
        detail: `Expires ${v.period_of_performance_end} (within 90 days).`,
        actionLabel: "Mark expired",
        run: async () => {
          const { error } = await supabase.from("contract_vehicles").update({ status: "expired" }).eq("id", v.id);
          if (error) throw error;
        },
      });
    });

    setFindings(out);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function applyFix(f: Finding) {
    setBusyId(f.id);
    try {
      await f.run();
      setFindings((cur) => cur.filter((x) => x.id !== f.id));
      toast.success("Resolved");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to apply fix");
    } finally {
      setBusyId(null);
    }
  }

  const categoryIcon = (c: Finding["category"]) => {
    if (c === "stale_proposal") return <Archive className="w-4 h-4 text-muted-foreground" />;
    if (c === "watching_past_deadline") return <Calendar className="w-4 h-4 text-amber-500" />;
    if (c === "expired_pp") return <FileWarning className="w-4 h-4 text-amber-500" />;
    return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Data Health</CardTitle>
          <CardDescription>Routine checks across your team's records. Resolve issues to keep your pipeline accurate.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Re-check
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Running checks…</div>
        ) : findings.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            All checks passed — no data health issues found.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground mb-2">{findings.length} issue{findings.length === 1 ? "" : "s"} detected</div>
            {findings.map((f) => (
              <div key={f.id} className="flex items-start gap-3 border border-border rounded-md p-3">
                <div className="mt-0.5">{categoryIcon(f.category)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.detail}</div>
                  <div className="mt-1">
                    <Badge variant="outline" className="text-[10px]">{f.category.replace(/_/g, " ")}</Badge>
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={busyId === f.id} onClick={() => applyFix(f)}>
                  {busyId === f.id ? "…" : f.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
