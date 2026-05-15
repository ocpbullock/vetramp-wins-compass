import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useDeadlines, daysUntil } from "@/lib/deadlines";

export function DeadlinesTab() {
  const { items, loading } = useDeadlines();

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading deadlines…</Card>;
  }

  if (items.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">No upcoming deadlines.</Card>;
  }

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Days Remaining</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right pr-4">Link</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => {
            const days = daysUntil(d.dueDate);
            const dColor = days < 0 ? "text-destructive" : days <= 7 ? "text-destructive" : days <= 14 ? "text-amber-600" : "text-muted-foreground";
            const dLabel = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d`;
            return (
              <TableRow key={d.id}>
                <TableCell className="font-medium text-sm">
                  <div>{d.title}</div>
                  <div className="text-[11px] text-muted-foreground">{d.context}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {d.kind === "milestone" ? "Milestone" : "Response"}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs font-mono">{format(new Date(d.dueDate), "MMM d, yyyy")}</TableCell>
                <TableCell className={`text-xs ${dColor}`}>{dLabel}</TableCell>
                <TableCell className="text-xs capitalize">{d.status}</TableCell>
                <TableCell className="text-right pr-4">
                  {d.proposalId ? (
                    <Link
                      to="/proposals/$proposalId"
                      params={{ proposalId: d.proposalId }}
                      className="text-xs text-primary hover:underline"
                    >
                      Open
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
