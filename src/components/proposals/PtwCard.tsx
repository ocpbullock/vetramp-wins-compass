import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Sparkles, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, LabelList,
} from "recharts";
import { computePtw, type EvalRating, type PtwCompetitor, type PtwInputs } from "@/lib/ptw";

const RATINGS: EvalRating[] = ["outstanding", "good", "acceptable", "marginal", "unknown"];
const RATING_LABEL: Record<EvalRating, string> = {
  outstanding: "Outstanding", good: "Good", acceptable: "Acceptable", marginal: "Marginal", unknown: "Unknown",
};
const RATING_ABBR: Record<EvalRating, string> = {
  outstanding: "O", good: "G", acceptable: "A", marginal: "M", unknown: "?",
};

export type PtwAnalysis = {
  updatedAt: string;
  ourRatings: { technical: EvalRating; staffing: EvalRating };
  premiumCapPct: number;
  undercutPct: number;
  competitors: PtwCompetitor[];
};

function emptyAnalysis(): PtwAnalysis {
  return {
    updatedAt: new Date().toISOString(),
    ourRatings: { technical: "good", staffing: "good" },
    premiumCapPct: 10,
    undercutPct: 1,
    competitors: [],
  };
}

function normalize(a: any | null): PtwAnalysis {
  if (!a || typeof a !== "object") return emptyAnalysis();
  const base = emptyAnalysis();
  return {
    updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : base.updatedAt,
    ourRatings: {
      technical: RATINGS.includes(a?.ourRatings?.technical) ? a.ourRatings.technical : "good",
      staffing: RATINGS.includes(a?.ourRatings?.staffing) ? a.ourRatings.staffing : "good",
    },
    premiumCapPct: Number.isFinite(a?.premiumCapPct) ? Number(a.premiumCapPct) : 10,
    undercutPct: Number.isFinite(a?.undercutPct) ? Number(a.undercutPct) : 1,
    competitors: Array.isArray(a?.competitors) ? a.competitors.map((c: any) => ({
      name: String(c?.name ?? ""),
      tepM: c?.tepM == null || c?.tepM === "" ? null : Number(c.tepM),
      fte: c?.fte == null || c?.fte === "" ? null : Number(c.fte),
      ratingTechnical: RATINGS.includes(c?.ratingTechnical) ? c.ratingTechnical : "unknown",
      ratingStaffing: RATINGS.includes(c?.ratingStaffing) ? c.ratingStaffing : "unknown",
      note: c?.note ? String(c.note) : "",
    })) : [],
  };
}

