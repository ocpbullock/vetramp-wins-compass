import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Shield, Target, TrendingUp } from "lucide-react";

import { toast } from "sonner";
import logoUrl from "@/assets/logo-vetramp-pursuit.png";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  component: AuthPage,
});

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
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-background">
      {/* Navy identity panel */}
      <aside className="hidden lg:flex flex-col justify-between bg-[color:var(--header-bg)] text-[color:var(--header-fg)] p-10 xl:p-14 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, var(--color-brand-brass) 0, transparent 40%), radial-gradient(circle at 80% 80%, var(--color-brand-brass) 0, transparent 45%)",
          }}
        />
        <div className="relative">
          <div className="inline-flex items-center rounded-md bg-white/95 px-3 py-2">
            <img src={logoUrl} alt="VetRamp Pursuit" className="h-9 w-auto" />
          </div>
          <p className="mt-6 briefing-label text-[color:var(--header-muted)]">Pursuit Intelligence</p>
          <h1 className="mt-1 text-3xl xl:text-4xl font-bold leading-tight">
            Capture better contracts with <span className="text-[color:var(--header-accent)]">disciplined intel</span>.
          </h1>
          <p className="mt-4 text-sm text-[color:var(--header-muted)] max-w-md">
            Track pursuits, analyze the competitive landscape, and assemble winning teams — all in one command deck.
          </p>
        </div>
        <ul className="relative space-y-3 text-sm">
          {[
            { icon: Target, text: "Opportunity intake, capture analysis, PWIN, and PTW" },
            { icon: TrendingUp, text: "Market snapshots pulled from live award history" },
            { icon: Shield, text: "Role-based teams, invite-only access, audit trail" },
          ].map((f) => (
            <li key={f.text} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/10 text-[color:var(--header-accent)]">
                <f.icon className="w-4 h-4" />
              </span>
              <span className="text-[color:var(--header-fg)]/90">{f.text}</span>
            </li>
          ))}
        </ul>
        <div className="relative text-[11px] uppercase tracking-[0.2em] text-[color:var(--header-muted)]">
          Opportunities · Captured · <span className="text-[color:var(--header-accent)] font-semibold">Mission Focused</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-4 sm:p-8">
        <Card className="w-full max-w-md p-6 sm:p-8 shadow-lg border-l-[3px] border-l-[color:var(--brand-brass)]">
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <img src={logoUrl} alt="VetRamp Pursuit" className="h-10 w-auto mb-3" />
            <p className="briefing-label">
              Opportunities · Captured · <span className="text-brand-red">Mission Focused</span>
            </p>
          </div>
          <div className="hidden lg:block mb-6">
            <p className="briefing-label">Sign in</p>
            <h2 className="text-xl font-semibold mt-1">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1">Continue with your VetRamp Pursuit workspace.</p>
          </div>

          <Button type="button" variant="outline" disabled={busy} className="w-full mb-4" onClick={handleGoogle}>
            Continue with Google
          </Button>
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>
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
      </main>
    </div>
  );
}
