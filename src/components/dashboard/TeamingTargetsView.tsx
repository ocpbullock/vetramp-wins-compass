import { useMemo, useState } from "react";
import { Users, Crown, HandshakeIcon, Save, Sparkles, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import {
  deriveTeamingTargets, companyFromTeamingTarget, type TeamingTarget,
} from "@/lib/teaming-targets";
import { listCompanies, upsertCompany } from "@/lib/companies";
import type { HistoricalAward } from "@/lib/api";

const fmtMoney = (n: number) =>
  n >= 1_000_000_000 ? `$${(n / 1e9).toFixed(2)}B`
  : n >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M`
  : n >= 1_000 ? `$${(n / 1e3).toFixed(0)}K`
  : `$${n.toFixed(0)}`;

const monthsSince = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30)));
};

export function TeamingTargetsView({
  awards,
  agency,
  naicsCodes,
  teamId,
  onAddToSandbox,
}: {
  awards: HistoricalAward[];
  agency: string | null;
  naicsCodes: string[];
  /** Required to enable save/add actions. */
  teamId: string | null;
  /** If provided, "Add to sandbox" is enabled and called with the saved company id. */
  onAddToSandbox?: (companyId: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "prime" | "partner">("all");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // local map of vendor-key -> saved company id (so subsequent "Add" reuses it)
  const [savedIds, setSavedIds] = useState<Record<string, string>>({});

  const allTargets = useMemo(
    () => deriveTeamingTargets(awards, { agency, limit: 30 }),
    [awards, agency],
  );
  const targets = useMemo(
    () => filter === "all" ? allTargets : allTargets.filter((t) => t.classification === filter),
    [allTargets, filter],
  );
  const primeCount = allTargets.filter((t) => t.classification === "prime").length;
  const partnerCount = allTargets.length - primeCount;

  const keyFor = (t: TeamingTarget) => t.uei || t.name;

  const saveAsCompany = async (t: TeamingTarget): Promise<string | null> => {
    if (!teamId) { toast.error("No team context available."); return null; }
    const key = keyFor(t);
    if (savedIds[key]) return savedIds[key];
    try {
      setSavingKey(key);
      // Dedup by UEI within the team's existing companies.
      const existing = await listCompanies(teamId);
      const match = t.uei
        ? existing.find((c) => c.uei && c.uei.toUpperCase() === t.uei!.toUpperCase())
        : existing.find((c) => c.name.toLowerCase() === t.name.toLowerCase());
      let id: string;
      if (match) {
        id = match.id;
        toast.info(`"${t.name}" is already in your company library.`);
      } else {
        const draft = companyFromTeamingTarget(t, teamId, { naicsCodes, agency });
        const created = await upsertCompany(draft);
        id = created.id;
        toast.success(`Saved "${t.name}" to companies.`);
      }
      setSavedIds((prev) => ({ ...prev, [key]: id }));
      return id;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save company.");
      return null;
    } finally {
      setSavingKey(null);
    }
  };

  const addToSandbox = async (t: TeamingTarget) => {
    const id = await saveAsCompany(t);
    if (id && onAddToSandbox) onAddToSandbox(id);
  };

  if (allTargets.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        No vendor candidates found in the cached award data for this NAICS{agency ? ` / ${agency}` : ""}.
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4" /> Teaming Targets
          <span className="text-[11px] font-normal text-muted-foreground">
            vendors with proven past performance on comparable work
          </span>
        </h3>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as typeof filter)}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="all" className="h-7 px-2 text-xs">All ({allTargets.length})</ToggleGroupItem>
          <ToggleGroupItem value="prime" className="h-7 px-2 text-xs">
            <Crown className="w-3 h-3 mr-1" />Potential primes ({primeCount})
          </ToggleGroupItem>
          <ToggleGroupItem value="partner" className="h-7 px-2 text-xs">
            <HandshakeIcon className="w-3 h-3 mr-1" />Potential partners ({partnerCount})
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="text-[11px] text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-1 mr-3"><Crown className="w-3 h-3 text-amber-500" />Large incumbents — strong candidates to <strong>sub under as their teammate</strong>.</span>
        <span className="inline-flex items-center gap-1"><HandshakeIcon className="w-3 h-3 text-emerald-500" />Small businesses — strong candidates as <strong>teaming partners</strong> when you prime.</span>
      </div>

      <div className="border rounded-md divide-y">
        {targets.map((t) => {
          const key = keyFor(t);
          const months = monthsSince(t.latestAwardDate);
          const saved = !!savedIds[key];
          const isSaving = savingKey === key;
          return (
            <div key={key} className="px-3 py-2.5 flex items-start gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{t.name}</span>
                  {t.classification === "prime" ? (
                    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 text-[10px]">
                      <Crown className="w-3 h-3 mr-1" />Potential prime
                    </Badge>
                  ) : (
                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 text-[10px]">
                      <HandshakeIcon className="w-3 h-3 mr-1" />Potential partner
                    </Badge>
                  )}
                  {t.isSmallBusiness && (
                    <Badge variant="outline" className="text-[10px]">
                      {t.latestSetAside?.slice(0, 24) ?? "Small business"}
                    </Badge>
                  )}
                  {t.uei && (
                    <a
                      href={`https://www.usaspending.gov/recipient/${encodeURIComponent(t.uei)}/latest`}
                      target="_blank" rel="noreferrer"
                      className="text-muted-foreground hover:text-primary"
                      title="View on USAspending.gov"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                  <span><span className="font-mono">{t.awardCount}</span> award{t.awardCount !== 1 ? "s" : ""}</span>
                  <span className="font-medium text-foreground tabular-nums">{fmtMoney(t.totalValue)}</span>
                  {t.latestAwardDate && (
                    <span>
                      latest <span className="font-mono">{t.latestAwardDate.slice(0, 10)}</span>
                      {months !== null && <> · {months} mo ago</>}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant={saved ? "outline" : "secondary"}
                  className="h-7 text-xs"
                  disabled={!teamId || isSaving}
                  onClick={() => saveAsCompany(t)}
                  title="Save this vendor to your company library"
                >
                  <Save className="w-3 h-3 mr-1" />
                  {saved ? "Saved" : isSaving ? "Saving…" : "Save as company"}
                </Button>
                {onAddToSandbox && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={!teamId || isSaving}
                    onClick={() => addToSandbox(t)}
                    title="Save and add to a teaming sandbox scenario"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    Add to sandbox
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
