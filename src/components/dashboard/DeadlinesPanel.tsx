import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon } from "lucide-react";
import { useDeadlines, daysUntil, urgencyColor, urgencyClass } from "@/lib/deadlines";
import { format } from "date-fns";

export function DeadlinesPanel() {
  const { items, loading } = useDeadlines();
  const upcoming = items.filter((d) => daysUntil(d.dueDate) >= -7).slice(0, 10);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-primary" />
          Upcoming deadlines
        </h2>
        {upcoming.length > 0 && (
          <span className="text-xs text-muted-foreground">{upcoming.length} in next 7 days</span>
        )}
      </div>
      {loading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {!loading && upcoming.length === 0 && (
        <div className="text-xs text-muted-foreground">No upcoming deadlines.</div>
      )}
      <div className="space-y-2">
        {upcoming.map((d) => {
          const days = daysUntil(d.dueDate);
          const dColor = days < 0 ? "text-destructive" : days <= 7 ? "text-destructive" : days <= 14 ? "text-amber-600" : "text-muted-foreground";
          const dLabel = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `in ${days}d`;
          const c = urgencyColor(days);
          const row = (
            <div className="flex items-start justify-between gap-2 p-2 rounded-md hover:bg-accent transition-colors">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgencyClass(c)}`} />
                  {d.title}
                </div>
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
          return d.proposalId || d.href ? (
            <Link
              key={d.id}
              to={d.href ?? "/proposals/$proposalId"}
              params={d.proposalId ? { proposalId: d.proposalId } : undefined}
              className="block"
            >
              {row}
            </Link>
          ) : (
            <div key={d.id}>{row}</div>
          );
        })}
      </div>
    </Card>
  );
}
