import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getFedSpendRecompetes } from "@/lib/fedspend.functions";
import { CollapsibleSection } from "@/components/CollapsibleSection";

type Props = {
  teamId: string | null | undefined;
  onTracked: (proposalId: string) => void;
};

function money(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function urgencyTone(days: number | null): string {
  if (days === null) return "";
  if (days <= 90) return "border-destructive/40 bg-destructive/10 text-destructive";
  if (days <= 180) return "border-warning/40 bg-warning/15 text-warning";
  return "";
}

export function ExpiringMarketsCard({ teamId, onTracked }: Props) {
  const { user } = useAuth();
  const [force, setForce] = useState(0);
  const [tracking, setTracking] = useState<string | null>(null);
  const runRecompetes = useServerFn(getFedSpendRecompetes);

  // Markets = the NAICS codes this team already works in.
  const marketsQ = useQuery({
    queryKey: ["fedspend", "markets", teamId ?? "none", user?.id ?? "none"],
    enabled: !!user,
    queryFn: async () => {
      const [prefs, props] = await Promise.all([
        supabase.from("user_preferences").select("default_naics").maybeSingle(),
        supabase.from("proposals").select("naics_code").not("naics_code", "is", null).limit(200),
      ]);
      const codes = new Set<string>();
      for (const c of (prefs.data?.default_naics ?? []) as string[]) if (c) codes.add(c);
      for (const r of (props.data ?? []) as Array<{ naics_code: string | null }>) {
        if (r.naics_code) codes.add(r.naics_code);
      }
      return [...codes].slice(0, 6);
    },
  });

  const naicsCodes = useMemo(() => marketsQ.data ?? [], [marketsQ.data]);

  const recompetesQ = useQuery({
    queryKey: ["fedspend", "recompetes", teamId ?? "none", naicsCodes.join(","), force],
    enabled: !!teamId && naicsCodes.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: () =>
      runRecompetes({
        data: { teamId: teamId as string, naicsCodes, maxDays: 365, force: force > 0 },
      }),
  });

  const rows = recompetesQ.data?.rows ?? [];

  const trackRow = async (row: (typeof rows)[number]) => {
    if (!user || !teamId) return;
    setTracking(row.piid);
    const { data, error } = await supabase
      .from("proposals")
      .insert({
        user_id: user.id,
        team_id: teamId,
        solicitation_number: row.piid,
        opportunity_title: row.title ?? `Recompete — ${row.incumbentName ?? row.piid}`,
        agency: row.agency,
        naics_code: row.naicsCode,
        estimated_value: row.value,
        known_incumbent: row.incumbentName,
        incumbent_notes: row.incumbentUei ? `Incumbent UEI ${row.incumbentUei} (Fed-Spend)` : null,
        opportunity_source: "fedspend_recompete",
        opportunity_source_id: row.piid,
        capture_stage: "intake",
        status: "intake",
        opportunity_data: {
          contract_end_date: row.endDate,
          psc_code: row.pscCode,
          place_of_performance: row.placeOfPerformance,
          source: "fed-spend recompete",
        },
      } as never)
      .select("id")
      .single();
    setTracking(null);
    if (error || !data) {
      toast.error(error?.message ?? "Could not track this contract");
      return;
    }
    toast.success("Tracked as an opportunity");
    onTracked((data as { id: string }).id);
  };

  if (!teamId) return null;

  return (
    <CollapsibleSection
      id="expiring-markets"
      title="Expiring in my markets"
      summary={
        naicsCodes.length === 0
          ? "No NAICS markets set"
          : recompetesQ.isFetching
            ? "Loading expiring contracts…"
            : `${rows.length} contract${rows.length === 1 ? "" : "s"} ending within 12 months`
      }
      defaultOpen={false}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Federal contracts in your NAICS codes reaching end of period — likely recompetes.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={recompetesQ.isFetching || naicsCodes.length === 0}
          onClick={() => setForce((f) => f + 1)}
        >
          {recompetesQ.isFetching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Refresh
        </Button>
      </div>
      {naicsCodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Set default NAICS codes in Settings, or add an opportunity with a NAICS code, to see expiring
          contracts in your markets.
        </p>
      ) : recompetesQ.isPending ? (
        <div className="space-y-2">
          <div className="h-14 rounded-md bg-muted animate-pulse" />
          <div className="h-14 rounded-md bg-muted animate-pulse" />
        </div>
      ) : recompetesQ.data?.error ? (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> {recompetesQ.data.error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No contracts expiring within 12 months for NAICS {naicsCodes.join(", ")}.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            NAICS {naicsCodes.join(", ")} ·{" "}
            {recompetesQ.data?.cached ? "cached" : "fresh"} as of{" "}
            {new Date(recompetesQ.data?.fetchedAt ?? Date.now()).toLocaleString()}
            {rows.length > 25 ? ` · showing the 25 nearest expirations of ${rows.length}` : ""}
          </div>
          {rows.slice(0, 25).map((row) => (
            <Card key={row.piid} className="p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {row.title ?? row.incumbentName ?? row.piid}
                  </span>
                  {row.daysUntilExpiration !== null && (
                    <Badge variant="outline" className={`text-[10px] ${urgencyTone(row.daysUntilExpiration)}`}>
                      {row.daysUntilExpiration}d left
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  <span className="briefing-label mr-1">Incumbent</span>
                  {row.incumbentName ?? "—"}
                  {" · "}
                  <span className="briefing-label mr-1">Agency</span>
                  {row.agency ?? "—"}
                  {row.naicsCode ? (
                    <>
                      {" · "}
                      <span className="briefing-label mr-1">NAICS</span>
                      <span className="font-mono">{row.naicsCode}</span>
                    </>
                  ) : null}
                  {" · "}
                  <span className="briefing-label mr-1">Value</span>
                  {money(row.value)}
                  {row.endDate ? ` · ends ${new Date(row.endDate).toLocaleDateString()}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={tracking === row.piid}
                onClick={() => trackRow(row)}
              >
                {tracking === row.piid ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Track as opportunity
              </Button>
            </Card>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
