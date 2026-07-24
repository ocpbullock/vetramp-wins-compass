import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { StoplightDot, STOPLIGHT_LABEL } from "@/components/StoplightDot";

export type MatrixRating = "strong" | "moderate" | "weak" | "unknown";
export type MatrixThreat = "very_high" | "high" | "medium" | "low";

export type MatrixRow = {
  company: string;
  isUs: boolean;
  threat: MatrixThreat;
  ratings: Record<string, MatrixRating>;
  coverage: string;
};

export type PositioningMatrix = {
  updatedAt: string;
  dimensions: string[];
  rows: MatrixRow[];
};

export const DEFAULT_DIMENSIONS = [
  "Technical Capability",
  "Workforce & Staffing",
  "Relevant Past Performance",
  "Operational Scale",
];

const RATING_CYCLE: MatrixRating[] = ["strong", "moderate", "weak", "unknown"];
const RATING_LABEL = STOPLIGHT_LABEL;
const THREAT_LABEL: Record<MatrixThreat, string> = {
  very_high: "Very High", high: "High", medium: "Medium", low: "Low",
};
const THREAT_BADGE: Record<MatrixThreat, string> = {
  very_high: "bg-red-600 text-white",
  high: "bg-red-500/90 text-white",
  medium: "bg-amber-500 text-white",
  low: "bg-emerald-600 text-white",
};

function emptyMatrix(): PositioningMatrix {
  return { updatedAt: new Date().toISOString(), dimensions: [...DEFAULT_DIMENSIONS], rows: [] };
}

function normalize(m: any | null): PositioningMatrix {
  if (!m || typeof m !== "object") return emptyMatrix();
  const dims: string[] = Array.isArray(m.dimensions) && m.dimensions.length
    ? (m.dimensions as any[]).slice(0, 6).map((d) => String(d))
    : [...DEFAULT_DIMENSIONS];
  const rows: MatrixRow[] = Array.isArray(m.rows) ? m.rows.map((r: any) => ({
    company: String(r?.company ?? ""),
    isUs: !!r?.isUs,
    threat: (["very_high","high","medium","low"].includes(r?.threat) ? r.threat : "medium") as MatrixThreat,
    ratings: dims.reduce((acc: Record<string, MatrixRating>, d: string) => {
      const v = r?.ratings?.[d];
      acc[d] = (RATING_CYCLE as string[]).includes(v) ? v : "unknown";
      return acc;
    }, {} as Record<string, MatrixRating>),
    coverage: String(r?.coverage ?? ""),
  })) : [];
  return { updatedAt: m.updatedAt ?? new Date().toISOString(), dimensions: dims, rows };
}

