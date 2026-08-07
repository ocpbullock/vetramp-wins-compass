// TEMPORARY provider-evaluation UI. Runs the fed-spend.com verification
// harness (admin / team-owner gated server function) and renders raw results.
// Not wired into any user-facing feature.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play, ChevronDown, ChevronRight } from "lucide-react";
import { runFedSpendVerification } from "@/lib/fedspend-verify.functions";
import type { FedSpendTestResult } from "@/lib/fedspend-verify";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-muted/40 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-96">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function TestRow({ t }: { t: FedSpendTestResult }) {
  const [open, setOpen] = useState(false);
  const statusBadge = t.error
    ? <Badge className="bg-destructive text-destructive-foreground">Error</Badge>
    : t.status === null
      ? <Badge variant="outline">n/a</Badge>
      : t.ok
        ? <Badge className="bg-success text-success-foreground">{t.status}</Badge>
        : <Badge className="bg-warning text-warning-foreground">{t.status}</Badge>;

  const booleans = Object.entries(t.extras).filter(([, v]) => typeof v === "boolean");

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {statusBadge}
        <span className="text-sm font-medium flex-1 min-w-[12rem]">{t.label}</span>
        {t.count !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">{t.count} rows</span>
        )}
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
          Raw JSON
        </Button>
      </div>

      {t.error && <p className="text-xs text-destructive">{t.error}</p>}
      {t.notes.map((n) => (
        <p key={n} className="text-xs text-warning">{n}</p>
      ))}

      {booleans.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {booleans.map(([k, v]) => (
            <Badge key={k} variant={v ? "default" : "outline"} className="text-[11px]">
              {k}: {String(v)}
            </Badge>
          ))}
        </div>
      )}

      {Object.keys(t.headers).length > 0 && (
        <div className="text-xs text-muted-foreground">
          headers: {Object.entries(t.headers).map(([k, v]) => `${k}=${v}`).join(" · ")}
        </div>
      )}

      {open && (
        <div className="space-y-2">
          {Object.keys(t.extras).length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Extracted</p>
              <Json value={t.extras} />
            </div>
          )}
          <div>
            <p className="text-xs font-medium mb-1">Full response</p>
            <Json value={t.raw} />
          </div>
        </div>
      )}
    </li>
  );
}

export function FedSpendVerificationSection() {
  const run = useServerFn(runFedSpendVerification);
  const [loading, setLoading] = useState(false);
  const [tests, setTests] = useState<FedSpendTestResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await run({});
      if (res.error) {
        setTests(null);
        setMessage(res.message ?? res.error);
      } else {
        setTests(res.tests ?? []);
      }
    } catch (e) {
      setTests(null);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[14rem]">
          <h2 className="text-sm font-semibold">Fed-Spend verification</h2>
          <p className="text-xs text-muted-foreground">
            Provider evaluation — temporary. Nothing is saved; results are not used by any feature.
          </p>
        </div>
        <Button size="sm" onClick={handleRun} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
          {loading ? "Running…" : "Run verification"}
        </Button>
      </div>

      {message && <p className="px-4 py-3 text-sm text-destructive">{message}</p>}

      {tests && tests.length > 0 && (
        <ul className="divide-y divide-border">
          {tests.map((t) => <TestRow key={t.id} t={t} />)}
        </ul>
      )}

      {!tests && !message && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Runs four probes against fed-spend.com (recipient fields, recompete, opportunity search,
          rate-limit headers).
        </p>
      )}
    </Card>
  );
}
