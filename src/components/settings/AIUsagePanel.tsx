import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AIUsagePanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("ai_usage_log")
        .select("function_name, model, input_tokens, output_tokens, estimated_cost_usd, created_at, status")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  const totalCost = rows.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0);
  const totalIn = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOut = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);

  const byFn = rows.reduce<Record<string, { calls: number; cost: number }>>((acc, r) => {
    const k = r.function_name || "unknown";
    acc[k] = acc[k] || { calls: 0, cost: 0 };
    acc[k].calls += 1;
    acc[k].cost += Number(r.estimated_cost_usd || 0);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Usage (last 30 days)</CardTitle>
        <CardDescription>Estimated cost based on token counts. Actual billing may differ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
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
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">By function</div>
              {Object.entries(byFn).sort((a, b) => b[1].cost - a[1].cost).map(([fn, v]) => (
                <div key={fn} className="flex items-center justify-between text-sm border-b border-border py-1">
                  <span className="font-mono text-xs">{fn}</span>
                  <span className="text-muted-foreground">{v.calls} call{v.calls === 1 ? "" : "s"} · ${v.cost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
