// Admin-only diagnostics smoke-test screen. Runs the registry in
// src/lib/diagnostics.ts, shows per-check pass/warn/fail, and persists each
// run to public.diagnostics_runs for a rolling history.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useTeamId } from "@/lib/team";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, ArrowLeft, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  DIAGNOSTICS_CHECKS,
  runAllChecks,
  summarize,
  type CheckRun,
  type CheckStatus,
} from "@/lib/diagnostics";

export const Route = createFileRoute("/diagnostics")({ component: DiagnosticsPage });

const GROUP_LABEL: Record<CheckRun["group"], string> = {
  boot: "Edge function boot",
  rls: "Row-level security",
  external: "External APIs",
  platform: "Platform integrity",
};

function StatusBadge({ status }: { status: CheckStatus | "pending" }) {
  if (status === "pass") return <Badge className="bg-success text-success-foreground">Pass</Badge>;
  if (status === "warn") return <Badge className="bg-warning text-warning-foreground">Warn</Badge>;
  if (status === "fail") return <Badge className="bg-destructive text-destructive-foreground">Fail</Badge>;
  return <Badge variant="outline">Running…</Badge>;
}

function DiagnosticsPage() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const teamId = useTeamId();
  const qc = useQueryClient();

  // Team-admin fallback: allow team owners/admins too.
  const { data: teamRoles } = useQuery({
    queryKey: ["diagnostics-team-roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("team_members").select("role").eq("user_id", user!.id);
      return data ?? [];
    },
  });
  const isTeamAdmin = (teamRoles ?? []).some((r: any) => r.role === "owner" || r.role === "admin");
  const canAccess = isAdmin || isTeamAdmin;

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Array<CheckRun | (typeof DIAGNOSTICS_CHECKS[number] & { status: "pending" })>>(
    DIAGNOSTICS_CHECKS.map((c) => ({ ...c, status: "pending" as const })),
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summary = useMemo(() => {
    const done = results.filter((r): r is CheckRun => "ms" in (r as any));
    return summarize(done);
  }, [results]);

  const history = useQuery({
    queryKey: ["diagnostics-history", teamId],
    enabled: !!user,
    queryFn: async () => {
      const q = supabase
        .from("diagnostics_runs")
        .select("id, ran_at, total, passed, warned, failed")
        .order("ran_at", { ascending: false })
        .limit(10);
      if (teamId) q.eq("team_id", teamId);
      const { data } = await q;
      return data ?? [];
    },
  });

  async function handleRun() {
    if (running) return;
    if (!teamId) {
      toast.error("Join or create a team before running diagnostics.");
      return;
    }
    setRunning(true);
    setResults(DIAGNOSTICS_CHECKS.map((c) => ({ ...c, status: "pending" as const })));
    try {
      const collected: CheckRun[] = [];
      await runAllChecks((r) => {
        collected.push(r);
        setResults((prev) =>
          prev.map((p) => (p.id === r.id ? r : p)),
        );
      });
      const s = summarize(collected);
      const { error } = await supabase.from("diagnostics_runs").insert({
        team_id: teamId,
        ran_by: user?.id ?? null,
        total: s.total,
        passed: s.passed,
        warned: s.warned,
        failed: s.failed,
        results: collected as any,
      });

      if (error) toast.error(`Saved locally, but history write failed: ${error.message}`);
      else toast.success(`Ran ${s.total} checks — ${s.passed} pass · ${s.warned} warn · ${s.failed} fail`);
      qc.invalidateQueries({ queryKey: ["diagnostics-history"] });
    } finally {
      setRunning(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="max-w-[1100px] mx-auto p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="max-w-[1100px] mx-auto p-6">
        <Card className="p-6">
          <h1 className="text-lg font-semibold mb-1">Diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            Diagnostics is available to app admins and team owners only.
          </p>
          <div className="mt-4">
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings"><ArrowLeft className="w-4 h-4 mr-1" /> Back to settings</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const grouped = new Map<CheckRun["group"], typeof results>();
  for (const r of results) {
    const g = (r as any).group as CheckRun["group"];
    if (!grouped.has(g)) grouped.set(g, [] as any);
    grouped.get(g)!.push(r);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="max-w-[1100px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Diagnostics</h1>
            <p className="text-xs text-muted-foreground">
              Runtime health checks for edge functions, RLS, external APIs, and platform jobs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Link>
            </Button>
            <Button size="sm" onClick={handleRun} disabled={running}>
              {running ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
              {running ? "Running…" : "Run all checks"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto p-6 space-y-6">
        <Card className="p-4">
          <div className="flex items-center gap-6 text-sm">
            <div><span className="font-semibold">{summary.total}</span> checks</div>
            <div className="text-success"><span className="font-semibold">{summary.passed}</span> passed</div>
            <div className="text-warning"><span className="font-semibold">{summary.warned}</span> warnings</div>
            <div className="text-destructive"><span className="font-semibold">{summary.failed}</span> failed</div>
            {running && (
              <div className="ml-auto text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Running…
              </div>
            )}
          </div>
        </Card>

        {(Object.keys(GROUP_LABEL) as Array<CheckRun["group"]>).map((g) => {
          const rows = grouped.get(g) ?? [];
          if (rows.length === 0) return null;
          return (
            <Card key={g} className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/40">
                <h2 className="text-sm font-semibold">{GROUP_LABEL[g]}</h2>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((r) => {
                  const isDone = "ms" in (r as any);
                  const status: CheckStatus | "pending" = (r as any).status;
                  const isOpen = expanded.has(r.id);
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 text-left"
                        onClick={() => {
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          });
                        }}
                      >
                        {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                        <StatusBadge status={status} />
                        <span className="text-sm flex-1 truncate">{(r as any).label}</span>
                        {isDone && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {(r as CheckRun).ms} ms
                          </span>
                        )}
                      </button>
                      {isOpen && isDone && (
                        <pre className="mt-2 ml-7 text-xs bg-muted/40 border border-border rounded p-2 whitespace-pre-wrap break-words">
                          {(r as CheckRun).detail}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Recent runs</h2>
          {history.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No previous runs yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(history.data ?? []).map((h: any) => (
                <li key={h.id} className="flex items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground w-40">
                    {formatDistanceToNow(new Date(h.ran_at), { addSuffix: true })}
                  </span>
                  <span>{h.total} checks</span>
                  <span className="text-success">{h.passed} pass</span>
                  <span className="text-warning">{h.warned} warn</span>
                  <span className="text-destructive">{h.failed} fail</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <FedSpendVerificationSection />

      </main>
    </div>
  );
}
