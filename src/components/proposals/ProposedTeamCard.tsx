import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { AlertTriangle, Handshake, Info, Link2, Trash2, Users, X } from "lucide-react";
import { listPartnerCompanies, type PartnerView } from "@/lib/companies";
import type { PwinRole } from "@/lib/pwin";

const ROLES: { value: PwinRole; label: string }[] = [
  { value: "prime", label: "Prime" },
  { value: "sub", label: "Sub" },
  { value: "mentor", label: "Mentor" },
  { value: "protege", label: "Protégé" },
  { value: "jv_partner", label: "JV partner" },
];

type OutreachStatus =
  | "not_started" | "contacted" | "call_held" | "nda_signed" | "ta_signed" | "declined";

const OUTREACH_STATUSES: { value: OutreachStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "contacted", label: "Contacted" },
  { value: "call_held", label: "Call held" },
  { value: "nda_signed", label: "NDA signed" },
  { value: "ta_signed", label: "TA signed" },
  { value: "declined", label: "Declined" },
];

function outreachChipClass(s: OutreachStatus): string {
  switch (s) {
    case "not_started": return "bg-muted text-muted-foreground border-border";
    case "contacted": return "bg-primary/15 text-primary border-primary/30";
    case "call_held":
      return "border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_18%,transparent)] text-[color:var(--brand-brass)]";
    case "nda_signed":
    case "ta_signed":
      return "bg-success/15 text-success border-success/30";
    case "declined":
      return "bg-destructive/15 text-destructive border-destructive/30";
  }
}

export type TeamingEntry = {
  id: string;
  company_id: string;
  role: PwinRole;
  work_share_pct: number | null;
  outreach_status: OutreachStatus;
};

// ---------------------------------------------------------------------------
// Single source of truth: one query per proposal for proposal_teaming rows.
// ProposedTeamCard, TeamHubPanel's suggested-partners exclusion list, and
// useTeamingSummary in CaptureAnalysisPanel all share this key so optimistic
// mutations flow to every consumer at once.
// ---------------------------------------------------------------------------
export const teamingEntriesKey = (proposalId: string) =>
  ["capture-entries", proposalId] as const;

export async function fetchTeamingEntries(proposalId: string): Promise<TeamingEntry[]> {
  const { data, error } = await supabase
    .from("proposal_teaming")
    .select("id, company_id, role, work_share_pct, outreach_status")
    .eq("proposal_id", proposalId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamingEntry[];
}

const clampShare = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
};

