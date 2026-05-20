import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Crosshair, BarChart3, ExternalLink, Swords, FileSignature, Users, FolderOpen } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { CreateOpportunityTeamDialog } from "./CreateOpportunityTeamDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { differenceInCalendarDays, parseISO, format } from "date-fns";
import {
  TrackOpportunityDialog,
  CONTRACT_VEHICLES,
  TRACKED_STATUSES,
  type TrackedOpportunity,
} from "./TrackOpportunityDialog";
import { TrackedAnalyzePanel } from "./TrackedAnalyzePanel";
import { NAICS_GROUPS } from "@/lib/contracts";
import type { HistoricalAward, SamOpportunity } from "@/lib/api";
import { StarButton } from "./StarButton";

// Build a SamOpportunity-shaped object from a tracked opportunity so the
// existing Compete/Propose flows (which expect a SamOpportunity) can be reused.
function trackedToOpp(t: TrackedOpportunity): SamOpportunity {
  const path = [t.agency, t.sub_agency].filter(Boolean).join(".");
  return {
    noticeId: `tracked:${t.id}`,
    solicitationNumber: `tracked-${t.id.slice(0, 8)}`,
    title: t.title,
    fullParentPathName: path,
    naicsCode: t.naics_code,
    classificationCode: undefined,
    typeOfSetAside: undefined,
    setAside: undefined,
    responseDeadLine: t.response_deadline ?? undefined,
    postedDate: t.created_at,
    description: t.description ?? "",
    uiLink: t.source_url ?? undefined,
    type: t.contract_vehicle,
  } as unknown as SamOpportunity;
}

const NAICS_NAME = new Map(NAICS_GROUPS.flatMap((g) => g.codes.map((c) => [c.code, c.name])));

const STATUS_VARIANTS: Record<string, string> = {
  Watching: "bg-muted text-muted-foreground border-border",
  Preparing: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  Submitted: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  Won: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  Lost: "bg-red-500/15 text-red-600 border-red-500/30",
  "No-Bid": "bg-muted text-muted-foreground border-border opacity-70",
};

