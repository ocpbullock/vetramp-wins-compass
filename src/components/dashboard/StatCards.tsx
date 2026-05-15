import { Card } from "@/components/ui/card";
import { Briefcase, History, DollarSign, FileEdit, Star, Calendar as CalIcon } from "lucide-react";
import { type DeadlineItem, urgencyClass, urgencyColor, daysUntil } from "@/lib/deadlines";

type Props = {
  activeOpps: number;
  historicalCount: number;
  historicalTotal?: number;
  totalObligated: number;
  totalObligatedFiltered?: number;
  totalObligatedIsFiltered?: boolean;
  inProgressCount?: number;
  starredCount?: number;
  deadlines?: DeadlineItem[];
  onSelect?: (tab: string) => void;
};

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

function MiniCalendar({ deadlines }: { deadlines: DeadlineItem[] }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Map day-of-month -> most urgent color
  const byDay = new Map<number, "red" | "amber" | "blue">();
  for (const d of deadlines) {
    const dt = new Date(d.dueDate);
    if (dt.getFullYear() !== year || dt.getMonth() !== month) continue;
    const day = dt.getDate();
    const c = urgencyColor(daysUntil(d.dueDate));
    const existing = byDay.get(day);
    const rank = (x: "red" | "amber" | "blue") => (x === "red" ? 3 : x === "amber" ? 2 : 1);
    if (!existing || rank(c) > rank(existing)) byDay.set(day, c);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="mt-2">
      <div className="grid grid-cols-7 gap-px text-[8px] text-muted-foreground">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px mt-0.5">
        {cells.map((d, i) => (
          <div key={i} className="aspect-square flex flex-col items-center justify-center text-[9px]">
            {d != null && (
              <>
                <span className={d === today ? "font-bold text-primary" : "text-foreground/70"}>{d}</span>
                {byDay.has(d) ? (
                  <span className={`w-1 h-1 rounded-full ${urgencyClass(byDay.get(d)!)}`} />
                ) : (
                  <span className="w-1 h-1" />
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatCards(p: Props) {
  const deadlines = p.deadlines ?? [];
  const upcomingCount = deadlines.filter((d) => daysUntil(d.dueDate) >= 0).length;

  const cards = [
    { label: "Active Opportunities", value: p.activeOpps.toLocaleString(), icon: Briefcase, tab: "opportunities", color: "text-primary" },
    {
      label: "Historical Awards",
      value: p.historicalTotal != null && p.historicalTotal > p.historicalCount
        ? `${p.historicalCount.toLocaleString()} of ${p.historicalTotal.toLocaleString()}`
        : p.historicalCount.toLocaleString(),
      icon: History, tab: "historical", color: "text-violet-600",
    },
    { label: "Total Obligated", value: fmtMoney(p.totalObligated), icon: DollarSign, tab: "historical", color: "text-money" },
    { label: "Works in Progress", value: (p.inProgressCount ?? 0).toLocaleString(), icon: FileEdit, tab: "in-progress", color: "text-amber-600" },
    { label: "Starred", value: (p.starredCount ?? 0).toLocaleString(), icon: Star, tab: "starred", color: "text-amber-500" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
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
      <Card
        onClick={() => p.onSelect?.("deadlines")}
        className="p-4 cursor-pointer hover:shadow-md transition-shadow col-span-2 lg:col-span-1"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Deadlines</div>
            <div className="text-2xl font-bold mt-1 text-rose-600">{upcomingCount.toLocaleString()}</div>
          </div>
          <CalIcon className="w-5 h-5 text-rose-600" />
        </div>
        <MiniCalendar deadlines={deadlines} />
      </Card>
    </div>
  );
}
