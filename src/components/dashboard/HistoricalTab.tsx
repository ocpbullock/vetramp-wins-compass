import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ExternalLink, ArrowUpDown, Info } from "lucide-react";
import { mapSetAside } from "@/lib/contracts";
import type { HistoricalAward } from "@/lib/api";

type SortKey = "desc" | "recipient" | "agency" | "naics" | "amount" | "date";

const fmtMoney = (n: any) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n) || 0);

export function HistoricalTab({
  awards,
  onDetails,
}: {
  awards: HistoricalAward[];
  onDetails: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [agency, setAgency] = useState("__all__");
  const [vendor, setVendor] = useState("__all__");
  const [setAside, setSetAside] = useState("__all__");
  const [sort, setSort] = useState<SortKey>("amount");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const agencies = useMemo(() => Array.from(new Set(awards.map((a) => a["Awarding Agency"]).filter(Boolean) as string[])).sort(), [awards]);
  const vendors = useMemo(() => Array.from(new Set(awards.map((a) => a["Recipient Name"]).filter(Boolean) as string[])).sort(), [awards]);
  const setAsides = useMemo(() => Array.from(new Set(awards.map((a) => a["Type of Set Aside"]).filter(Boolean) as string[])).sort(), [awards]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return awards.filter((a) => {
      if (q && !(a.Description?.toLowerCase().includes(q) || a["Award ID"]?.toLowerCase().includes(q))) return false;
      if (agency !== "__all__" && a["Awarding Agency"] !== agency) return false;
      if (vendor !== "__all__" && a["Recipient Name"] !== vendor) return false;
      if (setAside !== "__all__" && a["Type of Set Aside"] !== setAside) return false;
      return true;
    });
  }, [awards, search, agency, vendor, setAside]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: any = "", bv: any = "";
      switch (sort) {
        case "desc": av = a.Description || ""; bv = b.Description || ""; break;
        case "recipient": av = a["Recipient Name"] || ""; bv = b["Recipient Name"] || ""; break;
        case "agency": av = a["Awarding Agency"] || ""; bv = b["Awarding Agency"] || ""; break;
        case "naics": av = a["NAICS Code"] || ""; bv = b["NAICS Code"] || ""; break;
        case "amount": av = Number(a["Award Amount"]) || 0; bv = Number(b["Award Amount"]) || 0; break;
        case "date": av = a["Start Date"] || ""; bv = b["Start Date"] || ""; break;
      }
      if (typeof av === "number") return dir === "asc" ? av - bv : bv - av;
      return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filtered, sort, dir]);

  function toggleSort(k: SortKey) { if (sort === k) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir("desc"); } }
  const Head = ({ k, label }: { k: SortKey; label: string }) => (
    <th onClick={() => toggleSort(k)}><span className="inline-flex items-center gap-1">{label}<ArrowUpDown className="w-3 h-3 opacity-50" /></span></th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search description or award ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={agency} onValueChange={setAgency}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Agency" /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All agencies</SelectItem>{agencies.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={vendor} onValueChange={setVendor}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Vendor" /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All vendors</SelectItem>{vendors.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={setAside} onValueChange={setSetAside}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Set-Aside" /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All set-asides</SelectItem>{setAsides.map((a) => <SelectItem key={a} value={a}>{mapSetAside(a)}</SelectItem>)}</SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground self-center ml-auto">{sorted.length} of {awards.length}</div>
      </div>

      <div className="overflow-x-auto bg-card rounded-md border border-border">
        <table className="data-table">
          <thead>
            <tr>
              <Head k="desc" label="Description" />
              <Head k="recipient" label="Recipient" />
              <Head k="agency" label="Agency" />
              <Head k="naics" label="NAICS" />
              <th>Set-Aside</th>
              <Head k="amount" label="Obligated" />
              <Head k="date" label="Award Date" />
              <th>PIID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={9} className="text-center text-muted-foreground py-6">No historical awards.</td></tr>}
            {sorted.map((a, i) => (
              <tr key={(a["Award ID"] ?? "") + i}>
                <td className="max-w-md">
                  {a.generated_internal_id ? (
                    <a href={`https://www.usaspending.gov/award/${a.generated_internal_id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                      <span className="line-clamp-2">{a.Description}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    </a>
                  ) : <span className="line-clamp-2">{a.Description}</span>}
                </td>
                <td className="text-xs">{a["Recipient Name"]}</td>
                <td className="text-xs">{a["Awarding Agency"]}</td>
                <td className="font-mono text-xs">{a["NAICS Code"]}</td>
                <td>{a["Type of Set Aside"] && <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-badge-setaside text-purple-900">{mapSetAside(a["Type of Set Aside"])}</span>}</td>
                <td className="font-semibold text-money">{fmtMoney(a["Award Amount"])}</td>
                <td className="text-xs">{a["Start Date"]?.slice(0, 10)}</td>
                <td className="font-mono text-xs">{a["Award ID"]}</td>
                <td>
                  {a.generated_internal_id && (
                    <Button size="sm" variant="outline" onClick={() => onDetails(a.generated_internal_id!)}>
                      <Info className="w-3 h-3 mr-1" /> Details
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
