import { Card } from "@/components/ui/card";
import { Briefcase, History, DollarSign, FileEdit, Star } from "lucide-react";

type Props = {
  activeOpps: number;
  historicalCount: number;
  historicalTotal?: number;
  totalObligated: number;
  totalObligatedFiltered?: number;
  totalObligatedIsFiltered?: boolean;
  inProgressCount?: number;
  starredCount?: number;
  onSelect?: (tab: string) => void;
};

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export function StatCards(p: Props) {
  const cards = [
    { label: "Active Opportunities", value: p.activeOpps.toLocaleString(), icon: Briefcase, tab: "opportunities", color: "text-primary" },
    {
      label: "Historical Awards",
      value: p.historicalTotal != null && p.historicalTotal > p.historicalCount
        ? `${p.historicalCount.toLocaleString()} of ${p.historicalTotal.toLocaleString()}`
        : p.historicalCount.toLocaleString(),
      icon: History, tab: "historical", color: "text-violet-600",
    },
    {
      label: p.totalObligatedIsFiltered ? "Total Obligated (filtered)" : "Total Obligated",
      value: fmtMoney(p.totalObligatedIsFiltered ? (p.totalObligatedFiltered ?? 0) : p.totalObligated),
      icon: DollarSign, tab: "historical", color: "text-money",
    },
    { label: "Works in Progress", value: (p.inProgressCount ?? 0).toLocaleString(), icon: FileEdit, tab: "in-progress", color: "text-amber-600" },
    { label: "Starred", value: (p.starredCount ?? 0).toLocaleString(), icon: Star, tab: "starred", color: "text-amber-500" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((c) => (
        <Card
          key={c.label}
          onClick={() => p.onSelect?.(c.tab)}
          className="p-4 cursor-pointer hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{c.label}</div>
              <div className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</div>
            </div>
            <c.icon className={`w-5 h-5 ${c.color}`} />
          </div>
        </Card>
      ))}
    </div>
  );
}