const fmtMoney = (n: number | null) => {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

function deadlineColor(d: string | null): string {
  if (!d) return "text-muted-foreground";
  try {
    const days = differenceInCalendarDays(parseISO(d), new Date());
    if (days < 0) return "text-muted-foreground line-through";
    if (days <= 7) return "text-red-600 font-semibold";
    if (days <= 14) return "text-amber-600 font-medium";
    return "text-emerald-700";
  } catch { return ""; }
}

export function TrackedOpportunitiesTab({
  awards = [],
  onCompete,
  onPropose,
}: {
  awards?: HistoricalAward[];
  onCompete?: (opp: SamOpportunity) => void;
  onPropose?: (opp: SamOpportunity, trackedId: string) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<TrackedOpportunity[]>([]);
  const [proposalByTracked, setProposalByTracked] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TrackedOpportunity | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TrackedOpportunity | null>(null);
  const [analyze, setAnalyze] = useState<TrackedOpportunity | null>(null);
  const [teamRow, setTeamRow] = useState<TrackedOpportunity | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Pick up a "highlight this row" hint stashed by InProgressTab so the user
  // sees which tracked opportunity their proposal came from.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("dash:highlight");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { source: string; id: string };
      if (parsed.source !== "tracked") return;
      sessionStorage.removeItem("dash:highlight");
      setHighlightId(parsed.id);
      const el = document.querySelector(`[data-tracked-id="${parsed.id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => setHighlightId(null), 4000);
      return () => clearTimeout(t);
    } catch { /* ignore */ }
  }, [items]);

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterVehicle, setFilterVehicle] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("deadline");
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("tracked_opportunities")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const rows = (data ?? []) as TrackedOpportunity[];
    setItems(rows);
    // Look up existing proposals for these tracked opps so we can offer
    // "Open existing proposal" instead of silently creating a duplicate.
    // RLS scopes results to proposals the caller can already see.
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const { data: props } = await supabase
        .from("proposals")
        .select("id, opportunity_source_id, created_at")
        .eq("opportunity_source", "tracked")
        .in("opportunity_source_id", ids)
        .order("created_at", { ascending: true });
      const map: Record<string, string> = {};
      const dupes = new Set<string>();
      for (const p of props ?? []) {
        const k = p.opportunity_source_id as string | null;
        if (!k) continue;
        if (map[k]) dupes.add(k); else map[k] = p.id;
      }
      setProposalByTracked(map);
      if (dupes.size > 0) {
        // Non-destructive: just surface the duplicates so a human can decide.
        // eslint-disable-next-line no-console
        console.warn("[tracked-opps] duplicate proposals detected for", Array.from(dupes));
      }
    } else {
      setProposalByTracked({});
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const agencySuggestions = useMemo(() => {
    const set = new Set<string>();
    awards.forEach((a) => {
      if (a["Awarding Agency"]) set.add(a["Awarding Agency"]!);
      if (a["Awarding Sub Agency"]) set.add(a["Awarding Sub Agency"]!);
    });
    items.forEach((i) => set.add(i.agency));
    return Array.from(set).sort();
  }, [awards, items]);

  const updateStatus = async (id: string, status: string) => {
    const prev = items;
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status } : i)));
    const { error } = await supabase.from("tracked_opportunities").update({ status }).eq("id", id);
    if (error) { setItems(prev); toast.error(error.message); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from("tracked_opportunities").delete().eq("id", confirmDelete.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed");
    setConfirmDelete(null);
    load();
  };

  const filtered = useMemo(() => {
    let out = items.slice();
    if (filterStatus !== "all") out = out.filter((i) => i.status === filterStatus);
    if (filterVehicle !== "all") out = out.filter((i) => i.contract_vehicle === filterVehicle);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        i.agency.toLowerCase().includes(q) ||
        i.naics_code.includes(q),
      );
    }
    out.sort((a, b) => {
      if (sortBy === "deadline") {
        const av = a.response_deadline ?? "9999-12-31";
        const bv = b.response_deadline ?? "9999-12-31";
        return av.localeCompare(bv);
      }
      if (sortBy === "value") return (b.estimated_value ?? 0) - (a.estimated_value ?? 0);
      if (sortBy === "agency") return a.agency.localeCompare(b.agency);
      return b.created_at.localeCompare(a.created_at);
    });
    return out;
  }, [items, filterStatus, filterVehicle, search, sortBy]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-primary" />
            Tracked Opportunities
          </h2>
          <p className="text-xs text-muted-foreground">
            Manually-tracked opportunities (GSA eBuy, IDIQ task orders, BPA calls, agency RFQs).
          </p>
        </div>
        <div className="flex-1" />
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> Track Opportunity
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search title, agency, NAICS..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-9"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TRACKED_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterVehicle} onValueChange={setFilterVehicle}>
          <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Vehicle" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vehicles</SelectItem>
            {CONTRACT_VEHICLES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="deadline">Sort: Deadline</SelectItem>
            <SelectItem value="value">Sort: Value</SelectItem>
            <SelectItem value="agency">Sort: Agency</SelectItem>
            <SelectItem value="created">Sort: Recently added</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {items.length}
        </div>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Actions</TableHead>
              <TableHead>Title / Agency</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>NAICS</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">Loading...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">
                  {items.length === 0
                    ? "No tracked opportunities yet. Click \"Track Opportunity\" to add one."
                    : "No matches for the current filters."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((i) => {
              const vehicle = i.contract_vehicle === "Custom/Other" && i.contract_vehicle_other
                ? i.contract_vehicle_other
                : i.contract_vehicle;
              return (
                <TableRow
                  key={i.id}
                  data-tracked-id={i.id}
                  className={highlightId === i.id ? "bg-amber-100/60 dark:bg-amber-500/10 ring-1 ring-amber-400/60" : undefined}
                >
                  <TableCell className="w-[220px]">
                    <div className="flex items-center gap-1">
                      <StarButton
                        input={{
                          noticeId: `tracked:${i.id}`,
                          title: i.title,
                          naicsCode: i.naics_code,
                          responseDeadline: i.response_deadline ?? null,
                          setAsideDescription: null,
                          sourceData: i,
                        }}
                      />
                      {onCompete && (
                        <Button size="sm" variant="ghost" onClick={() => onCompete(trackedToOpp(i))} title="Competitive intel">
                          <Swords className="w-4 h-4 text-primary" />
                        </Button>
                      )}
                      {proposalByTracked[i.id] ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate({ to: "/proposals/$proposalId", params: { proposalId: proposalByTracked[i.id] } })}
                          title="Open existing team proposal workspace"
                        >
                          <FolderOpen className="w-4 h-4 text-primary" />
                        </Button>
                      ) : onPropose && (
                        <Button size="sm" variant="ghost" onClick={() => onPropose(trackedToOpp(i), i.id)} title="Start proposal">
                          <FileSignature className="w-4 h-4 text-money" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setAnalyze(i)} title="Analyze with USAspending">
                        <BarChart3 className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTeamRow(i)} title="Create opportunity team">
                        <Users className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(i); setDialogOpen(true); }} title="Edit">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(i)} title="Delete">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[340px]">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      {i.title}
                      {i.source_url && (
                        <a href={i.source_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {i.agency}{i.sub_agency ? ` · ${i.sub_agency}` : ""}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="font-normal">{vehicle}</Badge></TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{i.naics_code}</div>
                    <div className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                      {NAICS_NAME.get(i.naics_code) ?? ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(i.estimated_value)}</TableCell>
                  <TableCell className={`text-sm ${deadlineColor(i.response_deadline)}`}>
                    {i.response_deadline ? format(parseISO(i.response_deadline), "MMM d, yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    <Select value={i.status} onValueChange={(v) => updateStatus(i.id, v)}>
                      <SelectTrigger className={`h-7 px-2 text-xs border ${STATUS_VARIANTS[i.status] ?? ""}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRACKED_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <TrackOpportunityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        agencySuggestions={agencySuggestions}
        onSaved={load}
      />

      <TrackedAnalyzePanel
        open={!!analyze}
        onClose={() => setAnalyze(null)}
        naicsCode={analyze?.naics_code ?? null}
        agency={analyze?.agency ?? null}
        title={analyze?.title ?? null}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tracked opportunity?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes "{confirmDelete?.title}" from your tracked list. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {teamRow && (
        <CreateOpportunityTeamDialog
          open={!!teamRow}
          onOpenChange={(o) => { if (!o) setTeamRow(null); }}
          opportunityTitle={teamRow.title}
          source="tracked"
          sourceId={teamRow.id}
          agency={teamRow.agency}
          naicsCode={teamRow.naics_code}
          responseDeadline={teamRow.response_deadline ?? null}
        />
      )}
    </div>
  );
}
