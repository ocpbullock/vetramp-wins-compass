import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, ArrowRight } from "lucide-react";

type Outcome = "won" | "lost" | "no_bid";

type Row = {
  id: string;
  opportunity_title: string | null;
  agency: string | null;
  naics_code: string | null;
  outcome: Outcome;
  outcome_reasons: string | null;
  lessons_learned: string | null;
  outcome_recorded_at: string | null;
};

const OUTCOME_BADGE: Record<Outcome, { label: string; className: string }> = {
  won: { label: "Won", className: "bg-emerald-600 text-white hover:bg-emerald-600" },
  lost: { label: "Lost", className: "bg-destructive text-destructive-foreground hover:bg-destructive" },
  no_bid: { label: "No-bid", className: "bg-muted text-foreground hover:bg-muted" },
};

export function SimilarPastPursuitsCard({
  proposalId,
  teamId,
  naicsCode,
  agency,
  limit = 5,
}: {
  proposalId: string;
  teamId: string | null;
  naicsCode: string | null | undefined;
  agency: string | null | undefined;
  limit?: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["similar-past-pursuits", teamId, naicsCode, agency, proposalId, limit],
    enabled: !!(naicsCode || agency),
    queryFn: async () => {
      let q = supabase
        .from("proposals")
        .select("id,opportunity_title,agency,naics_code,outcome,outcome_reasons,lessons_learned,outcome_recorded_at")
        .neq("id", proposalId)
        .not("outcome", "is", null)
        .order("outcome_recorded_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (teamId) q = q.eq("team_id", teamId);
      const filters: string[] = [];
      if (naicsCode) filters.push(`naics_code.eq.${naicsCode}`);
      if (agency) filters.push(`agency.eq.${agency.replace(/,/g, "")}`);
      if (filters.length) q = q.or(filters.join(","));
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-4 h-4" /> Similar past pursuits
        </CardTitle>
        <CardDescription className="text-xs">
          Closed opportunities on your team sharing NAICS or agency — institutional memory.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {!naicsCode && !agency
              ? "Set a NAICS or agency to surface similar past pursuits."
              : "No matching closed pursuits yet."}
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const ob = OUTCOME_BADGE[r.outcome];
              return (
                <li key={r.id} className="border rounded-md p-2">
                  <div className="flex items-start gap-2">
                    <Badge className={`shrink-0 ${ob.className}`}>{ob.label}</Badge>
                    <div className="flex-1 min-w-0">
                      <Link
                        to="/proposals/$proposalId"
                        params={{ proposalId: r.id }}
                        className="text-sm font-medium hover:underline inline-flex items-center gap-1"
                      >
                        <span className="truncate">{r.opportunity_title || "Untitled opportunity"}</span>
                        <ArrowRight className="w-3 h-3 shrink-0" />
                      </Link>
                      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                        {r.agency && <span>{r.agency}</span>}
                        {r.naics_code && <span>NAICS {r.naics_code}</span>}
                        {r.outcome_recorded_at && (
                          <span>{new Date(r.outcome_recorded_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {r.outcome_reasons && (
                    <div className="mt-2 text-xs">
                      <span className="font-medium text-muted-foreground">Reasons: </span>
                      <span className="whitespace-pre-wrap">{r.outcome_reasons}</span>
                    </div>
                  )}
                  {r.lessons_learned && (
                    <div className="mt-1 text-xs">
                      <span className="font-medium text-muted-foreground">Lessons: </span>
                      <span className="whitespace-pre-wrap">{r.lessons_learned}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
