import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAwardDetail } from "@/lib/api";
import { mapSetAside } from "@/lib/contracts";

const fmtMoney = (n: any) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n) || 0);

export function AwardDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const open = !!id;
  const { data, isLoading } = useQuery({
    queryKey: ["award-detail", id],
    queryFn: () => getAwardDetail(id!),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Award Detail</DialogTitle>
        </DialogHeader>
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {data && (
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground uppercase">Title</div>
              <div className="font-medium">{data.description?.toLowerCase?.() ?? data.transaction_obligated_amount ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-2">PIID: <span className="font-mono">{data.piid}</span> · Parent: <span className="font-mono">{data.parent_award?.piid ?? "—"}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground uppercase">Recipient</div>
                <div>{data.recipient?.recipient_name}</div>
                <div className="text-xs text-muted-foreground">CAGE: {data.recipient?.cage_code ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase">Agency</div>
                <div>{data.awarding_agency?.toptier_agency?.name}</div>
                <div className="text-xs text-muted-foreground">{data.awarding_agency?.subtier_agency?.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase">Obligated</div>
                <div className="text-money font-bold text-lg">{fmtMoney(data.total_obligation)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase">Total Contract Value</div>
                <div className="text-money font-bold text-lg">{fmtMoney(data.base_and_all_options_value ?? data.base_exercised_options_val)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase">Award Date · Type</div>
                <div>{data.date_signed?.slice(0, 10)} · {data.type_description}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase">NAICS · PSC</div>
                <div className="font-mono text-xs">{data.naics_hierarchy?.toptier_code?.code ?? data.latest_transaction_contract_data?.naics ?? "—"} · {data.psc_hierarchy?.toptier_code?.code ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase">Set-Aside</div>
                <div>{mapSetAside(data.latest_transaction_contract_data?.type_set_aside) || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase">Period of Performance</div>
                <div>{data.period_of_performance?.start_date?.slice(0, 10)} — {data.period_of_performance?.end_date?.slice(0, 10)}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground uppercase">Place of Performance</div>
                <div>{[data.place_of_performance?.city_name, data.place_of_performance?.state_code, data.place_of_performance?.zip5].filter(Boolean).join(", ")}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground uppercase">Funding Office</div>
                <div>{data.funding_agency?.subtier_agency?.name ?? data.funding_agency?.toptier_agency?.name ?? "—"}</div>
              </div>
            </div>
            {data.description && (
              <div>
                <div className="text-xs text-muted-foreground uppercase">Description</div>
                <div className="text-sm">{data.description}</div>
              </div>
            )}
            <a className="text-primary hover:underline text-xs" href={`https://www.usaspending.gov/award/${data.generated_unique_award_id ?? id}`} target="_blank" rel="noreferrer">
              View on USAspending.gov →
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
