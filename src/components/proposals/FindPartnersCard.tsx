import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, Search, Truck } from "lucide-react";
import { AwardeePoolCard } from "./AwardeePoolCard";
import { PartnerResearch } from "./PartnerResearch";

const STORAGE_KEY = "find-partners-view";

/**
 * Team-tab "Find partners" container. When the opportunity has a linked
 * contract vehicle, splits partner-finding into two explicit views:
 *   - On-vehicle vendors: awardee pool for the linked vehicle
 *   - Open market: NAICS/agency-based search + dark horses + firm lookup
 * When no vehicle is linked, only Open market is shown.
 * Last-used view is persisted per user in localStorage.
 */
export function FindPartnersCard({
  proposal,
  teamId,
  existingPartnerIds,
  onProposalRefresh,
}: {
  proposal: any;
  teamId: string | null;
  existingPartnerIds: string[];
  onProposalRefresh?: () => void;
}) {
  const vehicleId: string | null = proposal?.vehicle_registry_id ?? null;
  const vehicleName: string =
    (proposal?.opportunity_data as any)?.contract_vehicle ?? "the selected vehicle";

  const [view, setView] = useState<"vehicle" | "open">(() => {
    if (typeof window === "undefined") return vehicleId ? "vehicle" : "open";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if ((saved === "vehicle" || saved === "open") && vehicleId) return saved;
    return vehicleId ? "vehicle" : "open";
  });

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, view);
  }, [view]);

  useEffect(() => {
    if (!vehicleId && view !== "open") setView("open");
  }, [vehicleId, view]);

  const openMarket = (
    <PartnerResearch
      proposalId={proposal.id}
      teamId={teamId}
      opportunityNaics={proposal.naics_code ?? null}
      opportunityAgency={proposal.agency ?? null}
      opportunitySetAside={proposal.set_aside ?? null}
    />
  );

  if (!vehicleId) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          Link a contract vehicle on the Overview tab to see on-contract vendors alongside open-market search.
        </div>
        {openMarket}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs value={view} onValueChange={(v) => setView(v as "vehicle" | "open")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="vehicle" className="gap-1.5">
              <Truck className="w-3.5 h-3.5" /> On-vehicle vendors
            </TabsTrigger>
            <TabsTrigger value="open" className="gap-1.5">
              <Search className="w-3.5 h-3.5" /> Open market
            </TabsTrigger>
          </TabsList>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Users className="w-3 h-3" />
            {view === "vehicle"
              ? `Vendors currently on ${vehicleName} — the eligible pool for this competition.`
              : "NAICS/agency-based search — for subs, teaming, or non-vehicle-restricted work."}
          </div>
        </div>
        <TabsContent value="vehicle" className="mt-3">
          <AwardeePoolCard
            vehicleId={vehicleId}
            vehicleName={vehicleName}
            teamId={teamId ?? ""}
            existingCompanyKeys={new Set(existingPartnerIds)}
            proposal={proposal}
            onProposalRefresh={onProposalRefresh}
          />
        </TabsContent>
        <TabsContent value="open" className="mt-3">
          {openMarket}
        </TabsContent>
      </Tabs>
    </div>
  );
}
