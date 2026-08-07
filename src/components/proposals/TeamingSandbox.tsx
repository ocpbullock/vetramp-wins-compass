import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles, Trash2, Plus, X, ArrowRight, ThumbsUp, ThumbsDown, AlertTriangle,
  Building2, Copy, Check, Pencil, Scale, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { listCompanies, type Company } from "@/lib/companies";
import {
  calculatePwin, colorFor, deriveInsights,
  RELATIONSHIP_MODELS, engagementForModel,
  type PwinTeamMember, type PwinContext, type PwinRole, type PwinResult,
  type RelationshipModel, type FactorKey,
} from "@/lib/pwin";
import {
  computePwinProbability, type GateStatus, type PwinProbabilityResult,
} from "@/lib/pwin-probability";
import { PwinDial } from "@/components/PwinDial";
import { teamingEntriesKey, fetchTeamingEntries, type TeamingEntry } from "@/components/proposals/ProposedTeamCard";

export type SandboxOpportunityContext = {
  title: string;
  naicsCodes: string[];
  agency?: string | null;
  setAside?: string | null;
  requiredVehicles?: string[];
  incumbentName?: string | null;
  scopeKeywords?: string[];
};

export type SandboxParent =
  | { kind: "proposal"; proposalId: string; teamId: string }
  | { kind: "tracked"; trackedOpportunityId: string; teamId: string }
  | { kind: "preview"; teamId: string };

const ROLES: { value: PwinRole; label: string }[] = [
  { value: "prime", label: "Prime" },
  { value: "sub", label: "Sub" },
  { value: "mentor", label: "Mentor" },
  { value: "protege", label: "Protégé" },
  { value: "jv_partner", label: "JV Partner" },
];

import { buildPartnerPwinMember, buildSelfPwinMember } from "@/lib/pwin-members";

type SandboxMember = PwinTeamMember & { companyId: string };

/** Scenario shape persisted to proposals.sandbox_scenarios. */
export type SandboxScenario = {
  id: string;
  name: string;
  members: SandboxMember[];
  updatedAt: string;
};

const clampShare = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `s-${Math.random().toString(36).slice(2)}`);

/** Proportional normalisation to exactly 100, remainder to the largest share. */
function normalizeShares(members: SandboxMember[]): SandboxMember[] {
  const total = members.reduce((s, m) => s + clampShare(m.workShare), 0);
  if (members.length === 0 || total === 0) return members;
  const scaled = members.map((m) => ({
    m,
    exact: (clampShare(m.workShare) / total) * 100,
  }));
  const rounded = scaled.map((x) => ({ ...x, v: Math.max(0, Math.round(x.exact)) }));
  let diff = 100 - rounded.reduce((s, x) => s + x.v, 0);
  if (diff !== 0) {
    let idx = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i].v > rounded[idx].v) idx = i;
    rounded[idx].v = clampShare(rounded[idx].v + diff);
    diff = 0;
  }
  return rounded.map((x) => ({ ...x.m, workShare: clampShare(x.v) }));
}

function memberFromCompany(c: Company, opts: { isSelf: boolean; role: PwinRole; share: number }): SandboxMember {
  const base = opts.isSelf
    ? buildSelfPwinMember({
        self: {
          company_name: c.name,
          certifications: c.certifications ?? [],
          naics_codes: c.naics_codes ?? [],
          vehicles: c.contract_vehicles ?? [],
          pastPerf: (c.past_performance ?? []).map((pp: any) => ({
            naics: pp?.naics ?? null,
            agency: pp?.customer ?? pp?.agency ?? null,
            end: pp?.end ?? null,
            keywords: pp?.keywords ?? [],
          })),
        },
        isSelfPrime: opts.role === "prime",
        workShare: clampShare(opts.share),
      })
    : buildPartnerPwinMember(
        { ...(c as any), name: c.name },
        { role: opts.role, workShare: clampShare(opts.share), isPrime: opts.role === "prime" },
      );
  return { ...base, id: c.id, role: opts.role, workShare: clampShare(opts.share), companyId: c.id };
}

export type SandboxSeedMember = {
  companyId: string;
  role: PwinRole;
  workShare: number;
  isSelf: boolean;
};

export type SandboxSuggestion = {
  companyId: string;
  name: string;
  reason?: string;
};

