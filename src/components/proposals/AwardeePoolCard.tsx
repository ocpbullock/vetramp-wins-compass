import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { upsertCompany, type CompanyDraft } from "@/lib/companies";

type Awardee = {
  id: string;
  company_name: string;
  uei: string | null;
  small_business: boolean | null;
  socioeconomic: string[] | null;
};

export function AwardeePoolCard({
  vehicleId,
  vehicleName,
  teamId,
  existingCompanyKeys,
  onAdded,
}: {
  vehicleId: string;
  vehicleName: string;
  teamId: string;
  existingCompanyKeys: Set<string>;
  onAdded?: () => void;
}) {
  const qc = useQueryClient();
  const [addingId, setAddingId] = useState<string | null>(null);

  const { data: awardees = [], isLoading } = useQuery({
    queryKey: ["vehicle-awardees", vehicleId],
    staleTime: 15 * 60 * 1000,
    queryFn: async (): Promise<Awardee[]> => {
      const { data, error } = await supabase
        .from("vehicle_awardees")
        .select("id, company_name, uei, small_business, socioeconomic")
        .eq("vehicle_id", vehicleId)
        .order("company_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Awardee[];
    },
  });

  const addToRoster = async (a: Awardee) => {
    setAddingId(a.id);
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
      setAddingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Awardee pool</CardTitle>
        <CardDescription className="text-xs">
          Awardees on <span className="font-medium">{vehicleName}</span> — on a vehicle-restricted competition, they are the teaming and competitor pool.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {isLoading ? (
          <div className="text-xs text-muted-foreground py-2"><Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Loading…</div>
        ) : awardees.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No awardees recorded yet. Add them from Settings → Contract Vehicles.</div>
        ) : (
          <div className="divide-y">
            {awardees.map((a) => {
              const key = (a.uei ?? a.company_name).toLowerCase();
              const already = existingCompanyKeys.has(key);
              return (
                <div key={a.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{a.company_name}</div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1 items-center">
                      {a.uei && <span className="font-mono">{a.uei}</span>}
                      {a.small_business && <Badge variant="outline" className="text-[10px]">Small business</Badge>}
                      {(a.socioeconomic ?? []).map((s) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={already ? "ghost" : "outline"}
                    disabled={already || addingId === a.id}
                    onClick={() => addToRoster(a)}
                    className="gap-1"
                  >
                    {addingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                    {already ? "In roster" : "Add to roster"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
