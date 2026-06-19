import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Search, Plus, UserPlus, Loader2, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { searchEntities } from "@/lib/api";
import { listPartnerCompanies, findOrInsertPartnerFromSamEntity, type PartnerView as Partner } from "@/lib/companies";

const SB_TYPES = [
  { value: "SDVOSB", label: "SDVOSB" },
  { value: "8(a)", label: "8(a)" },
  { value: "WOSB", label: "WOSB" },
  { value: "HUBZone", label: "HUBZone" },
];

export function PartnerResearch({
  proposalId, teamId, opportunityNaics,
}: {
  proposalId: string;
  teamId: string | null;
  opportunityNaics?: string | null;
}) {
  const qc = useQueryClient();

  const { data: partners = [] } = useQuery({
    queryKey: ["teaming-partners", teamId],
    enabled: !!teamId,
    queryFn: async () => listPartnerCompanies(teamId!),
  });

  const { data: existingTeaming = [] } = useQuery({
    queryKey: ["proposal-teaming", proposalId],
    enabled: !!proposalId,
    queryFn: async () => {
      const { data } = await supabase.from("proposal_teaming").select("company_id").eq("proposal_id", proposalId);
      return (data ?? []).map((r: any) => r.company_id as string);
    },
  });

  const hasProposal = !!proposalId;

  const suggested = useMemo(() => {
    if (!opportunityNaics) return [];
    return partners.filter((p) => p.naics_codes?.includes(opportunityNaics));
  }, [partners, opportunityNaics]);

  const onProposal = (partnerId: string) => existingTeaming.includes(partnerId);

  const addToProposal = async (partner: Partner) => {
    if (onProposal(partner.id)) { toast.message(`${partner.company_name} is already on this proposal`); return; }
    const overlap = opportunityNaics
      ? partner.naics_codes.filter((n) => n === opportunityNaics)
      : [];
    const { error } = await supabase.from("proposal_teaming").insert({
      proposal_id: proposalId, company_id: partner.id, role: "sub", work_share_pct: null, naics_contribution: overlap,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${partner.company_name} to this proposal`);
    qc.invalidateQueries({ queryKey: ["proposal-teaming", proposalId] });
  };

  // ---- Find new partners panel ----
  const [showSearch, setShowSearch] = useState(false);
  const [naicsInput, setNaicsInput] = useState(opportunityNaics ?? "");
  const [sbTypes, setSbTypes] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [cached, setCached] = useState(false);

  const toggleSb = (v: string) =>
    setSbTypes((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);

  const runSearch = async () => {
    setSearching(true);
    try {
      // Tango entity API supports one small_business_type at a time; loop if multiple.
      const types = sbTypes.length ? sbTypes : [undefined as unknown as string];
      const collected: any[] = [];
      let anyCached = false;
      for (const t of types) {
        const { results, _cached } = await searchEntities({
          vendor_name: keyword || undefined,
          naics_code: naicsInput || undefined,
          small_business_type: t || undefined,
        });
        if (_cached) anyCached = true;
        for (const r of results || []) {
          if (!collected.find((x) => x.tango_id === r.tango_id)) collected.push(r);
        }
      }
      let final = collected;
      if (stateFilter.trim()) {
        const s = stateFilter.trim().toUpperCase();
        final = final.filter((r) => (r.state ?? "").toUpperCase().includes(s));
      }
      setResults(final);
      setCached(anyCached);
      toast.success(`Found ${final.length} entit${final.length === 1 ? "y" : "ies"}${anyCached ? " (from cache)" : ""}`);
    } catch (e: any) {
      toast.error(e.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const addToRoster = async (entity: any): Promise<Partner | null> => {
    if (!teamId) { toast.error("No team selected"); return null; }
    try {
      const partner = await findOrInsertPartnerFromSamEntity(teamId, entity);
      if (partner) {
        toast.success(`Added ${partner.company_name} to roster`);
        qc.invalidateQueries({ queryKey: ["teaming-partners", teamId] });
        qc.invalidateQueries({ queryKey: ["companies", teamId] });
      }
      return partner;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add to roster");
      return null;
    }
  };

  const addEntityToProposal = async (entity: any) => {
    const partner = await addToRoster(entity);
    if (partner) await addToProposal(partner);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Research teaming partners</CardTitle>
        <CardDescription>Find subs that fit this NAICS — from your roster or from SAM.gov.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Suggested from roster */}
        <div>
          <div className="text-xs font-semibold mb-2">Suggested from your roster {opportunityNaics && <span className="text-muted-foreground font-normal">· NAICS {opportunityNaics}</span>}</div>
          {!opportunityNaics && (
            <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">Set the opportunity NAICS to see suggestions.</div>
          )}
          {opportunityNaics && suggested.length === 0 && (
            <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">No partners in your roster match this NAICS code.</div>
          )}
          {suggested.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {suggested.map((p) => (
                <div key={p.id} className="border border-border rounded p-2 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{p.company_name}</div>
                    <Button size="sm" variant="outline" disabled={onProposal(p.id)} onClick={() => addToProposal(p)}>
                      <Plus className="w-3 h-3 mr-1" />{onProposal(p.id) ? "Added" : "Add to team"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(p.certifications ?? []).slice(0, 6).map((c) => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                    {(p.naics_codes ?? []).slice(0, 8).map((n) => (
                      <Badge key={n} variant={n === opportunityNaics ? "secondary" : "outline"} className="text-[10px] font-mono">{n}{n === opportunityNaics ? " ✓" : ""}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Find new partners */}
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold">Find new partners</div>
            <Button size="sm" variant="outline" onClick={() => setShowSearch((s) => !s)}>
              <Search className="w-3 h-3 mr-1" />{showSearch ? "Hide" : "Research new partners"}
            </Button>
          </div>
          {showSearch && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <Label className="text-[11px]">NAICS code</Label>
                  <Input className="h-8 text-xs" value={naicsInput} onChange={(e) => setNaicsInput(e.target.value)} placeholder="e.g. 541512" />
                </div>
                <div>
                  <Label className="text-[11px]">State</Label>
                  <Input className="h-8 text-xs" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} placeholder="e.g. VA" />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-[11px]">Keyword (matches vendor name)</Label>
                  <Input className="h-8 text-xs" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. cyber, cloud, logistics…" />
                </div>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <span className="text-[11px] text-muted-foreground">Set-aside:</span>
                {SB_TYPES.map((t) => (
                  <label key={t.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={sbTypes.includes(t.value)} onCheckedChange={() => toggleSb(t.value)} />
                    {t.label}
                  </label>
                ))}
              </div>
              <Button size="sm" onClick={runSearch} disabled={searching}>
                {searching ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}
                {searching ? "Searching…" : "Search SAM.gov"}
              </Button>
              <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                Entity data from SAM.gov via Tango API. Verify credentials before teaming.
              </div>

              {results !== null && (
                <div className="border border-border rounded overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Legal Name</TableHead>
                        <TableHead>DBA</TableHead>
                        <TableHead>UEI</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Business Types</TableHead>
                        <TableHead>NAICS</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-4">No results.</TableCell></TableRow>
                      )}
                      {results.map((r) => (
                        <TableRow key={r.tango_id || r.uei || `${r.legal_name}-${r.cage_code}`}>
                          <TableCell className="text-xs">{r.legal_name || "—"}</TableCell>
                          <TableCell className="text-xs">{r.dba_name || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{r.uei || "—"}</TableCell>
                          <TableCell className="text-xs">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-wrap gap-1">
                              {(r.small_business_types ?? []).slice(0, 4).map((c: string) => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-wrap gap-1">
                              {(r.naics_codes ?? []).slice(0, 4).map((n: string) => (
                                <Badge key={n} variant={n === opportunityNaics ? "secondary" : "outline"} className="text-[10px] font-mono">{n}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col gap-1 items-end">
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addToRoster(r)}>
                                <UserPlus className="w-3 h-3 mr-1" />Add to roster
                              </Button>
                              <Button size="sm" className="h-7 text-[11px]" onClick={() => addEntityToProposal(r)}>
                                <Plus className="w-3 h-3 mr-1" />Add to this proposal
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {cached && <div className="text-[10px] text-muted-foreground p-2">Showing cached results.</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
