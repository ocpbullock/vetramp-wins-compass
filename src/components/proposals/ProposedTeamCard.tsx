import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HoverCard, HoverCardContent, HoverCardTrigger,
} from "@/components/ui/hover-card";
import { AlertTriangle, Handshake, Info, Trash2, Users, X } from "lucide-react";
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

type Entry = {
  id: string;
  company_id: string;
  role: PwinRole;
  work_share_pct: number | null;
  outreach_status: OutreachStatus;
};

export function ProposedTeamCard({
  proposalId,
  teamId,
  selfName,
  isSelfPrime,
  opportunityNaics,
}: {
  proposalId: string;
  teamId: string;
  selfName: string;
  isSelfPrime: boolean;
  opportunityNaics: string | null;
}) {
  const qc = useQueryClient();

  const { data: entries = [] } = useQuery({
    queryKey: ["proposed-team-entries", proposalId],
    queryFn: async (): Promise<Entry[]> => {
      const { data, error } = await supabase
        .from("proposal_teaming")
        .select("id, company_id, role, work_share_pct, outreach_status")
        .eq("proposal_id", proposalId)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as Entry[];
    },
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["capture-partners", teamId],
    enabled: !!teamId,
    queryFn: () => listPartnerCompanies(teamId),
  });

  const partnerById = useMemo(
    () => new Map(partners.map((p) => [p.id, p])),
    [partners],
  );

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["proposal-teaming", proposalId] });
    qc.invalidateQueries({ queryKey: ["capture-entries", proposalId] });
    qc.invalidateQueries({ queryKey: ["pwin-entries", proposalId] });
    qc.invalidateQueries({ queryKey: ["capture-partners", teamId] });
    qc.invalidateQueries({ queryKey: ["pwin-partners", teamId] });
    qc.invalidateQueries({ queryKey: ["suggest-partners", teamId] });
    qc.invalidateQueries({ queryKey: ["teaming-partners", teamId] });
  };

  const patchEntry = async (id: string, patch: Partial<Entry>) => {
    const { error } = await supabase.from("proposal_teaming").update(patch as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    invalidateAll();
  };

  const updateOutreach = async (e: Entry, status: OutreachStatus) => {
    const { error } = await supabase
      .from("proposal_teaming")
      .update({ outreach_status: status } as any)
      .eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    if ((status === "nda_signed" || status === "ta_signed") && e.company_id) {
      const patch: { has_nda: boolean; has_teaming_agreement?: boolean } = { has_nda: true };
      if (status === "ta_signed") patch.has_teaming_agreement = true;
      await supabase.from("companies").update(patch).eq("id", e.company_id);
    }
    invalidateAll();
  };

  const removeEntry = async (id: string) => {
    const { error } = await supabase.from("proposal_teaming").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Partner removed");
    invalidateAll();
  };

  const partnerShare = entries.reduce(
    (s, e) => s + (Number(e.work_share_pct) || 0),
    0,
  );
  const selfShare = isSelfPrime ? Math.max(0, 100 - partnerShare) : 0;
  const total = selfShare + partnerShare;
  const over = total > 100;

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
            <div className="tabular-nums">{entries.length + 1} member{entries.length === 0 ? "" : "s"}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Self row */}
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5">
          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">Us</Badge>
          <div className="text-sm font-medium truncate flex-1">{selfName}</div>
          <span className="text-[10px] text-muted-foreground uppercase">
            {isSelfPrime ? "Prime" : "Sub"}
          </span>
          <span className="text-xs tabular-nums w-16 text-right">{selfShare}%</span>
          <div className="w-[92px]" />
          <div className="w-6" />
        </div>

        {entries.length === 0 && (
          <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
            No partners yet — add from suggestions below.
          </div>
        )}

        {entries.map((e) => {
          const p = partnerById.get(e.company_id);
          return (
            <ProposedRow
              key={e.id}
              entry={e}
              partner={p ?? null}
              opportunityNaics={opportunityNaics}
              onRoleChange={(r) => patchEntry(e.id, { role: r })}
              onShareChange={(v) => patchEntry(e.id, { work_share_pct: v })}
              onOutreachChange={(s) => updateOutreach(e, s)}
              onRemove={() => removeEntry(e.id)}
            />
          );
        })}

        {/* Total share bar */}
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

function ProposedRow({
  entry,
  partner,
  opportunityNaics,
  onRoleChange,
  onShareChange,
  onOutreachChange,
  onRemove,
}: {
  entry: Entry;
  partner: PartnerView | null;
  opportunityNaics: string | null;
  onRoleChange: (r: PwinRole) => void;
  onShareChange: (v: number) => void;
  onOutreachChange: (s: OutreachStatus) => void;
  onRemove: () => void;
}) {
  const [share, setShare] = useState<string>(String(entry.work_share_pct ?? 0));

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

  const commitShare = () => {
    const n = Math.max(0, Math.min(100, Number(share) || 0));
    if (n !== (entry.work_share_pct ?? 0)) onShareChange(n);
    setShare(String(n));
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
          value={share}
          onChange={(e) => setShare(e.target.value)}
          onBlur={commitShare}
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