export function PositioningMatrixCard({ proposal, proposalId }: { proposal: any; proposalId: string }) {
  const qc = useQueryClient();
  const [matrix, setMatrix] = useState<PositioningMatrix>(() => normalize(proposal?.positioning_matrix));
  const [prefilling, setPrefilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const initial = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reload when server row changes (e.g. after AI prefill).
  useEffect(() => {
    setMatrix(normalize(proposal?.positioning_matrix));
    initial.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.positioning_matrix]);

  const persist = async (next: PositioningMatrix) => {
    setSaving(true);
    try {
      const payload = { ...next, updatedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("proposals")
        .update({ positioning_matrix: payload as any })
        .eq("id", proposalId);
      if (error) throw error;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save matrix");
    } finally {
      setSaving(false);
    }
  };

  // Debounced autosave on edits (not on first mount).
  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void persist(matrix); }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix]);

  const setRows = (fn: (rows: MatrixRow[]) => MatrixRow[]) =>
    setMatrix((m) => ({ ...m, rows: fn(m.rows) }));

  const addRow = () => setRows((rows) => [
    ...rows,
    {
      company: "",
      isUs: false,
      threat: "medium",
      ratings: matrix.dimensions.reduce((a: Record<string, MatrixRating>, d: string) => { a[d] = "unknown"; return a; }, {} as Record<string, MatrixRating>),
      coverage: "",
    },
  ]);

  const removeRow = (i: number) => setRows((rows) => rows.filter((_, idx) => idx !== i));
  const moveRow = (i: number, dir: -1 | 1) => setRows((rows) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return rows;
    const copy = rows.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  const cycleRating = (i: number, dim: string) => setRows((rows) => rows.map((r, idx) => {
    if (idx !== i) return r;
    const cur = r.ratings[dim] ?? "unknown";
    const next = RATING_CYCLE[(RATING_CYCLE.indexOf(cur) + 1) % RATING_CYCLE.length];
    return { ...r, ratings: { ...r.ratings, [dim]: next } };
  }));

  const addDimension = () => setMatrix((m) => {
    if (m.dimensions.length >= 6) { toast.warning("Maximum 6 dimensions"); return m; }
    const name = `Dimension ${m.dimensions.length + 1}`;
    return {
      ...m,
      dimensions: [...m.dimensions, name],
      rows: m.rows.map((r) => ({ ...r, ratings: { ...r.ratings, [name]: "unknown" } })),
    };
  });

  const removeDimension = (dim: string) => setMatrix((m) => ({
    ...m,
    dimensions: m.dimensions.filter((d) => d !== dim),
    rows: m.rows.map((r) => {
      const { [dim]: _drop, ...rest } = r.ratings;
      return { ...r, ratings: rest };
    }),
  }));

  const renameDimension = (oldName: string, newName: string) => setMatrix((m) => {
    const clean = newName.trim();
    if (!clean || clean === oldName) return m;
    if (m.dimensions.includes(clean)) return m;
    return {
      ...m,
      dimensions: m.dimensions.map((d) => (d === oldName ? clean : d)),
      rows: m.rows.map((r) => {
        const { [oldName]: v, ...rest } = r.ratings;
        return { ...r, ratings: { ...rest, [clean]: v ?? "unknown" } };
      }),
    };
  });

  const runPrefill = async () => {
    setPrefilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("capture-analysis", {
        body: { proposalId, mode: "positioning_matrix" },
      });
      if (error) throw error;
      const returned = (data as any)?.matrix;
      if (!returned) throw new Error("No matrix returned");
      const merged = normalize({ ...returned, dimensions: returned.dimensions ?? matrix.dimensions });
      setMatrix(merged);
      await persist(merged);
      await qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
      toast.success("Matrix prefilled — every value is editable");
    } catch (e: any) {
      toast.error(e?.message ?? "Prefill failed");
    } finally {
      setPrefilling(false);
    }
  };

  const hasContent = matrix.rows.length > 0;

  const PrefillButton = (
    <Button size="sm" variant="outline" disabled={prefilling} onClick={hasContent ? undefined : runPrefill}>
      {prefilling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
      AI prefill
    </Button>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
        <div>
          <CardTitle className="text-base">Competitive Positioning Matrix</CardTitle>
          <CardDescription>
            Briefing-grade stoplight grid. Click any dot to cycle. {saving && <span className="ml-1 text-xs">Saving…</span>}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasContent ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>{PrefillButton}</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Overwrite the matrix?</AlertDialogTitle>
                  <AlertDialogDescription>
                    AI prefill will replace the current rows, threat levels, and ratings using the market snapshot,
                    capture analysis, and proprietary intel. You can still edit every value afterward.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={runPrefill}>Overwrite</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : PrefillButton}
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="w-4 h-4 mr-1" /> Add row
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {(["strong","moderate","weak","unknown"] as MatrixRating[]).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <StoplightDot rating={r} size="md" /> {RATING_LABEL[r]}
            </span>
          ))}
          <span className="ml-auto">{matrix.rows.length} row(s) · {matrix.dimensions.length}/6 dimensions</span>
        </div>

        {!hasContent ? (
          <div className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
            No positioning matrix yet. Add rows manually or use AI prefill to seed from the market snapshot.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-2 font-medium min-w-[180px]">Company</th>
                  <th className="text-left p-2 font-medium w-[140px]">Threat</th>
                  {matrix.dimensions.map((dim) => (
                    <th key={dim} className="p-2 font-medium min-w-[130px]">
                      <div className="flex items-center gap-1">
                        <Input
                          value={dim}
                          onChange={(e) => renameDimension(dim, e.target.value)}
                          onBlur={(e) => renameDimension(dim, e.target.value)}
                          className="h-7 text-xs px-1.5"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => removeDimension(dim)}
                          title="Remove dimension"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </th>
                  ))}
                  <th className="p-2 font-medium min-w-[220px]">Overall Coverage</th>
                  <th className="p-2 w-[90px]"></th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row, i) => (
                  <tr key={i} className={`border-b align-top ${row.isUs ? "bg-primary/5" : ""}`}>
                    <td className="p-2">
                      <Input
                        value={row.company}
                        onChange={(e) => setRows((rows) => rows.map((r, idx) => idx === i ? { ...r, company: e.target.value } : r))}
                        className="h-8"
                        placeholder="Company name"
                      />
                      <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={row.isUs}
                          onChange={(e) => setRows((rows) => rows.map((r, idx) => idx === i ? { ...r, isUs: e.target.checked } : r))}
                        />
                        Our team
                      </label>
                    </td>
                    <td className="p-2">
                      <Select
                        value={row.threat}
                        onValueChange={(v) => setRows((rows) => rows.map((r, idx) => idx === i ? { ...r, threat: v as MatrixThreat } : r))}
                      >
                        <SelectTrigger className={`h-8 text-xs ${THREAT_BADGE[row.threat]} border-0`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["very_high","high","medium","low"] as MatrixThreat[]).map((t) => (
                            <SelectItem key={t} value={t}>{THREAT_LABEL[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    {matrix.dimensions.map((dim) => {
                      const val = row.ratings[dim] ?? "unknown";
                      return (
                        <td key={dim} className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => cycleRating(i, dim)}
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${RATING_COLOR[val]} hover:scale-110 transition-transform`}
                            title={`${dim}: ${RATING_LABEL[val]} (click to cycle)`}
                            aria-label={`${dim}: ${RATING_LABEL[val]}`}
                          />
                        </td>
                      );
                    })}
                    <td className="p-2">
                      <Input
                        value={row.coverage}
                        onChange={(e) => setRows((rows) => rows.map((r, idx) => idx === i ? { ...r, coverage: e.target.value } : r))}
                        className="h-8"
                        placeholder="Overall coverage narrative"
                      />
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-0.5">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveRow(i, -1)} disabled={i === 0} title="Move up">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveRow(i, 1)} disabled={i === matrix.rows.length - 1} title="Move down">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeRow(i)} title="Remove row">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button size="sm" variant="ghost" onClick={addDimension} disabled={matrix.dimensions.length >= 6}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add dimension
          </Button>
          {matrix.updatedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(matrix.updatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
