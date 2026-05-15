import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ExternalLink, ArrowUpDown, Info, Loader2 } from "lucide-react";
import { mapSetAside } from "@/lib/contracts";
import type { HistoricalAward } from "@/lib/api";
import { NaicsFilterChips } from "./NaicsFilterChips";
import { List, type RowComponentProps } from "react-window";

type SortKey = "desc" | "recipient" | "agency" | "naics" | "amount" | "date";

const fmtMoney = (n: any) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n) || 0);

// Column template shared by header + rows. Action column is fixed and lives FIRST.
const COLS =
  "90px minmax(280px,2.2fr) minmax(140px,1fr) minmax(140px,1fr) 90px 110px 130px 110px 130px";

type RowData = {
  items: HistoricalAward[];
  onDetails: (id: string) => void;
};

function Row({ index, style, items, onDetails }: RowComponentProps<RowData>) {
  const a = items[index];
  if (!a) return null;
  return (
    <div
      style={style}
      className="px-3 border-b border-border text-sm hover:bg-muted/40"
    >
      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: "0.5rem", alignItems: "center", width: "100%", height: "100%" }}>
        <div>
          {a.generated_internal_id && (
            <Button size="sm" variant="outline" onClick={() => onDetails(a.generated_internal_id!)} className="h-7 px-2">
              <Info className="w-3 h-3 mr-1" /> Details
            </Button>
          )}
        </div>
        <div className="min-w-0">
          {a.generated_internal_id ? (
            <a
              href={`https://www.usaspending.gov/award/${a.generated_internal_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              <span className="line-clamp-2">{a.Description}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          ) : (
            <span className="line-clamp-2">{a.Description}</span>
          )}
        </div>
        <div className="text-xs truncate">{a["Recipient Name"]}</div>
        <div className="text-xs truncate">{a["Awarding Agency"]}</div>
        <div className="font-mono text-xs">{a.NAICS}</div>
        <div>
          {a["Type of Set Aside"] && (
            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-badge-setaside text-purple-900 truncate max-w-full">
              {mapSetAside(a["Type of Set Aside"])}
            </span>
          )}
        </div>
        <div className="font-semibold text-money">{fmtMoney(a["Award Amount"])}</div>
        <div className="text-xs">{a["Start Date"]?.slice(0, 10)}</div>
        <div className="font-mono text-xs truncate">{a["Award ID"]}</div>
      </div>
    </div>
  );
}

export function HistoricalTab({
  awards,
  searchedNaics = [],
  searchKey = "",
  onDetails,
  onFilteredTotalChange,
  onLoadMore,
  loadingMore = false,
  hasMore = false,
  totalAvailable,
}: {
  awards: HistoricalAward[];
  searchedNaics?: string[];
  searchKey?: string;
  onDetails: (id: string) => void;
  onFilteredTotalChange?: (total: number) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  hasMore?: boolean;
  totalAvailable?: number;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [agency, setAgency] = useState("__all__");
  const [vendor, setVendor] = useState("__all__");
  const [setAside, setSetAside] = useState("__all__");
  const [activeNaics, setActiveNaics] = useState<Set<string>>(new Set(searchedNaics));
  const [sort, setSort] = useState<SortKey>("amount");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  // Debounce text search by 300ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setActiveNaics(new Set(searchedNaics));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  const agencies = useMemo(
    () => Array.from(new Set(awards.map((a) => a["Awarding Agency"]).filter(Boolean) as string[])).sort(),
    [awards],
  );
  const vendors = useMemo(
    () => Array.from(new Set(awards.map((a) => a["Recipient Name"]).filter(Boolean) as string[])).sort(),
    [awards],
  );
  const setAsides = useMemo(
    () => Array.from(new Set(awards.map((a) => a["Type of Set Aside"]).filter(Boolean) as string[])).sort(),
    [awards],
  );

  const naicsKey = useMemo(() => Array.from(activeNaics).sort().join(","), [activeNaics]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return awards.filter((a) => {
      if (q && !(a.Description?.toLowerCase().includes(q) || a["Award ID"]?.toLowerCase().includes(q))) return false;
      if (agency !== "__all__" && a["Awarding Agency"] !== agency) return false;
      if (vendor !== "__all__" && a["Recipient Name"] !== vendor) return false;
      if (setAside !== "__all__" && a["Type of Set Aside"] !== setAside) return false;
      if (searchedNaics.length > 0 && a.NAICS && !activeNaics.has(a.NAICS)) return false;
      return true;
    });
    // naicsKey is used to invalidate when activeNaics contents change
  }, [awards, search, agency, vendor, setAside, naicsKey, searchedNaics.length]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: any = "";
      let bv: any = "";
      switch (sort) {
        case "desc": av = a.Description || ""; bv = b.Description || ""; break;
        case "recipient": av = a["Recipient Name"] || ""; bv = b["Recipient Name"] || ""; break;
        case "agency": av = a["Awarding Agency"] || ""; bv = b["Awarding Agency"] || ""; break;
        case "naics": av = a.NAICS || ""; bv = b.NAICS || ""; break;
        case "amount": av = Number(a["Award Amount"]) || 0; bv = Number(b["Award Amount"]) || 0; break;
        case "date": av = a["Start Date"] || ""; bv = b["Start Date"] || ""; break;
      }
      if (typeof av === "number") return dir === "asc" ? av - bv : bv - av;
      return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filtered, sort, dir]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, a) => s + (Number(a["Award Amount"]) || 0), 0),
    [filtered],
  );

  // Emit filtered total to parent for the stat card
  const lastEmitted = useRef<number | null>(null);
  useEffect(() => {
    if (!onFilteredTotalChange) return;
    if (lastEmitted.current !== filteredTotal) {
      lastEmitted.current = filteredTotal;
      onFilteredTotalChange(filteredTotal);
    }
  }, [filteredTotal, onFilteredTotalChange]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(k); setDir("desc"); }
  }

  const Head = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
    >
      {label}
      <ArrowUpDown className="w-3 h-3 opacity-50" />
    </button>
  );

  const filtersActive =
    !!search ||
    agency !== "__all__" ||
    vendor !== "__all__" ||
    setAside !== "__all__" ||
    (searchedNaics.length > 0 && activeNaics.size !== searchedNaics.length);

  const totalLabel = totalAvailable && totalAvailable > awards.length
    ? `Showing ${awards.length.toLocaleString()} of ${totalAvailable.toLocaleString()} awards${
        filtersActive ? ` (${sorted.length.toLocaleString()} filtered)` : ""
      }`
    : `Showing ${awards.length.toLocaleString()} awards${
        filtersActive ? ` (${sorted.length.toLocaleString()} filtered)` : ""
      }`;

  return (
    <div className="space-y-3">
      <NaicsFilterChips searched={searchedNaics} active={activeNaics} onChange={setActiveNaics} />
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search description or award ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-xs"
        />
        <Select value={agency} onValueChange={setAgency}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Agency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All agencies</SelectItem>
            {agencies.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={vendor} onValueChange={setVendor}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Vendor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All vendors</SelectItem>
            {vendors.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={setAside} onValueChange={setSetAside}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Set-Aside" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All set-asides</SelectItem>
            {setAsides.map((a) => <SelectItem key={a} value={a}>{mapSetAside(a)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground self-center ml-auto">{totalLabel}</div>
      </div>

      <div className="bg-card rounded-md border border-border overflow-hidden">
        {/* Header */}
        <div
          className="px-3 py-2 border-b border-border bg-muted/30"
          style={{ display: "grid", gridTemplateColumns: COLS, gap: "0.5rem", alignItems: "center" }}
        >
          <Head k="desc" label="Description" />
          <Head k="recipient" label="Recipient" />
          <Head k="agency" label="Agency" />
          <Head k="naics" label="NAICS" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Set-Aside</span>
          <Head k="amount" label="Obligated" />
          <Head k="date" label="Award Date" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">PIID</span>
          <span />
        </div>

        {/* Virtualized body */}
        {sorted.length === 0 ? (
          <div className="text-center text-muted-foreground py-6 text-sm">No historical awards.</div>
        ) : (
          <List
            rowComponent={Row}
            rowCount={sorted.length}
            rowHeight={56}
            rowProps={{ items: sorted, onDetails }}
            defaultHeight={Math.min(640, Math.max(240, sorted.length * 56))}
            style={{ width: "100%" }}
            overscanCount={6}
          />
        )}
      </div>

      {hasMore && onLoadMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</> : "Load 2,000 more"}
          </Button>
        </div>
      )}
    </div>
  );
}
