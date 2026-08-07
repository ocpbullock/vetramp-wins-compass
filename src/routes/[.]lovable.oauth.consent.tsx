import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Beta auth.oauth namespace typing shim
type OAuthClient = { name?: string; redirect_uri?: string };
type OAuthAuthzDetails = { client?: OAuthClient; scope?: string; redirect_url?: string; redirect_to?: string };
type OAuthNS = {
  getAuthorizationDetails: (id: string) => Promise<{ data: OAuthAuthzDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: OAuthAuthzDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: OAuthAuthzDetails | null; error: { message: string } | null }>;
};
function oauthNS(): OAuthNS {
  return (supabase.auth as unknown as { oauth: OAuthNS }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { authorization_id?: string } => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthNS().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-6 max-w-md">
        <h1 className="font-semibold mb-2">Authorization request unavailable</h1>
        <p className="text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
      </Card>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const ns = oauthNS();
    const { data, error } = approve
      ? await ns.approveAuthorization(authorization_id ?? "")
      : await ns.denyAuthorization(authorization_id ?? "");
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an application";

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="p-6 max-w-md w-full">
        <h1 className="text-xl font-semibold mb-2">Connect {clientName} to VetRamp Pursuit</h1>
        <p className="text-sm text-muted-foreground mb-4">
          This lets {clientName} access your opportunities, capture activities, and partner roster as you.
        </p>
        {details?.client?.redirect_uri ? (
          <p className="text-xs text-muted-foreground mb-4 break-all">
            Redirects to: {details.client.redirect_uri}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground mb-4">
          This does not bypass row-level security — the client only sees data you can see.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive mb-3">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button disabled={busy} onClick={() => decide(true)} className="flex-1">
            Approve
          </Button>
          <Button disabled={busy} variant="outline" onClick={() => decide(false)} className="flex-1">
            Deny
          </Button>
        </div>
      </Card>
    </main>
  );
}
