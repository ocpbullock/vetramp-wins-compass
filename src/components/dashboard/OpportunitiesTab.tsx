import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ExternalLink, FileSignature, ArrowUpDown, Repeat, Swords } from "lucide-react";
import {
  badgeClassForType, isProposable, shortAgency,
} from "@/lib/contracts";
import { type SamOpportunity, type HistoricalAward } from "@/lib/api";
import { buildIndex, matchIncumbent, type IncumbentMatch } from "@/lib/incumbents";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { StarButton } from "@/components/dashboard/StarButton";
import { starInputFromSam } from "@/lib/starred";
import { AgencyCombobox } from "./AgencyCombobox";
import { useLogStore } from "@/lib/log-store";
import { PwinChip } from "./PwinChip";

type SortKey = "title" | "agency" | "naics" | "type" | "posted" | "deadline" | "incumbent";

function fmtUsd(n?: number) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

export function OpportunitiesTab({
  opportunities,
  awards = [],
  searchedNaics = [],
  activeFilterNaics,
  searchKey = "",
  onPropose,
  onCompete,
}: {
  opportunities: SamOpportunity[];
  awards?: HistoricalAward[];
  searchedNaics?: string[];
  /** Currently selected NAICS in SearchControls — drives client-side filtering. */
  activeFilterNaics?: string[];
  searchKey?: string;
  onPropose: (o: SamOpportunity) => void;
  onCompete: (o: SamOpportunity) => void;
}) {
  const [search, setSearch] = useState("");
  const [agency, setAgency] = useState("__all__");
  const [type, setType] = useState("__all__");
  const [activeNaics, setActiveNaics] = useState<Set<string>>(new Set(searchedNaics));
  const [sort, setSort] = useState<SortKey>("posted");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [recompetesOnly, setRecompetesOnly] = useState(false);

  // Reset NAICS filter whenever a new search runs
  useEffect(() => {
    setActiveNaics(new Set(searchedNaics));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  // External NAICS selection (from SearchControls) overrides the local set
  // when provided, so toggling chips in the search bar instantly narrows results.
  const effectiveNaics = useMemo(
    () => (activeFilterNaics ? new Set(activeFilterNaics) : activeNaics),
    [activeFilterNaics, activeNaics],
  );

  const log = useLogStore((s) => s.log);
  const idx = useMemo(() => buildIndex(awards), [awards]);
  const matches = useMemo(() => {
    const m = new Map<string, IncumbentMatch>();
    const tier = { exact: 0, parent: 0, psc: 0, fuzzy: 0, frequent: 0, none: 0 };
    for (const o of opportunities) {
      const key = (o.solicitationNumber ?? o.noticeId ?? "") as string;
      const match = matchIncumbent(o, awards, idx);
      m.set(key, match);
      tier[match.confidence]++;
    }
    if (opportunities.length > 0) {
      const matched = opportunities.length - tier.none;
      log(
        "info",
        `Recompete index: ${awards.length} awards, ${idx.byPiid.size} PIIDs, ${idx.byParent.size} parents, ${idx.byAgencyPsc.size} agency+PSC, ${idx.byAgencyNaics.size} agency+NAICS · checked ${opportunities.length} opps → ${matched} matches (exact:${tier.exact} parent:${tier.parent} psc:${tier.psc} fuzzy:${tier.fuzzy} frequent:${tier.frequent})`,
      );
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunities, awards, idx]);

  const agencies = useMemo(() => {
    const s = new Set<string>();
    opportunities.forEach((o) => s.add(shortAgency(o.fullParentPathName)));
    return Array.from(s).filter(Boolean).sort();
  }, [opportunities]);
  const types = useMemo(() => {
    const s = new Set<string>();
    opportunities.forEach((o) => o.type && s.add(o.type));
    return Array.from(s).sort();
  }, [opportunities]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return opportunities.filter((o) => {
      const key = (o.solicitationNumber ?? o.noticeId ?? "") as string;
      const m = matches.get(key);
      if (recompetesOnly && (!m || m.confidence === "none")) return false;
      if (q && !(o.title?.toLowerCase().includes(q) || o.solicitationNumber?.toLowerCase().includes(q))) return false;
      if (agency !== "__all__" && shortAgency(o.fullParentPathName) !== agency) return false;
      if (type !== "__all__" && o.type !== type) return false;
      // Empty NAICS selection = show all (no filter applied)
      if (effectiveNaics.size > 0 && o.naicsCode && !effectiveNaics.has(o.naicsCode)) return false;
      return true;
    });
  }, [opportunities, search, agency, type, effectiveNaics, recompetesOnly, matches]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const ka = (a.solicitationNumber ?? a.noticeId ?? "") as string;
      const kb = (b.solicitationNumber ?? b.noticeId ?? "") as string;
      let av: string = "", bv: string = "";
      switch (sort) {
        case "title": av = a.title || ""; bv = b.title || ""; break;
        case "agency": av = shortAgency(a.fullParentPathName); bv = shortAgency(b.fullParentPathName); break;
        case "naics": av = a.naicsCode || ""; bv = b.naicsCode || ""; break;
        case "type": av = a.type || ""; bv = b.type || ""; break;
        case "posted": av = a.postedDate || ""; bv = b.postedDate || ""; break;
        case "deadline": av = a.responseDeadLine || ""; bv = b.responseDeadLine || ""; break;
        case "incumbent": {
          const ma = matches.get(ka);
          const mb = matches.get(kb);
          // Sort exact > parent > none, then by total $
          const score = (m?: IncumbentMatch) =>
            (m?.confidence === "exact" ? 4 : m?.confidence === "parent" ? 3 : m?.confidence === "psc" ? 2 : m?.confidence === "fuzzy" ? 1 : 0) * 1e15
            + (m?.popExpiringSoon ? 5e14 : 0)
            + (m?.totalAmount ?? 0);
          const sa = score(ma), sb = score(mb);
          return dir === "asc" ? sa - sb : sb - sa;
        }
      }
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return arr;
  }, [filtered, sort, dir, matches]);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(key); setDir("asc"); }
  }
  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <th onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className="w-3 h-3 opacity-50" /></span>
    </th>
  );

  const recompeteCount = useMemo(
    () => [...matches.values()].filter((m) => m.confidence !== "none").length,
    [matches],
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input placeholder="Search title or sol #..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <AgencyCombobox value={agency} onChange={setAgency} agencies={agencies} width="w-[240px]" />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Notice type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 px-2 py-1 rounded border border-border">
            <Switch id="recompetes" checked={recompetesOnly} onCheckedChange={setRecompetesOnly} />
            <Label htmlFor="recompetes" className="text-xs cursor-pointer">
              Recompetes only <span className="text-muted-foreground">({recompeteCount})</span>
            </Label>
          </div>
          <div className="text-xs self-center ml-auto">
            <span className={sorted.length < opportunities.length ? "text-primary font-medium" : "text-muted-foreground"}>
              Showing {sorted.length} of {opportunities.length} results
            </span>
            {sorted.length < opportunities.length && (
              <span className="text-muted-foreground ml-1">(filtered)</span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto bg-card rounded-md border border-border">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-[120px]">Actions</th>
                <SortHead k="title" label="Title" />
                <SortHead k="agency" label="Agency" />
                <SortHead k="naics" label="NAICS" />
                <SortHead k="type" label="Type" />
                <th>pWin</th>
                <SortHead k="incumbent" label="Incumbent" />
                <SortHead k="posted" label="Posted" />
                <SortHead k="deadline" label="Deadline" />
                <th>Sol #</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={10} className="text-center text-muted-foreground py-6">No opportunities. Click Search to fetch.</td></tr>
              )}
              {sorted.map((o, i) => {
                const key = (o.solicitationNumber ?? o.noticeId ?? "") + i;
                const m = matches.get((o.solicitationNumber ?? o.noticeId ?? "") as string);
                const dlMs = o.responseDeadLine ? new Date(o.responseDeadLine).getTime() : NaN;
                const isExpired = !isNaN(dlMs) && dlMs < Date.now();
                return (
                  <tr key={key} className={isExpired ? "opacity-50" : ""}>
                    <td className="w-[120px]">
                      <div className="flex gap-1">
                        <StarButton input={starInputFromSam(o)} />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="outline" onClick={() => onCompete(o)} className="h-7 w-7 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400">
                              <Swords className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Compete</TooltipContent>
                        </Tooltip>
                        {isProposable(o.type) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" onClick={() => onPropose(o)} className="h-7 w-7 bg-money text-money-foreground hover:bg-money/90">
                                <FileSignature className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Propose</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                    <td className="max-w-[320px]">
                      {o.uiLink ? (
                        <a href={o.uiLink} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-start gap-1 line-clamp-2">
                          <span className="line-clamp-2">{o.title}</span>
                          <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
                        </a>
                      ) : <span className="line-clamp-2">{o.title}</span>}
                    </td>
                    <td className="text-xs">{shortAgency(o.fullParentPathName)}</td>
                    <td className="font-mono text-xs">{o.naicsCode}</td>
                    <td>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeClassForType(o.type)}`}>{o.type}</span>
                    </td>
                    <td>
                      <PwinChip
                        opp={{
                          id: (o.solicitationNumber ?? o.noticeId ?? "") as string,
                          naics: o.naicsCode,
                          agency: shortAgency(o.fullParentPathName),
                          setAside: o.typeOfSetAside ?? o.setAside ?? null,
                        }}
                      />
                    </td>
                    <td className="text-xs">
                      <IncumbentCell m={m} />
                    </td>
                    <td className="text-xs whitespace-nowrap">{o.postedDate?.slice(0, 10)}</td>
                    <td className="text-xs whitespace-nowrap">
                      {o.responseDeadLine?.slice(0, 10)}
                      {isExpired && (
                        <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-muted text-muted-foreground border border-border">Closed</span>
                      )}
                    </td>
                    <td className="font-mono text-xs">{o.solicitationNumber}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}

function IncumbentCell({ m }: { m?: IncumbentMatch }) {
  if (!m || m.confidence === "none") {
    return <span className="text-muted-foreground">—</span>;
  }
  const label = m.confidence === "exact"
    ? "Recompete"
    : m.confidence === "parent"
      ? "Follow-on (IDV)"
      : m.confidence === "psc"
        ? "Likely recompete (PSC)"
        : `Possible recompete${m.similarity ? ` (${Math.round(m.similarity * 100)}%)` : ""}`;
  const color = m.confidence === "exact"
    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
    : m.confidence === "parent"
      ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
      : m.confidence === "psc"
        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        : "bg-violet-500/15 text-violet-600 dark:text-violet-400";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium cursor-help ${color}`}>
          <Repeat className="w-3 h-3" />
          <span className="truncate max-w-[110px]">{m.topRecipient}</span>
          {m.popExpiringSoon && <span title="Prior PoP expiring near this deadline" className="ml-0.5">⏰</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs">
        <div className="font-semibold mb-1">{label} — {m.awards.length} prior award{m.awards.length === 1 ? "" : "s"}</div>
        <div>Top incumbent: <span className="font-medium">{m.topRecipient}</span></div>
        <div>Total prior obligations: <span className="font-mono">{fmtUsd(m.totalAmount)}</span></div>
        {m.latestEndDate && <div>Latest end date: {m.latestEndDate}</div>}
        {m.popExpiringSoon && <div className="text-amber-600 dark:text-amber-400 mt-1">⏰ Prior PoP ends within ±9mo of this deadline — strong recompete signal</div>}
        {m.diagnostics?.pscMatched && <div className="text-muted-foreground mt-1">PSC: {m.diagnostics.pscMatched}</div>}
      </TooltipContent>
    </Tooltip>
  );
}