// Same gate derivation the PwinProbabilityCard uses, so compare-view
// probabilities line up with the scoreboard.
function gateFromFactor(pwin: PwinResult | null | undefined, key: FactorKey): GateStatus {
  if (!pwin) return "unknown";
  const f = pwin.factors.find((x) => x.key === key);
  if (!f) return "unknown";
  if (f.score < 30) return "fail";
  if (f.score >= 70) return "pass";
  return "unknown";
}

export function TeamingSandbox({
  open, onOpenChange, parent, opportunity, addCompanyIdOnOpen,
  seedFromProposed, suggestions, proposal,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  parent: SandboxParent;
  opportunity: SandboxOpportunityContext;
  /** If set, this company id is added to the sandbox team when companies finish loading. */
  addCompanyIdOnOpen?: string | null;
  /** Team of record: the first scenario seeds from this. */
  seedFromProposed?: SandboxSeedMember[];
  /** Top suggested partners for one-click add. */
  suggestions?: SandboxSuggestion[];
  /** Proposal row — supplies pwin_config gates/field/incumbent + engagement type. */
  proposal?: any;
}) {
  const qc = useQueryClient();
  const teamId = parent.teamId;
  const proposalId = parent.kind === "proposal" ? parent.proposalId : null;

  const { data: companies } = useQuery({
    queryKey: ["sandbox-companies", teamId],
    enabled: open && !!teamId,
    queryFn: () => listCompanies(teamId),
  });

  const ownCompany = useMemo(() => companies?.find((c) => c.is_own_company), [companies]);

  // ----- scenario state (single source of truth for members)
  const [scenarios, setScenarios] = useState<SandboxScenario[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [applyId, setApplyId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [relationshipModel, setRelationshipModel] = useState<RelationshipModel>("prime_with_subs");
  const [scopeAreas, setScopeAreas] = useState<string>((opportunity.scopeKeywords ?? []).join(", "));
  const [pickerQuery, setPickerQuery] = useState("");
  const initializedRef = useRef(false);

  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeId) ?? scenarios[0] ?? null,
    [scenarios, activeId],
  );
  // Derived — never copied into separate state, so every mutation re-scores.
  const members: SandboxMember[] = activeScenario?.members ?? [];
  const perspectiveId = members.find((m) => m.isSelf)?.companyId ?? null;

  const mutateActive = useCallback(
    (fn: (prev: SandboxMember[]) => SandboxMember[]) => {
      setScenarios((prev) =>
        prev.map((s) =>
          s.id === (activeId ?? prev[0]?.id)
            ? { ...s, members: fn(s.members), updatedAt: new Date().toISOString() }
            : s,
        ),
      );
    },
    [activeId],
  );

  // ----- persisted scenarios
  const { data: persisted } = useQuery({
    queryKey: ["sandbox-scenarios-json", proposalId],
    enabled: open && !!proposalId,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("sandbox_scenarios")
        .eq("id", proposalId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return ((data?.sandbox_scenarios as unknown) as SandboxScenario[] | null) ?? [];
    },
  });

  const buildSeedMembers = useCallback((): SandboxMember[] => {
    if (!companies || companies.length === 0) return [];
    const seed: SandboxMember[] = [];
    for (const s of seedFromProposed ?? []) {
      const c = companies.find((cc) => cc.id === s.companyId);
      if (!c) continue;
      seed.push(memberFromCompany(c, { isSelf: s.isSelf, role: s.role, share: s.workShare }));
    }
    if (!seed.some((m) => m.isSelf)) {
      const initial = ownCompany ?? companies[0];
      if (initial && !seed.some((m) => m.companyId === initial.id)) {
        seed.unshift(memberFromCompany(initial, {
          isSelf: true,
          role: "prime",
          share: clampShare(100 - seed.reduce((s, m) => s + m.workShare, 0)),
        }));
      } else if (seed.length > 0) {
        seed[0] = { ...seed[0], isSelf: true };
      }
    }
    if (seed.length === 0) {
      const initial = ownCompany ?? companies[0];
      if (initial) seed.push(memberFromCompany(initial, { isSelf: true, role: "prime", share: 100 }));
      if (addCompanyIdOnOpen && initial && addCompanyIdOnOpen !== initial.id) {
        const extra = companies.find((c) => c.id === addCompanyIdOnOpen);
        if (extra) seed.push(memberFromCompany(extra, { isSelf: false, role: "sub", share: 20 }));
      }
    }
    return seed;
  }, [companies, ownCompany, seedFromProposed, addCompanyIdOnOpen]);

  // Initialise once per open: saved scenarios if any, otherwise a seed scenario.
  useEffect(() => {
    if (!open || !companies) return;
    if (initializedRef.current) return;
    if (proposalId && persisted === undefined) return; // wait for the read
    const saved = (persisted ?? []).filter((s) => s && Array.isArray(s.members));
    if (saved.length > 0) {
      const hydrated = saved.map((s) => ({
        ...s,
        members: s.members.map((m) => ({ ...m, workShare: clampShare(m.workShare) })),
      }));
      setScenarios(hydrated);
      setActiveId(hydrated[0].id);
    } else {
      const base: SandboxScenario = {
        id: newId(),
        name: "Scenario 1",
        members: buildSeedMembers(),
        updatedAt: new Date().toISOString(),
      };
      setScenarios([base]);
      setActiveId(base.id);
    }
    initializedRef.current = true;
  }, [open, companies, persisted, proposalId, buildSeedMembers]);

  // Reset when dialog closes
  useEffect(() => {
    if (open) return;
    initializedRef.current = false;
    setScenarios([]);
    setActiveId(null);
    setCompareMode(false);
    setRenamingId(null);
    setPickerQuery("");
  }, [open]);

  // ---- Debounced, optimistic persistence of all scenarios.
  const savedKeyRef = useRef<string>("");
  useEffect(() => {
    if (!open || !proposalId || !initializedRef.current) return;
    const key = JSON.stringify(scenarios);
    if (key === savedKeyRef.current) return;
    const t = setTimeout(async () => {
      savedKeyRef.current = key;
      qc.setQueryData(["sandbox-scenarios-json", proposalId], scenarios);
      const { error } = await supabase
        .from("proposals")
        .update({ sandbox_scenarios: scenarios as never })
        .eq("id", proposalId);
      if (error) {
        savedKeyRef.current = "";
        toast.error(`Couldn't save scenarios: ${error.message}`);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [scenarios, open, proposalId, qc]);

  // ----- scenario ops
  const addScenario = (duplicate: boolean) => {
    const src = duplicate ? activeScenario : null;
    const next: SandboxScenario = {
      id: newId(),
      name: duplicate && src ? `${src.name} (copy)` : `Scenario ${scenarios.length + 1}`,
      members: src ? src.members.map((m) => ({ ...m })) : buildSeedMembers(),
      updatedAt: new Date().toISOString(),
    };
    setScenarios((prev) => [...prev, next]);
    setActiveId(next.id);
    setCompareMode(false);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (name) {
      setScenarios((prev) => prev.map((s) => (s.id === renamingId ? { ...s, name } : s)));
    }
    setRenamingId(null);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    setScenarios((prev) => {
      const next = prev.filter((s) => s.id !== deleteId);
      if (next.length === 0) {
        const base: SandboxScenario = {
          id: newId(), name: "Scenario 1", members: buildSeedMembers(), updatedAt: new Date().toISOString(),
        };
        setActiveId(base.id);
        return [base];
      }
      if (deleteId === activeId) setActiveId(next[0].id);
      return next;
    });
    setDeleteId(null);
  };

  const reseedActive = () => {
    const seed = buildSeedMembers();
    mutateActive(() => seed);
    toast.success("Re-seeded this scenario from the proposed team");
  };

  // ----- member ops (all funnel through mutateActive → one derived score)
  const addCompany = (c: Company) => {
    mutateActive((prev) => {
      if (prev.some((m) => m.companyId === c.id)) return prev;
      const isFirst = prev.length === 0;
      return [
        ...prev,
        memberFromCompany(c, {
          isSelf: isFirst,
          role: prev.some((m) => m.role === "prime") ? "sub" : "prime",
          share: isFirst ? 100 : 20,
        }),
      ];
    });
  };

  const removeMember = (companyId: string) => {
    mutateActive((prev) => {
      const next = prev.filter((m) => m.companyId !== companyId);
      if (next.length > 0 && !next.some((m) => m.isSelf)) {
        return next.map((m, i) => ({ ...m, isSelf: i === 0 }));
      }
      return next;
    });
  };

  const updateMember = (companyId: string, patch: Partial<SandboxMember>) => {
    const safe: Partial<SandboxMember> =
      patch.workShare !== undefined ? { ...patch, workShare: clampShare(patch.workShare) } : patch;
    mutateActive((prev) => prev.map((m) => (m.companyId === companyId ? { ...m, ...safe } : m)));
  };

  const setPerspective = (companyId: string) => {
    mutateActive((prev) => prev.map((m) => ({ ...m, isSelf: m.companyId === companyId })));
  };

  const normalizeActive = () => {
    mutateActive((prev) => normalizeShares(prev));
    toast.success("Work shares normalized to 100%");
  };

  const ctx: PwinContext = useMemo(() => ({
    engagementType: engagementForModel(relationshipModel),
    relationshipModel,
    opportunityNaics: opportunity.naicsCodes,
    opportunityAgency: opportunity.agency ?? null,
    setAside: opportunity.setAside ?? null,
    requiredVehicles: opportunity.requiredVehicles ?? [],
    scopeKeywords: scopeAreas.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
    incumbentName: opportunity.incumbentName ?? null,
  }), [
    relationshipModel, opportunity.naicsCodes, opportunity.agency,
    opportunity.setAside, opportunity.requiredVehicles, opportunity.incumbentName, scopeAreas,
  ]);

  // Single derived computation — recomputes on ANY member change.
  const result: PwinResult = useMemo(() => calculatePwin(ctx, members), [ctx, members]);
  const insights = useMemo(() => deriveInsights(result, relationshipModel), [result, relationshipModel]);

  const totalShare = members.reduce((s, m) => s + clampShare(m.workShare), 0);
  const overAllocated = totalShare > 100;

  // ----- comparison rows
  const pwinConfig = (proposal?.pwin_config as any) ?? {};
  const compareRows = useMemo(() => {
    return scenarios.map((s) => {
      const r = calculatePwin(ctx, s.members);
      const gates = {
        setAsideEligible: (pwinConfig?.gateOverrides?.setAsideEligible as GateStatus) ?? gateFromFactor(r, "set_aside"),
        vehicleAccess: (pwinConfig?.gateOverrides?.vehicleAccess as GateStatus) ?? gateFromFactor(r, "vehicle_access"),
        clearance: (pwinConfig?.gateOverrides?.clearance as GateStatus) ?? ("unknown" as GateStatus),
      };
      const prob: PwinProbabilityResult = computePwinProbability({
        gates,
        field: {
          minCredibleBidders: Number(pwinConfig?.field?.min) || 6,
          maxCredibleBidders: Number(pwinConfig?.field?.max) || 12,
        },
        incumbent: {
          present: !!pwinConfig?.incumbent?.present,
          weAreIncumbent: !!pwinConfig?.incumbent?.weAreIncumbent,
          retention: Number(pwinConfig?.incumbent?.retention) || 0.6,
        },
        teamStrength: r.pwin,
      });
      const total = s.members.reduce((acc, m) => acc + clampShare(m.workShare), 0);
      return { scenario: s, strength: r.pwin, prob, total };
    });
  }, [scenarios, ctx, pwinConfig]);

  const bestId = useMemo(() => {
    if (compareRows.length === 0) return null;
    return compareRows.reduce((a, b) => (b.strength > a.strength ? b : a)).scenario.id;
  }, [compareRows]);

  const filteredCompanies = useMemo(() => {
    if (!companies) return [];
    const q = pickerQuery.trim().toLowerCase();
    const inTeam = new Set(members.map((m) => m.companyId));
    return companies
      .filter((c) => !inTeam.has(c.id))
      .filter((c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.naics_codes.some((n) => n.includes(q)) ||
        c.certifications.some((x) => x.toLowerCase().includes(q)),
      );
  }, [companies, pickerQuery, members]);

  // ----- apply a scenario to the proposed team of record
  const applyScenario = async (scenario: SandboxScenario) => {
    if (!proposalId) return;
    setApplying(true);
    const key = teamingEntriesKey(proposalId);
    const snapshot = qc.getQueryData<TeamingEntry[]>(key);
    try {
      const existing = await fetchTeamingEntries(proposalId);
      const selfMember = scenario.members.find((m) => m.isSelf) ?? null;
      const partners = scenario.members.filter((m) => !m.isSelf);
      const wanted = new Map(partners.map((m) => [m.companyId, m]));

      // Optimistic cache write so the scoreboard, rail and card move now.
      qc.setQueryData<TeamingEntry[]>(key, () =>
        partners.map((m) => {
          const prior = existing.find((e) => e.company_id === m.companyId);
          return {
            id: prior?.id ?? `temp-${m.companyId}`,
            company_id: m.companyId,
            role: m.role,
            work_share_pct: clampShare(m.workShare),
            outreach_status: prior?.outreach_status ?? "not_started",
          } as TeamingEntry;
        }),
      );

      const removals = existing.filter((e) => !wanted.has(e.company_id));
      if (removals.length > 0) {
        const { error } = await supabase
          .from("proposal_teaming")
          .delete()
          .in("id", removals.map((e) => e.id));
        if (error) throw new Error(error.message);
      }

      for (const m of partners) {
        const prior = existing.find((e) => e.company_id === m.companyId);
        if (prior) {
          const { error } = await supabase
            .from("proposal_teaming")
            .update({ role: m.role, work_share_pct: clampShare(m.workShare) } as never)
            .eq("id", prior.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from("proposal_teaming").insert({
            proposal_id: proposalId,
            company_id: m.companyId,
            role: m.role,
            work_share_pct: clampShare(m.workShare),
          } as never);
          if (error) throw new Error(error.message);
        }
      }

      // In sub mode, our own share lives in pwin_config.
      if (proposal?.engagement_type === "sub" && selfMember) {
        const nextConfig = { ...(proposal?.pwin_config ?? {}), selfWorkSharePct: clampShare(selfMember.workShare) };
        const { error } = await supabase
          .from("proposals")
          .update({ pwin_config: nextConfig as never })
          .eq("id", proposalId);
        if (error) throw new Error(error.message);
      }

      toast.success(`Applied "${scenario.name}" to the proposed team`);
    } catch (err) {
      if (snapshot) qc.setQueryData(key, snapshot);
      toast.error((err as Error).message);
    } finally {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["proposal-teaming", proposalId] });
      qc.invalidateQueries({ queryKey: ["pwin-entries", proposalId] });
      qc.invalidateQueries({ queryKey: ["proposed-team-entries", proposalId] });
      qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
      if (teamId) {
        qc.invalidateQueries({ queryKey: ["capture-partners", teamId] });
        qc.invalidateQueries({ queryKey: ["pwin-partners", teamId] });
        qc.invalidateQueries({ queryKey: ["suggest-partners", teamId] });
      }
      setApplying(false);
      setApplyId(null);
    }
  };

  const applyTarget = scenarios.find((s) => s.id === applyId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Teaming Sandbox
          </DialogTitle>
          <DialogDescription className="text-xs">
            {opportunity.title} — build multiple lineups, compare them side by side, then apply the winner to the proposed team.
            {!proposalId && (
              <span className="text-warning ml-1">Preview mode: scenarios won't persist.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Scenario chip strip */}
        <div className="px-6 py-2 border-b flex items-center gap-2 flex-wrap">
          {scenarios.map((s) => {
            const isActive = s.id === activeScenario?.id;
            if (renamingId === s.id) {
              return (
                <span key={s.id} className="inline-flex items-center gap-1">
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="h-7 w-40 text-xs"
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={commitRename} aria-label="Save name">
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                </span>
              );
            }
            return (
              <span
                key={s.id}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                <button type="button" onClick={() => { setActiveId(s.id); setCompareMode(false); }} className="max-w-[160px] truncate">
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => { setRenamingId(s.id); setRenameValue(s.name); }}
                  aria-label={`Rename ${s.name}`}
                  className="opacity-60 hover:opacity-100"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteId(s.id)}
                  aria-label={`Delete ${s.name}`}
                  className="opacity-60 hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addScenario(false)}>
            <Plus className="w-3 h-3 mr-1" /> New scenario
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => addScenario(true)}
            disabled={!activeScenario}
          >
            <Copy className="w-3 h-3 mr-1" /> Duplicate
          </Button>
          <Button
            size="sm"
            variant={compareMode ? "default" : "outline"}
            className="h-7 text-[11px] ml-auto"
            onClick={() => setCompareMode((v) => !v)}
          >
            <Scale className="w-3 h-3 mr-1" /> {compareMode ? "Back to builder" : `Compare scenarios (${scenarios.length})`}
          </Button>
        </div>

        <div className="px-6 pt-3 text-[11px] text-muted-foreground bg-muted/40 border-b py-2">
          <strong className="text-foreground">What-if modeling.</strong> The Proposed Team is the team of record — nothing here
          changes it until you use “Apply to proposed team”.
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6">
          {compareMode ? (
            <CompareTable
              rows={compareRows}
              bestId={bestId}
              canApply={!!proposalId}
              onOpen={(id) => { setActiveId(id); setCompareMode(false); }}
              onApply={(id) => setApplyId(id)}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
                <div>
                  <Label className="text-xs">Relationship model</Label>
                  <Select value={relationshipModel} onValueChange={(v) => setRelationshipModel(v as RelationshipModel)}>
                    <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIP_MODELS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Targeted scope areas</Label>
                  <Input
                    value={scopeAreas}
                    onChange={(e) => setScopeAreas(e.target.value)}
                    placeholder="e.g. zero trust, cloud migration"
                    className="text-sm mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4 pb-6">
                {/* LEFT: Company picker */}
                <div className="lg:col-span-1">
                  <Label className="text-xs">Add from company library</Label>
                  <Input
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Search companies, NAICS, certs…"
                    className="h-8 text-sm mt-1"
                  />
                  <ScrollArea className="h-[52vh] mt-2 border rounded-md">
                    <div className="p-2 space-y-1">
                      {filteredCompanies.length === 0 && (
                        <div className="text-xs text-muted-foreground py-4 text-center">No more matching companies.</div>
                      )}
                      {filteredCompanies.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => addCompany(c)}
                          className="w-full text-left p-2 rounded hover:bg-muted border border-transparent hover:border-border"
                        >
                          <div className="flex items-center gap-1 text-sm font-medium">
                            {c.is_own_company && <Building2 className="w-3 h-3 text-primary" />}
                            <span className="truncate">{c.name}</span>
                            <Plus className="w-3 h-3 ml-auto text-muted-foreground" />
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.certifications.slice(0, 3).map((x) => (
                              <Badge key={x} variant="outline" className="text-[10px]">{x}</Badge>
                            ))}
                            {c.naics_codes.slice(0, 3).map((n) => (
                              <Badge key={n} variant="secondary" className="text-[10px] font-mono">{n}</Badge>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* MIDDLE: Candidate team */}
                <div className="lg:col-span-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Candidate team ({members.length})</Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] px-2"
                      onClick={reseedActive}
                      title="Reset this scenario to the current Proposed Team"
                    >
                      Re-seed from proposed team
                    </Button>
                  </div>

                  {/* Live work-share total */}
                  <div className="mt-2 border rounded-md p-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Total work share</span>
                      <span className={`tabular-nums font-medium ${overAllocated ? "text-destructive" : "text-foreground"}`}>
                        {totalShare}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-1">
                      <div
                        className={`h-full ${overAllocated ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, totalShare)}%` }}
                      />
                    </div>
                    {overAllocated && (
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-destructive">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span className="flex-1">Over-allocated — this penalizes Team Strength.</span>
                        <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={normalizeActive}>
                          <Wand2 className="w-3 h-3 mr-1" /> Normalize to 100%
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 pr-1 max-h-[52vh] overflow-y-auto">
                    <RadioGroup value={perspectiveId ?? ""} onValueChange={setPerspective} className="space-y-2">
                      {members.length === 0 && (
                        <div className="text-xs text-muted-foreground border border-dashed rounded p-4 text-center">
                          Add a company from the picker to start.
                        </div>
                      )}
                      {members.map((m) => (
                        <div key={m.companyId} className={`border rounded-md p-2.5 ${m.isSelf ? "border-primary/60 bg-primary/5" : ""}`}>
                          <div className="flex items-start gap-2">
                            <RadioGroupItem value={m.companyId} id={`p-${m.companyId}`} className="mt-1" />
                            <div className="flex-1 min-w-0">
                              <label htmlFor={`p-${m.companyId}`} className="font-medium text-sm cursor-pointer block truncate">
                                {m.name} {m.isSelf && <Badge className="ml-1 text-[10px]">Perspective</Badge>}
                              </label>
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <Select value={m.role} onValueChange={(v) => updateMember(m.companyId, { role: v as PwinRole })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <div>
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[10px] text-muted-foreground">Work share</span>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={m.workShare}
                                      onChange={(e) => updateMember(m.companyId, { workShare: clampShare(e.target.value) })}
                                      className="h-6 w-14 text-[11px] px-1 tabular-nums"
                                    />
                                  </div>
                                  <Slider
                                    value={[clampShare(m.workShare)]} min={0} max={100} step={1}
                                    onValueChange={([v]) => updateMember(m.companyId, { workShare: v })}
                                  />
                                </div>
                              </div>
                              {!m.isSelf && (
                                <div className="mt-2">
                                  <div className="text-[10px] text-muted-foreground">
                                    Relationship strength {m.primeRelationshipStrength ?? 0}
                                  </div>
                                  <Slider
                                    value={[m.primeRelationshipStrength ?? 0]} min={0} max={100} step={5}
                                    onValueChange={([v]) => updateMember(m.companyId, { primeRelationshipStrength: v })}
                                  />
                                </div>
                              )}
                              <div className="flex items-center gap-3 mt-2 text-[11px]">
                                <label className="flex items-center gap-1">
                                  <Switch
                                    checked={!!m.isIncumbent}
                                    onCheckedChange={(v) => updateMember(m.companyId, { isIncumbent: v })}
                                  />
                                  <span>Incumbent</span>
                                </label>
                                <label className="flex items-center gap-1">
                                  <Switch
                                    checked={!!m.workedWithIncumbent}
                                    onCheckedChange={(v) => updateMember(m.companyId, { workedWithIncumbent: v })}
                                  />
                                  <span>Worked w/ incumbent</span>
                                </label>
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => removeMember(m.companyId)} aria-label="Remove">
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  {suggestions && suggestions.length > 0 && (
                    <div className="mt-3 border-t pt-2">
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">
                        Add from suggestions (sandbox only)
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {suggestions
                          .filter((s) => !members.some((m) => m.companyId === s.companyId))
                          .slice(0, 8)
                          .map((s) => (
                            <button
                              key={s.companyId}
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 text-primary text-[11px] px-2 py-0.5 hover:bg-primary/10"
                              onClick={() => {
                                const c = companies?.find((cc) => cc.id === s.companyId);
                                if (c) addCompany(c);
                              }}
                              title={s.reason ?? undefined}
                            >
                              <Plus className="w-3 h-3" />
                              {s.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT: Team Strength */}
                <div className="lg:col-span-1">
                  <PwinDisplay result={result} />
                  <InsightsBox insights={insights} />
                  {proposalId && (
                    <Button
                      className="w-full mt-3"
                      size="sm"
                      disabled={members.length === 0 || !activeScenario}
                      onClick={() => activeScenario && setApplyId(activeScenario.id)}
                    >
                      Apply to proposed team
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete scenario?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the scenario and its lineup from the sandbox. It doesn't change the proposed team.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!applyTarget} onOpenChange={(o) => !o && setApplyId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply “{applyTarget?.name}” to the proposed team?</AlertDialogTitle>
              <AlertDialogDescription>
                This replaces the current proposed team composition. Partners in this scenario are added or updated
                (role and work share), and partners not in it are removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={applying}
                onClick={(e) => { e.preventDefault(); if (applyTarget) void applyScenario(applyTarget); }}
              >
                {applying ? "Applying…" : "Apply"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function strengthClass(score: number): string {
  const c = colorFor(score);
  return c === "green" ? "text-success" : c === "amber" ? "text-warning" : "text-destructive";
}

function CompareTable({
  rows, bestId, canApply, onOpen, onApply,
}: {
  rows: { scenario: SandboxScenario; strength: number; prob: PwinProbabilityResult; total: number }[];
  bestId: string | null;
  canApply: boolean;
  onOpen: (id: string) => void;
  onApply: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border border-dashed rounded-md p-6 text-center my-6">
        Create a scenario to start comparing.
      </div>
    );
  }
  return (
    <div className="py-4 overflow-x-auto">
      <table className="w-full text-xs border-separate border-spacing-y-1.5">
        <thead className="text-[10px] uppercase text-muted-foreground">
          <tr>
            <th className="text-left px-2">Scenario</th>
            <th className="text-right px-2">Team Strength</th>
            <th className="text-right px-2">PWIN</th>
            <th className="text-right px-2">Members</th>
            <th className="text-right px-2">Work share</th>
            <th className="text-left px-2">Lineup</th>
            <th className="px-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ scenario, strength, prob, total }) => {
            const best = scenario.id === bestId;
            return (
              <tr
                key={scenario.id}
                className={`bg-card ${best ? "outline outline-1 outline-[color:var(--brand-brass)]" : ""}`}
              >
                <td className="px-2 py-2 rounded-l-md align-top">
                  <button type="button" className="font-medium hover:underline text-left" onClick={() => onOpen(scenario.id)}>
                    {scenario.name}
                  </button>
                  {best && (
                    <div className="text-[10px] text-[color:var(--brand-brass)] uppercase">Strongest</div>
                  )}
                </td>
                <td className={`px-2 py-2 text-right tabular-nums font-semibold align-top ${strengthClass(strength)}`}>
                  {strength}
                </td>
                <td className="px-2 py-2 text-right tabular-nums align-top">
                  <div className="font-medium">{prob.likelyPct}%</div>
                  <div className="text-[10px] text-muted-foreground">{prob.lowPct}–{prob.highPct}%</div>
                  {prob.gateFailed && (
                    <div className="text-[10px] text-destructive">{prob.gateFailed} failed</div>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums align-top">{scenario.members.length}</td>
                <td className={`px-2 py-2 text-right tabular-nums align-top ${total > 100 ? "text-destructive font-medium" : ""}`}>
                  {total}%
                  {total > 100 && <div className="text-[10px]">over-allocated</div>}
                </td>
                <td className="px-2 py-2 align-top">
                  <div className="flex flex-wrap gap-1 max-w-[280px]">
                    {scenario.members.map((m) => (
                      <span
                        key={m.companyId}
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                          m.isSelf ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        }`}
                      >
                        {m.name} · {clampShare(m.workShare)}%
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-2 rounded-r-md text-right align-top">
                  {canApply && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onApply(scenario.id)}>
                      Apply to proposed team
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PwinDisplay({ result }: { result: PwinResult }) {
  return (
    <div>
      <div className="flex flex-col items-center py-3 border rounded-md">
        <PwinDial value={result.pwin} size="md" label="Team Strength" />
        <div className="text-[11px] text-muted-foreground mt-1">
          Partners {result.totalPartnerShare}% · perspective {result.selfShare}%
        </div>
        {result.overAllocated && (
          <div className="text-[10px] text-destructive flex items-center justify-center gap-1 mt-1">
            <AlertTriangle className="w-3 h-3" /> over-allocated
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {result.factors.map((f) => {
          const col = colorFor(f.score);
          const bar =
            col === "green" ? "bg-success"
            : col === "amber" ? "bg-warning"
            : "bg-destructive";
          return (
            <div key={f.key} className="border rounded p-2">
              <div className="flex justify-between text-[11px]">
                <span className="font-medium truncate">{f.label}</span>
                <span className="tabular-nums">{Math.round(f.weight * 100)}% · {f.score}</span>
              </div>
              <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
                <div className={`h-full ${bar}`} style={{ width: `${f.score}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsightsBox({ insights }: { insights: ReturnType<typeof deriveInsights> }) {
  return (
    <div className="mt-4 border rounded p-3 text-xs space-y-2">
      {insights.strengths.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-success flex items-center gap-1">
            <ThumbsUp className="w-3 h-3" /> Strengths
          </div>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {insights.strengths.map((s, i) => <li key={i}>{s.label}</li>)}
          </ul>
        </div>
      )}
      {insights.weaknesses.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-destructive flex items-center gap-1">
            <ThumbsDown className="w-3 h-3" /> Weaknesses
          </div>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {insights.weaknesses.map((s, i) => <li key={i}>{s.label}</li>)}
          </ul>
        </div>
      )}
      <div className="border-t pt-2 flex items-start gap-1">
        <ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />
        <span>{insights.recommendedAction}</span>
      </div>
    </div>
  );
}
