import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ChevronDown, Building2, Star, Users, Swords, Target,
  Lightbulb, ArrowRight, Mail, UserPlus, Sparkles, Loader2,
} from "lucide-react";
import { toast } from "sonner";


import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { supabase } from "@/integrations/supabase/client";
import { useTeamId } from "@/lib/team";
import { useOpportunityContext, type TargetProfile } from "@/lib/opportunity-context";
import { useOnboardingGate } from "@/lib/setup-status";
import { listCompanies, type Company } from "@/lib/companies";
import { NAICS_GROUPS } from "@/lib/contracts";

import { SetupBanner } from "@/components/settings/SetupChecklist";
import { OnboardingFlow, PastPerformanceAccuracyBanner } from "@/components/onboarding/OnboardingFlow";
import { PartnerResearch } from "@/components/proposals/PartnerResearch";
import { SuggestedPartnersCard } from "@/components/proposals/SuggestedPartnersCard";
import {
  TeamingOutreachModal,
  type OutreachPartnerInput,
} from "@/components/proposals/TeamingOutreachModal";
import {
  TeamingSandbox,
  type SandboxOpportunityContext,
} from "@/components/proposals/TeamingSandbox";
import { CreateOpportunityTeamDialog } from "@/components/dashboard/CreateOpportunityTeamDialog";
import { CONTRACT_VEHICLES } from "@/components/dashboard/TrackOpportunityDialog";

export const Route = createFileRoute("/")({ component: CaptureWorkspace });

const SET_ASIDE_OPTIONS = [
  { value: "__none", label: "None / Full & Open" },
  { value: "SDVOSB", label: "SDVOSB" },
  { value: "VOSB", label: "VOSB" },
  { value: "8(a)", label: "8(a)" },
  { value: "WOSB", label: "WOSB" },
  { value: "EDWOSB", label: "EDWOSB" },
  { value: "HUBZone", label: "HUBZone" },
  { value: "Total_Small_Business", label: "Total Small Business" },
];

const ALL_NAICS_FLAT = NAICS_GROUPS.flatMap((g) => g.codes);

// Columns needed by SuggestedPartnersCard's ProposalLite + outreach modal.
const PROPOSAL_COLUMNS =
  "id, team_id, agency, naics_code, set_aside, contract_type, engagement_type, prime_contractor_name, targeted_scope_areas, customer_intel, opportunity_data, solicitation_number, opportunity_title, response_deadline";

type ProposalSummary = {
  id: string;
  opportunity_title: string | null;
  agency: string | null;
  status: string | null;
  updated_at: string;
};

type FullProposal = {
  id: string;
  team_id: string | null;
  agency: string | null;
  naics_code: string | null;
  set_aside: string | null;
  contract_type: string | null;
  engagement_type: "prime" | "sub";
  prime_contractor_name: string | null;
  targeted_scope_areas: string | null;
  customer_intel: any;
  opportunity_data: any;
  solicitation_number: string | null;
  opportunity_title: string | null;
  response_deadline: string | null;
};

