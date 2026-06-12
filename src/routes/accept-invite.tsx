import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { acceptInvite, getInviteByToken } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: (s: Record<string, unknown>) => ({ token: (s.token as string) ?? "" }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const fetchInvite = useServerFn(getInviteByToken);
  const acceptInviteFn = useServerFn(acceptInvite);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "expired" | "used" | "accepted" | "no-session">("loading");
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) { setState("invalid"); return; }
      // The Supabase invite magic link signs the user in before redirecting here.
      // If there is no session, the lookup endpoint will reject (it requires auth).
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { setState("no-session"); return; }
      try {
        const res = await fetchInvite({ data: { token } });
        if (!res.invite) { setState("invalid"); return; }
        if (res.invite.status === "accepted") { setState("used"); return; }
        if (res.invite.status === "cancelled") { setState("invalid"); return; }
        if (res.invite.expired) { setState("expired"); return; }
        setInvite({ email: res.invite.email, role: res.invite.role });
        setState("ready");
      } catch {
        setState("invalid");
      }
    })();
  }, [token, fetchInvite]);

  async function finalizeAcceptance() {
    try {
      const res = await acceptInviteFn({ data: { token } });
      if (res.alreadyAccepted) {
        toast.info("Invitation already accepted.");
      } else {
        toast.success("Welcome to the team!");
      }
      if (res.teamId) {
        try { localStorage.setItem("vetramp.currentTeamId", res.teamId); } catch { /* ignore */ }
      }
      if (res.proposalId) {
        navigate({ to: "/proposals/$proposalId", params: { proposalId: res.proposalId } });
      } else {
        navigate({ to: "/" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not accept invitation.";
      if (/already been used|already used/i.test(msg)) { setState("used"); return; }
      if (/expired/i.test(msg)) { setState("expired"); return; }
      if (/not found|cancelled|no longer valid/i.test(msg)) { setState("invalid"); return; }
      toast.error(msg);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { toast.error(error.message); return; }
      await finalizeAcceptance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Join the team</h1>
          <p className="text-sm text-muted-foreground mt-1">VetRamp Pursuit</p>
        </div>
        {state === "loading" && <p className="text-sm text-muted-foreground">Validating invitation…</p>}
        {state === "no-session" && (
          <div className="space-y-3">
            <p className="text-sm">
              Please open the invitation link from the email we sent you. It signs you in automatically.
            </p>
            <Button variant="outline" onClick={() => navigate({ to: "/auth" })}>Go to sign in</Button>
          </div>
        )}
        {state === "invalid" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">This invitation link is invalid or has been cancelled.</p>
            <p className="text-sm text-muted-foreground">Ask your administrator to send a new invite, then open the link from that email.</p>
            <Button variant="outline" onClick={() => navigate({ to: "/auth" })}>Go to sign in</Button>
          </div>
        )}
        {state === "expired" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">This invitation has expired.</p>
            <p className="text-sm text-muted-foreground">Invites are valid for 7 days. Ask your administrator to <span className="font-medium">request a new invite</span> and use the latest link.</p>
            <Button variant="outline" onClick={() => navigate({ to: "/auth" })}>Go to sign in</Button>
          </div>
        )}
        {state === "used" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">This invitation has already been used.</p>
            <p className="text-sm text-muted-foreground">Invitation links are single-use. If you didn't accept it, ask your administrator to <span className="font-medium">request a new invite</span>.</p>
            <Button onClick={() => navigate({ to: "/auth" })}>Go to sign in</Button>
          </div>
        )}
        {state === "ready" && invite && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm">
              You're invited to join as <span className="font-semibold capitalize">{invite.role}</span>. Set a password to finish creating your account.
            </p>
            <div>
              <Label>Email</Label>
              <Input value={invite.email} disabled />
              <p className="text-xs text-muted-foreground mt-1">Email partially hidden for security.</p>
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Setting up…" : "Accept invitation"}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
