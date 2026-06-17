import { createFileRoute } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { useTeam } from "@/lib/team";
import { PartnerResearch } from "@/components/proposals/PartnerResearch";
import { PartnersPanel } from "@/components/settings/PartnersPanel";

export const Route = createFileRoute("/partners")({
  component: PartnersPage,
});

function PartnersPage() {
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id ?? null;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Handshake className="w-5 h-5 text-primary" />
          Partners
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Find new firms via SAM.gov entity search, and manage the partners on your team roster.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Find new partners
        </h2>
        {/* Global mode: no proposal context. PartnerResearch's "add to proposal"
            button is a no-op without a proposalId; the SAM entity search +
            "add to team roster" path still works. */}
        <PartnerResearch proposalId="" teamId={teamId} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Your roster
        </h2>
        <PartnersPanel />
      </section>
    </div>
  );
}
