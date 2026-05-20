import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, Trash2, Users, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Partner } from "@/components/settings/PartnersPanel";
import { TeamCompositionAnalyzer } from "./TeamCompositionAnalyzer";

const ROLES = [
  { value: "prime", label: "Prime" },
  { value: "sub", label: "Sub" },
  { value: "mentor", label: "Mentor" },
  { value: "protege", label: "Protégé" },
  { value: "jv_partner", label: "JV partner" },
] as const;
type RoleValue = typeof ROLES[number]["value"];

const ROLE_VARIANT: Record<RoleValue, "default" | "secondary" | "outline"> = {
  prime: "default",
  sub: "secondary",
  mentor: "outline",
  protege: "outline",
  jv_partner: "outline",
};

export type TeamingEntry = {
  id: string;
  proposal_id: string;
  partner_id: string;
  role: RoleValue;
  work_share_pct: number | null;
  naics_contribution: string[];
  notes: string | null;
  partner?: Partner;
};

export function TeamingCard({
  proposalId, teamId, opportunityNaics, proposal,
}: {
  proposalId: string;
  teamId: string | null;
  opportunityNaics?: string | null;
  proposal?: any;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);

  const { data: partners = [] } = useQuery({
    queryKey: ["teaming-partners", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaming_partners").select("*")
        .eq("team_id", teamId!)
        .order("company_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Partner[];
    },
  });

  const { data: entries = [], refetch } = useQuery({
    queryKey: ["proposal-teaming", proposalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_teaming")
        .select("*, partner:partner_id ( * )")
        .eq("proposal_id", proposalId)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as TeamingEntry[];
    },
  });

  const usedIds = useMemo(() => new Set(entries.map((e) => e.partner_id)), [entries]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter((p) =>
      !usedIds.has(p.id) && (
        !q || p.company_name.toLowerCase().includes(q) ||
        p.certifications.some((c) => c.toLowerCase().includes(q)) ||
        p.naics_codes.some((n) => n.includes(q))
      ),
    );
  }, [partners, usedIds, search]);

  const addPartner = async (partner: Partner) => {
    const overlap = opportunityNaics
      ? partner.naics_codes.filter((n) => n === opportunityNaics)
      : [];
    const { error } = await supabase.from("proposal_teaming").insert({
      proposal_id: proposalId,
      partner_id: partner.id,
      role: "sub",
      work_share_pct: null,
      naics_contribution: overlap,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${partner.company_name}`);
    setPicker(false);
    setSearch("");
    refetch();
    qc.invalidateQueries({ queryKey: ["proposal-teaming", proposalId] });
  };

  const updateEntry = async (id: string, patch: Partial<Pick<TeamingEntry, "role" | "work_share_pct">>) => {
    const { error } = await supabase.from("proposal_teaming").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    refetch();
  };

  const removeEntry = async (id: string) => {
    const { error } = await supabase.from("proposal_teaming").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refetch();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Teaming</CardTitle>
          <CardDescription>Partners on this bid, their role, and work share.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {proposal && (
            <Button size="sm" variant="secondary" onClick={() => setAnalyzerOpen(true)} disabled={!teamId}>
              <Sparkles className="w-4 h-4 mr-1" /> Analyze team
            </Button>
          )}
          <Popover open={picker} onOpenChange={setPicker}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={!teamId}>
              <Plus className="w-4 h-4 mr-1" /> Add partner
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="end">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search partners…" className="pl-7 h-8 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-y-auto mt-2 space-y-1">
              {partners.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">No partners yet. Add some in Settings → Teaming Partners.</div>
              )}
              {partners.length > 0 && filtered.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">No matches.</div>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addPartner(p)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-sm"
                >
                  <div className="font-medium">{p.company_name}</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {p.certifications.slice(0, 4).map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.length === 0 && (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
            No teaming partners on this bid yet.
          </div>
        )}
        {entries.map((e) => {
          const naicsHit = opportunityNaics && e.partner?.naics_codes.includes(opportunityNaics);
          return (
            <div key={e.id} className="border border-border rounded-md p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{e.partner?.company_name ?? "Unknown partner"}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant={ROLE_VARIANT[e.role]} className="text-[10px]">
                      {ROLES.find((r) => r.value === e.role)?.label}
                    </Badge>
                    {(e.partner?.certifications ?? []).map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                    ))}
                    {naicsHit && (
                      <Badge variant="secondary" className="text-[10px] font-mono">NAICS {opportunityNaics} ✓</Badge>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeEntry(e.id)} aria-label="Remove">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">Role</Label>
                  <Select value={e.role} onValueChange={(v) => updateEntry(e.id, { role: v as RoleValue })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">Work share %</Label>
                  <Input
                    type="number" min={0} max={100}
                    className="h-8 text-xs"
                    value={e.work_share_pct ?? ""}
                    onChange={(ev) => {
                      const v = ev.target.value === "" ? null : Math.min(100, Math.max(0, Number(ev.target.value)));
                      updateEntry(e.id, { work_share_pct: v });
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {entries.length > 0 && (
          <TotalShare entries={entries} />
        )}
      </CardContent>
    </Card>
  );
}

function TotalShare({ entries }: { entries: TeamingEntry[] }) {
  const total = entries.reduce((s, e) => s + (e.work_share_pct ?? 0), 0);
  return (
    <div className="text-xs text-muted-foreground flex items-center justify-between border-t border-border pt-2">
      <span>Allocated work share</span>
      <span className={total > 100 ? "text-destructive font-medium" : "font-medium"}>
        {total}% {total > 100 && "(over 100%)"}
      </span>
    </div>
  );
}

// Helper used by the proposal page to fetch teaming context for AI generation
export async function fetchTeamingForProposal(proposalId: string): Promise<TeamingEntry[]> {
  const { data, error } = await supabase
    .from("proposal_teaming")
    .select("*, partner:partner_id ( * )")
    .eq("proposal_id", proposalId);
  if (error) return [];
  return (data ?? []) as TeamingEntry[];
}
