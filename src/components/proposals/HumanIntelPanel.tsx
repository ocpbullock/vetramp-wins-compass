import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Paperclip, Trash2, Pencil, Download, ChevronDown, ChevronUp } from "lucide-react";

const INTEL_TYPES = [
  { value: "incumbent_interview", label: "Incumbent interview" },
  { value: "partner_conversation", label: "Partner conversation" },
  { value: "customer_meeting", label: "Customer meeting" },
  { value: "capture_note", label: "Capture note" },
  { value: "other", label: "Other" },
] as const;

type IntelType = typeof INTEL_TYPES[number]["value"];

type IntelRow = {
  id: string;
  proposal_id: string;
  team_id: string | null;
  user_id: string | null;
  intel_type: IntelType;
  title: string | null;
  source_name: string | null;
  occurred_on: string | null;
  body: string | null;
  file_storage_path: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = Object.fromEntries(INTEL_TYPES.map((t) => [t.value, t.label]));

export function HumanIntelPanel({ proposalId, teamId }: { proposalId: string; teamId: string | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | IntelType>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<IntelRow | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["opportunity_intel", proposalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunity_intel")
        .select("*")
        .eq("proposal_id", proposalId)
        .order("occurred_on", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as IntelRow[];
    },
  });

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.intel_type === filter)),
    [items, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const t of INTEL_TYPES) c[t.value] = 0;
    for (const i of items) c[i.intel_type] = (c[i.intel_type] ?? 0) + 1;
    return c;
  }, [items]);

  async function handleDelete(row: IntelRow) {
    if (!confirm("Delete this intel entry?")) return;
    const { data, error } = await supabase
      .from("opportunity_intel")
      .delete()
      .eq("id", row.id)
      .select("id");
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data || data.length === 0) {
      toast.error("You don't have permission to delete this entry");
      return;
    }
    if (row.file_storage_path) {
      await supabase.storage.from("proposal-attachments").remove([row.file_storage_path]);
    }
    qc.invalidateQueries({ queryKey: ["opportunity_intel", proposalId] });
    toast.success("Intel deleted");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Human Intel</CardTitle>
          <CardDescription>
            Proprietary notes from incumbent interviews, partner calls, and customer meetings.
          </CardDescription>
        </div>
        <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add intel</Button>
          </DialogTrigger>
          <IntelComposerDialog
            proposalId={proposalId}
            teamId={teamId}
            userId={user?.id ?? null}
            existing={null}
            onClose={() => setComposerOpen(false)}
            onSaved={() => {
              setComposerOpen(false);
              qc.invalidateQueries({ queryKey: ["opportunity_intel", proposalId] });
            }}
          />
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All <span className="ml-1 opacity-70">{counts.all}</span>
          </FilterChip>
          {INTEL_TYPES.map((t) => (
            <FilterChip
              key={t.value}
              active={filter === t.value}
              onClick={() => setFilter(t.value)}
            >
              {t.label} <span className="ml-1 opacity-70">{counts[t.value] ?? 0}</span>
            </FilterChip>
          ))}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No intel yet. Capture notes after every incumbent interview, partner call, or customer meeting.
          </div>
        ) : (
          <ol className="space-y-3 border-l ml-2">
            {filtered.map((row) => (
              <IntelItem
                key={row.id}
                row={row}
                onEdit={() => setEditing(row)}
                onDelete={() => handleDelete(row)}
              />
            ))}
          </ol>
        )}

        {editing && (
          <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
            <IntelComposerDialog
              proposalId={proposalId}
              teamId={teamId}
              userId={user?.id ?? null}
              existing={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["opportunity_intel", proposalId] });
              }}
            />
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"
      }`}
    >
      {children}
    </button>
  );
}

function IntelItem({
  row,
  onEdit,
  onDelete,
}: {
  row: IntelRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = row.body ?? "";
  const isLong = body.length > 280;
  const shown = expanded || !isLong ? body : body.slice(0, 280) + "…";

  async function downloadFile() {
    if (!row.file_storage_path) return;
    const { data, error } = await supabase.storage
      .from("proposal-attachments")
      .createSignedUrl(row.file_storage_path, 60);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not generate download link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  const dateLabel = row.occurred_on
    ? format(new Date(row.occurred_on + "T00:00:00"), "MMM d, yyyy")
    : format(new Date(row.created_at), "MMM d, yyyy");

  return (
    <li className="ml-4 pl-4 -ml-px border-l-2 border-transparent hover:border-primary/40 relative">
      <div className="absolute -left-[7px] top-2 h-3 w-3 rounded-full bg-primary/70 ring-4 ring-background" />
      <div className="rounded-md border bg-card p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-xs">{TYPE_LABEL[row.intel_type] ?? row.intel_type}</Badge>
              <span className="text-xs text-muted-foreground">{dateLabel}</span>
              {row.source_name && (
                <span className="text-xs text-muted-foreground">· {row.source_name}</span>
              )}
            </div>
            {row.title && <div className="font-medium text-sm mt-1 truncate">{row.title}</div>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {row.file_storage_path && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={downloadFile} title="Download attachment">
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {body && (
          <div className="text-sm whitespace-pre-wrap text-foreground/90">
            {shown}
            {isLong && (
              <button
                type="button"
                className="ml-2 text-xs text-primary hover:underline inline-flex items-center"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <>Less <ChevronUp className="h-3 w-3 ml-0.5" /></> : <>More <ChevronDown className="h-3 w-3 ml-0.5" /></>}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function IntelComposerDialog({
  proposalId,
  teamId,
  userId,
  existing,
  onClose,
  onSaved,
}: {
  proposalId: string;
  teamId: string | null;
  userId: string | null;
  existing: IntelRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [intelType, setIntelType] = useState<IntelType>(existing?.intel_type ?? "capture_note");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [sourceName, setSourceName] = useState(existing?.source_name ?? "");
  const [occurredOn, setOccurredOn] = useState(existing?.occurred_on ?? new Date().toISOString().slice(0, 10));
  const [body, setBody] = useState(existing?.body ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      let filePath: string | null = existing?.file_storage_path ?? null;
      if (file) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `proposals/${proposalId}/intel/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage.from("proposal-attachments").upload(path, file);
        if (upErr) throw upErr;
        // Best-effort cleanup of replaced file
        if (existing?.file_storage_path) {
          await supabase.storage.from("proposal-attachments").remove([existing.file_storage_path]);
        }
        filePath = path;
      }

      if (existing) {
        const { data, error } = await supabase
          .from("opportunity_intel")
          .update({
            intel_type: intelType,
            title: title.trim() || null,
            source_name: sourceName.trim() || null,
            occurred_on: occurredOn || null,
            body: body.trim() || null,
            file_storage_path: filePath,
          })
          .eq("id", existing.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("You don't have permission to edit this entry");
        toast.success("Intel updated");
      } else {
        const { error } = await supabase.from("opportunity_intel").insert({
          proposal_id: proposalId,
          team_id: teamId,
          user_id: userId,
          intel_type: intelType,
          title: title.trim() || null,
          source_name: sourceName.trim() || null,
          occurred_on: occurredOn || null,
          body: body.trim() || null,
          file_storage_path: filePath,
        });
        if (error) throw error;
        toast.success("Intel added");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{existing ? "Edit intel" : "Add intel"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={intelType} onValueChange={(v) => setIntelType(v as IntelType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTEL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={occurredOn ?? ""} onChange={(e) => setOccurredOn(e.target.value)} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Call with incumbent PM"
          />
        </div>
        <div>
          <Label className="text-xs">Source (person or org)</Label>
          <Input
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="e.g. Jane Doe, Acme Corp"
          />
        </div>
        <div>
          <Label className="text-xs">Notes</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="What did you learn? Pain points, hot buttons, incumbent strengths/weaknesses, partner fit..."
          />
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1"><Paperclip className="h-3 w-3" /> Attach file (optional)</Label>
          <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {existing?.file_storage_path && !file && (
            <div className="text-xs text-muted-foreground mt-1 truncate">
              Current: {existing.file_storage_path.split("/").pop()}
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Add intel"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
