import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, ChevronRight, DollarSign, Users, FileText } from "lucide-react";

type Source = "internal" | "partner";
type LaborRow = {
  id: string;
  category: string;
  qty: number;
  hours: number;
  rate: number;
  source: Source;
  partner_id?: string | null;
};

type OdcCategory = "Travel" | "Equipment" | "Software" | "Licenses" | "Training" | "Other";
type OdcFreq = "One-time" | "Monthly" | "Annually";
type OdcRow = {
  id: string;
  description: string;
  category: OdcCategory;
  cost: number;
  frequency: OdcFreq;
};

type Pricing = {
  odcs?: OdcRow[];
  ga_pct?: number;
  overhead_pct?: number;
  profit_pct?: number;
  escalation_pct?: number;
};

type Partner = { id: string; company_name: string };

const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function SolutionDesignStep({
  proposal,
  proposalId,
  onPatch,
}: {
  proposal: any;
  proposalId: string;
  onPatch: (patch: any) => Promise<void> | void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("teaming_partners").select("id,company_name").order("company_name");
      setPartners(data || []);
    })();
  }, []);

  // Load initial state from proposal
  const initialLabor: LaborRow[] = Array.isArray(proposal.staffing_plan?.labor) ? proposal.staffing_plan.labor : [];
  const pricing: Pricing = proposal.pricing || {};

  const [labor, setLabor] = useState<LaborRow[]>(initialLabor);
  const [odcs, setOdcs] = useState<OdcRow[]>(pricing.odcs || []);
  const [gaPct, setGaPct] = useState<number>(pricing.ga_pct ?? 12);
  const [overheadPct, setOverheadPct] = useState<number>(pricing.overhead_pct ?? 0);
  const [profitPct, setProfitPct] = useState<number>(pricing.profit_pct ?? 5);
  const [escalationPct, setEscalationPct] = useState<number>(pricing.escalation_pct ?? 3);

  // Debounced save
  const saveTimer = useRef<any>(null);
  function scheduleSave(patch: any) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onPatch(patch), 500);
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  function persistLabor(next: LaborRow[]) {
    setLabor(next);
    scheduleSave({ staffing_plan: { ...(proposal.staffing_plan || {}), labor: next } });
  }
  function persistPricing(next: Partial<Pricing>) {
    const merged: Pricing = { odcs, ga_pct: gaPct, overhead_pct: overheadPct, profit_pct: profitPct, escalation_pct: escalationPct, ...next };
    scheduleSave({ pricing: merged });
  }

  // Computed totals
  const annualLabor = useMemo(
    () => labor.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.hours) || 0) * (Number(r.rate) || 0), 0),
    [labor]
  );
  const annualOdc = useMemo(
    () => odcs.reduce((s, r) => {
      const c = Number(r.cost) || 0;
      if (r.frequency === "Monthly") return s + c * 12;
      if (r.frequency === "Annually") return s + c;
      return s + c; // One-time treated as base-year cost
    }, 0),
    [odcs]
  );
  const subtotal = annualLabor + annualOdc;
  const ga = subtotal * (gaPct / 100);
  const overhead = subtotal * (overheadPct / 100);
  const beforeProfit = subtotal + ga + overhead;
  const profit = beforeProfit * (profitPct / 100);
  const baseYearTotal = beforeProfit + profit;

  // Multi-year breakdown
  const baseMonths = Number(proposal.pop_base_months) || 12;
  const optionMonths = Number(proposal.pop_option_months) || 0;
  const totalMonths = baseMonths + optionMonths;
  const years = Math.max(1, Math.ceil(totalMonths / 12));
  const yearRows = useMemo(() => {
    const rows: { year: number; months: number; total: number }[] = [];
    let remaining = totalMonths;
    for (let y = 1; y <= years; y++) {
      const m = Math.min(12, remaining);
      remaining -= m;
      const escalator = Math.pow(1 + escalationPct / 100, y - 1);
      rows.push({ year: y, months: m, total: baseYearTotal * (m / 12) * escalator });
    }
    return rows;
  }, [years, totalMonths, baseYearTotal, escalationPct]);
  const lifecycleTotal = yearRows.reduce((s, r) => s + r.total, 0);

  // Labor mutations
  function addLabor() {
    persistLabor([...labor, { id: uid(), category: "", qty: 1, hours: 1880, rate: 0, source: "internal" }]);
  }
  function updateLabor(id: string, patch: Partial<LaborRow>) {
    persistLabor(labor.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeLabor(id: string) {
    persistLabor(labor.filter((r) => r.id !== id));
  }

  // ODC mutations
  function commitOdcs(next: OdcRow[]) {
    setOdcs(next);
    scheduleSave({ pricing: { ...(proposal.pricing || {}), odcs: next, ga_pct: gaPct, overhead_pct: overheadPct, profit_pct: profitPct, escalation_pct: escalationPct } });
  }
  function addOdc() {
    commitOdcs([...odcs, { id: uid(), description: "", category: "Other", cost: 0, frequency: "One-time" }]);
  }
  function updateOdc(id: string, patch: Partial<OdcRow>) {
    commitOdcs(odcs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeOdc(id: string) {
    commitOdcs(odcs.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-4">
      {/* Price summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><DollarSign className="w-4 h-4" />Price summary</CardTitle>
          <CardDescription className="text-xs">Live calculation from staffing and ODCs below. Indirect rates and escalation are editable.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat label="Total labor (base year)" value={fmt(annualLabor)} />
            <Stat label="Total ODCs (base year)" value={fmt(annualOdc)} />
            <Stat label="Subtotal" value={fmt(subtotal)} />
            <Stat label="Base year total" value={fmt(baseYearTotal)} highlight />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <RateInput label="G&A %" value={gaPct} onChange={(v) => { setGaPct(v); persistPricing({ ga_pct: v }); }} />
            <RateInput label="Overhead %" value={overheadPct} onChange={(v) => { setOverheadPct(v); persistPricing({ overhead_pct: v }); }} />
            <RateInput label="Profit / fee %" value={profitPct} onChange={(v) => { setProfitPct(v); persistPricing({ profit_pct: v }); }} />
            <RateInput label="Annual escalation %" value={escalationPct} onChange={(v) => { setEscalationPct(v); persistPricing({ escalation_pct: v }); }} />
          </div>

          {years > 1 && (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="grid grid-cols-3 bg-muted px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <div>Period</div><div>Months</div><div className="text-right">Total</div>
              </div>
              {yearRows.map((r) => (
                <div key={r.year} className="grid grid-cols-3 px-3 py-1.5 text-xs border-t border-border">
                  <div>{r.year <= Math.ceil(baseMonths / 12) ? `Base year ${r.year}` : `Option year ${r.year - Math.ceil(baseMonths / 12)}`}</div>
                  <div>{r.months}</div>
                  <div className="text-right font-mono">{fmt(r.total)}</div>
                </div>
              ))}
              <div className="grid grid-cols-3 px-3 py-1.5 text-xs border-t border-border bg-muted/40 font-semibold">
                <div>Lifecycle total</div><div>{totalMonths}</div><div className="text-right font-mono">{fmt(lifecycleTotal)}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Staffing */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Staffing plan</CardTitle>
            <CardDescription className="text-xs">Annual cost = Quantity × Annual hours × Hourly rate.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addLabor}><Plus className="w-3.5 h-3.5 mr-1" />Add labor category</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Labor category</th>
                  <th className="text-right p-2 font-medium w-16">Qty</th>
                  <th className="text-right p-2 font-medium w-24">Annual hrs</th>
                  <th className="text-right p-2 font-medium w-28">Hourly rate</th>
                  <th className="text-right p-2 font-medium w-32">Annual cost</th>
                  <th className="text-left p-2 font-medium w-44">Source</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {labor.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No labor categories yet — click "Add labor category" to start.</td></tr>
                )}
                {labor.map((r) => {
                  const annualCost = (Number(r.qty) || 0) * (Number(r.hours) || 0) * (Number(r.rate) || 0);
                  return (
                    <tr key={r.id} className="border-t border-border align-middle">
                      <td className="p-1.5">
                        <Input value={r.category} onChange={(e) => updateLabor(r.id, { category: e.target.value })} className="h-7 text-xs" placeholder="e.g. Sr. Developer" />
                      </td>
                      <td className="p-1.5"><Input type="number" min={0} value={r.qty} onChange={(e) => updateLabor(r.id, { qty: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                      <td className="p-1.5"><Input type="number" min={0} value={r.hours} onChange={(e) => updateLabor(r.id, { hours: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                      <td className="p-1.5"><Input type="number" min={0} step="0.01" value={r.rate} onChange={(e) => updateLabor(r.id, { rate: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                      <td className="p-1.5 text-right font-mono">{fmt(annualCost)}</td>
                      <td className="p-1.5">
                        <div className="flex gap-1">
                          <Select value={r.source} onValueChange={(v: Source) => updateLabor(r.id, { source: v, partner_id: v === "internal" ? null : r.partner_id })}>
                            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="internal">Internal</SelectItem>
                              <SelectItem value="partner">Teaming Partner</SelectItem>
                            </SelectContent>
                          </Select>
                          {r.source === "partner" && (
                            <Select value={r.partner_id || ""} onValueChange={(v) => updateLabor(r.id, { partner_id: v })}>
                              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Partner…" /></SelectTrigger>
                              <SelectContent>
                                {partners.length === 0 && <SelectItem value="none" disabled>No partners</SelectItem>}
                                {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.company_name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </td>
                      <td className="p-1.5"><Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeLabor(r.id)}><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
              {labor.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    <td className="p-2" colSpan={4}>Total annual labor</td>
                    <td className="p-2 text-right font-mono">{fmt(annualLabor)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ODCs */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><DollarSign className="w-4 h-4" />Other Direct Costs (ODCs) & materials</CardTitle>
            <CardDescription className="text-xs">Monthly costs annualized × 12. One-time costs roll into base year.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addOdc}><Plus className="w-3.5 h-3.5 mr-1" />Add ODC line</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Description</th>
                  <th className="text-left p-2 font-medium w-32">Category</th>
                  <th className="text-right p-2 font-medium w-28">Cost</th>
                  <th className="text-left p-2 font-medium w-32">Frequency</th>
                  <th className="text-right p-2 font-medium w-32">Annualized</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {odcs.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No ODCs yet.</td></tr>
                )}
                {odcs.map((r) => {
                  const annual = r.frequency === "Monthly" ? (Number(r.cost) || 0) * 12 : (Number(r.cost) || 0);
                  return (
                    <tr key={r.id} className="border-t border-border align-middle">
                      <td className="p-1.5"><Input value={r.description} onChange={(e) => updateOdc(r.id, { description: e.target.value })} className="h-7 text-xs" placeholder="e.g. Travel to client site" /></td>
                      <td className="p-1.5">
                        <Select value={r.category} onValueChange={(v: OdcCategory) => updateOdc(r.id, { category: v })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(["Travel", "Equipment", "Software", "Licenses", "Training", "Other"] as OdcCategory[]).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1.5"><Input type="number" min={0} step="0.01" value={r.cost} onChange={(e) => updateOdc(r.id, { cost: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                      <td className="p-1.5">
                        <Select value={r.frequency} onValueChange={(v: OdcFreq) => updateOdc(r.id, { frequency: v })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(["One-time", "Monthly", "Annually"] as OdcFreq[]).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1.5 text-right font-mono">{fmt(annual)}</td>
                      <td className="p-1.5"><Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeOdc(r.id)}><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
              {odcs.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    <td className="p-2" colSpan={4}>Total ODCs (base year)</td>
                    <td className="p-2 text-right font-mono">{fmt(annualOdc)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Approach narratives</CardTitle>
          <CardDescription className="text-xs">Freeform notes that feed into the AI proposal generator.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <NoteSection
            label="Technical approach notes"
            value={proposal.technical_approach?.notes || ""}
            onSave={(v) => onPatch({ technical_approach: { ...(proposal.technical_approach || {}), notes: v } })}
          />
          <NoteSection
            label="Management approach notes"
            value={proposal.management_approach?.notes || ""}
            onSave={(v) => onPatch({ management_approach: { ...(proposal.management_approach || {}), notes: v } })}
          />
          <NoteSection
            label="Transition plan notes"
            value={proposal.transition_plan?.notes || ""}
            onSave={(v) => onPatch({ transition_plan: { ...(proposal.transition_plan || {}), notes: v } })}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-md p-3 ${highlight ? "border-primary bg-primary/5" : "border-border"}`}>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-lg font-mono font-semibold ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1">{label}</div>
      <Input type="number" min={0} step="0.1" value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 text-xs" />
    </div>
  );
}

function NoteSection({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(value);
  const t = useRef<any>(null);
  useEffect(() => setVal(value), [value]);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium hover:text-primary w-full text-left py-1">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
        {value && <span className="text-[10px] text-muted-foreground">({value.split(/\s+/).filter(Boolean).length} words)</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Textarea
          value={val}
          onChange={(e) => {
            const v = e.target.value;
            setVal(v);
            if (t.current) clearTimeout(t.current);
            t.current = setTimeout(() => onSave(v), 600);
          }}
          className="min-h-[120px] text-xs mt-1"
          placeholder={`Capture ${label.toLowerCase()}…`}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
