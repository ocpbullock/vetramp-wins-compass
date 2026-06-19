import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTeam } from "@/lib/team";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, Upload, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const KB_CATEGORIES = [
  { value: "past_performance", label: "Past Performance" },
  { value: "personnel", label: "Personnel / Resumes" },
  { value: "capability", label: "Capability Statement" },
  { value: "boilerplate", label: "Boilerplate / Templates" },
  { value: "pricing", label: "Pricing Strategy" },
  { value: "win_theme", label: "Win Themes" },
  { value: "other", label: "Other" },
] as const;

export type KbEntry = {
  id: string;
  category: string;
  title: string;
  content: string;
  source_filename: string | null;
  tags: string[] | null;
  created_at: string;
  team_id: string | null;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",", 2)[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function categoryLabel(v: string) {
  return KB_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

export function KnowledgeBasePanel() {
  return (
    <div className="space-y-6">
      <KbUploadCard />
      <KbLibraryCard />
    </div>
  );
}

/** Alias for admin.tsx compatibility */
export function KnowledgeBaseSections() {
  return <KnowledgeBasePanel />;
}

function KbUploadCard() {
  const qc = useQueryClient();
  const { currentTeam } = useTeam();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("past_performance");
  const [tagsInput, setTagsInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const ingestMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      if (!title.trim()) throw new Error("Title is required.");
      if (!currentTeam?.id) throw new Error("No active team. Select a team first.");
      const fileBase64 = await fileToBase64(file);
      const tags = tagsInput
        .split(",").map((t) => t.trim()).filter(Boolean);
      const { data, error } = await supabase.functions.invoke("ingest-knowledge", {
        body: {
          filename: file.name,
          fileType: file.type,
          fileBase64,
          category,
          title: title.trim(),
          tags,
          teamId: currentTeam.id,
        },
      });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { id: string; chars: number };
    },
    onSuccess: (data) => {
      toast.success(`Ingested ${data.chars.toLocaleString()} characters.`);
      setTitle(""); setTagsInput(""); setFile(null);
      const input = document.getElementById("kb-file-input") as HTMLInputElement | null;
      if (input) input.value = "";
      qc.invalidateQueries({ queryKey: ["kb-entries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="font-semibold">Upload content</h2>
        <p className="text-xs text-muted-foreground">
          We extract text from PDF, DOCX, TXT, or MD files and store it for reuse across proposals.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); ingestMut.mutate(); }}
      >
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4">
          <div>
            <Label htmlFor="kb-title">Title</Label>
            <Input
              id="kb-title" required value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. DLA Logistics Modernization PWS"
            />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KB_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="kb-tags">Tags <span className="text-muted-foreground">(optional, comma-separated)</span></Label>
          <Input
            id="kb-tags" value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. DoD, cybersecurity, RMF"
          />
        </div>

        <label
          htmlFor="kb-file-input"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
          className={`block border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          <input
            id="kb-file-input" type="file" className="hidden"
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <FileText className="w-5 h-5 text-primary" />
              <span className="font-medium">{file.name}</span>
              <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          ) : (
            <div className="space-y-1">
              <Upload className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-sm">Drop a file here or click to browse</p>
              <p className="text-xs text-muted-foreground">PDF, DOCX, TXT, or MD</p>
            </div>
          )}
        </label>

        <div className="flex justify-end">
          <Button type="submit" disabled={ingestMut.isPending || !file}>
            {ingestMut.isPending
              ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Ingesting…</>
              : <><Upload className="w-4 h-4 mr-1" /> Upload & Ingest</>}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function KbLibraryCard() {
  const qc = useQueryClient();
  const { currentTeam } = useTeam();
  const [filter, setFilter] = useState<string>("all");

  const teamIds = currentTeam
    ? [currentTeam.id, ...(currentTeam.parent_team_id ? [currentTeam.parent_team_id] : [])]
    : [];

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["kb-entries", teamIds.join(",")],
    enabled: teamIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_base")
        .select("id,category,title,content,source_filename,tags,created_at,team_id")
        .in("team_id", teamIds)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as KbEntry[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("knowledge_base").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Entry deleted.");
      qc.invalidateQueries({ queryKey: ["kb-entries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = data ?? [];
  const filtered = filter === "all" ? entries : entries.filter((e) => e.category === filter);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Library</h2>
          <p className="text-xs text-muted-foreground">{entries.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Filter</Label>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[220px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {KB_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading entries…</div>
      ) : isError ? (
        <div className="p-6 text-sm text-destructive">Could not load entries: {(error as Error)?.message}</div>
      ) : (
        <TooltipProvider delayDuration={200}>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source file</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Date added</TableHead>
                <TableHead className="text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-12">
                    {entries.length === 0
                      ? "No knowledge base entries yet — upload one above to get started."
                      : "No entries in this category."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{e.title}</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-md">
                        <p className="text-xs whitespace-pre-wrap">
                          {e.content.slice(0, 150)}{e.content.length > 150 ? "…" : ""}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{categoryLabel(e.category)}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.source_filename ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(e.tags ?? []).length === 0
                        ? <span className="text-xs text-muted-foreground">—</span>
                        : (e.tags ?? []).map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(e.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right pr-4">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={deleteMut.isPending}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{e.title}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes this entry from the knowledge base. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMut.mutate(e.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </TooltipProvider>
      )}
    </Card>
  );
}
