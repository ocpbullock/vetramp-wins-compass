import { Database, Zap, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type DataSource =
  | { kind: "cache"; fetchedAt: string; supersetCount?: number; requestedCount: number }
  | { kind: "fresh"; fetchedAt: string };

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.round(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function DataSourceBadge({ source }: { source: DataSource }) {
  if (source.kind === "fresh") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        title={`Fetched ${new Date(source.fetchedAt).toLocaleString()}`}
      >
        <Zap className="w-3 h-3" />
        Fresh · {relativeTime(source.fetchedAt)}
      </Badge>
    );
  }
  const label = source.supersetCount
    ? `Cached (${source.requestedCount} of ${source.supersetCount} NAICS)`
    : "Cached";
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      title={`Cached ${new Date(source.fetchedAt).toLocaleString()} — use Force refresh for live data`}
    >
      <Database className="w-3 h-3" />
      {label} · {relativeTime(source.fetchedAt)}
    </Badge>
  );
}
