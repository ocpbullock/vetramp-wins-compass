import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, Settings as SettingsIcon } from "lucide-react";
import { useTeamId } from "@/lib/team";
import {
  useSoloPwinSelf,
  hasUsableCapabilities,
  computeSoloPwin,
  pwinChipTone,
  type OppForPwin,
  type SoloPwinSelf,
} from "@/lib/pwin-solo";
import type { PwinResult } from "@/lib/pwin";

function PwinBreakdownDialog({
  open, onOpenChange, opp, result, selfName,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  opp: OppForPwin;
  result: PwinResult;
  selfName: string;
}) {
  const tone = pwinChipTone(result.pwin);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Solo-prime pWin estimate
          </DialogTitle>
          <DialogDescription>
            Quick triage score assuming {selfName} primes solo. Open the full Teaming
            Analyzer in a proposal to model partners.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className={`px-3 py-2 rounded-md border text-2xl font-semibold tabular-nums ${tone.bg} ${tone.text}`}>
              {result.pwin}
            </div>
            <div className="text-xs text-muted-foreground">
              {opp.naics && <div>NAICS: <span className="font-mono">{opp.naics}</span></div>}
              {opp.setAside && <div>Set-aside: {opp.setAside}</div>}
              {opp.vehicle && <div>Vehicle: {opp.vehicle}</div>}
            </div>
          </div>
          <div className="space-y-2">
            {result.factors.map((f) => {
              const ft = pwinChipTone(f.score);
              return (
                <div key={f.key} className="text-xs border rounded-md p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{f.label}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span>weight {Math.round(f.weight * 100)}%</span>
                      <span className={`px-1.5 py-0.5 rounded border tabular-nums ${ft.bg} ${ft.text}`}>{f.score}</span>
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1">{f.explanation}</p>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Start a proposal from this opportunity to use the full analyzer with partners,
            set-aside primes, and saved scenarios.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PwinChip({ opp }: { opp: OppForPwin }) {
  const teamId = useTeamId();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const selfQ = useSoloPwinSelf(teamId, true);

  // Per-opportunity memoization keyed by opp signature + self version, so
  // result is cached but recomputes when either changes.
  const oppKey = useMemo(
    () => [opp.id, opp.naics ?? "", opp.agency ?? "", opp.setAside ?? "", opp.vehicle ?? ""].join("|"),
    [opp.id, opp.naics, opp.agency, opp.setAside, opp.vehicle],
  );

  const { data: result } = useQuery({
    queryKey: ["pwin-solo", teamId, oppKey],
    enabled: !!teamId && !!selfQ.data && hasUsableCapabilities(selfQ.data),
    staleTime: 5 * 60 * 1000,
    queryFn: () => computeSoloPwin(selfQ.data as SoloPwinSelf, opp),
  });

  if (!teamId || selfQ.isLoading) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] border bg-muted text-muted-foreground">
        …
      </span>
    );
  }

  if (!hasUsableCapabilities(selfQ.data)) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => navigate({ to: "/settings" })}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border bg-muted text-muted-foreground hover:bg-muted/70"
          >
            <SettingsIcon className="w-3 h-3" />
            Set up profile to score
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-xs">
          Add your company's NAICS, certifications, and capabilities in Settings to enable pWin scoring.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!result) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] border bg-muted text-muted-foreground">
        …
      </span>
    );
  }

  const tone = pwinChipTone(result.pwin);
  const selfName = selfQ.data?.ownCompany?.name || "Your company";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border tabular-nums hover:opacity-80 ${tone.bg} ${tone.text}`}
            aria-label={`pWin ${result.pwin}`}
          >
            <Sparkles className="w-3 h-3" />
            {result.pwin}
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          Solo-prime pWin · click for breakdown
        </TooltipContent>
      </Tooltip>
      {open && (
        <PwinBreakdownDialog
          open={open}
          onOpenChange={setOpen}
          opp={opp}
          result={result}
          selfName={selfName}
        />
      )}
    </>
  );
}
