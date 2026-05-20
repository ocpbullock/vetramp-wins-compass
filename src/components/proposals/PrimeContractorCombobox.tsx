import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Partner = { id: string; company_name: string; uei?: string | null; cage_code?: string | null };

interface Props {
  teamId: string | null | undefined;
  valueId?: string | null;
  valueName?: string | null;
  onChange: (next: { prime_contractor_id: string | null; prime_contractor_name: string | null }) => void;
}

export function PrimeContractorCombobox({ teamId, valueId, valueName, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!teamId) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("teaming_partners")
        .select("id, company_name, uei, cage_code")
        .eq("team_id", teamId)
        .order("company_name", { ascending: true })
        .limit(200);
      if (!cancel) setPartners((data as Partner[]) ?? []);
    })();
    return () => { cancel = true; };
  }, [teamId]);

  const label = useMemo(() => valueName || "Select prime contractor…", [valueName]);
  const trimmed = query.trim();
  const hasExact = trimmed.length > 0 && partners.some(
    (p) => p.company_name.toLowerCase() === trimmed.toLowerCase()
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn("truncate", !valueName && "text-muted-foreground")}>{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
        <Command>
          <CommandInput placeholder="Search teaming partners…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No partner matches.</CommandEmpty>
            {partners.length > 0 && (
              <CommandGroup heading="Teaming partners">
                {partners.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.company_name}
                    onSelect={() => {
                      onChange({ prime_contractor_id: p.id, prime_contractor_name: p.company_name });
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-3.5 w-3.5", valueId === p.id ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{p.company_name}</span>
                    {(p.uei || p.cage_code) && (
                      <span className="ml-auto text-[10px] text-muted-foreground">{p.uei || p.cage_code}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {trimmed && !hasExact && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Other">
                  <CommandItem
                    value={`__use__${trimmed}`}
                    onSelect={() => {
                      onChange({ prime_contractor_id: null, prime_contractor_name: trimmed });
                      setOpen(false);
                    }}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Use "<span className="font-medium">{trimmed}</span>" as free-text prime
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
