import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, Users, Crown, Swords } from "lucide-react";
import { toast } from "sonner";
import { upsertCompany, type CompanyDraft } from "@/lib/companies";

type Awardee = {
  id: string;
  company_name: string;
  uei: string | null;
  small_business: boolean | null;
  socioeconomic: string[] | null;
  team_id: string | null;
};

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function AwardeePoolCard({
  vehicleId,
  vehicleName,
  teamId,
  existingCompanyKeys,
  proposal,
  onProposalRefresh,
  onAdded,
}: {
  vehicleId: string;
  vehicleName: string;
  teamId: string;
  existingCompanyKeys: Set<string>;
  proposal?: any;
  onProposalRefresh?: () => void;
  onAdded?: () => void;
}) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: awardees = [], isLoading } = useQuery({
    queryKey: ["vehicle-awardees", vehicleId, teamId],
    staleTime: 15 * 60 * 1000,
    queryFn: async (): Promise<Awardee[]> => {
      // RLS returns global (team_id IS NULL) + our team's rows.
      const { data, error } = await supabase
        .from("vehicle_awardees")
        .select("id, company_name, uei, small_business, socioeconomic, team_id")
        .eq("vehicle_id", vehicleId)
        .order("company_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Awardee[];
    },
  });

  // Cross-reference: pull tango contracts scoped to team to compute relevance signal.
  const { data: contracts = [] } = useQuery({
    queryKey: ["tango-contracts-slim", teamId],
    enabled: !!teamId && awardees.length > 0,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("tango_cached_contracts")
        .select("vendor_name, vendor_uei, obligated_amount")
        .eq("team_id", teamId)
        .limit(5000);
      return data ?? [];
    },
  });

  const snapshotTopVendors: { name: string; value: number }[] =
    proposal?.market_snapshot?.historical?.topVendors ?? [];

  const relevance = useMemo(() => {
    const byUei = new Map<string, { count: number; value: number }>();
    const byName = new Map<string, { count: number; value: number }>();
    for (const c of contracts as any[]) {
      const v = Number(c.obligated_amount ?? 0) || 0;
      const uei = (c.vendor_uei ?? "").toString().toUpperCase();
      const n = normName(c.vendor_name);
      if (uei) {
        const cur = byUei.get(uei) ?? { count: 0, value: 0 };
        cur.count++; cur.value += v; byUei.set(uei, cur);
      }
      if (n) {
        const cur = byName.get(n) ?? { count: 0, value: 0 };
        cur.count++; cur.value += v; byName.set(n, cur);
      }
    }
    const snapByName = new Map<string, number>();
    for (const s of snapshotTopVendors) snapByName.set(normName(s.name), s.value);
    return (a: Awardee) => {
      const ueiKey = (a.uei ?? "").toUpperCase();
      const nameKey = normName(a.company_name);
      const hit = (ueiKey && byUei.get(ueiKey)) || byName.get(nameKey);
      const snapVal = snapByName.get(nameKey);
      return {
        count: hit?.count ?? 0,
        value: (hit?.value ?? 0) + (snapVal ?? 0),
        inSnapshot: snapVal != null,
      };
    };
  }, [contracts, snapshotTopVendors]);

  const sorted = useMemo(() => {
    return [...awardees].sort((a, b) => {
      const ra = relevance(a); const rb = relevance(b);
      const sa = ra.value + ra.count * 1000 + (ra.inSnapshot ? 1 : 0);
      const sb = rb.value + rb.count * 1000 + (rb.inSnapshot ? 1 : 0);
      if (sa !== sb) return sb - sa;
      return a.company_name.localeCompare(b.company_name);
    });
  }, [awardees, relevance]);

  const isSub = proposal?.engagement_type === "sub";

  const addToRoster = async (a: Awardee) => {
    setBusyId(a.id);
    try {
      const draft: CompanyDraft = {
        team_id: teamId,
        name: a.company_name,
        uei: a.uei,
        certifications: a.socioeconomic ?? [],
        contract_vehicles: [vehicleName],
        source: "vehicle_awardees",
        is_existing_partner: false,
        relationship_status: "prospective",
        notes: `Added from ${vehicleName} awardee pool`,
      };
      await upsertCompany(draft);
      toast.success(`${a.company_name} added to roster`);
      qc.invalidateQueries({ queryKey: ["companies", teamId] });
      qc.invalidateQueries({ queryKey: ["partners", teamId] });
      onAdded?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add");
    } finally {
      setBusyId(null);
    }
  };

  const setAsPrimeCandidate = async (a: Awardee) => {
    if (!proposal?.id) return;
    setBusyId(a.id);
    try {
      // Try to find a linked roster company by UEI or name.
      let matchId: string | null = null;
      const { data: rows } = await supabase
        .from("companies")
        .select("id, name, uei")
        .eq("team_id", teamId);
      if (rows) {
        const uei = (a.uei ?? "").toUpperCase();
        const nm = normName(a.company_name);
        const found = (rows as any[]).find((r) =>
          (uei && (r.uei ?? "").toUpperCase() === uei) || normName(r.name) === nm,
        );
        matchId = found?.id ?? null;
      }
      const { error } = await supabase
        .from("proposals")
        .update({
          prime_contractor_name: a.company_name,
          prime_contractor_id: matchId,
        })
        .eq("id", proposal.id);
      if (error) throw new Error(error.message);
      toast.success(`Set ${a.company_name} as prime candidate`);
      onProposalRefresh?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to set prime");
    } finally {
      setBusyId(null);
    }
  };

  const markAsCompetitor = async (a: Awardee) => {
    if (!proposal?.id) return;
    setBusyId(a.id);
    try {
      const matrix = proposal.positioning_matrix ?? { rows: [] };
      const rows = Array.isArray(matrix.rows) ? [...matrix.rows] : [];
      const nm = normName(a.company_name);
      if (rows.some((r: any) => normName(r.name) === nm)) {
        toast.info(`${a.company_name} already on the matrix`);
        setBusyId(null);
        return;
      }
      rows.push({
        name: a.company_name,
        isUs: false,
        threat: "medium",
        pastPerformance: "unknown",
        priceRating: "unknown",
        technicalRating: "unknown",
        managementRating: "unknown",
        notes: `Added from ${vehicleName} awardee pool`,
      });
      const { error } = await supabase
        .from("proposals")
        .update({ positioning_matrix: { ...matrix, rows } as any })
        .eq("id", proposal.id);
      if (error) throw new Error(error.message);
      toast.success(`Added ${a.company_name} as competitor`);
      onProposalRefresh?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add competitor");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" /> {awardees.length} awardees on {vehicleName}
        </CardTitle>
        <CardDescription className="text-xs">
          {awardees.length > 0
            ? "Vehicle-restricted competition — this is the eligible prime universe."
            : "No awardees recorded yet. Add them from Settings → Contract Vehicles, or run AI research."}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {isLoading ? (
          <div className="text-xs text-muted-foreground py-2"><Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Loading…</div>
        ) : awardees.length === 0 ? null : (
          <div className="divide-y max-h-96 overflow-y-auto">
            {sorted.map((a) => {
              const key = (a.uei ?? a.company_name).toLowerCase();
              const already = existingCompanyKeys.has(key);
              const rel = relevance(a);
              return (
                <div key={a.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      {a.company_name}
                      {a.team_id === null && <Badge variant="outline" className="text-[9px]">global</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1 items-center">
                      {a.uei && <span className="font-mono">{a.uei}</span>}
                      {a.small_business && <Badge variant="outline" className="text-[10px]">SB</Badge>}
                      {(a.socioeconomic ?? []).map((s) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                      {(rel.count > 0 || rel.inSnapshot) && (
                        <Badge className="text-[10px] bg-accent text-accent-foreground" variant="outline">
                          {rel.count > 0
                            ? `${rel.count} relevant award${rel.count === 1 ? "" : "s"}${rel.value ? ` · $${Math.round(rel.value / 1_000_000)}M` : ""}`
                            : "in market snapshot"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <Button
                      size="sm"
                      variant={already ? "ghost" : "outline"}
                      disabled={already || busyId === a.id}
                      onClick={() => addToRoster(a)}
                      className="gap-1 h-7"
                    >
                      {busyId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                      {already ? "In roster" : "Add to roster"}
                    </Button>
                    {proposal?.id && (
                      <div className="flex gap-1">
                        {isSub && (
                          <Button
                            size="sm" variant="ghost" className="gap-1 h-6 text-[11px] px-2"
                            disabled={busyId === a.id}
                            onClick={() => setAsPrimeCandidate(a)}
                          >
                            <Crown className="w-3 h-3" /> Prime candidate
                          </Button>
                        )}
                        <Button
                          size="sm" variant="ghost" className="gap-1 h-6 text-[11px] px-2"
                          disabled={busyId === a.id}
                          onClick={() => markAsCompetitor(a)}
                        >
                          <Swords className="w-3 h-3" /> Competitor
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
