import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTeam } from "@/lib/team";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";

type UsageRow = {
  id: string;
  endpoint: string;
  cached: boolean;
  called_at: string;
  response_status: number | null;
};

const DAILY_LIMIT = 100;
const MONTHLY_LIMIT = 3000;

export function TangoUsagePanel() {
  const { currentTeam } = useTeam();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentTeam) return;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("tango_api_usage")
        .select("id, endpoint, cached, called_at, response_status")
        .eq("team_id", currentTeam.id)
        .gte("called_at", since)
        .order("called_at", { ascending: false })
        .limit(5000);
      setRows((data as UsageRow[]) ?? []);
      setLoading(false);
    })();
  }, [currentTeam]);

  const startOfDay = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const startOfMonth = (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); })();
  const today = rows.filter((r) => new Date(r.called_at).getTime() >= startOfDay);
  const todayLive = today.filter((r) => !r.cached).length;
  const monthLive = rows.filter((r) => new Date(r.called_at).getTime() >= startOfMonth && !r.cached).length;
  const totalCount = rows.length;
  const cacheHitRate = totalCount > 0 ? Math.round((rows.filter((r) => r.cached).length / totalCount) * 100) : 0;
  const dailyPct = Math.min(100, (todayLive / DAILY_LIMIT) * 100);
  const monthPct = Math.min(100, (monthLive / MONTHLY_LIMIT) * 100);

  const trend = (() => {
    const days: { date: string; live: number; cached: number }[] = [];
    const map: Record<string, { date: string; live: number; cached: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map[key] = { date: key.slice(5), live: 0, cached: 0 };
      days.push(map[key]);
    }
    rows.forEach((r) => {
      const key = new Date(r.called_at).toISOString().slice(0, 10);
      if (map[key]) {
        if (r.cached) map[key].cached++; else map[key].live++;
      }
    });
    return days;
  })();

  if (!currentTeam) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Tango API Usage</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-muted-foreground">Select a team to view usage.</div></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Tango API Usage</CardTitle>
            <CardDescription>Federal procurement data via Tango (free tier: 100/day, 3,000/mo).</CardDescription>
          </div>
          {dailyPct >= 80 && <Badge variant="destructive">Approaching daily limit</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Stat label="Today" value={`${todayLive} / ${DAILY_LIMIT}`} pct={dailyPct} />
              <Stat label="This month" value={`${monthLive} / ${MONTHLY_LIMIT}`} pct={monthPct} />
              <Stat label="Cache hit rate" value={`${cacheHitRate}%`} sub={`${totalCount} total calls`} />
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-2">Last 7 days</div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="live" stackId="a" fill="hsl(var(--primary))" name="API calls" />
                    <Bar dataKey="cached" stackId="a" fill="hsl(var(--muted-foreground))" name="Cache hits" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, pct, sub }: { label: string; value: string; pct?: number; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
      {typeof pct === "number" && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-2">
          <div className={`h-full ${pct >= 80 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
