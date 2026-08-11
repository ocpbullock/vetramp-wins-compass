import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Network, ArrowRight } from "lucide-react";
import { readEcosystem } from "@/lib/ecosystem-build";
import type { EcosystemRole } from "@/lib/ecosystem-rank";

const ROLE_LABEL: Record<EcosystemRole, string> = {
  known_competitor: "known competitors",
  incumbent: "incumbent",
  likely_prime_competitor: "likely primes",
  prime_teaming_partner: "prime teaming partners",
  coalition_partner: "coalition partners",
  dark_horse: "dark horses",
};

const ROLE_ORDER: EcosystemRole[] = [
  "incumbent",
  "likely_prime_competitor",
  "known_competitor",
  "prime_teaming_partner",
  "coalition_partner",
  "dark_horse",
];

/** Compact read-only view of proposals.ecosystem for the Capture Analysis tab. */
export function EcosystemSummaryStrip({
  proposal,
  onOpenEcosystem,
}: {
  proposal: any;
  onOpenEcosystem?: () => void;
}) {
  const result = readEcosystem(proposal);
  const companies = result?.companies ?? [];

  const counts = new Map<EcosystemRole, number>();
  for (const c of companies) counts.set(c.role, (counts.get(c.role) ?? 0) + 1);

  const topPrimes = companies
    .filter((c) => c.role === "likely_prime_competitor")
    .slice(0, 3);

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Network className="w-4 h-4 text-primary" /> Competitive ecosystem
        </span>

        {companies.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Not generated yet — build it on the Ecosystem tab.
          </span>
        ) : (
          <>
            <Badge variant="secondary" className="text-xs">{companies.length} companies</Badge>
            {ROLE_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => (
              <span key={r} className="text-xs text-muted-foreground">
                {counts.get(r)} {ROLE_LABEL[r]}
              </span>
            ))}
            {topPrimes.length > 0 && (
              <span className="text-xs">
                <span className="text-muted-foreground mr-1">Top primes:</span>
                {topPrimes.map((c) => c.name).join(" · ")}
              </span>
            )}
          </>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-xs"
          onClick={onOpenEcosystem}
        >
          Open Ecosystem tab <ArrowRight className="w-3 h-3 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
