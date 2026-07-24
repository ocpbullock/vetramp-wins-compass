import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Search } from "lucide-react";

export type VehicleRegistryRow = {
  id: string;
  team_id: string | null;
  vehicle_name: string;
  vehicle_type: string | null;
  managing_agency: string | null;
  url: string | null;
  status: string | null;
};

export const VEHICLE_STATUS_OPTIONS: { value: string; label: string; hint?: string }[] = [
  { value: "unknown", label: "Unknown" },
  { value: "tbd_market_research", label: "TBD — government doing market research" },
  { value: "identified", label: "Identified vehicle" },
  { value: "new_vehicle_expected", label: "New vehicle expected" },
];

export function useVehicleRegistry(teamId: string | null) {
  return useQuery({
    queryKey: ["vehicle-registry", teamId],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<VehicleRegistryRow[]> => {
      let q = supabase
        .from("vehicle_registry")
        .select("id, team_id, vehicle_name, vehicle_type, managing_agency, url, status")
        .order("vehicle_name");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as VehicleRegistryRow[];
    },
  });
}

export function VehiclePicker({
  teamId,
  status,
  vehicleId,
  onChange,
  compact = false,
}: {
  teamId: string | null;
  status: string;
  vehicleId: string | null;
  onChange: (patch: { vehicle_status: string; vehicle_registry_id: string | null; contract_vehicle: string | null }) => void;
  compact?: boolean;
}) {
  const { data: vehicles = [] } = useVehicleRegistry(teamId);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = useMemo(() => vehicles.find((v) => v.id === vehicleId) ?? null, [vehicles, vehicleId]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return vehicles.slice(0, 40);
    return vehicles.filter((v) =>
      [v.vehicle_name, v.managing_agency, v.vehicle_type].filter(Boolean).some((x) => x!.toLowerCase().includes(s)),
    ).slice(0, 40);
  }, [vehicles, q]);

  const setStatus = (next: string) => {
    if (next !== "identified") {
      onChange({ vehicle_status: next, vehicle_registry_id: null, contract_vehicle: null });
    } else {
      onChange({ vehicle_status: next, vehicle_registry_id: vehicleId, contract_vehicle: selected?.vehicle_name ?? null });
    }
  };

  const pickVehicle = (v: VehicleRegistryRow) => {
    onChange({ vehicle_status: "identified", vehicle_registry_id: v.id, contract_vehicle: v.vehicle_name });
    setOpen(false);
  };

  return (
    <div className={compact ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 md:grid-cols-2 gap-3"}>
      <div>
        <Label className="text-xs">Contract vehicle status</Label>
        <Select value={status || "unknown"} onValueChange={setStatus}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VEHICLE_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {status === "identified" && (
        <div>
          <Label className="text-xs">Vehicle</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between mt-1 font-normal">
                <span className="truncate text-left">
                  {selected ? (
                    <>
                      <span>{selected.vehicle_name}</span>
                      {selected.managing_agency && <span className="text-muted-foreground text-xs ml-2">· {selected.managing_agency}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground text-xs">Pick a vehicle…</span>
                  )}
                </span>
                <ChevronDown className="w-4 h-4 ml-2 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-2" align="start">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vehicles…" className="h-8 text-sm" />
              </div>
              <div className="max-h-72 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-4 text-center">No matches.</div>
                ) : filtered.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => pickVehicle(v)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{v.vehicle_name}</span>
                      {v.team_id === null && <Badge variant="outline" className="text-[10px]">global</Badge>}
                      {v.vehicle_type && <Badge variant="secondary" className="text-[10px]">{v.vehicle_type}</Badge>}
                    </div>
                    {v.managing_agency && <div className="text-[11px] text-muted-foreground">{v.managing_agency}</div>}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
