import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Check, Circle, ArrowRight } from "lucide-react";
import { useSetupStatus } from "@/lib/setup-status";

export function SetupChecklist() {
  const { items, requiredDone, requiredTotal, percent, loading } = useSetupStatus();

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Setup progress</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Complete these to unlock better proposal results.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">
            {loading ? "—" : `${requiredDone} of ${requiredTotal}`}
          </div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">complete</div>
        </div>
      </div>

      <div className="mt-3">
        <Progress value={percent} className="h-2" />
      </div>

      <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              to="/settings"
              hash={item.href.split("#")[1]}
              className={[
                "group flex items-center gap-3 rounded-md border px-3 py-2 transition-colors",
                item.done
                  ? "border-primary/30 bg-primary/5"
                  : "border-border hover:bg-accent",
              ].join(" ")}
            >
              <span
                className={[
                  "shrink-0 w-5 h-5 rounded-full flex items-center justify-center",
                  item.done ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground",
                ].join(" ")}
              >
                {item.done ? <Check className="w-3 h-3" /> : <Circle className="w-2 h-2" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{item.label}</span>
                  {!item.required && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5">Bonus</Badge>
                  )}
                </div>
                {item.hint && (
                  <div className="text-[11px] text-muted-foreground truncate">{item.hint}</div>
                )}
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SetupBanner() {
  const { coreComplete, requiredDone, requiredTotal, loading } = useSetupStatus();
  if (loading || coreComplete) return null;

  return (
    <Link
      to="/settings"
      className="block rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
          {requiredDone}/{requiredTotal}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Complete your company setup to get better proposal results</div>
          <div className="text-xs text-muted-foreground">
            Add your company profile and past performance so AI drafts can cite real wins.
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-primary shrink-0" />
      </div>
    </Link>
  );
}