export function ProposedTeamCard({
  proposalId,
  teamId,
  selfName,
  isSelfPrime,
  opportunityNaics,
  primeContractorId,
  primeContractorName,
  selfWorkSharePct,
  onSelfShareChange,
  onLinkPrime,
}: {
  proposalId: string;
  teamId: string;
  selfName: string;
  isSelfPrime: boolean;
  opportunityNaics: string | null;
  primeContractorId?: string | null;
  primeContractorName?: string | null;
  selfWorkSharePct?: number | null;
  onSelfShareChange?: (pct: number) => void;
  onLinkPrime?: () => void;
}) {
  const qc = useQueryClient();
  const ENTRIES_KEY = teamingEntriesKey(proposalId);

  const { data: entries = [] } = useQuery({
    queryKey: ENTRIES_KEY,
    queryFn: () => fetchTeamingEntries(proposalId),
    refetchOnWindowFocus: false,
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["capture-partners", teamId],
    enabled: !!teamId,
    queryFn: () => listPartnerCompanies(teamId),
    refetchOnWindowFocus: false,
  });

  const partnerById = useMemo(
    () => new Map(partners.map((p) => [p.id, p])),
    [partners],
  );

  const rosterPrime: PartnerView | null = useMemo(() => {
    if (isSelfPrime) return null;
    if (primeContractorId) {
      const byId = partnerById.get(primeContractorId);
      if (byId) return byId;
    }
    if (primeContractorName) {
      const lower = primeContractorName.toLowerCase();
      return partners.find((p) => (p.company_name ?? "").toLowerCase() === lower) ?? null;
    }
    return null;
  }, [isSelfPrime, primeContractorId, primeContractorName, partnerById, partners]);

  // Invalidate sibling caches (roster/suggestion lists). The authoritative
  // entries cache is already kept fresh via optimistic setQueryData.
  const invalidateSiblings = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["proposal-teaming", proposalId] });
    qc.invalidateQueries({ queryKey: ["pwin-entries", proposalId] });
    qc.invalidateQueries({ queryKey: ["proposed-team-entries", proposalId] });
    if (teamId) {
      qc.invalidateQueries({ queryKey: ["capture-partners", teamId] });
      qc.invalidateQueries({ queryKey: ["pwin-partners", teamId] });
      qc.invalidateQueries({ queryKey: ["suggest-partners", teamId] });
      qc.invalidateQueries({ queryKey: ["teaming-partners", teamId] });
    }
  }, [qc, proposalId, teamId]);

  // Serialize writes per-row so overlapping edits land in order.
  const chainMapRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const enqueuePerRow = useCallback(<T,>(id: string, fn: () => Promise<T>): Promise<T> => {
    const prev = chainMapRef.current.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    chainMapRef.current.set(id, next);
    return next;
  }, []);

  // ---- Mutations with proper optimistic + rollback + single settle ---------

  type PatchArgs = { id: string; patch: Partial<TeamingEntry> };
  const patchMutation = useMutation({
    mutationFn: async ({ id, patch }: PatchArgs) => {
      const { error } = await supabase
        .from("proposal_teaming")
        .update(patch as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const snapshot = qc.getQueryData<TeamingEntry[]>(ENTRIES_KEY);
      qc.setQueryData<TeamingEntry[]>(ENTRIES_KEY, (old = []) =>
        old.map((e) => (e.id === id ? { ...e, ...patch } as TeamingEntry : e)),
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(ENTRIES_KEY, ctx.snapshot);
      toast.error((err as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
      invalidateSiblings();
    },
  });

  const outreachMutation = useMutation({
    mutationFn: async ({ id, companyId, status }: { id: string; companyId: string; status: OutreachStatus }) => {
      const { error } = await supabase
        .from("proposal_teaming")
        .update({ outreach_status: status } as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
      if ((status === "nda_signed" || status === "ta_signed") && companyId) {
        const p: { has_nda: boolean; has_teaming_agreement?: boolean } = { has_nda: true };
        if (status === "ta_signed") p.has_teaming_agreement = true;
        await supabase.from("companies").update(p).eq("id", companyId);
      }
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const snapshot = qc.getQueryData<TeamingEntry[]>(ENTRIES_KEY);
      qc.setQueryData<TeamingEntry[]>(ENTRIES_KEY, (old = []) =>
        old.map((e) => (e.id === id ? { ...e, outreach_status: status } : e)),
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(ENTRIES_KEY, ctx.snapshot);
      toast.error((err as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
      invalidateSiblings();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("proposal_teaming").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const snapshot = qc.getQueryData<TeamingEntry[]>(ENTRIES_KEY);
      qc.setQueryData<TeamingEntry[]>(ENTRIES_KEY, (old = []) => old.filter((e) => e.id !== id));
      chainMapRef.current.delete(id);
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(ENTRIES_KEY, ctx.snapshot);
      toast.error((err as Error).message);
    },
    onSuccess: () => toast.success("Partner removed"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
      invalidateSiblings();
    },
  });

  // Immediate optimistic share update (fired on every keystroke).
  const setShareOptimistic = useCallback(
    (id: string, value: number) => {
      const n = clampShare(value);
      qc.cancelQueries({ queryKey: ENTRIES_KEY });
      qc.setQueryData<TeamingEntry[]>(ENTRIES_KEY, (old = []) =>
        old.map((e) => (e.id === id ? { ...e, work_share_pct: n } : e)),
      );
    },
    [qc, ENTRIES_KEY],
  );

  // Debounced DB write, serialized per-row. Trailing call always uses the
  // latest value at fire time (read from cache), so bursts collapse safely.
  const commitShare = useCallback(
    (id: string) =>
      enqueuePerRow(id, async () => {
        const latest = qc.getQueryData<TeamingEntry[]>(ENTRIES_KEY);
        const row = latest?.find((e) => e.id === id);
        if (!row) return;
        const n = clampShare(row.work_share_pct ?? 0);
        const { error } = await supabase
          .from("proposal_teaming")
          .update({ work_share_pct: n } as never)
          .eq("id", id);
        if (error) throw new Error(error.message);
      })
        .catch((err) => {
          toast.error((err as Error).message);
          qc.invalidateQueries({ queryKey: ENTRIES_KEY });
        })
        .finally(() => {
          invalidateSiblings();
        }),
    [enqueuePerRow, qc, ENTRIES_KEY, invalidateSiblings],
  );

  // -------- Derived numbers all read from the same live cache -------------
  const primeEntryCompanyId = rosterPrime?.id ?? null;
  const subEntries = entries.filter((e) => e.company_id !== primeEntryCompanyId);

  const otherSubShare = subEntries.reduce(
    (s, e) => s + (Number(e.work_share_pct) || 0),
    0,
  );

  const selfShareResolved = isSelfPrime
    ? Math.max(0, 100 - otherSubShare)
    : clampShare(typeof selfWorkSharePct === "number" ? selfWorkSharePct : 20);

  const primeRemainder = !isSelfPrime
    ? Math.max(0, 100 - selfShareResolved - otherSubShare)
    : 0;

  const total = selfShareResolved + otherSubShare + primeRemainder;
  const over = total > 100;

  const memberCount =
    1 + subEntries.length + (!isSelfPrime && (rosterPrime || primeContractorName) ? 1 : 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Proposed Team
            </CardTitle>
            <CardDescription className="text-xs">
              The team of record for this pursuit. Edit role, work share, and outreach — pWin and
              Team Strength update live.
            </CardDescription>
          </div>
          <div className="text-xs text-muted-foreground text-right shrink-0">
            <div className="tabular-nums">{memberCount} member{memberCount === 1 ? "" : "s"}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!isSelfPrime && (rosterPrime || primeContractorName) && (
          <div className="flex items-center gap-2 rounded-md border border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_10%,transparent)] px-2 py-1.5">
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 border-[color:var(--brand-brass)]/50 text-[color:var(--brand-brass)]"
            >
              Prime
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {rosterPrime?.company_name ?? primeContractorName}
              </div>
              {!rosterPrime && (
                <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  Not in roster — link or add for scoring detail
                  {onLinkPrime && (
                    <button
                      type="button"
                      onClick={onLinkPrime}
                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                    >
                      <Link2 className="w-3 h-3" /> Link
                    </button>
                  )}
                </div>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground uppercase">Leads bid</span>
            <span className="text-xs tabular-nums w-16 text-right" title="Remainder = 100% − our share − other subs">
              {primeRemainder}%
            </span>
            <div className="w-[110px]" />
            <div className="w-6" />
          </div>
        )}

        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5">
          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
            {isSelfPrime ? "Us" : "Sub (us)"}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{selfName}</div>
            {!isSelfPrime && (
              <div className="text-[10px] text-muted-foreground mt-0.5">Our share under the prime</div>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground uppercase">
            {isSelfPrime ? "Prime" : "Sub"}
          </span>
          {isSelfPrime ? (
            <>
              <span className="text-xs tabular-nums w-16 text-right">{selfShareResolved}%</span>
              <div className="w-[110px]" />
            </>
          ) : (
            <SelfShareEditor
              value={selfShareResolved}
              onCommit={(n) => onSelfShareChange?.(clampShare(n))}
            />
          )}
          <div className="w-6" />
        </div>

        {subEntries.length === 0 && (
          <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
            {isSelfPrime
              ? "No partners yet — add from suggestions below."
              : "No fellow subs yet — add from suggestions below."}
          </div>
        )}

        {subEntries.map((e) => {
          const p = partnerById.get(e.company_id);
          return (
            <ProposedRow
              key={e.id}
              entry={e}
              partner={p ?? null}
              opportunityNaics={opportunityNaics}
              onRoleChange={(r) => patchMutation.mutate({ id: e.id, patch: { role: r } })}
              onShareType={(n) => setShareOptimistic(e.id, n)}
              onShareCommit={() => commitShare(e.id)}
              onOutreachChange={(s) =>
                outreachMutation.mutate({ id: e.id, companyId: e.company_id, status: s })
              }
              onRemove={() => removeMutation.mutate(e.id)}
            />
          );
        })}

        <div className="pt-1">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-muted-foreground">Total work share</span>
            <span className={`tabular-nums font-medium ${over ? "text-destructive" : "text-foreground"}`}>
              {total}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${over ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${Math.min(100, total)}%` }}
            />
          </div>
          {over && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
              <AlertTriangle className="w-3 h-3" /> Work share exceeds 100% — trim partners or reduce shares.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SelfShareEditor({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [local, setLocal] = useState<string>(String(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setLocal(String(value));
  }, [value]);
  const commit = () => {
    const n = clampShare(Number(local) || 0);
    if (n !== value) onCommit(n);
    setLocal(String(n));
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number" min={0} max={100}
        value={local}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { focusedRef.current = false; commit(); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-7 w-14 text-xs tabular-nums"
        aria-label="Our work share percent"
      />
      <span className="text-[10px] text-muted-foreground">%</span>
      <div className="w-[92px]" />
    </div>
  );
}

function ProposedRow({
  entry,
  partner,
  opportunityNaics,
  onRoleChange,
  onShareType,
  onShareCommit,
  onOutreachChange,
  onRemove,
}: {
  entry: TeamingEntry;
  partner: PartnerView | null;
  opportunityNaics: string | null;
  onRoleChange: (r: PwinRole) => void;
  onShareType: (n: number) => void;
  onShareCommit: () => void;
  onOutreachChange: (s: OutreachStatus) => void;
  onRemove: () => void;
}) {
  // Local text buffer allows typing "" or partial values without the cache
  // yanking the caret. Optimistic cache updates fire on every keystroke via
  // onShareType; the debounced DB commit fires 400ms after the last edit.
  const [text, setText] = useState<string>(String(entry.work_share_pct ?? 0));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(String(entry.work_share_pct ?? 0));
  }, [entry.work_share_pct]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const naicsHit = !!(opportunityNaics && partner?.naics_codes?.includes(opportunityNaics));
  const ppCount = Array.isArray(partner?.past_performance) ? partner!.past_performance.length : 0;

  const reasons: string[] = [];
  if (naicsHit) reasons.push(`Holds NAICS ${opportunityNaics}`);
  if (ppCount > 0) reasons.push(`${ppCount} past performance record${ppCount === 1 ? "" : "s"}`);
  if (partner?.has_teaming_agreement) reasons.push("Teaming agreement signed");
  else if (partner?.has_nda) reasons.push("NDA in place");
  if (partner?.prior_contract_together || partner?.worked_together_before) {
    reasons.push("Prior contract together");
  }
  if (partner?.is_existing_partner) reasons.push("Established partner");
  if (partner?.certifications?.length) {
    reasons.push(`Certs: ${partner.certifications.slice(0, 3).join(", ")}`);
  }

  const handleType = (v: string) => {
    setText(v);
    const n = clampShare(Number(v) || 0);
    onShareType(n);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onShareCommit();
    }, 400);
  };

  const handleBlur = () => {
    focusedRef.current = false;
    const n = clampShare(Number(text) || 0);
    setText(String(n));
    onShareType(n);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    onShareCommit();
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
      <HoverCard openDelay={150}>
        <HoverCardTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Why they help">
            <Info className="w-3.5 h-3.5" />
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="right" className="w-72 text-xs space-y-1">
          <div className="font-medium text-sm flex items-center gap-1.5">
            <Handshake className="w-3.5 h-3.5 text-primary" /> Why they help
          </div>
          {reasons.length === 0 ? (
            <div className="text-muted-foreground">No standout signals yet — add NAICS, past performance, or partnership flags on the partner profile.</div>
          ) : (
            <ul className="list-disc pl-4 space-y-0.5">
              {reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </HoverCardContent>
      </HoverCard>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {partner?.company_name ?? "(unknown company)"}
        </div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {naicsHit && <Badge variant="outline" className="text-[9px] px-1 h-3.5">NAICS match</Badge>}
          {partner?.has_teaming_agreement && <Badge variant="outline" className="text-[9px] px-1 h-3.5">TA</Badge>}
          {!partner?.has_teaming_agreement && partner?.has_nda && <Badge variant="outline" className="text-[9px] px-1 h-3.5">NDA</Badge>}
          {(partner?.prior_contract_together || partner?.worked_together_before) &&
            <Badge variant="outline" className="text-[9px] px-1 h-3.5">Prior work</Badge>}
        </div>
      </div>

      <Select value={entry.role} onValueChange={(v) => onRoleChange(v as PwinRole)}>
        <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="number" min={0} max={100}
          value={text}
          onFocus={() => { focusedRef.current = true; }}
          onChange={(e) => handleType(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="h-7 w-14 text-xs tabular-nums"
          aria-label="Work share percent"
        />
        <span className="text-[10px] text-muted-foreground">%</span>
      </div>

      <Select value={entry.outreach_status} onValueChange={(v) => onOutreachChange(v as OutreachStatus)}>
        <SelectTrigger
          className={`h-7 w-[110px] text-[10px] uppercase tracking-wide border ${outreachChipClass(entry.outreach_status)}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OUTREACH_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
        onClick={onRemove} aria-label="Remove partner"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export { Trash2 };
