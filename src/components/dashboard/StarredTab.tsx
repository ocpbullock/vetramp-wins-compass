import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, FileSignature, ExternalLink, Trash2, Users, Swords } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format, parseISO } from "date-fns";
import { useStarred, type StarredRow } from "@/lib/starred";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateOpportunityTeamDialog } from "./CreateOpportunityTeamDialog";
import { PwinChip } from "./PwinChip";
import type { SamOpportunity } from "@/lib/api";

function rowToSamOpp(r: StarredRow): SamOpportunity {
  const sd = r.source_data as SamOpportunity | undefined;
  return sd ?? {
    noticeId: r.notice_id,
    solicitationNumber: r.notice_id,
    title: r.title ?? "",
    naicsCode: r.naics_code ?? undefined,
    responseDeadLine: r.response_deadline ?? undefined,
    postedDate: r.posted_date ?? undefined,
    setAside: r.set_aside_description ?? undefined,
    fullParentPathName: "",
    classificationCode: "",
  } as unknown as SamOpportunity;
}

export function StarredTab({
  onStartProposal,
  onCompete,
}: {
  onStartProposal: (row: StarredRow) => void;
  onCompete?: (opp: SamOpportunity) => void;
}) {
  const { list, toggle, count } = useStarred();
  const [rows, setRows] = useState<StarredRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [teamRow, setTeamRow] = useState<StarredRow | null>(null);

  async function reload() {
    setLoading(true);
    const data = await list();
    setRows(data);
    setLoading(false);
  }

  // Reload whenever the starred count changes (covers stars added from
  // other tabs while this tab is mounted).
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.title ?? "").toLowerCase().includes(q) ||
        (r.naics_code ?? "").includes(q) ||
        (r.notice_id ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  function fmt(ts: string | null) {
    if (!ts) return "—";
    try { return format(parseISO(ts), "MMM d, yyyy"); } catch { return "—"; }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500 fill-amber-400" />
              Starred Opportunities
            </h2>
            <p className="text-xs text-muted-foreground">
              Lightweight bookmarks. Promote any starred item to a full proposal when you're ready.
            </p>
          </div>
          <div className="flex-1" />
          <Input
            placeholder="Search title, NAICS, sol #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-9"
          />
        </div>

        <div className="rounded-md border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Actions</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>NAICS</TableHead>
                <TableHead>pWin</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead>Set-Aside</TableHead>
                <TableHead>Starred</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">Loading...</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    {rows.length === 0
                      ? "No starred opportunities yet. Click the star icon on any opportunity to bookmark it."
                      : "No matches for the current search."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const sd = r.source_data as any;
                const uiLink = sd?.uiLink as string | undefined;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="w-[180px]">
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              onClick={() => onStartProposal(r)}
                              className="h-7 bg-money text-money-foreground hover:bg-money/90"
                            >
                              <FileSignature className="w-3.5 h-3.5 mr-1" />
                              Start
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Promote to full proposal</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => setTeamRow(r)}
                              title="Create opportunity team"
                            >
                              <Users className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Create team & invite partners</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => {
                                setRows((cur) => cur.filter((x) => x.id !== r.id));
                                toggle({ noticeId: r.notice_id });
                              }}
                              title="Unstar"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Unstar</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[360px]">
                      <div className="font-medium truncate flex items-center gap-1.5">
                        {uiLink ? (
                          <a href={uiLink} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            <span className="truncate">{r.title || r.notice_id}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="truncate">{r.title || r.notice_id}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{r.notice_id}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.naics_code || "—"}</TableCell>
                    <TableCell>
                      <PwinChip
                        opp={{
                          id: r.id,
                          naics: r.naics_code,
                          agency: (r.source_data as any)?.fullParentPathName ?? null,
                          setAside: r.set_aside_description ?? null,
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{fmt(r.response_deadline)}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{fmt(r.posted_date)}</TableCell>
                    <TableCell className="text-xs">{r.set_aside_description || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.created_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {teamRow && (
          <CreateOpportunityTeamDialog
            open={!!teamRow}
            onOpenChange={(o) => { if (!o) setTeamRow(null); }}
            opportunityTitle={teamRow.title || teamRow.notice_id}
            source="starred"
            sourceId={teamRow.id}
            noticeId={teamRow.notice_id}
            naicsCode={teamRow.naics_code}
            responseDeadline={teamRow.response_deadline}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
