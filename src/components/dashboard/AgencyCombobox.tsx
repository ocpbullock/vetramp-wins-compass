import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { agencyMatchesLoose, normalizeAgency } from "@/lib/agency-match";

// Canonical sub-tier / department names Tango's `awarding_agency` filter
// matches reliably. Parent-only strings (e.g. "DEPT OF DEFENSE / ...") match
// the parent only and return the wrong scope — do NOT list them here.
const STATIC_AGENCIES = [
  // DoD sub-tiers
  "DEFENSE HEALTH AGENCY (DHA)",
  "DEPT OF THE ARMY",
  "DEPT OF THE NAVY",
  "DEPT OF THE AIR FORCE",
  "DEFENSE INFORMATION SYSTEMS AGENCY (DISA)",
  "DEFENSE LOGISTICS AGENCY (DLA)",
  "DEFENSE THREAT REDUCTION AGENCY (DTRA)",
  "U.S. SPECIAL OPERATIONS COMMAND (USSOCOM)",
  "U.S. CYBER COMMAND (USCYBERCOM)",
  "MISSILE DEFENSE AGENCY (MDA)",
  "DEFENSE ADVANCED RESEARCH PROJECTS AGENCY (DARPA)",
  // Civilian departments / sub-tiers
  "DEPT OF VETERANS AFFAIRS (VA)",
  "CYBERSECURITY AND INFRASTRUCTURE SECURITY AGENCY (CISA)",
  "U.S. CITIZENSHIP AND IMMIGRATION SERVICES (USCIS)",
  "TRANSPORTATION SECURITY ADMINISTRATION (TSA)",
  "U.S. COAST GUARD (USCG)",
  "FEDERAL EMERGENCY MANAGEMENT AGENCY (FEMA)",
  "GENERAL SERVICES ADMINISTRATION (GSA)",
  "NATIONAL INSTITUTES OF HEALTH (NIH)",
  "CENTERS FOR DISEASE CONTROL AND PREVENTION (CDC)",
  "DEPT OF HEALTH AND HUMAN SERVICES (HHS)",
  "SOCIAL SECURITY ADMINISTRATION (SSA)",
  "DEPT OF JUSTICE (DOJ)",
  "FEDERAL BUREAU OF INVESTIGATION (FBI)",
  "DEPT OF STATE (DOS)",
  "DEPT OF THE TREASURY (TREAS)",
  "INTERNAL REVENUE SERVICE (IRS)",
  "DEPT OF ENERGY (DOE)",
  "DEPT OF TRANSPORTATION (DOT)",
  "FEDERAL AVIATION ADMINISTRATION (FAA)",
  "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION (NASA)",
];

export function AgencyCombobox({
  value, onChange, teamId = null, agencies: agenciesProp, width, placeholder = "Search or paste awarding agency…",
}: {
  value: string;
  onChange: (v: string) => void;
  teamId?: string | null;
  agencies?: string[];
  width?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const { data: cachedAgencies = [] } = useQuery({
    queryKey: ["cached-agencies", teamId],
    enabled: !!teamId && !agenciesProp,
    queryFn: async () => {
      const { data } = await supabase
        .from("tango_cached_contracts")
        .select("agency")
        .eq("team_id", teamId!)
        .not("agency", "is", null)
        .limit(2000);
      const set = new Set<string>();
      for (const r of data ?? []) {
        const a = (r as any).agency as string | null;
        if (a) set.add(a);
      }
      return Array.from(set).sort();
    },
    staleTime: 5 * 60 * 1000,
  });

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const source = agenciesProp && agenciesProp.length > 0
      ? [...agenciesProp, ...STATIC_AGENCIES]
      : [...cachedAgencies, ...STATIC_AGENCIES];
    for (const a of source) {
      const key = a.toUpperCase();
      if (!seen.has(key)) { seen.add(key); out.push(a); }
    }
    return out;
  }, [cachedAgencies, agenciesProp]);

  const filtered = useMemo(() => {
    const query = q.trim();
    if (!query) return suggestions.slice(0, 40);
    const qn = normalizeAgency(query);
    return suggestions.filter((s) => {
      if (s.toLowerCase().includes(query.toLowerCase())) return true;
      const sn = normalizeAgency(s);
      return sn.includes(qn) || qn.includes(sn) || agencyMatchesLoose(s, query);
    }).slice(0, 40);
  }, [q, suggestions]);

  // Auto-select closest match when value is present but doesn't match a
  // suggestion verbatim (e.g. proposal.agency is "Defense Health Agency").
  useEffect(() => {
    if (!value) return;
    if (suggestions.some((s) => s.toUpperCase() === value.toUpperCase())) return;
    const hit = suggestions.find((s) => agencyMatchesLoose(s, value));
    if (hit) onChange(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions.length]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-8 text-xs justify-between font-normal", width ?? "w-full")}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type agency name or acronym…"
            value={q}
            onValueChange={setQ}
          />
          <CommandList>
            <CommandEmpty>
              <div className="p-2 text-xs space-y-2">
                <div className="text-muted-foreground">No suggestion matches.</div>
                {q.trim() && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-[11px] w-full"
                    onClick={() => { onChange(q.trim()); setOpen(false); }}
                  >
                    Use "{q.trim()}" as free text
                  </Button>
                )}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((s) => (
                <CommandItem
                  key={s}
                  value={s}
                  onSelect={() => { onChange(s); setOpen(false); }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3 w-3",
                      value.toUpperCase() === s.toUpperCase() ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {s}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
