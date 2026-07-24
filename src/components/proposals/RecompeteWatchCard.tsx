import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Radar, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { enrichProposalFromSam } from "@/lib/sam-enrich";

type WatchEvent = {
  id: string;
  proposal_id: string;
  event_type: "new_notice" | "deadline_change" | "attachment_update";
  notice_id: string | null;
  notice_type: string | null;
  title: string | null;
  posted_date: string | null;
  detail: string | null;
  maturity_hint: string | null;
  reviewed: boolean;
  created_at: string;
};

const EVENT_LABEL: Record<WatchEvent["event_type"], string> = {
  new_notice: "New notice",
  deadline_change: "Deadline change",
  attachment_update: "Attachment update",
};

const EVENT_TONE: Record<WatchEvent["event_type"], string> = {
  new_notice: "bg-primary/15 text-primary border-primary/30",
  deadline_change: "bg-warning/15 text-warning border-warning/30",
  attachment_update:
    "border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_15%,transparent)] text-[color:var(--brand-brass)]",
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const fmtTime = (d: string | null) => {
  if (!d) return "never";
  const then = new Date(d).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export function RecompeteWatchCard({
  proposalId,
  watchEnabled,
  lastWatchedAt,
  onChanged,
}: {
  proposalId: string;
  watchEnabled: boolean;
  lastWatchedAt: string | null;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  const eventsQ = useQuery({
    queryKey: ["watch-events", proposalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunity_watch_events" as any)
        .select("*")
        .eq("proposal_id", proposalId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as WatchEvent[];
    },
  });

  const events = eventsQ.data ?? [];
  const unreviewed = events.filter((e) => !e.reviewed);
  const reviewed = events.filter((e) => e.reviewed);

  const toggle = async (v: boolean) => {
    const { error } = await supabase.from("proposals").update({ watch_enabled: v } as any).eq("id", proposalId);
    if (error) { toast.error(error.message); return; }
    toast.success(v ? "SAM watcher enabled" : "SAM watcher paused");
    onChanged?.();
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("recompete-watch", {
        body: { proposalId },
      });
      if (error) throw error;
      const n = (data as any)?.events ?? 0;
      if ((data as any)?.rateLimited) {
        toast.warning((data as any).log?.[0] ?? "Daily SAM limit hit");
      } else {
        toast.success(n === 0 ? "No new SAM activity" : `${n} new event${n === 1 ? "" : "s"} recorded`);
      }
      await qc.invalidateQueries({ queryKey: ["watch-events", proposalId] });
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
    } finally {
      setChecking(false);
    }
  };

  const markReviewed = async (id: string) => {
    const { error } = await supabase.from("opportunity_watch_events" as any).update({ reviewed: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["watch-events", proposalId] });
  };

  const enrichNow = async (eventId: string) => {
    setEnriching(eventId);
    try {
      const res = await enrichProposalFromSam(proposalId);
      const fields = res.updatedFields.length ? ` · updated ${res.updatedFields.join(", ")}` : "";
      const att = res.attachmentsSaved ? ` · ${res.attachmentsSaved} doc${res.attachmentsSaved === 1 ? "" : "s"}` : "";
      toast.success(`Enriched from SAM.gov${fields}${att}`);
      await markReviewed(eventId);
    } catch (e: any) {
      toast.error(e?.message ?? "Enrichment failed");
    } finally {
      setEnriching(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Radar className="w-4 h-4 text-[color:var(--brand-brass)]" />
              SAM.gov Activity
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              <span className="briefing-label mr-1">Last checked</span>
              {fmtTime(lastWatchedAt)}
              {unreviewed.length > 0 && (
                <>
                  {" · "}
                  <Badge className="ml-1 border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_18%,transparent)] text-[color:var(--brand-brass)]">
                    {unreviewed.length} new
                  </Badge>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={watchEnabled} onCheckedChange={toggle} />
              <span className="briefing-label">Watch</span>
            </label>
            <Button size="sm" variant="outline" onClick={checkNow} disabled={checking} className="gap-1.5">
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Check now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {eventsQ.isLoading ? (
          <div className="space-y-2">
            <div className="h-12 rounded-md bg-muted/70 animate-pulse" />
            <div className="h-12 rounded-md bg-muted/70 animate-pulse" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
            {watchEnabled
              ? "No SAM.gov activity detected yet. We'll surface new notices, deadline changes, and attachment updates here."
              : "Turn on Watch to monitor SAM.gov for activity on this recompete."}
          </div>
        ) : (
          <div className="space-y-2">
            {unreviewed.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                onMarkReviewed={() => markReviewed(e.id)}
                onEnrich={() => enrichNow(e.id)}
                enriching={enriching === e.id}
              />
            ))}
            {reviewed.length > 0 && (
              <div className="pt-1">
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowEarlier((v) => !v)}
                >
                  {showEarlier ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Earlier ({reviewed.length})
                </button>
                {showEarlier && (
                  <div className="mt-2 space-y-2 opacity-70">
                    {reviewed.map((e) => (
                      <EventRow key={e.id} event={e} readOnly />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({
  event,
  onMarkReviewed,
  onEnrich,
  enriching,
  readOnly,
}: {
  event: WatchEvent;
  onMarkReviewed?: () => void;
  onEnrich?: () => void;
  enriching?: boolean;
  readOnly?: boolean;
}) {
  const showEnrich = !readOnly && (event.event_type === "new_notice" || event.event_type === "attachment_update");
  return (
    <div className="rounded-md border border-border p-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={`${EVENT_TONE[event.event_type]} text-[10px] uppercase tracking-wide`}>
          {EVENT_LABEL[event.event_type]}
        </Badge>
        {event.notice_type && (
          <Badge variant="secondary" className="text-[10px] capitalize">{event.notice_type}</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          <span className="briefing-label mr-1">Posted</span>{fmt(event.posted_date)}
        </span>
      </div>
      {event.title && <div className="text-sm font-medium truncate">{event.title}</div>}
      {event.detail && <div className="text-xs text-muted-foreground">{event.detail}</div>}
      {event.maturity_hint && (
        <div className="text-xs font-medium text-[color:var(--brand-brass)]">{event.maturity_hint}</div>
      )}
      {!readOnly && (
        <div className="flex items-center gap-2 pt-1">
          {showEnrich && (
            <Button size="sm" variant="outline" onClick={onEnrich} disabled={enriching} className="gap-1.5 h-7 text-xs">
              {enriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Enrich from SAM
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onMarkReviewed} className="h-7 text-xs">
            Mark reviewed
          </Button>
        </div>
      )}
    </div>
  );
}
