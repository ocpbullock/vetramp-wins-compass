import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import type { HistoricalAward } from "@/lib/api";

const COLORS = ["#2563eb", "#059669", "#d97706", "#9333ea", "#0891b2", "#dc2626", "#65a30d", "#7c3aed"];
const fmtMoney = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 }).format(n || 0);

export function AnalyticsTab({ awards }: { awards: HistoricalAward[] }) {
  const topVendors = useMemo(() => {
    const map = new Map<string, number>();
    awards.forEach((a) => { const k = a["Recipient Name"] || "Unknown"; map.set(k, (map.get(k) || 0) + 1); });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  }, [awards]);

  const agencyDist = useMemo(() => {
    const map = new Map<string, number>();
    awards.forEach((a) => { const k = a["Awarding Agency"] || "Unknown"; map.set(k, (map.get(k) || 0) + 1); });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));
  }, [awards]);

  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    awards.forEach((a) => {
      const d = a["Start Date"]?.slice(0, 7);
      if (!d) return;
      map.set(d, (map.get(d) || 0) + (Number(a["Award Amount"]) || 0));
    });
    return Array.from(map.entries()).sort().map(([month, value]) => ({ month, value }));
  }, [awards]);

  if (awards.length === 0) {
    return <div className="text-center text-muted-foreground py-12">Run a search to see analytics.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold mb-3">Top Vendors by Contract Count</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={topVendors} layout="vertical" margin={{ left: 100 }}>
            <XAxis type="number" />
            <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Agency Distribution</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={agencyDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => e.name.slice(0, 20)}>
              {agencyDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Monthly Obligations</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthly}>
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fontSize: 10 }} width={70} />
            <Tooltip formatter={(v: any) => fmtMoney(Number(v))} />
            <Bar dataKey="value" fill="#059669" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
