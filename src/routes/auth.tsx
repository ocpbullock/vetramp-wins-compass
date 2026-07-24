import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

import { toast } from "sonner";
import logoUrl from "@/assets/logo-vetramp-pursuit.png";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  component: AuthPage,
});

// Only allow same-origin relative paths.
function safeNext(next: string | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { next } = useSearch({ from: "/auth" });
  const destination = safeNext(next);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      // Use window.location for non-router destinations (e.g. /.lovable/oauth/consent)
      if (destination !== "/") window.location.href = destination;
      else navigate({ to: "/" });
    }
  }, [user, loading, navigate, destination]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else if (destination !== "/") window.location.href = destination;
    else navigate({ to: "/" });
  }
  async function handleGoogle() {
    setBusy(true);
    const redirectUri =
      destination !== "/"
        ? `${window.location.origin}/auth?next=${encodeURIComponent(destination)}`
        : window.location.origin;
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectUri });
    if (result.error) {
      toast.error("Google sign-in failed");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    if (destination !== "/") window.location.href = destination;
    else navigate({ to: "/" });
  }
  async function handleMagicLink() {
    if (!email) { toast.error("Enter email first"); return; }
    setBusy(true);
    const redirectTo =
      destination !== "/"
        ? `${window.location.origin}/auth?next=${encodeURIComponent(destination)}`
        : `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Magic link sent.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logoUrl} alt="VetRamp Pursuit" className="h-10 w-auto mb-3" />
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Opportunities · Captured · <span className="text-brand-red font-semibold">Mission Focused</span>
          </p>
        </div>
        <Button type="button" variant="outline" disabled={busy} className="w-full mb-4" onClick={handleGoogle}>
          Continue with Google
        </Button>
        <div className="relative mb-4"><div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div></div>
        <form onSubmit={handleSignIn} className="space-y-3">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <Button type="submit" disabled={busy} className="w-full">Sign in</Button>
          <Button type="button" variant="outline" disabled={busy} className="w-full" onClick={handleMagicLink}>
            Send magic link
          </Button>
        </form>
        <p className="text-xs text-muted-foreground text-center mt-6">
          Access is invite-only. Contact your administrator to request an invitation.
        </p>
      </Card>
    </div>
  );
}
