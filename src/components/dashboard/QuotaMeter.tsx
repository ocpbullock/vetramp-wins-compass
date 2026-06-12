// Compact quota meter for the dashboard header. Shows Tango requests
// today and AI cost month-to-date. Both labels link to the existing
// usage panels at /admin#ai-usage. Always renders so users can find it
// — opportunity-team viewers see the parent org's quota, and loading /
// no-team states show a compact placeholder rather than disappearing.

import { Link } from "@tanstack/react-router";
import { Database, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTangoQuota, useAIBudget } from "@/lib/use-quota";
import { useTeam } from "@/lib/team";

function fmtUsd(n: number) {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function pillColor(percent: number, over?: boolean) {
  if (over || percent >= 100) return "text-destructive border-destructive/40 bg-destructive/10";
  if (percent >= 80) return "text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10";
  return "text-muted-foreground border-border bg-muted/40";
}

const placeholderPill =
  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground border-border bg-muted/40";

export function QuotaMeter() {
  const { currentTeam } = useTeam();
  // In an opportunity-team context, quota is owned by the parent org.
  // Resolve to the parent id so the meter reflects the org's real usage
  // instead of an empty opp-team-scoped query.
  const isOpp = currentTeam?.team_type === "opportunity";
  const effectiveTeamId = isOpp
    ? currentTeam?.parent_team_id ?? null
    : currentTeam?.id ?? null;
  const tango = useTangoQuota(effectiveTeamId);
  const ai = useAIBudget();

  // Never disappear: if we have no team yet (auth still booting) or no
  // resolvable parent id, render a compact, non-interactive placeholder
  // so users can always locate the meter.
  if (!effectiveTeamId) {
    return (
      <div className="hidden md:flex items-center gap-1.5" aria-label="Quota meter loading">
        <span className={placeholderPill}>
          <Database className="w-3 h-3" />
          <span className="tabular-nums">—/—</span>
        </span>
        <span className={placeholderPill}>
          <Sparkles className="w-3 h-3" />
          <span className="tabular-nums">—</span>
        </span>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="hidden md:flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/admin"
              hash="ai-usage"
              className={[
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent",
                tango.loading
                  ? "text-muted-foreground border-border bg-muted/40"
                  : pillColor(tango.percentToday, tango.isExhausted),
              ].join(" ")}
              aria-label="View Tango API usage"
            >
              <Database className="w-3 h-3" />
              <span className="tabular-nums">
                {tango.loading ? "…" : `${tango.todayLive}/${tango.dailyLimit}`}
              </span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[260px]">
            <div className="font-semibold mb-0.5">Tango requests today</div>
            {tango.loading ? (
              <div>Loading usage…</div>
            ) : (
              <>
                <div>{tango.todayLive} live · {tango.remainingToday} remaining of {tango.dailyLimit} daily.</div>
                <div className="text-muted-foreground mt-1">Month-to-date: {tango.monthLive} of {tango.monthlyLimit}.</div>
              </>
            )}
            {isOpp && (
              <div className="text-muted-foreground mt-1">Shared with the parent organization.</div>
            )}
            <div className="text-muted-foreground mt-1">Click to open the usage panel.</div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/admin"
              hash="ai-usage"
              className={[
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent",
                ai.loading
                  ? "text-muted-foreground border-border bg-muted/40"
                  : pillColor(ai.percent, ai.over),
              ].join(" ")}
              aria-label="View AI budget"
            >
              <Sparkles className="w-3 h-3" />
              <span className="tabular-nums">
                {ai.loading ? "…" : (
                  <>
                    {fmtUsd(ai.mtdCost)}
                    {ai.budget > 0 && <>/{fmtUsd(ai.budget)}</>}
                  </>
                )}
              </span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[260px]">
            <div className="font-semibold mb-0.5">AI budget this month</div>
            {ai.loading ? (
              <div>Loading usage…</div>
            ) : ai.budget > 0 ? (
              <div>{fmtUsd(ai.mtdCost)} of {fmtUsd(ai.budget)} spent ({ai.percent.toFixed(0)}%).</div>
            ) : (
              <div>{fmtUsd(ai.mtdCost)} spent month-to-date. No budget set.</div>
            )}
            <div className="text-muted-foreground mt-1">Click to open the usage panel.</div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
