import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = {
  function_name: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
  status: string | null;
  proposal_id: string | null;
};

export function AIUsagePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState<number>(50);
  const [savedBudget, setSavedBudget] = useState<number>(50);
  const [savingBudget, setSavingBudget] = useState(false);
  const [proposalTitles, setProposalTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: usage }, { data: { user } }] = await Promise.all([
        supabase
          .from("ai_usage_log")
          .select("function_name, model, input_tokens, output_tokens, estimated_cost_usd, created_at, status, proposal_id")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase.auth.getUser(),
      ]);
      setRows((usage as Row[]) || []);

      if (user) {
        const { data: settings } = await supabase
          .from("user_ai_settings")
          .select("monthly_ai_budget_usd")
          .eq("user_id", user.id)
          .maybeSingle();
        if (settings) {
          setBudget(Number(settings.monthly_ai_budget_usd));
          setSavedBudget(Number(settings.monthly_ai_budget_usd));
        }
      }

      const propIds = Array.from(new Set(((usage as Row[]) || []).map((r) => r.proposal_id).filter((x): x is string => !!x)));
      if (propIds.length) {
        const { data: props } = await supabase.from("proposals").select("id, opportunity_title, solicitation_number").in("id", propIds);
        const map: Record<string, string> = {};
        (props || []).forEach((p: any) => { map[p.id] = p.opportunity_title || p.solicitation_number || p.id.slice(0, 8); });
        setProposalTitles(map);
      }

      setLoading(false);
    })();
  }, []);

  async function saveBudget() {
    setSavingBudget(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("user_ai_settings")
        .upsert({ user_id: user.id, monthly_ai_budget_usd: budget }, { onConflict: "user_id" });
      if (error) throw error;
      setSavedBudget(budget);
      toast.success("Monthly AI budget updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save budget");
    } finally {
      setSavingBudget(false);
    }
  }

  // Restrict month-to-date for the budget meter
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }, []);
  const mtdRows = useMemo(() => rows.filter((r) => new Date(r.created_at).getTime() >= monthStart), [rows, monthStart]);
  const mtdCost = mtdRows.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0);
  const pctOfBudget = savedBudget > 0 ? Math.min(100, (mtdCost / savedBudget) * 100) : 0;
  const overBudget = mtdCost > savedBudget;

  const totalCost = rows.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0);
  const totalIn = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOut = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);

  const byFn = useMemo(() => {
    const acc: Record<string, { fn: string; calls: number; cost: number }> = {};
    rows.forEach((r) => {
      const k = r.function_name || "unknown";
      acc[k] = acc[k] || { fn: k, calls: 0, cost: 0 };
      acc[k].calls += 1;
      acc[k].cost += Number(r.estimated_cost_usd || 0);
    });
    return Object.values(acc).sort((a, b) => b.cost - a.cost);
  }, [rows]);

  const byProposal = useMemo(() => {
    const acc: Record<string, { id: string; calls: number; cost: number }> = {};
    rows.forEach((r) => {
      if (!r.proposal_id) return;
      acc[r.proposal_id] = acc[r.proposal_id] || { id: r.proposal_id, calls: 0, cost: 0 };
      acc[r.proposal_id].calls += 1;
      acc[r.proposal_id].cost += Number(r.estimated_cost_usd || 0);
    });
    return Object.values(acc).sort((a, b) => b.cost - a.cost).slice(0, 10);
  }, [rows]);

  const dailyTrend = useMemo(() => {
    const days: { date: string; cost: number; calls: number }[] = [];
    const map: Record<string, { date: string; cost: number; calls: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map[key] = { date: key.slice(5), cost: 0, calls: 0 };
      days.push(map[key]);
    }
    rows.forEach((r) => {
      const key = new Date(r.created_at).toISOString().slice(0, 10);
      if (map[key]) {
        map[key].cost += Number(r.estimated_cost_usd || 0);
        map[key].calls += 1;
      }
    });
    return days;
  }, [rows]);

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">AI Usage</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-muted-foreground">Loading…</div></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly AI budget</CardTitle>
          <CardDescription>Cap your spend. Calls are blocked once your month-to-date cost exceeds this budget.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Month-to-date</div>
              <div className={`text-xl font-semibold ${overBudget ? "text-destructive" : ""}`}>${mtdCost.toFixed(4)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Budget</div>
              <div className="text-xl font-semibold">${savedBudget.toFixed(2)}</div>
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${overBudget ? "bg-destructive" : pctOfBudget > 80 ? "bg-amber-500" : "bg-primary"}`}
              style={{ width: `${pctOfBudget}%` }}
            />
          </div>
          {overBudget && (
            <div className="text-xs text-destructive">Budget exceeded — new AI calls will be blocked until the budget is increased or the month rolls over.</div>
          )}

          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Adjust budget</Label>
              <span className="text-xs font-mono">${budget.toFixed(2)} / month</span>
            </div>
            <Slider min={5} max={500} step={5} value={[budget]} onValueChange={(v) => setBudget(v[0])} />
            <div className="flex justify-end">
              <Button size="sm" onClick={saveBudget} disabled={savingBudget || budget === savedBudget}>
                {savingBudget ? "Saving…" : "Save budget"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Usage (last 30 days)</CardTitle>
          <CardDescription>Estimated cost based on token counts. Actual billing may differ.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No AI usage recorded yet.</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded border border-border p-3">
                  <div className="text-xs text-muted-foreground">Total cost</div>
                  <div className="text-lg font-semibold">${totalCost.toFixed(4)}</div>
                </div>
                <div className="rounded border border-border p-3">
                  <div className="text-xs text-muted-foreground">Input tokens</div>
                  <div className="text-lg font-semibold">{totalIn.toLocaleString()}</div>
                </div>
                <div className="rounded border border-border p-3">
                  <div className="text-xs text-muted-foreground">Output tokens</div>
                  <div className="text-lg font-semibold">{totalOut.toLocaleString()}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Daily cost trend</div>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                      <Tooltip formatter={(v: any) => `$${Number(v).toFixed(4)}`} contentStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="cost" stroke="#2563eb" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Cost by function</div>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byFn} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="fn" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                      <Tooltip formatter={(v: any) => `$${Number(v).toFixed(4)}`} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="cost" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1">
                  {byFn.map((v) => (
                    <div key={v.fn} className="flex items-center justify-between text-sm border-b border-border py-1">
                      <span className="font-mono text-xs">{v.fn}</span>
                      <span className="text-muted-foreground">{v.calls} call{v.calls === 1 ? "" : "s"} · ${v.cost.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {byProposal.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Top proposals by AI cost</div>
                  <div className="space-y-1">
                    {byProposal.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-sm border-b border-border py-1">
                        <span className="text-xs truncate max-w-[60%]" title={proposalTitles[p.id] ?? p.id}>
                          {proposalTitles[p.id] ?? p.id.slice(0, 8)}
                        </span>
                        <span className="text-muted-foreground text-xs">{p.calls} call{p.calls === 1 ? "" : "s"} · ${p.cost.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
