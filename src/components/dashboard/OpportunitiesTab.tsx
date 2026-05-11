import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileSignature, ArrowUpDown } from "lucide-react";
import {
  badgeClassForType, isProposable, shortAgency,
} from "@/lib/contracts";
import { type SamOpportunity } from "@/lib/api";
import { NaicsFilterChips } from "./NaicsFilterChips";

type SortKey = "title" | "agency" | "naics" | "type" | "posted" | "deadline";

export function OpportunitiesTab({
  opportunities,
  searchedNaics = [],
  onPropose,
}: {
  opportunities: SamOpportunity[];
  searchedNaics?: string[];
  onPropose: (o: SamOpportunity) => void;
}) {
  const [search, setSearch] = useState("");
  const [agency, setAgency] = useState("__all__");
  const [type, setType] = useState("__all__");
  const [activeNaics, setActiveNaics] = useState<Set<string>>(new Set(searchedNaics));
  const [sort, setSort] = useState<SortKey>("posted");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  // Reset NAICS filter whenever a new search runs
  useEffect(() => {
    setActiveNaics(new Set(searchedNaics));
  }, [searchedNaics.join(",")]);

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
      if (q && !(o.title?.toLowerCase().includes(q) || o.solicitationNumber?.toLowerCase().includes(q))) return false;
      if (agency !== "__all__" && shortAgency(o.fullParentPathName) !== agency) return false;
      if (type !== "__all__" && o.type !== type) return false;
      if (searchedNaics.length > 0 && o.naicsCode && !activeNaics.has(o.naicsCode)) return false;
      return true;
    });
  }, [opportunities, search, agency, type, activeNaics, searchedNaics]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: string = "", bv: string = "";
      switch (sort) {
        case "title": av = a.title || ""; bv = b.title || ""; break;
        case "agency": av = shortAgency(a.fullParentPathName); bv = shortAgency(b.fullParentPathName); break;
        case "naics": av = a.naicsCode || ""; bv = b.naicsCode || ""; break;
        case "type": av = a.type || ""; bv = b.type || ""; break;
        case "posted": av = a.postedDate || ""; bv = b.postedDate || ""; break;
        case "deadline": av = a.responseDeadLine || ""; bv = b.responseDeadLine || ""; break;
      }
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return arr;
  }, [filtered, sort, dir]);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(key); setDir("asc"); }
  }
  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <th onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className="w-3 h-3 opacity-50" /></span>
    </th>
  );

  return (
    <div className="space-y-3">
      <NaicsFilterChips searched={searchedNaics} active={activeNaics} onChange={setActiveNaics} />
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search title or sol #..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={agency} onValueChange={setAgency}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Agency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All agencies</SelectItem>
            {agencies.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Notice type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All types</SelectItem>
            {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground self-center ml-auto">{sorted.length} of {opportunities.length}</div>
      </div>

      <div className="overflow-x-auto bg-card rounded-md border border-border">
        <table className="data-table">
          <thead>
            <tr>
              <SortHead k="title" label="Title" />
              <SortHead k="agency" label="Agency" />
              <SortHead k="naics" label="NAICS" />
              <SortHead k="type" label="Type" />
              <SortHead k="posted" label="Posted" />
              <SortHead k="deadline" label="Deadline" />
              <th>Sol #</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted-foreground py-6">No opportunities. Click Search to fetch.</td></tr>
            )}
            {sorted.map((o, i) => (
              <tr key={(o.solicitationNumber ?? "") + i}>
                <td className="max-w-md">
                  {o.uiLink ? (
                    <a href={o.uiLink} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                      {o.title}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : <span>{o.title}</span>}
                </td>
                <td className="text-xs">{shortAgency(o.fullParentPathName)}</td>
                <td className="font-mono text-xs">{o.naicsCode}</td>
                <td>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badgeClassForType(o.type)}`}>{o.type}</span>
                </td>
                <td className="text-xs">{o.postedDate?.slice(0, 10)}</td>
                <td className="text-xs">{o.responseDeadLine?.slice(0, 10)}</td>
                <td className="font-mono text-xs">{o.solicitationNumber}</td>
                <td>
                  {isProposable(o.type) && (
                    <Button size="sm" onClick={() => onPropose(o)} className="bg-money text-money-foreground hover:bg-money/90">
                      <FileSignature className="w-3 h-3 mr-1" /> Propose
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
