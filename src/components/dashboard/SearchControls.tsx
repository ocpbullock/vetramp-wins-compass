import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ALL_NAICS, DEFAULT_NAICS, IT_ONLY, NAICS_GROUPS } from "@/lib/contracts";
import { ChevronDown, Search } from "lucide-react";
import { format, subYears } from "date-fns";

export type SearchInput = {
  naicsCodes: string[];
  postedFrom: string;
  postedTo: string;
  keyword: string;
  forceRefresh?: boolean;
};

const today = format(new Date(), "yyyy-MM-dd");
// Default to a 36-month window: USAspending uses the full range for historical
// award matching (better incumbent/recompete detection), and the SAM edge
// function auto-clamps the opportunities query to its 1-year hard limit.
const defaultFrom = format(subYears(new Date(), 3), "yyyy-MM-dd");

export function SearchControls({
  initial,
  onSearch,
  busy,
}: {
  initial?: Partial<SearchInput>;
  onSearch: (i: SearchInput) => void;
  busy: boolean;
}) {
  const [naics, setNaics] = useState<string[]>(initial?.naicsCodes ?? DEFAULT_NAICS);
  const [from, setFrom] = useState(initial?.postedFrom ?? defaultFrom);
  const [to, setTo] = useState(initial?.postedTo ?? today);
  const [keyword, setKeyword] = useState(initial?.keyword ?? "");

  function toggle(code: string) {
    setNaics((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  return (
    <div className="sticky top-[73px] z-20 bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[260px]">
          <Label className="text-xs">NAICS Codes ({naics.length})</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between mt-1 font-normal">
                <span className="truncate">{naics.length === 0 ? "Select NAICS" : naics.join(", ")}</span>
                <ChevronDown className="w-4 h-4 ml-2 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[420px] max-h-[400px] overflow-y-auto p-3">
              <div className="flex gap-2 mb-3">
                <Button size="sm" variant="secondary" onClick={() => setNaics(ALL_NAICS)}>Select All</Button>
                <Button size="sm" variant="secondary" onClick={() => setNaics([])}>Clear</Button>
                <Button size="sm" variant="secondary" onClick={() => setNaics(IT_ONLY)}>IT Only</Button>
              </div>
              {NAICS_GROUPS.map((g) => (
                <div key={g.label} className="mb-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">{g.label}</div>
                  <div className="space-y-1.5">
                    {g.codes.map((c) => (
                      <label key={c.code} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-1 py-1">
                        <Checkbox checked={naics.includes(c.code)} onCheckedChange={() => toggle(c.code)} />
                        <span className="font-mono text-xs">{c.code}</span>
                        <span className="text-muted-foreground text-xs">{c.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Keyword (optional)</Label>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. cybersecurity" className="mt-1" />
        </div>

        <Button
          disabled={busy || naics.length === 0}
          onClick={() => onSearch({ naicsCodes: naics, postedFrom: from, postedTo: to, keyword })}
          className="bg-primary hover:bg-primary/90"
        >
          <Search className="w-4 h-4 mr-2" />
          {busy ? "Searching..." : "Search"}
        </Button>
        <Button
          disabled={busy || naics.length === 0}
          variant="outline"
          onClick={() => onSearch({ naicsCodes: naics, postedFrom: from, postedTo: to, keyword, forceRefresh: true })}
          title="Bypass cache and refetch from APIs"
        >
          {busy ? "..." : "Force refresh"}
        </Button>
      </div>
    </div>
  );
}
