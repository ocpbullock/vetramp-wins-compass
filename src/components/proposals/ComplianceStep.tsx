import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Download, ShieldCheck, AlertTriangle, ChevronDown, ChevronRight, Search, CheckCircle2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useTeam, type TeamMember } from "@/lib/team";

type ReqStatus = "not_started" | "in_progress" | "drafted" | "reviewed" | "final";

const STATUS_LABELS: Record<ReqStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  drafted: "Drafted",
  reviewed: "Reviewed",
  final: "Final",
};

const STATUS_ORDER: ReqStatus[] = ["not_started", "in_progress", "drafted", "reviewed", "final"];

const STATUS_COLOR: Record<ReqStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  drafted: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  reviewed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  final: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300",
};

const STATUS_BAR: Record<ReqStatus, string> = {
  not_started: "bg-muted-foreground/40",
  in_progress: "bg-blue-500",
  drafted: "bg-amber-500",
  reviewed: "bg-emerald-500",
  final: "bg-emerald-600",
};

function initials(member?: TeamMember | null) {
  if (!member) return "?";
  const src = member.display_name || member.email || "";
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function ComplianceStep({
  proposal,
  onPatch,
  onGoToIntake,
}: {
  proposal: any;
  onPatch: (patch: any) => Promise<void> | void;
  onGoToIntake: () => void;
}) {
  const { teamMembers } = useTeam();
  const matrix = proposal.compliance_matrix || {};
  const reqs: any[] = useMemo(() => matrix.requirements || [], [matrix.requirements]);
  const hasMatrix = reqs.length > 0 || !!matrix.summary;

  // Debounced save of the matrix
  const saveTimer = useRef<any>(null);
  const pendingMatrix = useRef<any>(null);
  function scheduleSave(nextMatrix: any) {
    pendingMatrix.current = nextMatrix;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onPatch({ compliance_matrix: pendingMatrix.current });
    }, 500);
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  function updateReq(reqId: string, patch: Record<string, any>) {
    const next = {
      ...matrix,
      requirements: reqs.map((r) => (r.req_id === reqId ? { ...r, ...patch } : r)),
    };
    scheduleSave(next);
  }

  // Filters
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fType, setFType] = useState<string>("all");
  const [fAssignee, setFAssignee] = useState<string>("all");
  const [fSection, setFSection] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sections = useMemo(() => {
    const s = new Set<string>();
    for (const r of reqs) if (r.proposal_section) s.add(r.proposal_section);
    return Array.from(s).sort();
  }, [reqs]);

  const types = useMemo(() => {
    const s = new Set<string>();
    for (const r of reqs) if (r.type) s.add(r.type);
    return Array.from(s).sort();
  }, [reqs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reqs.filter((r) => {
      const status = (r.status as ReqStatus) || "not_started";
      if (fStatus !== "all" && status !== fStatus) return false;
      if (fType !== "all" && r.type !== fType) return false;
      if (fAssignee !== "all") {
        if (fAssignee === "unassigned" ? !!r.assignee_id : r.assignee_id !== fAssignee) return false;
      }
      if (fSection !== "all") {
        if (fSection === "unmapped" ? !!r.proposal_section : r.proposal_section !== fSection) return false;
      }
      if (q && !String(r.requirement_text || "").toLowerCase().includes(q) && !String(r.req_id || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [reqs, search, fStatus, fType, fAssignee, fSection]);

  // Dashboard stats
  const stats = useMemo(() => {
    const total = reqs.length;
    const counts: Record<ReqStatus, number> = { not_started: 0, in_progress: 0, drafted: 0, reviewed: 0, final: 0 };
    const bySection: Record<string, { total: number; unaddressed: number }> = {};
    for (const r of reqs) {
      const s = ((r.status as ReqStatus) || "not_started");
      counts[s]++;
      const sec = r.proposal_section || "unmapped";
      bySection[sec] ||= { total: 0, unaddressed: 0 };
      bySection[sec].total++;
      if (s === "not_started") bySection[sec].unaddressed++;
    }
    const addressed = total - counts.not_started;
    const pct = total ? Math.round((addressed / total) * 100) : 0;
    const sectionRows = Object.entries(bySection).sort((a, b) => b[1].unaddressed - a[1].unaddressed);
    return { total, addressed, pct, counts, sectionRows };
  }, [reqs]);

  function exportMatrixCsv() {
    const rows = [["Req ID", "Source", "Type", "Category", "Requirement", "Proposal Section", "Status", "Assignee", "Response Notes"]];
    const memberById = new Map(teamMembers.map((m) => [m.user_id, m]));
    for (const r of reqs) {
      const m = r.assignee_id ? memberById.get(r.assignee_id) : null;
      rows.push([
        r.req_id, r.source_section, r.type, r.category || "", r.requirement_text, r.proposal_section || "",
        STATUS_LABELS[(r.status as ReqStatus) || "not_started"],
        m ? (m.display_name || m.email || "") : "",
        r.response_notes || "",
      ]);
    }
    const csv = rows.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `compliance-matrix-${proposal.solicitation_number}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!hasMatrix) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Compliance matrix</CardTitle>
          <CardDescription className="text-xs">Auto-parsed from your uploaded SOW/PWS, Section L, Section M, and amendments.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-dashed border-border rounded-md p-6 text-center space-y-3">
            <AlertTriangle className="w-6 h-6 text-yellow-500 mx-auto" />
            <div className="text-sm">Documents haven't been parsed yet — go to Intake to upload and parse your SOW/PWS.</div>
            <Button size="sm" onClick={onGoToIntake}><ArrowLeft className="w-4 h-4 mr-1" />Go to Intake</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const memberById = new Map(teamMembers.map((m) => [m.user_id, m]));

  return (
    <div className="space-y-4">
      {/* Dashboard summary */}
      {reqs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Compliance dashboard</CardTitle>
            <CardDescription className="text-xs">Track response status across all extracted requirements.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border border-border rounded-md p-3">
                <div className="text-xs text-muted-foreground">Total requirements</div>
                <div className="text-2xl font-semibold">{stats.total}</div>
              </div>
              <div className="border border-border rounded-md p-3">
                <div className="text-xs text-muted-foreground">Addressed</div>
                <div className="text-2xl font-semibold">{stats.pct}%</div>
                <div className="text-[10px] text-muted-foreground">{stats.addressed} of {stats.total}</div>
              </div>
              <div className="border border-border rounded-md p-3 col-span-2">
                <div className="text-xs text-muted-foreground mb-1">By status</div>
                <div className="flex h-3 rounded overflow-hidden bg-muted">
                  {STATUS_ORDER.map((s) => stats.counts[s] > 0 && (
                    <div key={s} className={STATUS_BAR[s]} style={{ width: `${(stats.counts[s] / stats.total) * 100}%` }} title={`${STATUS_LABELS[s]}: ${stats.counts[s]}`} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
                  {STATUS_ORDER.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1">
                      <span className={`inline-block w-2 h-2 rounded ${STATUS_BAR[s]}`} />
                      {STATUS_LABELS[s]} {stats.counts[s]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {stats.sectionRows.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Unaddressed by proposal section</div>
                <div className="space-y-1">
                  {stats.sectionRows.slice(0, 6).map(([sec, v]) => (
                    <div key={sec} className="flex items-center gap-2 text-xs">
                      <div className="w-40 truncate">{sec}</div>
                      <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-destructive" style={{ width: `${(v.unaddressed / Math.max(1, v.total)) * 100}%` }} />
                      </div>
                      <div className="w-20 text-right font-mono text-[10px] text-muted-foreground">{v.unaddressed}/{v.total}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Compliance matrix</CardTitle>
            <CardDescription className="text-xs">Auto-parsed from your uploaded SOW/PWS. Re-parse from the Intake step if documents change.</CardDescription>
          </div>
          <div className="flex gap-2">
            {reqs.length > 0 && <Button onClick={exportMatrixCsv} variant="outline" size="sm"><Download className="w-4 h-4 mr-1" />Export CSV</Button>}
            <Button onClick={onGoToIntake} variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Re-parse in Intake</Button>
          </div>
        </CardHeader>
        <CardContent>
          {matrix.summary && <p className="text-sm mb-3 leading-relaxed">{matrix.summary}</p>}
        </CardContent>
      </Card>

      {matrix.evaluation_factors?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Section M — Evaluation factors</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {matrix.evaluation_factors.map((f: any, i: number) => (
              <div key={i} className="border border-border rounded px-2 py-1.5"><span className="font-semibold">{f.factor}</span>{f.weight && <Badge variant="outline" className="ml-2 text-[10px]">{f.weight}</Badge>}{f.description && <div className="text-muted-foreground mt-0.5">{f.description}</div>}</div>
            ))}
          </CardContent>
        </Card>
      )}

      {matrix.submission_instructions?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Section L — Submission instructions</CardTitle></CardHeader>
          <CardContent><ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">{matrix.submission_instructions.map((s: string, i: number) => <li key={i}>{s}</li>)}{matrix.page_limits?.map((p: string, i: number) => <li key={`p${i}`} className="text-foreground">{p}</li>)}</ul></CardContent>
        </Card>
      )}

      {reqs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Requirements traceability</CardTitle>
            <CardDescription className="text-xs">Click a row to draft a response. Changes save automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Filter bar */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search requirements…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-7 text-xs" />
              </div>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fType} onValueChange={setFType}>
                <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fAssignee} onValueChange={setFAssignee}>
                <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Assignee" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assignees</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.display_name || m.email}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fSection} onValueChange={setFSection}>
                <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue placeholder="Section" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  <SelectItem value="unmapped">Unmapped</SelectItem>
                  {sections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="border border-border rounded-md divide-y divide-border">
              <div className="grid grid-cols-[1.25rem_5rem_5rem_4rem_1fr_8rem_8rem_2rem] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted">
                <div></div><div>ID</div><div>Source</div><div>Type</div><div>Requirement</div><div>Section</div><div>Status</div><div>Owner</div>
              </div>
              {filtered.map((r: any) => {
                const status: ReqStatus = (r.status as ReqStatus) || "not_started";
                const isOpen = !!expanded[r.req_id];
                const member = r.assignee_id ? memberById.get(r.assignee_id) : null;
                return (
                  <div key={r.req_id}>
                    <div
                      className="grid grid-cols-[1.25rem_5rem_5rem_4rem_1fr_8rem_8rem_2rem] gap-2 px-2 py-2 text-xs items-center hover:bg-accent/40 cursor-pointer"
                      onClick={() => setExpanded((e) => ({ ...e, [r.req_id]: !e[r.req_id] }))}
                    >
                      <div className="text-muted-foreground">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</div>
                      <div className="font-mono text-[10px]">{r.req_id}</div>
                      <div className="text-[10px] truncate">{r.source_section}</div>
                      <div><Badge variant="outline" className="text-[10px]">{r.type}</Badge></div>
                      <div className="truncate" title={r.requirement_text}>{r.requirement_text}</div>
                      <div>
                        {r.proposal_section
                          ? <Badge variant="secondary" className="text-[10px]">{r.proposal_section}</Badge>
                          : <Badge className="bg-destructive text-[10px]">unmapped</Badge>}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Select value={status} onValueChange={(v) => updateReq(r.req_id, { status: v })}>
                          <SelectTrigger className={`h-7 text-[10px] ${STATUS_COLOR[status]}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STATUS_ORDER.map((s) => <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        {member ? (
                          <Avatar className="w-6 h-6"><AvatarFallback className="text-[10px]">{initials(member)}</AvatarFallback></Avatar>
                        ) : (
                          <Avatar className="w-6 h-6"><AvatarFallback className="text-[10px] text-muted-foreground">?</AvatarFallback></Avatar>
                        )}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="px-3 py-3 bg-muted/30 space-y-2">
                        <div className="text-xs leading-relaxed">{r.requirement_text}</div>
                        <div className="flex flex-wrap gap-3 items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">Assignee</span>
                            <Select
                              value={r.assignee_id || "none"}
                              onValueChange={(v) => updateReq(r.req_id, { assignee_id: v === "none" ? null : v })}
                            >
                              <SelectTrigger className="h-7 text-xs w-[200px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Unassigned</SelectItem>
                                {teamMembers.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.display_name || m.email}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-1">Draft response — fed into AI generation for {r.proposal_section || "this section"}</div>
                          <ResponseEditor
                            initial={r.response_notes || ""}
                            onChange={(val) => updateReq(r.req_id, { response_notes: val })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">No requirements match the current filters.</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResponseEditor({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
  const [val, setVal] = useState(initial);
  const timer = useRef<any>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Textarea
      value={val}
      placeholder="Draft your response to this requirement…"
      className="min-h-[100px] text-xs"
      onChange={(e) => {
        const v = e.target.value;
        setVal(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(v), 500);
      }}
    />
  );
}