// ---------------------------------------------------------------------------
// Capture Workspace — the app's new front door.
// ---------------------------------------------------------------------------
function CaptureWorkspace() {
  const teamId = useTeamId();
  const onboarding = useOnboardingGate();
  const qc = useQueryClient();
  const { selected, setSelectedOpportunityId, targetProfile, setTargetProfile } =
    useOpportunityContext();

  const [sandboxOpen, setSandboxOpen] = useState(false);

  // Selectable proposals — RLS limits this to ones the user can see.
  const { data: proposalOptions = [] } = useQuery({
    queryKey: ["capture-workspace-proposals", teamId],
    queryFn: async (): Promise<ProposalSummary[]> => {
      let q = supabase
        .from("proposals")
        .select("id, opportunity_title, agency, status, updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (teamId) q = q.eq("team_id", teamId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as ProposalSummary[];
    },
  });

  // Full proposal row for the selected opportunity (drives SuggestedPartnersCard
  // + outreach modal + opp team dialog pre-fill).
  const { data: selectedProposal } = useQuery({
    queryKey: ["capture-workspace-proposal", selected?.id],
    enabled: !!selected?.id,
    queryFn: async (): Promise<FullProposal | null> => {
      const { data, error } = await supabase
        .from("proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("id", selected!.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as FullProposal) ?? null;
    },
  });

  // Already-teamed company ids for the selected proposal — feeds the
  // SuggestedPartnersCard so it can hide partners already on the team.
  const { data: existingPartnerIds = [] } = useQuery({
    queryKey: ["capture-workspace-teaming", selected?.id],
    enabled: !!selected?.id,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("proposal_teaming")
        .select("company_id")
        .eq("proposal_id", selected!.id);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: any) => r.company_id as string);
    },
  });

  // Effective opportunity context for downstream panels. Falls back to the
  // editable target profile when no opportunity is selected so the global
  // exploration mode still drives PWIN inputs and partner suggestions.
  const effectiveNaics: string[] = useMemo(() => {
    if (selected?.naicsCode) return [selected.naicsCode];
    return targetProfile.naics;
  }, [selected, targetProfile.naics]);

  // When a real opportunity is selected, scope sandbox PWIN to it directly
  // (NOT the target profile). Otherwise fall back to the target profile so
  // global exploration still works.
  const sandboxOpportunity: SandboxOpportunityContext = useMemo(() => {
    if (selected) {
      return {
        title: selected.title ?? "Selected opportunity",
        naicsCodes: selected.naicsCode ? [selected.naicsCode] : [],
        agency: selected.agency,
        setAside: selected.setAside,
        requiredVehicles: selected.requiredVehicles ?? [],
        incumbentName: selected.incumbentName,
        scopeKeywords: selected.scopeKeywords ?? [],
      };
    }
    return {
      title: "Global exploration",
      naicsCodes: targetProfile.naics,
      agency: targetProfile.agency,
      setAside: targetProfile.setAside,
      requiredVehicles: targetProfile.requiredVehicles,
      incumbentName: null,
      scopeKeywords: targetProfile.scopeKeywords,
    };
  }, [selected, targetProfile]);

  // PartnerResearch is proposal-scoped today; in global mode we pass an empty
  // id so the roster + SAM.gov search work, while proposal-side actions stay
  // inert until the user actually creates a proposal.
  const partnerResearchProposalId = selected?.id ?? "";

  return (
    <div className="min-h-screen bg-background">
      
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        {onboarding.showOnboarding ? (
          <OnboardingFlow
            onComplete={onboarding.skip}
            onSkip={onboarding.skip}
            canSkip={onboarding.state.coreDone}
          />
        ) : (
          <>
            <SetupBanner />
            <PastPerformanceAccuracyBanner />

            <OpportunityContextBar proposals={proposalOptions} />

            {selected ? (
              <OpportunityTeamingSummary
                proposalId={selected.id}
                proposal={selectedProposal ?? null}
                opp={{
                  id: `proposal:${selected.id}`,
                  naics: selected.naicsCode ?? null,
                  agency: selected.agency ?? null,
                  setAside: selected.setAside ?? null,
                  vehicle: null,
                }}
                existingPartnerIds={existingPartnerIds}
              />
            ) : (
              <>
                <TargetProfileForm value={targetProfile} onChange={setTargetProfile} />

                <Tabs defaultValue="partners" className="w-full">
                  <TabsList>
                    <TabsTrigger value="partners">
                      <Users className="w-4 h-4 mr-1.5" /> Partner Search
                    </TabsTrigger>
                    <TabsTrigger value="roster">
                      <Building2 className="w-4 h-4 mr-1.5" /> Roster
                    </TabsTrigger>
                    <TabsTrigger value="sandbox">
                      <Swords className="w-4 h-4 mr-1.5" /> Teaming Sandbox
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="partners" className="mt-4">
                    {teamId ? (
                      <PartnerResearch
                        proposalId={partnerResearchProposalId}
                        teamId={teamId}
                        opportunityNaics={effectiveNaics[0] ?? null}
                      />
                    ) : (
                      <Card className="p-6 text-sm text-muted-foreground">
                        Pick a team to search for partners.
                      </Card>
                    )}
                  </TabsContent>

                  <TabsContent value="roster" className="mt-4">
                    <RosterPanel teamId={teamId} />
                  </TabsContent>

                  <TabsContent value="sandbox" className="mt-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Swords className="w-4 h-4" /> Teaming Sandbox
                        </CardTitle>
                        <CardDescription>
                          Drop your company and partners into a scenario and watch pWin update live. Using your target profile as the opportunity context.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">Title: {sandboxOpportunity.title}</Badge>
                          <Badge variant="outline">
                            NAICS: {sandboxOpportunity.naicsCodes.length
                              ? sandboxOpportunity.naicsCodes.join(", ")
                              : "—"}
                          </Badge>
                          <Badge variant="outline">Set-aside: {sandboxOpportunity.setAside ?? "—"}</Badge>
                          <Badge variant="outline">Agency: {sandboxOpportunity.agency ?? "—"}</Badge>
                        </div>
                        <Button onClick={() => setSandboxOpen(true)} disabled={!teamId}>
                          <Swords className="w-4 h-4 mr-1.5" /> Open Teaming Sandbox
                        </Button>
                        {!teamId && (
                          <div className="text-xs text-muted-foreground">
                            Pick a team to run a teaming scenario.
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {teamId && (
                      <TeamingSandbox
                        open={sandboxOpen}
                        onOpenChange={setSandboxOpen}
                        parent={{ kind: "preview", teamId }}
                        opportunity={sandboxOpportunity}
                      />
                    )}
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </main>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Opportunity context bar — selector + actions when an opp is selected.
// ---------------------------------------------------------------------------
function OpportunityContextBar({
  proposals,
}: {
  proposals: ProposalSummary[];
}) {
  const { selected, setSelectedOpportunityId } = useOpportunityContext();
  const NONE = "__none";

  const selector = (
    <Select
      value={selected?.id ?? NONE}
      onValueChange={(v) => setSelectedOpportunityId(v === NONE ? null : v)}
    >
      <SelectTrigger className="h-8 text-xs min-w-[260px]">
        <SelectValue placeholder="Select opportunity" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Global mode — no opportunity</SelectItem>
        {proposals.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.opportunity_title || "Untitled proposal"}
            {p.agency ? ` · ${p.agency}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!selected) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Exploring globally</span>
            <span className="text-muted-foreground">— no opportunity selected</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selector}
            <Button asChild size="sm">
              {/* /opportunities doesn't exist yet — header nav routes it to /discover for now. */}
              <Link to="/discover">
                <Plus className="w-4 h-4 mr-1.5" /> Add opportunity
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <Target className="w-4 h-4 text-primary" />
              <span className="font-medium truncate">{selected.title ?? "Selected opportunity"}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {selected.agency && <Badge variant="outline">{selected.agency}</Badge>}
              {selected.naicsCode && (
                <Badge variant="secondary" className="font-mono">NAICS {selected.naicsCode}</Badge>
              )}
              {selected.setAside && <Badge variant="outline">{selected.setAside}</Badge>}
              {selected.incumbentName && (
                <Badge variant="outline">Incumbent: {selected.incumbentName}</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selector}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedOpportunityId(null)}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <EnrichFromSamButton proposalId={selected.id} />
          <Button asChild size="sm" variant="ghost">
            <Link to="/proposals/$proposalId" params={{ proposalId: selected.id }}>
              Go to proposal <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Target profile editor (shown when no opportunity is selected)
// ---------------------------------------------------------------------------
function TargetProfileForm({
  value,
  onChange,
}: {
  value: TargetProfile;
  onChange: (p: TargetProfile) => void;
}) {
  const patch = (p: Partial<TargetProfile>) => onChange({ ...value, ...p });

  const toggleNaics = (code: string) =>
    patch({
      naics: value.naics.includes(code)
        ? value.naics.filter((c) => c !== code)
        : [...value.naics, code],
    });

  const toggleVehicle = (v: string) =>
    patch({
      requiredVehicles: value.requiredVehicles.includes(v)
        ? value.requiredVehicles.filter((x) => x !== v)
        : [...value.requiredVehicles, v],
    });

  const scopeText = value.scopeKeywords.join(", ");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="w-4 h-4" /> Target profile
        </CardTitle>
        <CardDescription>
          Tune the global exploration — partner search, roster suggestions, and pWin all use this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* NAICS multi-select */}
          <div>
            <Label className="text-xs">NAICS codes</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between mt-1 font-normal">
                  <span className="truncate text-xs">
                    {value.naics.length === 0
                      ? "Select NAICS codes"
                      : `${value.naics.length} selected · ${value.naics.slice(0, 3).join(", ")}${value.naics.length > 3 ? "…" : ""}`}
                  </span>
                  <ChevronDown className="w-4 h-4 ml-2 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] max-h-[360px] overflow-y-auto p-3">
                {NAICS_GROUPS.map((g) => (
                  <div key={g.label} className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                      {g.label}
                    </div>
                    <div className="space-y-1.5">
                      {g.codes.map((c) => (
                        <label
                          key={c.code}
                          className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-1 py-1"
                        >
                          <Checkbox
                            checked={value.naics.includes(c.code)}
                            onCheckedChange={() => toggleNaics(c.code)}
                          />
                          <span className="font-mono text-xs">{c.code}</span>
                          <span className="text-muted-foreground text-xs">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </PopoverContent>
            </Popover>
            {value.naics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {value.naics.map((n) => {
                  const meta = ALL_NAICS_FLAT.find((c) => c.code === n);
                  return (
                    <Badge key={n} variant="secondary" className="text-[10px] font-mono">
                      {n}
                      {meta && <span className="ml-1 font-sans text-muted-foreground">· {meta.name}</span>}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Set-aside */}
          <div>
            <Label className="text-xs">Set-aside</Label>
            <Select
              value={value.setAside ?? "__none"}
              onValueChange={(v) => patch({ setAside: v === "__none" ? null : v })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select set-aside" />
              </SelectTrigger>
              <SelectContent>
                {SET_ASIDE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Agency */}
          <div>
            <Label className="text-xs">Agency</Label>
            <Input
              className="mt-1"
              value={value.agency ?? ""}
              onChange={(e) => patch({ agency: e.target.value || null })}
              placeholder="e.g. Department of Veterans Affairs"
            />
          </div>

          {/* Scope keywords */}
          <div>
            <Label className="text-xs">Scope keywords</Label>
            <Input
              className="mt-1"
              value={scopeText}
              onChange={(e) =>
                patch({
                  scopeKeywords: e.target.value
                    .split(/[,;\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="cloud, cybersecurity, logistics"
            />
            <div className="text-[11px] text-muted-foreground mt-1">Comma-separated.</div>
          </div>
        </div>

        {/* Required vehicles */}
        <div>
          <Label className="text-xs">Required contract vehicles</Label>
          <div className="flex flex-wrap gap-3 mt-2">
            {CONTRACT_VEHICLES.filter((v) => v !== "Custom/Other").map((v) => (
              <label key={v} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox
                  checked={value.requiredVehicles.includes(v)}
                  onCheckedChange={() => toggleVehicle(v)}
                />
                {v}
              </label>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Roster panel — companies for the current team, filterable.
// Display style mirrors src/components/settings/PartnersPanel.tsx.
// ---------------------------------------------------------------------------
type RelationshipFilter = "all" | "active" | "prospective" | "inactive";

function RosterPanel({ teamId }: { teamId: string | null }) {
  const [certFilter, setCertFilter] = useState("");
  const [naicsFilter, setNaicsFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RelationshipFilter>("all");

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ["roster-companies", teamId],
    enabled: !!teamId,
    queryFn: () => listCompanies(teamId!),
  });

  const filtered = useMemo(() => {
    const cert = certFilter.trim().toLowerCase();
    const naics = naicsFilter.trim();
    const vehicle = vehicleFilter.trim().toLowerCase();
    return companies.filter((c: Company) => {
      if (statusFilter !== "all" && c.relationship_status !== statusFilter) return false;
      if (cert && !c.certifications.some((x) => x.toLowerCase().includes(cert))) return false;
      if (naics && !c.naics_codes.some((n) => n.includes(naics))) return false;
      if (vehicle && !c.contract_vehicles.some((v) => v.toLowerCase().includes(vehicle))) return false;
      return true;
    });
  }, [companies, certFilter, naicsFilter, vehicleFilter, statusFilter]);

  if (!teamId) {
    return <Card className="p-6 text-sm text-muted-foreground">Pick a team to view the roster.</Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Roster
        </CardTitle>
        <CardDescription>
          Your own company, teaming partners, primes, and competitors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <Label className="text-[11px]">Certification</Label>
            <Input
              className="h-8 text-xs"
              value={certFilter}
              onChange={(e) => setCertFilter(e.target.value)}
              placeholder="e.g. SDVOSB"
            />
          </div>
          <div>
            <Label className="text-[11px]">NAICS</Label>
            <Input
              className="h-8 text-xs"
              value={naicsFilter}
              onChange={(e) => setNaicsFilter(e.target.value)}
              placeholder="e.g. 541512"
            />
          </div>
          <div>
            <Label className="text-[11px]">Contract vehicle</Label>
            <Input
              className="h-8 text-xs"
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              placeholder="e.g. GSA"
            />
          </div>
          <div>
            <Label className="text-[11px]">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RelationshipFilter)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="prospective">Prospective</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Relationship</TableHead>
              <TableHead>Certifications</TableHead>
              <TableHead>NAICS</TableHead>
              <TableHead>Vehicles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground py-6 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground py-6 text-center">
                  No companies match these filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.id} className={c.is_own_company ? "bg-muted/30" : ""}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {c.is_own_company && <Building2 className="w-4 h-4 text-primary" aria-label="Your company" />}
                    <div>
                      <div className="font-medium">{c.name}</div>
                      {c.uei && <div className="text-[11px] text-muted-foreground font-mono">UEI {c.uei}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {c.is_own_company ? <Badge>Own</Badge>
                    : c.is_existing_partner ? <Badge variant="secondary">Partner</Badge>
                    : <Badge variant="outline">Other</Badge>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{c.relationship_status}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {c.is_own_company ? "—" : (
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      <span className="font-mono">{c.relationship_strength ?? 0}</span>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.certifications.length === 0 ? <span className="text-xs text-muted-foreground">—</span>
                      : c.certifications.slice(0, 3).map((x) => <Badge key={x} variant="outline" className="text-[10px]">{x}</Badge>)}
                    {c.certifications.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.certifications.length - 3}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[180px]">
                    {c.naics_codes.length === 0 ? <span className="text-xs text-muted-foreground">—</span>
                      : c.naics_codes.slice(0, 3).map((n) => <Badge key={n} variant="secondary" className="text-[10px] font-mono">{n}</Badge>)}
                    {c.naics_codes.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.naics_codes.length - 3}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[180px]">
                    {c.contract_vehicles.length === 0 ? <span className="text-xs text-muted-foreground">—</span>
                      : c.contract_vehicles.slice(0, 3).map((v) => <Badge key={v} variant="outline" className="text-[10px]">{v}</Badge>)}
                    {c.contract_vehicles.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.contract_vehicles.length - 3}</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="text-[11px] text-muted-foreground">
          Manage companies in{" "}
          <Link to="/settings" hash="partners" className="underline">
            Capture Intel → Companies
          </Link>.
        </div>
      </CardContent>
    </Card>
  );
}

function EnrichFromSamButton({ proposalId }: { proposalId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { enrichProposalFromSam } = await import("@/lib/sam-enrich");
      const res = await enrichProposalFromSam(proposalId);
      const fields = res.updatedFields.length ? ` · updated ${res.updatedFields.join(", ")}` : "";
      const att = res.attachmentsSaved ? ` · ${res.attachmentsSaved} doc${res.attachmentsSaved === 1 ? "" : "s"}` : "";
      toast.success(`Enriched from SAM.gov${fields}${att}`);
      qc.invalidateQueries({ queryKey: ["capture-workspace-proposal", proposalId] });
      qc.invalidateQueries({ queryKey: ["opportunities-page"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Enrichment failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
      Enrich from SAM.gov
    </Button>
  );
}

