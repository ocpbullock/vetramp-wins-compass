import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Lightbulb, Plus, Mail, AlertTriangle, ShieldCheck, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  rankPartnerSuggestions,
  type PartnerSuggestion,
  type SuggestContext,
  type SuggestPartner,
  type SuggestSelf,
  type Confidence,
} from "@/lib/partner-suggest";
import type { PartnerView as Partner } from "@/lib/companies";
import type { OutreachPartnerInput } from "./TeamingOutreachModal";

type ProposalLite = {
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
};

const CONFIDENCE_BADGE: Record<Confidence, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  high: { label: "High confidence", variant: "default" },
  medium: { label: "Medium confidence", variant: "secondary" },
  low: { label: "Low confidence", variant: "outline" },
  not_enough_data: { label: "Not enough data", variant: "outline" },
};

export function SuggestedPartnersCard({
  proposal,
  existingPartnerIds,
  onAdd,
  onOutreach,
}: {
  proposal: ProposalLite;
  existingPartnerIds: string[];
  onAdd: (s: PartnerSuggestion) => void | Promise<void>;
  onOutreach: (p: OutreachPartnerInput) => void;
}) {
  const teamId = proposal.team_id;

  const { data: partners = [], isLoading: loadingPartners } = useQuery({
    queryKey: ["suggest-partners", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const { listPartnerCompanies } = await import("@/lib/companies");
      return listPartnerCompanies(teamId!);
    },
  });

  const { data: selfProfile } = useQuery({
    queryKey: ["suggest-self", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const [profRes, vehRes] = await Promise.all([
        supabase.from("company_profile").select("profile_data").eq("team_id", teamId!).maybeSingle(),
        supabase.from("contract_vehicles").select("vehicle_name").eq("team_id", teamId!).eq("status", "active"),
      ]);
      const pd = (profRes.data?.profile_data ?? {}) as any;
      const self: SuggestSelf = {
        certifications: pd.certifications || pd.socioeconomic_certifications || [],
        naics_codes: pd.naics_codes || [],
        contract_vehicles: (vehRes.data ?? []).map((v: any) => v.vehicle_name),
      };
      return self;
    },
  });

  const suggestions = useMemo<PartnerSuggestion[]>(() => {
    if (!selfProfile || partners.length === 0) return [];
    const ctx: SuggestContext = {
      engagementType: proposal.engagement_type,
      opportunityNaics: [proposal.naics_code].filter(Boolean) as string[],
      opportunityAgency: proposal.agency,
      setAside: proposal.set_aside,
      requiredVehicles: proposal.contract_type
        && /OASIS|STARS|GWAC|SEWP|CIO-SP|VETS/i.test(proposal.contract_type)
        ? [proposal.contract_type] : [],
      scopeKeywords: (proposal.targeted_scope_areas ?? "")
        .split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
      incumbentName: proposal.customer_intel?.predecessor_contract?.incumbent ?? null,
      primeContractorName: proposal.prime_contractor_name,
    };
    const partnersIn: SuggestPartner[] = partners.map((p) => ({
      id: p.id,
      company_name: p.company_name,
      certifications: p.certifications ?? [],
      naics_codes: p.naics_codes ?? [],
      contract_vehicles: (p as any).contract_vehicles ?? [],
      capabilities_summary: p.capabilities_summary,
      past_performance_summary: p.past_performance_summary,
      notes: p.notes,
      relationship_status: p.relationship_status,
    }));
    return rankPartnerSuggestions(ctx, selfProfile, partnersIn, existingPartnerIds, { limit: 8 });
  }, [partners, selfProfile, proposal, existingPartnerIds]);

  const partnerById = useMemo(() =>
    new Map(partners.map((p) => [p.id, p])), [partners]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary" /> Suggested Teaming Partners
        </CardTitle>
        <CardDescription>
          Ranked from your team roster against this opportunity. Scores are heuristic estimates — not guaranteed fit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!teamId && (
          <EmptyState text="Save the proposal to a team to enable partner suggestions." />
        )}
        {teamId && loadingPartners && (
          <EmptyState text="Loading partner roster…" />
        )}
        {teamId && !loadingPartners && partners.length === 0 && (
          <EmptyState text="No teaming partners on file. Add some in Settings → Teaming Partners to get suggestions." />
        )}
        {teamId && partners.length > 0 && suggestions.length === 0 && (
          <EmptyState text="No partners matched this opportunity well. Try adding more profile detail to your partners." />
        )}
        {suggestions.length > 0 && (
          <ScrollArea className="h-[420px] pr-3">
            <ul className="space-y-1.5">
              {suggestions.map((s) => (
                <SuggestionRow
                  key={s.partnerId}
                  suggestion={s}
                  onAdd={() => onAdd(s)}
                  onOutreach={() => {
                    const p = partnerById.get(s.partnerId);
                    if (!p) { toast.error("Partner not found"); return; }
                    onOutreach({ ...(p as any), id: p.id });
                  }}
                />
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
      {text}
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-amber-600";
  return "text-destructive";
}

function SuggestionRow({
  suggestion: s, onAdd, onOutreach,
}: {
  suggestion: PartnerSuggestion;
  onAdd: () => void;
  onOutreach: () => void;
}) {
  const conf = CONFIDENCE_BADGE[s.confidence];
  const [expanded, setExpanded] = useState(false);
  const hasDetails = s.reasons.length > 0 || s.gapsCovered.length > 0 || s.risks.length > 0 || !!s.outreachAngle;
  return (
    <li className="border border-border rounded-md px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={!hasDetails}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 shrink-0"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-sm truncate">{s.partnerName}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{s.bestRoleLabel}</Badge>
            <Badge variant={conf.variant} className="text-[10px] px-1.5 py-0 h-4">{conf.label}</Badge>
            <span className="text-[10px] text-muted-foreground">{s.workshareRange[0]}–{s.workshareRange[1]}% WS</span>
          </div>
        </div>
        <div className={`text-base font-bold tabular-nums shrink-0 ${scoreColor(s.fitScore)}`}>{s.fitScore}</div>
        <Button size="sm" variant="outline" className="h-6 px-1.5" onClick={onAdd} aria-label="Add to team">
          <Plus className="w-3 h-3" />
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onOutreach} aria-label="Draft outreach">
          <Mail className="w-3 h-3" />
        </Button>
      </div>
      {expanded && hasDetails && (
        <div className="pl-5 pt-2 space-y-2">
          {s.reasons.length > 0 && (
            <Section icon={<ShieldCheck className="w-3.5 h-3.5 text-green-600" />} title="Why they fit">
              {s.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </Section>
          )}
          {s.gapsCovered.length > 0 && (
            <Section icon={<Sparkles className="w-3.5 h-3.5 text-primary" />} title="Gaps covered">
              {s.gapsCovered.map((g, i) => <li key={i}>{g}</li>)}
            </Section>
          )}
          {s.risks.length > 0 && (
            <Section icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-600" />} title="Risks / unknowns">
              {s.risks.map((r, i) => <li key={i}>{r}</li>)}
            </Section>
          )}
          {s.outreachAngle && (
            <div className="text-[11px] text-muted-foreground italic border-t border-border pt-2">
              <span className="not-italic font-medium">Outreach angle:</span> {s.outreachAngle}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onAdd}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add to team
            </Button>
            <Button size="sm" variant="ghost" onClick={onOutreach}>
              <Mail className="w-3.5 h-3.5 mr-1" /> Draft outreach
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function Section({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon} {title}
      </div>
      <ul className="list-disc pl-5 text-[12px] mt-0.5 space-y-0.5">
        {children}
      </ul>
    </div>
  );
}
