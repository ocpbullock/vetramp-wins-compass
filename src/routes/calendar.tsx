import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, isSameDay, isSameMonth } from "date-fns";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/dashboard/Header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CalendarIcon } from "lucide-react";
import { useDeadlines, daysUntil, urgencyColor, urgencyClass, type DeadlineItem } from "@/lib/deadlines";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — VetRamp Pursuit" },
      { name: "description", content: "Upcoming proposal milestones and response deadlines at a glance." },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const { items, loading: itemsLoading } = useDeadlines();
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<Date | null>(null);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const startOffset = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();

  // Map yyyy-mm-dd -> deadlines on that day
  const byDay = useMemo(() => {
    const m = new Map<string, DeadlineItem[]>();
    for (const d of items) {
      const dt = new Date(d.dueDate);
      const key = format(dt, "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(d);
      m.set(key, arr);
    }
    return m;
  }, [items]);

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const selectedKey = selected ? format(selected, "yyyy-MM-dd") : null;
  const selectedItems = selectedKey ? (byDay.get(selectedKey) ?? []) : [];
  const upcoming = items.filter((d) => daysUntil(d.dueDate) >= 0).slice(0, 25);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-primary" />
              Calendar
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Proposal milestones and opportunity response deadlines.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCursor(subMonths(cursor, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-sm font-medium min-w-[140px] text-center">
              {format(cursor, "MMMM yyyy")}
            </div>
            <Button variant="outline" size="sm" onClick={() => setCursor(addMonths(cursor, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCursor(new Date()); setSelected(new Date()); }}>
              Today
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-4">
            <div className="grid grid-cols-7 gap-px text-[11px] text-muted-foreground mb-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="text-center py-1 font-medium">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
              {cells.map((d, i) => {
                if (!d) return <div key={i} className="bg-card aspect-square min-h-[80px]" />;
                const key = format(d, "yyyy-MM-dd");
                const dayItems = byDay.get(key) ?? [];
                const isToday = isSameDay(d, today);
                const isSelected = selected && isSameDay(d, selected);
                const dim = !isSameMonth(d, cursor);
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(d)}
                    className={[
                      "bg-card aspect-square min-h-[80px] p-1.5 text-left flex flex-col gap-1 transition-colors hover:bg-accent",
                      isSelected ? "ring-2 ring-primary ring-inset" : "",
                      dim ? "opacity-40" : "",
                    ].join(" ")}
                  >
                    <span className={[
                      "text-xs font-medium",
                      isToday ? "text-primary font-bold" : "text-foreground/80",
                    ].join(" ")}>
                      {d.getDate()}
                    </span>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      {dayItems.slice(0, 3).map((it) => {
                        const c = urgencyColor(daysUntil(it.dueDate));
                        return (
                          <div key={it.id} className="flex items-center gap-1 text-[10px] truncate">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgencyClass(c)}`} />
                            <span className="truncate text-foreground/70">{it.title}</span>
                          </div>
                        );
                      })}
                      {dayItems.length > 3 && (
                        <div className="text-[10px] text-muted-foreground">+{dayItems.length - 3} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-destructive" /> ≤ 7 days</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> ≤ 14 days</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" /> Later</span>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">
              {selected ? format(selected, "EEEE, MMM d") : "Upcoming deadlines"}
            </h2>
            {itemsLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
            {!itemsLoading && (selected ? selectedItems : upcoming).length === 0 && (
              <div className="text-xs text-muted-foreground">
                {selected ? "Nothing scheduled this day." : "No upcoming deadlines."}
              </div>
            )}
            <div className="space-y-2">
              {(selected ? selectedItems : upcoming).map((d) => {
                const days = daysUntil(d.dueDate);
                const dColor = days < 0 ? "text-destructive" : days <= 7 ? "text-destructive" : days <= 14 ? "text-amber-600" : "text-muted-foreground";
                const dLabel = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `in ${days}d`;
                const row = (
                  <div className="flex items-start justify-between gap-2 p-2 rounded-md hover:bg-accent transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{d.title}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{d.context}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                          {d.kind === "milestone" ? "Milestone" : "Response"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(d.dueDate), "MMM d")}
                        </span>
                      </div>
                    </div>
                    <span className={`text-[10px] font-medium shrink-0 ${dColor}`}>{dLabel}</span>
                  </div>
                );
                return d.proposalId ? (
                  <Link key={d.id} to="/proposals/$proposalId" params={{ proposalId: d.proposalId }} className="block">
                    {row}
                  </Link>
                ) : (
                  <div key={d.id}>{row}</div>
                );
              })}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
