import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({ component: AuthPage });

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else navigate({ to: "/" });
  }
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Account created — check your email to confirm.");
  }
  async function handleMagicLink() {
    if (!email) { toast.error("Enter email first"); return; }
    setBusy(true);
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Magic link sent.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Federal Contracts Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">VetRamp · SDVOSB</p>
        </div>
        <Tabs defaultValue="signin">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>
          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-3 mt-4">
              <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
              <Button type="submit" disabled={busy} className="w-full">Sign in</Button>
              <Button type="button" variant="outline" disabled={busy} className="w-full" onClick={handleMagicLink}>
                Send magic link
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-3 mt-4">
              <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></div>
              <Button type="submit" disabled={busy} className="w-full">Create account</Button>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
