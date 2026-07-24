import { Briefcase, History, DollarSign, FileEdit, Star } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";

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
    { label: "Active Opportunities", value: p.activeOpps.toLocaleString(), icon: Briefcase, tab: "opportunities", tone: "default" as const },
    {
      label: "Historical Awards",
      value: p.historicalTotal != null && p.historicalTotal > p.historicalCount
        ? `${p.historicalCount.toLocaleString()} of ${p.historicalTotal.toLocaleString()}`
        : p.historicalCount.toLocaleString(),
      icon: History, tab: "historical", tone: "default" as const,
    },
    {
      label: p.totalObligatedIsFiltered ? "Total Obligated (filtered)" : "Total Obligated",
      value: fmtMoney(p.totalObligatedIsFiltered ? (p.totalObligatedFiltered ?? 0) : p.totalObligated),
      icon: DollarSign, tab: "historical", tone: "money" as const,
    },
    { label: "Works in Progress", value: (p.inProgressCount ?? 0).toLocaleString(), icon: FileEdit, tab: "in-progress", tone: "warning" as const },
    { label: "Starred", value: (p.starredCount ?? 0).toLocaleString(), icon: Star, tab: "starred", tone: "brass" as const },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((c) => (
        <MetricCard
          key={c.label}
          label={c.label}
          value={c.value}
          icon={c.icon}
          tone={c.tone}
          onClick={p.onSelect ? () => p.onSelect?.(c.tab) : undefined}
        />
      ))}
    </div>
  );
}
