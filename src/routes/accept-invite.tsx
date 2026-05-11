import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getInviteByToken } from "@/lib/admin.functions";
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
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "expired" | "accepted">("loading");
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) { setState("invalid"); return; }
      try {
        const res = await fetchInvite({ data: { token } });
        if (!res.invite) { setState("invalid"); return; }
        if (res.invite.status === "accepted") { setState("accepted"); return; }
        if (res.invite.status === "cancelled") { setState("invalid"); return; }
        if (res.invite.expired) { setState("expired"); return; }
        setInvite({ email: res.invite.email, role: res.invite.role });
        setState("ready");
      } catch {
        setState("invalid");
      }
    })();
  }, [token, fetchInvite]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setBusy(true);
    // The Supabase invite email already created the user and signed them in via the magic link.
    // If they reached this page directly (e.g. password setup), we update the password.
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      const { error } = await supabase.auth.updateUser({ password });
      setBusy(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Welcome to the team!");
      navigate({ to: "/" });
      return;
    }
    // Fallback: try password sign-up (works if user doesn't exist yet)
    const { error } = await supabase.auth.signUp({
      email: invite.email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Account created — check your email to confirm, then sign in.");
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Join the team</h1>
          <p className="text-sm text-muted-foreground mt-1">Federal Contracts Dashboard · VetRamp</p>
        </div>
        {state === "loading" && <p className="text-sm text-muted-foreground">Validating invitation…</p>}
        {state === "invalid" && (
          <div className="space-y-3">
            <p className="text-sm">This invitation link is invalid or has been cancelled.</p>
            <Button variant="outline" onClick={() => navigate({ to: "/auth" })}>Go to sign in</Button>
          </div>
        )}
        {state === "expired" && (
          <div className="space-y-3">
            <p className="text-sm">This invitation has expired. Ask an administrator to resend it.</p>
            <Button variant="outline" onClick={() => navigate({ to: "/auth" })}>Go to sign in</Button>
          </div>
        )}
        {state === "accepted" && (
          <div className="space-y-3">
            <p className="text-sm">This invitation has already been used. Please sign in.</p>
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
