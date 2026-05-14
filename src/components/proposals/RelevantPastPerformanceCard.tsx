import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Award } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { cparsBadgeClass } from "@/components/settings/PastPerformancePanel";

export type PastPerformance = Tables<"past_performance">;

function fmtMoney(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function relevanceScore(pp: PastPerformance, naics?: string | null, agency?: string | null, keywords: string[] = []) {
  let s = 0;
  if (naics && pp.naics_code === naics) s += 50;
  else if (naics && pp.naics_code?.slice(0, 4) === naics.slice(0, 4)) s += 25;
  if (agency && pp.agency && pp.agency.toLowerCase().includes(agency.toLowerCase())) s += 30;
  const lcKeywords = keywords.map((k) => k.toLowerCase());
  for (const k of pp.relevance_keywords ?? []) {
    if (lcKeywords.some((kw) => kw.includes(k.toLowerCase()) || k.toLowerCase().includes(kw))) s += 10;
  }
  return s;
}

export function RelevantPastPerformanceCard({
  teamId, naics, agency, opportunityTitle, selectedIds, onChange,
}: {
  teamId: string | null;
  naics?: string | null;
  agency?: string | null;
  opportunityTitle?: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["past-performance", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("past_performance")
        .select("*")
        .eq("team_id", teamId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as PastPerformance[];
    },
  });

  const titleKeywords = useMemo(
    () => (opportunityTitle ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
    [opportunityTitle],
  );

  const ranked = useMemo(() => {
    const list = (data ?? []).map((pp) => ({ pp, score: relevanceScore(pp, naics, agency, titleKeywords) }));
    list.sort((a, b) => b.score - a.score);
    return list;
  }, [data, naics, agency, titleKeywords]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4" /> Relevant past performance</CardTitle>
        <CardDescription className="text-xs">
          Auto-matched from your library by NAICS, agency, and keywords. Selected entries are passed to the AI when drafting the Past Performance section.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && ranked.length === 0 && (
          <div className="text-xs text-muted-foreground">No past performance entries in your library yet. Add some in Settings → Past Performance.</div>
        )}
        {ranked.map(({ pp, score }) => {
          const checked = selectedIds.includes(pp.id);
          return (
            <label key={pp.id} className={`flex items-start gap-2 p-2 rounded border cursor-pointer hover:bg-muted/50 ${checked ? "border-primary bg-muted/30" : "border-border"}`}>
              <Checkbox checked={checked} onCheckedChange={() => toggle(pp.id)} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm truncate">{pp.contract_title}</div>
                  <div className="flex items-center gap-1 shrink-0">
                    {pp.cpars_rating && <Badge variant="outline" className={`text-[10px] ${cparsBadgeClass(pp.cpars_rating)}`}>{pp.cpars_rating}</Badge>}
                    {score > 0 && <Badge variant="secondary" className="text-[10px]">match {score}</Badge>}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {pp.agency} · NAICS {pp.naics_code || "—"} · {fmtMoney(pp.total_value)} · {pp.prime_or_sub || "—"}
                </div>
                {pp.relevance_keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {pp.relevance_keywords.slice(0, 6).map((k) => (
                      <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </CardContent>
    </Card>
  );
}
