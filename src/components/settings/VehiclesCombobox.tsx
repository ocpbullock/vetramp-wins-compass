import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Row = { vehicle_name: string; status: string | null; team_id: string | null };

/**
 * Searchable multi-select combobox backed by public.vehicle_registry
 * (global + team rows). Expired entries are hidden by default but remain
 * visible when they are still selected. Free-text entries are allowed so
 * unlisted vehicles can be added; values are persisted as vehicle_name
 * strings into companies.contract_vehicles.
 */
export function VehiclesCombobox({
  value,
  onChange,
  placeholder,
  className,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const { data: options = [] } = useQuery<Row[]>({
    queryKey: ["vehicle-registry-picker"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_registry")
        .select("vehicle_name, status, team_id")
        .order("vehicle_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const selectedSet = React.useMemo(() => new Set(value), [value]);
  const q = query.trim().toLowerCase();

  const filtered = React.useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; status: string | null; scope: "global" | "team" }[] = [];
    for (const o of options) {
      const name = o.vehicle_name;
      if (seen.has(name)) continue;
      seen.add(name);
      const isExpired = (o.status ?? "").toLowerCase() === "expired";
      if (isExpired && !selectedSet.has(name)) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      out.push({ name, status: o.status, scope: o.team_id ? "team" : "global" });
      if (out.length >= 200) break;
    }
    return out;
  }, [options, q, selectedSet]);

  const qTrim = query.trim();
  const showCustom =
    qTrim.length > 0 &&
    !options.some((o) => o.vehicle_name.toLowerCase() === qTrim.toLowerCase()) &&
    !selectedSet.has(qTrim);

  const toggle = (name: string) => {
    const next = selectedSet.has(name) ? value.filter((v) => v !== name) : [...value, name];
    onChange(next);
    setQuery("");
  };

  const triggerLabel =
    value.length === 0
      ? placeholder ?? "Select contract vehicles"
      : value.length === 1
      ? value[0]
      : `${value.length} vehicles selected`;

  return (
    <div className={cn("w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-left">{triggerLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search vehicles or type a custom name…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-72">
              {showCustom && (
                <CommandGroup heading="Custom entry">
                  <CommandItem value={`custom-${qTrim}`} onSelect={() => toggle(qTrim)}>
                    <Check className="mr-2 h-4 w-4 opacity-0" />
                    <span className="truncate">Add “{qTrim}”</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading="Registry">
                {filtered.length === 0 && !showCustom && (
                  <CommandEmpty>No matches.</CommandEmpty>
                )}
                {filtered.map((o) => (
                  <CommandItem key={o.name} value={o.name} onSelect={() => toggle(o.name)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedSet.has(o.name) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate flex-1">{o.name}</span>
                    {o.scope === "global" && (
                      <Badge variant="outline" className="ml-1 text-[9px]">
                        global
                      </Badge>
                    )}
                    {(o.status ?? "").toLowerCase() === "expired" && (
                      <Badge variant="outline" className="ml-1 text-[9px]">
                        expired
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {value.map((name) => (
            <Badge key={name} variant="secondary" className="gap-1 text-[10px]">
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="ml-1 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((v) => v !== name));
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
