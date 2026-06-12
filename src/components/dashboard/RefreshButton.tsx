// Per-item refresh button + "last refreshed" relative timestamp. Designed
// to sit next to DataSourceBadge / DataProvenance on cached SAM.gov,
// USAspending, and Tango views. Presentation-only: caller wires the
// actual refetch in `onRefresh`.

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTangoQuota } from "@/lib/use-quota";
import { relativeTimeStr } from "./DataSourceBadge";

export type RefreshKind = "sam" | "usaspending" | "tango" | "ai";

export function LastRefreshed({
  fetchedAt,
  className,
}: {
  fetchedAt?: string | null;
  className?: string;
}) {
  if (!fetchedAt) return null;
  return (
    <span
      className={["text-[11px] text-muted-foreground", className].filter(Boolean).join(" ")}
      title={`Last refreshed ${new Date(fetchedAt).toLocaleString()}`}
    >
      Updated {relativeTimeStr(fetchedAt)}
    </span>
  );
}

export function RefreshButton({
  onRefresh,
  busy,
  kind,
  label = "Refresh",
}: {
  onRefresh: () => void | Promise<void>;
  busy?: boolean;
  kind: RefreshKind;
  label?: string;
}) {
  const quota = useTangoQuota();
  // Only Tango refreshes are quota-gated. SAM/USAspending/AI refreshes
  // run regardless. The button is disabled while the parent's fetch is
  // in flight, or when the Tango daily quota is exhausted.
  const quotaDisabled = kind === "tango" && quota.isExhausted;
  const lowQuota = kind === "tango" && quota.isLow && !quota.isExhausted;
  const disabled = !!busy || quotaDisabled;

  const tooltip = quotaDisabled
    ? `Tango daily quota reached (${quota.todayLive}/${quota.dailyLimit}). Try again tomorrow or wait for cache.`
    : lowQuota
      ? `Tango quota low — ${quota.remainingToday} live request${quota.remainingToday === 1 ? "" : "s"} left today.`
      : busy
        ? "Refreshing…"
        : label;

  const button = (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => { if (!disabled) void onRefresh(); }}
      disabled={disabled}
      aria-label={label}
    >
      <RefreshCw className={["w-3.5 h-3.5", busy ? "animate-spin" : ""].join(" ")} />
    </Button>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrapper so the tooltip still fires when the button is disabled. */}
          <span className={lowQuota ? "ring-1 ring-amber-500/40 rounded-md" : ""}>{button}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[240px]">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Convenience grouping of LastRefreshed + RefreshButton — drop next to a
 * DataSourceBadge / DataProvenance to give every cached view a uniform
 * "Updated X · refresh" affordance.
 */
export function CachedItemControls({
  fetchedAt,
  onRefresh,
  busy,
  kind,
}: {
  fetchedAt?: string | null;
  onRefresh?: () => void | Promise<void>;
  busy?: boolean;
  kind: RefreshKind;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <LastRefreshed fetchedAt={fetchedAt} />
      {onRefresh && <RefreshButton onRefresh={onRefresh} busy={busy} kind={kind} />}
    </span>
  );
}