export function PtwCard({ proposal, proposalId, readOnly = false }: { proposal: any; proposalId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = useState<PtwAnalysis>(() => normalize(proposal?.ptw_analysis));
  const [saving, setSaving] = useState(false);
  const initial = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setState(normalize(proposal?.ptw_analysis));
    initial.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.ptw_analysis]);

  const persist = async (next: PtwAnalysis) => {
    setSaving(true);
    try {
      const payload = { ...next, updatedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("proposals")
        .update({ ptw_analysis: payload as any })
        .eq("id", proposalId);
      if (error) throw error;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save PTW");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void persist(state); }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const setCompetitors = (fn: (cs: PtwCompetitor[]) => PtwCompetitor[]) =>
    setState((s) => ({ ...s, competitors: fn(s.competitors) }));

  const addRow = () => setCompetitors((cs) => [
    ...cs,
    { name: "", tepM: null, fte: null, ratingTechnical: "unknown", ratingStaffing: "unknown", note: "" },
  ]);
  const removeRow = (i: number) => setCompetitors((cs) => cs.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<PtwCompetitor>) =>
    setCompetitors((cs) => cs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const seedFromSources = () => {
    const matrix = (proposal as any)?.positioning_matrix;
    const snap = (proposal as any)?.market_snapshot;
    const seen = new Set<string>(state.competitors.map((c) => c.name.trim().toLowerCase()).filter(Boolean));
    const adds: PtwCompetitor[] = [];

    const compRows: any[] = Array.isArray(snap?.competitors) ? snap.competitors : [];
    const compByName = new Map<string, any>(compRows.map((c) => [String(c?.name ?? "").trim().toLowerCase(), c]));

    // From matrix (non-isUs)
    if (Array.isArray(matrix?.rows)) {
      for (const r of matrix.rows) {
        if (!r || r.isUs) continue;
        const name = String(r.company ?? "").trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        const mc = compByName.get(name.toLowerCase());
        const est = estimateTepM(mc);
        adds.push({
          name,
          tepM: est,
          fte: null,
          ratingTechnical: "unknown",
          ratingStaffing: "unknown",
          note: est != null ? "TEP estimated from historical awards — verify." : "",
        });
        seen.add(name.toLowerCase());
      }
    }
    // Fill in from snapshot competitors not already added
    for (const c of compRows.slice(0, 8)) {
      const name = String(c?.name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      const est = estimateTepM(c);
      adds.push({
        name,
        tepM: est,
        fte: null,
        ratingTechnical: "unknown",
        ratingStaffing: "unknown",
        note: est != null ? "TEP estimated from historical awards — verify." : "",
      });
      seen.add(name.toLowerCase());
    }

    if (adds.length === 0) {
      toast.info("Nothing new to seed from matrix or snapshot.");
      return;
    }
    setCompetitors((cs) => [...cs, ...adds]);
    toast.success(`Added ${adds.length} competitor${adds.length === 1 ? "" : "s"} — TEPs and ratings are editable.`);
  };

  const result = useMemo(() => {
    const inputs: PtwInputs = {
      competitors: state.competitors,
      ourRatings: state.ourRatings,
      premiumCapPct: state.premiumCapPct,
      undercutPct: state.undercutPct,
    };
    return computePtw(inputs);
  }, [state]);

  const scatterData = state.competitors
    .filter((c) => c.fte != null && Number.isFinite(c.fte) && c.tepM != null && Number.isFinite(c.tepM))
    .map((c) => ({
      x: Number(c.fte),
      y: Number(c.tepM),
      name: c.name || "—",
      label: `${c.name || "—"} (${RATING_ABBR[c.ratingTechnical]}/${RATING_ABBR[c.ratingStaffing]})`,
    }));

  const unplotted = state.competitors.filter(
    (c) => c.tepM != null && Number.isFinite(c.tepM) && (c.fte == null || !Number.isFinite(c.fte)),
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
        <div>
          <CardTitle className="text-base">Price-to-Win</CardTitle>
          <CardDescription>
            Bottom-up pricing analysis against the expected competitive field.
            {saving && <span className="ml-1 text-xs">Saving…</span>}
          </CardDescription>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={seedFromSources}>
              <Sparkles className="w-4 h-4 mr-1" /> Seed from matrix/snapshot
            </Button>
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus className="w-4 h-4 mr-1" /> Add competitor
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Our assumed ratings */}
        {!readOnly && (
          <div className="rounded-md border p-3 space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Our assumed ratings</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Technical</label>
                <Select
                  value={state.ourRatings.technical}
                  onValueChange={(v) => setState((s) => ({ ...s, ourRatings: { ...s.ourRatings, technical: v as EvalRating } }))}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RATINGS.map((r) => <SelectItem key={r} value={r}>{RATING_LABEL[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Staffing</label>
                <Select
                  value={state.ourRatings.staffing}
                  onValueChange={(v) => setState((s) => ({ ...s, ourRatings: { ...s.ourRatings, staffing: v as EvalRating } }))}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RATINGS.map((r) => <SelectItem key={r} value={r}>{RATING_LABEL[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Rating premium cap (%)</label>
                <Input
                  type="number" min={0} max={100} step={0.5}
                  className="h-8"
                  value={state.premiumCapPct}
                  onChange={(e) => setState((s) => ({ ...s, premiumCapPct: Number(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Undercut (%)</label>
                <Input
                  type="number" min={0} max={100} step={0.1}
                  className="h-8"
                  value={state.undercutPct}
                  onChange={(e) => setState((s) => ({ ...s, undercutPct: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>
        )}

        {/* Competitor table */}
        {readOnly ? (
          state.competitors.length === 0 ? (
            <div className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
              No competitors yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-2 min-w-[180px]">Competitor</th>
                    <th className="text-left p-2 w-[110px]">TEP ($M)</th>
                    <th className="text-left p-2 w-[110px]">FTE</th>
                    <th className="text-left p-2 w-[80px]">T / S</th>
                    <th className="text-left p-2 min-w-[200px]">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {state.competitors.map((c, i) => (
                    <tr key={i} className="border-b align-top">
                      <td className="p-2 text-sm font-medium truncate">{c.name || "—"}</td>
                      <td className="p-2 tabular-nums">{c.tepM == null ? "—" : `$${Number(c.tepM).toFixed(1)}M`}</td>
                      <td className="p-2 tabular-nums">{c.fte == null ? "—" : c.fte}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {RATING_ABBR[c.ratingTechnical]} / {RATING_ABBR[c.ratingStaffing]}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{c.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-2 min-w-[180px]">Competitor</th>
                  <th className="text-left p-2 w-[110px]">TEP ($M)</th>
                  <th className="text-left p-2 w-[110px]">Proposed FTE</th>
                  <th className="text-left p-2 w-[150px]">Technical</th>
                  <th className="text-left p-2 w-[150px]">Staffing</th>
                  <th className="text-left p-2 min-w-[200px]">Note</th>
                  <th className="p-2 w-[40px]"></th>
                </tr>
              </thead>
              <tbody>
                {state.competitors.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground text-xs">
                    No competitors yet. Add rows manually or seed from matrix/snapshot.
                  </td></tr>
                )}
                {state.competitors.map((c, i) => (
                  <tr key={i} className="border-b align-top">
                    <td className="p-2">
                      <Input value={c.name} onChange={(e) => updateRow(i, { name: e.target.value })} className="h-8" placeholder="Company" />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number" min={0} step={0.1} className="h-8"
                        value={c.tepM ?? ""}
                        onChange={(e) => updateRow(i, { tepM: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number" min={0} step={1} className="h-8"
                        value={c.fte ?? ""}
                        onChange={(e) => updateRow(i, { fte: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-2">
                      <Select value={c.ratingTechnical} onValueChange={(v) => updateRow(i, { ratingTechnical: v as EvalRating })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RATINGS.map((r) => <SelectItem key={r} value={r}>{RATING_LABEL[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2">
                      <Select value={c.ratingStaffing} onValueChange={(v) => updateRow(i, { ratingStaffing: v as EvalRating })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RATINGS.map((r) => <SelectItem key={r} value={r}>{RATING_LABEL[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2">
                      <Input value={c.note ?? ""} onChange={(e) => updateRow(i, { note: e.target.value })} className="h-8" placeholder="Notes / assumptions" />
                    </td>
                    <td className="p-2">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeRow(i)} title="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Chart + unplotted */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
          <div className="rounded-md border p-3 h-[320px]">
            {scatterData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-4">
                Add TEP and Proposed FTE to plot competitors. Ratings shown as (Technical/Staffing) — e.g. "O/G".
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    type="number" dataKey="x" name="FTE"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    stroke="var(--border)"
                    label={{ value: "Proposed FTE", position: "insideBottom", offset: -15, fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    type="number" dataKey="y" name="TEP"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    stroke="var(--border)"
                    label={{ value: "TEP ($M)", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3", stroke: "var(--border)" }}
                    contentStyle={{
                      background: "var(--card)",
                      color: "var(--card-foreground)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v: any, k: any) => k === "y" ? `$${Number(v).toFixed(2)}M` : v}
                  />
                  {result.scenarios.map((s, idx) => (
                    <ReferenceLine
                      key={idx}
                      y={s.recommendedTepM}
                      stroke="var(--chart-2)"
                      strokeDasharray="4 4"
                      strokeWidth={idx === 0 ? 2 : 1.25}
                      label={{
                        value: `${s.label}: $${s.recommendedTepM.toFixed(2)}M`,
                        fontSize: 10,
                        position: "insideTopRight",
                        fill: "var(--chart-2)",
                      }}
                    />
                  ))}
                  <Scatter data={scatterData} fill="var(--chart-1)">
                    <LabelList dataKey="label" position="top" style={{ fontSize: 10, fill: "var(--foreground)" }} />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Not plotted (no FTE)</div>
            {unplotted.length === 0 ? (
              <div className="text-xs text-muted-foreground">All priced competitors are plotted.</div>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {unplotted.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.name || "—"}</span>
                    <span className="text-muted-foreground shrink-0">
                      ${Number(c.tepM).toFixed(1)}M · {RATING_ABBR[c.ratingTechnical]}/{RATING_ABBR[c.ratingStaffing]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Recommendations */}
        <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-3 space-y-3">
          <div className="text-xs font-medium text-primary uppercase tracking-wide">Price-to-Win recommendations</div>
          {result.scenarios.length === 0 ? (
            <div className="text-sm text-muted-foreground">Add priced competitors to see recommendations.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {result.scenarios.map((s, i) => (
                <div key={i} className="rounded-md bg-background p-3 border">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="text-2xl font-bold mt-1">${s.recommendedTepM.toFixed(2)}M</div>
                  <div className="text-xs text-muted-foreground mt-2">{s.rationale}</div>
                </div>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {state.updatedAt && (
          <div className="text-xs text-muted-foreground text-right">
            Updated {new Date(state.updatedAt).toLocaleString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function estimateTepM(mc: any | undefined): number | null {
  if (!mc) return null;
  const avg = Number(mc.avgValue);
  if (Number.isFinite(avg) && avg > 0) return round2(avg / 1_000_000);
  const total = Number(mc.totalValue);
  const awards = Number(mc.awards);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(awards) && awards > 0) {
    return round2(total / awards / 1_000_000);
  }
  return null;
}
function round2(n: number) { return Math.round(n * 100) / 100; }
