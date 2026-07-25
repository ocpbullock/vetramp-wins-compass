import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookmarkPlus, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getVendorProfile } from "@/lib/api";
import { useTeam } from "@/lib/team";
import { companyFromVendorLookup, upsertCompany } from "@/lib/companies";

function fmtUsd(n?: number | null) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

export function VendorDetailDrawer({
  recipientId, vendorName, searchedNaics, onClose,
}: {
  recipientId: string | null;
  vendorName: string | null;
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
  const { currentTeam, userRole } = useTeam();
  const canSave = !!currentTeam && (userRole === "owner" || userRole === "admin" || userRole === "member");

  useEffect(() => {
    if (!recipientId && !vendorName) { setData(null); setError(null); setSelectedUei(null); return; }
    setLoading(true); setError(null); setData(null); setSelectedUei(null);
    // Pass both signals — the function decides UEI vs name-resolution.
    getVendorProfile({ recipientId, vendorName })
      .then(setData)
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [recipientId, vendorName]);

  const pickCandidate = (uei: string) => {
    setSelectedUei(uei);
    setLoading(true); setError(null); setData(null);
    getVendorProfile({ uei })
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

        {error && <div className="text-xs text-destructive mt-3">{error}</div>}
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
