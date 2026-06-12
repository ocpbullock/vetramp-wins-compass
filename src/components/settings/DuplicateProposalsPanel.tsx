import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Copy } from "lucide-react";
import { format } from "date-fns";

type Row = {
  id: string;
  opportunity_title: string | null;
  opportunity_source: string | null;
  opportunity_source_id: string | null;
  team_id: string | null;
  status: string | null;
  created_at: string;
};

type Group = {
  key: string;
  source: string;
  sourceId: string;
  teamId: string | null;
  rows: Row[];
};

export function DuplicateProposalsPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    // Admin RLS lets us see all proposals; bucket by team+source+source_id.
    const { data, error } = await supabase
      .from("proposals")
      .select("id, opportunity_title, opportunity_source, opportunity_source_id, team_id, status, created_at")
      .not("opportunity_source_id", "is", null)
      .order("created_at", { ascending: true });
    if (error) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const buckets = new Map<string, Group>();
    for (const r of (data ?? []) as Row[]) {
      if (!r.opportunity_source || !r.opportunity_source_id) continue;
      const key = `${r.team_id ?? "null"}::${r.opportunity_source}::${r.opportunity_source_id}`;
      const g = buckets.get(key) ?? {
        key,
        source: r.opportunity_source,
        sourceId: r.opportunity_source_id,
        teamId: r.team_id,
        rows: [],
      };
      g.rows.push(r);
      buckets.set(key, g);
    }
    setGroups([...buckets.values()].filter((g) => g.rows.length > 1));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Copy className="w-4 h-4" /> Duplicate proposals
          </CardTitle>
          <CardDescription>
            Proposals that share the same team + opportunity source + source id. Not auto-removed — review
            and archive duplicates manually.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Scanning…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted-foreground">No duplicates detected.</div>
        ) : (
          <ul className="space-y-4">
            {groups.map((g) => (
              <li key={g.key} className="border border-border rounded-md p-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge variant="outline">{g.source}</Badge>
                  <code className="text-xs">{g.sourceId}</code>
                  <Badge variant="secondary">{g.rows.length} proposals</Badge>
                  {g.teamId && <span className="text-xs text-muted-foreground">team {g.teamId.slice(0, 8)}…</span>}
                </div>
                <ul className="space-y-1">
                  {g.rows.map((r, i) => (
                    <li key={r.id} className="flex items-center justify-between text-sm gap-2">
                      <div className="min-w-0">
                        <Link
                          to="/proposals/$proposalId"
                          params={{ proposalId: r.id }}
                          className="underline truncate inline-block max-w-[420px] align-middle"
                        >
                          {r.opportunity_title || r.id}
                        </Link>
                        <span className="text-xs text-muted-foreground ml-2">
                          {r.status} · {format(new Date(r.created_at), "MMM d, yyyy")}
                          {i === 0 && " · earliest"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
