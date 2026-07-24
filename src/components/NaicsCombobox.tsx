import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
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
import { NAICS_2022, naicsTitle, isValidNaicsCode } from "@/lib/naics-all";
import { NAICS_GROUPS } from "@/lib/contracts";

const COMMON: { code: string; title: string }[] = NAICS_GROUPS.flatMap((g) =>
  g.codes.map((c) => ({ code: c.code, title: c.name })),
);
const COMMON_SET = new Set(COMMON.map((c) => c.code));

/** Human label for a code — uses official title, common list, or falls back to "Custom code". */
export function naicsLabel(code: string | null | undefined): string {
  if (!code) return "";
  const off = naicsTitle(code);
  if (off) return off;
  const c = COMMON.find((x) => x.code === code);
  if (c) return c.title;
  return "Custom code";
}

type SingleProps = {
  mode?: "single";
  value: string | null;
  onChange: (code: string | null) => void;
  multiple?: false;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
};

type MultipleProps = {
  mode: "multiple";
  value: string[];
  onChange: (codes: string[]) => void;
  multiple?: true;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
};

type Props = SingleProps | MultipleProps;

export function NaicsCombobox(props: Props) {
  const isMulti = props.mode === "multiple";
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const q = query.trim().toLowerCase();
  const isCodeQuery = /^\d{1,6}$/.test(q);

  const filteredAll = React.useMemo(() => {
    if (!q) return NAICS_2022.slice(0, 200);
    const out: { code: string; title: string }[] = [];
    for (const e of NAICS_2022) {
      if (e.code.includes(q) || e.title.toLowerCase().includes(q)) {
        out.push(e);
        if (out.length >= 200) break;
      }
    }
    return out;
  }, [q]);

  const filteredCommon = React.useMemo(() => {
    if (!q) return COMMON;
    return COMMON.filter(
      (e) => e.code.includes(q) || e.title.toLowerCase().includes(q),
    );
  }, [q]);

  const showCustom =
    isValidNaicsCode(q) &&
    !naicsTitle(q) &&
    !COMMON_SET.has(q);

  const selected: string[] = isMulti
    ? (props as MultipleProps).value
    : (props as SingleProps).value
    ? [(props as SingleProps).value as string]
    : [];

  const commit = (code: string) => {
    if (isMulti) {
      const cur = (props as MultipleProps).value;
      const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
      (props as MultipleProps).onChange(next);
    } else {
      (props as SingleProps).onChange(code);
      setOpen(false);
    }
    setQuery("");
  };

  const clear = () => {
    if (isMulti) (props as MultipleProps).onChange([]);
    else (props as SingleProps).onChange(null);
  };

  const triggerLabel = React.useMemo(() => {
    if (isMulti) {
      const v = (props as MultipleProps).value;
      if (v.length === 0) return props.placeholder ?? "Select NAICS codes";
      if (v.length === 1) return `${v[0]} — ${naicsLabel(v[0])}`;
      return `${v.length} selected · ${v.slice(0, 3).join(", ")}${v.length > 3 ? "…" : ""}`;
    }
    const v = (props as SingleProps).value;
    if (!v) return props.placeholder ?? "Select NAICS code";
    return `${v} — ${naicsLabel(v)}`;
  }, [isMulti, props]);

  return (
    <div className={cn("w-full", props.className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={props.disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-left">{triggerLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by code or industry…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-72">
              {showCustom && (
                <CommandGroup heading="Custom code">
                  <CommandItem value={`custom-${q}`} onSelect={() => commit(q)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected.includes(q) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono text-xs mr-2">{q}</span>
                    <span className="text-muted-foreground text-xs">
                      Use custom 6-digit code
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              {filteredCommon.length > 0 && (
                <CommandGroup heading="Common">
                  {filteredCommon.map((e) => (
                    <CommandItem
                      key={`c-${e.code}`}
                      value={`c-${e.code}`}
                      onSelect={() => commit(e.code)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selected.includes(e.code) ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-mono text-xs mr-2">{e.code}</span>
                      <span className="truncate">{e.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandGroup heading={q ? "All NAICS" : "All NAICS (type to search)"}>
                {filteredAll.length === 0 && !showCustom && (
                  <CommandEmpty>
                    {isCodeQuery
                      ? "No matches. Type a full 6-digit code to add a custom code."
                      : "No matches."}
                  </CommandEmpty>
                )}
                {filteredAll.map((e) => (
                  <CommandItem
                    key={`a-${e.code}`}
                    value={`a-${e.code}`}
                    onSelect={() => commit(e.code)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected.includes(e.code) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono text-xs mr-2">{e.code}</span>
                    <span className="truncate">{e.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {isMulti && (props as MultipleProps).value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(props as MultipleProps).value.map((code) => (
            <Badge key={code} variant="secondary" className="gap-1 font-mono text-[10px]">
              {code}
              <button
                type="button"
                aria-label={`Remove ${code}`}
                className="ml-1 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = (props as MultipleProps).value.filter((c) => c !== code);
                  (props as MultipleProps).onChange(next);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {!isMulti && props.allowClear !== false && (props as SingleProps).value && (
        <button
          type="button"
          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={clear}
        >
          Clear
        </button>
      )}
      {isMulti && props.allowClear !== false && (props as MultipleProps).value.length > 0 && (
        <button
          type="button"
          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={clear}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
