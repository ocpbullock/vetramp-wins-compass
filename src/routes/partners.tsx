import { createFileRoute } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { useTeam } from "@/lib/team";
import { PartnerResearch } from "@/components/proposals/PartnerResearch";
import { PartnersPanel } from "@/components/settings/PartnersPanel";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/partners")({
  component: PartnersPage,
});

function PartnersPage() {
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id ?? null;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-8">
      <PageHeader
        icon={<Handshake className="w-5 h-5" />}
        title="Partners"
        description="Find new firms via SAM.gov entity search, and manage the partners on your team roster."
      />

      <section className="space-y-3">
        <h2 className="briefing-label">Find new partners</h2>
        {/* Global mode: no proposal context. PartnerResearch's "add to proposal"
            button is a no-op without a proposalId; the SAM entity search +
            "add to team roster" path still works. */}
        <PartnerResearch proposalId="" teamId={teamId} />
      </section>

      <section className="space-y-3">
        <h2 className="briefing-label">Your roster</h2>
        <PartnersPanel />
      </section>
    </div>
  );
}
