import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getVendorProfile } from "@/lib/api";

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

  useEffect(() => {
    if (!recipientId) { setData(null); setError(null); return; }
    setLoading(true); setError(null); setData(null);
    getVendorProfile(recipientId)
      .then(setData)
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [recipientId]);

  const open = !!recipientId;
  const sharedNaics = new Set(searchedNaics);
  const overlapNaics: string[] = data?.naicsBreakdown
    ?.filter((n: any) => sharedNaics.has(n.code))
    .map((n: any) => n.code) ?? [];

  const assessment = !data
    ? ""
    : overlapNaics.length >= 2
    ? "Direct competitor"
    : overlapNaics.length === 1
    ? "Potential competitor in shared NAICS"
    : "Different market segment — possible teaming partner";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">{vendorName ?? "Vendor"}</SheetTitle>
          {data?.profile?.location && (
            <div className="text-xs text-muted-foreground">
              {[data.profile.location.city_name, data.profile.location.state_code, data.profile.location.country_name].filter(Boolean).join(", ")}
            </div>
          )}
          {data?.profile?.uei && (
            <div className="text-[11px] font-mono text-muted-foreground">UEI {data.profile.uei}</div>
          )}
          {data?.profile?.business_types && (
            <div className="flex flex-wrap gap-1 pt-1">
              {(data.profile.business_types as string[]).slice(0, 6).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          )}
        </SheetHeader>

        {error && <div className="text-xs text-destructive mt-3">{error}</div>}
        {loading && <div className="space-y-3 mt-4"><Skeleton className="h-20" /><Skeleton className="h-32" /></div>}

        {data && (
          <div className="space-y-4 mt-4 text-xs">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Contracts" v={String(data.summary.totalContracts)} />
              <Stat label="Total $" v={fmtUsd(data.summary.totalValue)} />
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
                  <span>{n.awards} · {fmtUsd(n.totalValue)}</span>
                </div>
              ))}
            </Section>

            <Section title={`Top Agencies (${data.agencyBreakdown.length})`}>
              {data.agencyBreakdown.slice(0, 6).map((a: any) => (
                <div key={a.name} className="flex justify-between py-1 gap-2">
                  <span className="truncate">{a.name}</span>
                  <span className="whitespace-nowrap">{a.awards} · {fmtUsd(a.totalValue)}</span>
                </div>
              ))}
            </Section>

            <Section title="Recent Contracts">
              <div className="overflow-x-auto -mx-2">
                <table className="w-full">
                  <thead><tr className="text-left opacity-60"><th className="px-2 py-1">PIID</th><th>NAICS</th><th className="text-right px-2">Value</th><th>End</th></tr></thead>
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
