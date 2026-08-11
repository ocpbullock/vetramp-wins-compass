import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookmarkPlus, Loader2, AlertTriangle, ExternalLink, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";
import { getVendorProfile } from "@/lib/api";
import { researchVendor, type VendorResearch } from "@/lib/api";
import { useTeam } from "@/lib/team";
import { companyFromVendorLookup, upsertCompany } from "@/lib/companies";
import { useServerFn } from "@tanstack/react-start";
import { getFedSpendSubawards } from "@/lib/fedspend.functions";
import type { SubawardsResponse } from "@/lib/fedspend-types";

// Session-only cache: keyed by UEI when present, else normalized name. Cleared on reload.
const researchCache = new Map<string, VendorResearch>();
const cacheKeyFor = (uei?: string | null, name?: string | null) =>
  (uei && uei.trim()) ? `uei:${uei.trim().toUpperCase()}`
  : (name && name.trim()) ? `name:${name.trim().toLowerCase()}` : "";

function fmtUsd(n?: number | null) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

export function VendorDetailDrawer({
  recipientId, vendorName, uei, searchedNaics, onClose,
}: {
  recipientId: string | null;
  vendorName: string | null;
  /** Known UEI, when the caller already resolved one. Skips fragile name resolution. */
  uei?: string | null;
  searchedNaics: string[];
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // When the name-only path returns multiple SAM matches, the user picks one
  // and we re-run by UEI.
  const [selectedUei, setSelectedUei] = useState<string | null>(null);
  const [research, setResearch] = useState<VendorResearch | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const { currentTeam, userRole } = useTeam();
  const canSave = !!currentTeam && (userRole === "owner" || userRole === "admin" || userRole === "member");

  useEffect(() => {
    if (!recipientId && !vendorName && !uei) { setData(null); setError(null); setSelectedUei(null); setResearch(null); return; }
    setLoading(true); setError(null); setData(null); setSelectedUei(null); setResearch(null); setResearchError(null);
    // Pass every signal we have — the function prefers UEI over name resolution.
    getVendorProfile({ uei: uei ?? null, recipientId, vendorName })
      .then(setData)
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [recipientId, vendorName, uei]);


  // Hydrate cached AI research once the drawer knows the resolved identity.
  useEffect(() => {
    const key = cacheKeyFor(data?.resolved?.uei, data?.resolved?.legal_name ?? vendorName);
    if (key && researchCache.has(key)) setResearch(researchCache.get(key)!);
  }, [data?.resolved?.uei, data?.resolved?.legal_name, vendorName]);

  const runResearch = async () => {
    const displayName = data?.resolved?.legal_name ?? vendorName ?? null;
    const ueiVal = data?.resolved?.uei ?? null;
    if (!displayName && !ueiVal) { setResearchError("No vendor identity to research."); return; }
    setResearching(true); setResearchError(null);
    try {
      const knownContracts = (data?.contracts ?? []).slice(0, 5).map((c: any) => ({
        piid: c["Award ID"], naics: c.NAICS, agency: c["Awarding Agency"] ?? c["Awarding Sub Agency"],
        amount: Number(c["Award Amount"]) || undefined, end: c["End Date"]?.slice(0, 10),
      }));
      const { research: r } = await researchVendor({ name: displayName, uei: ueiVal, knownContracts });
      setResearch(r);
      const key = cacheKeyFor(ueiVal, displayName);
      if (key) researchCache.set(key, r);
    } catch (e: any) {
      setResearchError(e?.message ?? "vendor-research: research failed");
    } finally {
      setResearching(false);
    }
  };

  const pickCandidate = (pickedUei: string) => {
    setSelectedUei(pickedUei);
    setLoading(true); setError(null); setData(null);
    getVendorProfile({ uei: pickedUei })
      .then(setData)
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  };


  const saveAsCompany = async () => {
    if (!currentTeam || !data) return;
    setSaving(true);
    try {
      const draft = companyFromVendorLookup(
        { ...data, recipientId: data?.resolved?.uei ?? recipientId, recipientName: data?.resolved?.legal_name ?? vendorName },
        currentTeam.id,
      );
      await upsertCompany(draft);
      toast.success(`Saved ${draft.name} to companies`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const open = !!(recipientId || vendorName);
  const sharedNaics = new Set(searchedNaics);
  const overlapNaics: string[] = data?.naicsBreakdown
    ?.filter((n: any) => sharedNaics.has(n.code))
    .map((n: any) => n.code) ?? [];

  const assessment = !data || data.multipleMatches
    ? ""
    : overlapNaics.length >= 2
    ? "Direct competitor"
    : overlapNaics.length === 1
    ? "Potential competitor in shared NAICS"
    : "Different market segment — possible teaming partner";

  const resolved = data?.resolved;
  const warning = data?.summary?.warningFlag;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">{resolved?.legal_name ?? vendorName ?? "Vendor"}</SheetTitle>
          {resolved && (
            <div className="text-[11px] font-mono text-muted-foreground">
              UEI {resolved.uei}
              {resolved.city || resolved.state
                ? <span className="ml-2 font-sans">· {[resolved.city, resolved.state].filter(Boolean).join(", ")}</span>
                : null}
            </div>
          )}
          {resolved?.business_types?.length ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {(resolved.business_types as string[]).slice(0, 6).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          ) : null}
        </SheetHeader>

        {data && !data.multipleMatches && canSave && (
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={saveAsCompany} disabled={saving}>
              {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <BookmarkPlus className="w-3 h-3 mr-1" />}
              Save as company
            </Button>
          </div>
        )}

        {(data?.resolved || vendorName) && !data?.multipleMatches && (
          <VerifyExternally
            uei={data?.resolved?.uei ?? null}
            name={data?.resolved?.legal_name ?? vendorName ?? null}
          />
        )}

        {data && !data.multipleMatches && (
          <AiResearchBlock
            research={research}
            researching={researching}
            error={researchError}
            onRun={runResearch}
          />
        )}

        {error && (
          <div className="mt-4 border border-border rounded-md p-2.5">
            <div className="text-[10px] uppercase opacity-60 mb-1">Vendor profile</div>
            <SectionError message={`Profile unavailable — ${error}`} />
          </div>
        )}
        {loading && <div className="space-y-3 mt-4"><Skeleton className="h-20" /><Skeleton className="h-32" /></div>}


        {data?.multipleMatches && (
          <div className="mt-4 space-y-2">
            <div className="text-xs text-muted-foreground">
              Multiple SAM entities match "{data.query}". Pick one to load its contracts.
            </div>
            {(data.candidates ?? []).map((c: any) => (
              <button
                key={c.uei}
                type="button"
                onClick={() => pickCandidate(c.uei)}
                className={`w-full text-left p-2 rounded border border-border hover:bg-muted/40 text-xs ${
                  selectedUei === c.uei ? "ring-1 ring-primary" : ""
                }`}
              >
                <div className="font-medium">{c.legal_name ?? "(no name)"}</div>
                <div className="font-mono text-[10px] text-muted-foreground">UEI {c.uei}</div>
                {(c.city || c.state) && (
                  <div className="text-[10px] text-muted-foreground">{[c.city, c.state].filter(Boolean).join(", ")}</div>
                )}
              </button>
            ))}
          </div>
        )}

        {data && !data.multipleMatches && (
          <div className="space-y-4 mt-4 text-xs">
            {warning === "unusually_large_total" && (
              <div className="flex items-start gap-2 p-2 rounded border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div>Total obligated is unusually large for a single vendor. Verify the resolved identity above matches the company you meant.</div>
              </div>
            )}
            {data.summary?.noAwards ? (
              <div className="p-2 rounded border border-border bg-muted/30 text-muted-foreground">
                No federal prime awards found for this UEI in the last 5 years.
              </div>
            ) : (data.summary?.droppedCount > 0 && (
              <div className="text-[10px] text-muted-foreground">
                Filtered out {data.summary.droppedCount} contract{data.summary.droppedCount === 1 ? "" : "s"} that didn't match this UEI or legal name.
              </div>
            ))}

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Contracts" v={String(data.summary.totalContracts)} />
              <Stat label="Obligated to this vendor" v={fmtUsd(data.summary.obligatedTotal ?? data.summary.totalValue)} />
              <Stat label="Active" v={String(data.summary.activeCount)} />
            </div>

            <div>
              <div className="text-[10px] uppercase opacity-60 mb-1">Assessment</div>
              <div className="p-2 rounded bg-muted/40 border border-border">{assessment}</div>
            </div>

            <Section title={`Top NAICS (${data.naicsBreakdown.length})`}>
              {data.naicsBreakdown.slice(0, 6).map((n: any) => (
                <div key={n.code} className={`flex justify-between py-1 ${sharedNaics.has(n.code) ? "text-primary font-medium" : ""}`}>
                  <span className="font-mono">{n.code}</span>
                  <span>{n.awards} · {fmtUsd(n.obligatedTotal ?? n.totalValue)}</span>
                </div>
              ))}
            </Section>

            <Section title={`Top Agencies (${data.agencyBreakdown.length})`}>
              {data.agencyBreakdown.slice(0, 6).map((a: any) => (
                <div key={a.name} className="flex justify-between py-1 gap-2">
                  <span className="truncate">{a.name}</span>
                  <span className="whitespace-nowrap">{a.awards} · {fmtUsd(a.obligatedTotal ?? a.totalValue)}</span>
                </div>
              ))}
            </Section>

            <Section title="Recent Contracts">
              <div className="overflow-x-auto -mx-2">
                <table className="w-full">
                  <thead><tr className="text-left opacity-60"><th className="px-2 py-1">PIID</th><th>NAICS</th><th className="text-right px-2">Obligated</th><th>End</th></tr></thead>
                  <tbody>
                    {data.contracts.slice(0, 15).map((c: any, i: number) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-2 py-1 font-mono">{c["Award ID"]}</td>
                        <td className="font-mono">{c.NAICS}</td>
                        <td className="text-right px-2 font-mono">{fmtUsd(Number(c["Award Amount"]))}</td>
                        <td>{c["End Date"]?.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <SubRelationships
              teamId={currentTeam?.id ?? null}
              companyName={data?.resolved?.legal_name ?? vendorName ?? null}
            />
          </div>

        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="p-2 rounded border border-border bg-muted/30">
      <div className="text-[10px] uppercase opacity-60">{label}</div>
      <div className="font-mono font-semibold">{v}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase opacity-60 mb-1">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function VerifyExternally({ uei, name }: { uei: string | null; name: string | null }) {
  const samUrl = uei ? `https://sam.gov/entity/${encodeURIComponent(uei)}/coreData` : null;
  const usaUrl = uei
    ? `https://www.usaspending.gov/recipient/${encodeURIComponent(uei)}-C/latest`
    : name
    ? `https://www.usaspending.gov/search/?filters=%7B%22keywords%22%3A%5B%22${encodeURIComponent(name)}%22%5D%7D`
    : null;
  const newsUrl = name
    ? `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(`"${name}" contract award`)}`
    : null;
  const items: { href: string; label: string }[] = [];
  if (samUrl) items.push({ href: samUrl, label: "SAM.gov entity" });
  if (usaUrl) items.push({ href: usaUrl, label: "USAspending recipient" });
  if (newsUrl) items.push({ href: newsUrl, label: "Google News: contract awards" });
  if (items.length === 0) return null;
  return (
    <div className="mt-4 border border-border rounded-md p-2.5">
      <div className="text-[10px] uppercase opacity-60 mb-1.5">Verify externally</div>
      <div className="flex flex-col gap-1">
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {it.label} <ExternalLink className="w-3 h-3" />
          </a>
        ))}
      </div>
    </div>
  );
}

function AiResearchBlock({
  research, researching, onRun,
}: {
  research: VendorResearch | null;
  researching: boolean;
  onRun: () => void;
}) {
  return (
    <div className="mt-4 border border-border rounded-md p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase opacity-60">AI research (verify before relying)</div>
        <Button size="sm" variant="outline" onClick={onRun} disabled={researching} className="h-7 text-xs">
          {researching ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
          {research ? "Re-run" : "AI research this vendor"}
        </Button>
      </div>
      <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-warning">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>Model-generated. May contain errors or omissions — verify each claim against SAM/USAspending/news before acting on it.</span>
      </div>
      {research && (
        <div className="mt-3 space-y-2.5 text-xs">
          <div>
            <div className="text-[10px] uppercase opacity-60 mb-0.5">Overview</div>
            <p className="whitespace-pre-wrap">{research.overview}</p>
          </div>
          {research.focus_areas?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase opacity-60 mb-1">Focus areas</div>
              <div className="flex flex-wrap gap-1">
                {research.focus_areas.map((f, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{f}</Badge>
                ))}
              </div>
            </div>
          )}
          {research.notable_wins?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase opacity-60 mb-1">Notable wins</div>
              <ul className="space-y-1">
                {research.notable_wins.map((w, i) => (
                  <li key={i} className="border border-border/60 rounded p-1.5">
                    <div className="font-medium">{w.what}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {w.customer}{w.year ? ` · ${w.year}` : ""}
                    </div>
                    {w.source_url && (
                      <a
                        href={w.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        source <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            <div>
              <div className="text-[10px] uppercase opacity-60">Size / set-aside posture</div>
              <div>{research.size_posture}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase opacity-60">Teaming angle</div>
              <div>{research.teaming_angle}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase opacity-60">Confidence notes</div>
              <div className="text-muted-foreground italic">{research.confidence_notes}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Prime/sub relationship lists from Fed-Spend. Loaded on demand (the provider
 * is rate-limited to 10 requests/minute), cached per team for 7 days.
 */
function SubRelationships({ teamId, companyName }: { teamId: string | null; companyName: string | null }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SubawardsResponse | null>(null);
  const fetchSubs = useServerFn(getFedSpendSubawards);

  useEffect(() => { setResult(null); setErr(null); }, [companyName]);

  if (!teamId || !companyName) return null;

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetchSubs({ data: { teamId, companyName } });
      if (res.error) setErr(res.error);
      setResult(res);
    } catch (e: any) {
      setErr(e?.message ?? "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  const list = (rows: SubawardsResponse["asPrime"], emptyLabel: string) =>
    rows.length === 0 ? (
      <div className="py-1 opacity-60">{emptyLabel}</div>
    ) : (
      rows.slice(0, 10).map((r, i) => (
        <div key={`${r.partnerName}-${i}`} className="flex justify-between gap-2 py-1 border-t border-border/40 first:border-0">
          <span className="truncate">
            {r.partnerName}
            {r.suspect && (
              <span title="Reported value looks implausible in FSRS data" className="ml-1 text-warning">⚠</span>
            )}
          </span>
          <span className="whitespace-nowrap font-mono">{fmtUsd(r.amount)}</span>
        </div>
      ))
    );

  return (
    <Section title="Teaming history (subawards)">
      {!result ? (
        <div className="space-y-2">
          <p className="opacity-70">
            Look up who this firm subcontracts to, and who it works under, from federal subaward reporting.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={loading} onClick={load}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Info className="w-3.5 h-3.5" />}
            Load sub-relationships
          </Button>
          {err && <div className="text-destructive">{err}</div>}
        </div>
      ) : (
        <div className="space-y-3">
          {err && <div className="text-destructive">{err}</div>}
          <div>
            <div className="text-[10px] uppercase opacity-60 mb-1">Subcontractors they used</div>
            {list(result.asPrime, "No subawards found where this firm was the prime.")}
          </div>
          <div>
            <div className="text-[10px] uppercase opacity-60 mb-1">Primes they worked under</div>
            {list(result.asSub, "No subawards found where this firm was the sub.")}
          </div>
          <div className="opacity-60">
            {result.cached ? "Cached" : "Fresh"} · {new Date(result.fetchedAt).toLocaleDateString()}
            {result.suspectCount > 0 ? ` · ${result.suspectCount} value(s) flagged as implausible` : ""}
          </div>
        </div>
      )}
    </Section>
  );
}
