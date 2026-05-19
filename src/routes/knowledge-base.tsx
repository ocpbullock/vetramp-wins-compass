import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
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
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, Trash2, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/knowledge-base")({ component: KnowledgeBasePage });

const CATEGORIES = [
  { value: "past_performance", label: "Past performance" },
  { value: "personnel", label: "Personnel" },
  { value: "capability", label: "Capability" },
  { value: "boilerplate", label: "Boilerplate" },
  { value: "pricing", label: "Pricing" },
  { value: "win_theme", label: "Win theme" },
  { value: "other", label: "Other" },
] as const;

type KbEntry = {
  id: string;
  category: string;
  title: string;
  content: string;
  source_filename: string | null;
  tags: string[] | null;
  created_at: string;
  user_id: string | null;
};

function KnowledgeBasePage() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!isAdmin) {
      toast.error("Admins only.");
      navigate({ to: "/" });
    }
  }, [user, loading, isAdmin, navigate]);

  if (loading || !user || !isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Knowledge Base</h1>
            <p className="text-xs text-muted-foreground">Reusable proposal content for your team</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin"><ArrowLeft className="w-4 h-4 mr-1" /> Back to admin</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 space-y-6">
        <KnowledgeBaseSections />
      </main>
    </div>
  );
}

export function KnowledgeBaseSections() {
  return (
    <>
      <UploadCard />
      <LibraryCard />
    </>
  );
}

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

function UploadCard() {
  const qc = useQueryClient();
  const { currentTeam } = useTeam();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("past_performance");
  const [title, setTitle] = useState("");

  const ingestMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      if (!title.trim()) throw new Error("Title is required.");
      if (!currentTeam?.id) throw new Error("No active team. Select a team first.");
      const fileBase64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("ingest-knowledge", {
        body: {
          fileBase64,
          filename: file.name,
          category,
          title: title.trim(),
          teamId: currentTeam.id,
        },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success("Added to knowledge base.");
      setFile(null); setTitle("");
      const input = document.getElementById("kb-file") as HTMLInputElement | null;
      if (input) input.value = "";
      qc.invalidateQueries({ queryKey: ["knowledge-base"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-6">
      <h2 className="font-semibold mb-1">Upload content</h2>
      <p className="text-xs text-muted-foreground mb-4">
        We extract the text from PDF, DOCX, TXT, or MD files and store it for reuse across proposals.
      </p>
      <form
        className="grid grid-cols-1 md:grid-cols-[1fr_200px_1fr_auto] gap-3 items-end"
        onSubmit={(e) => { e.preventDefault(); ingestMut.mutate(); }}
      >
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
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="kb-file">File</Label>
          <Input
            id="kb-file" type="file" required
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button type="submit" disabled={ingestMut.isPending}>
          {ingestMut.isPending
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Ingesting…</>
            : <><Upload className="w-4 h-4 mr-1" /> Add</>}
        </Button>
      </form>
    </Card>
  );
}

function LibraryCard() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["knowledge-base"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("knowledge_base")
        .select("id,category,title,content,source_filename,tags,created_at,user_id")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as KbEntry[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("knowledge_base").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Entry deleted.");
      qc.invalidateQueries({ queryKey: ["knowledge-base"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = data ?? [];
  const filtered = useMemo(
    () => filter === "all" ? entries : entries.filter((e) => e.category === filter),
    [entries, filter],
  );

  const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4">
        <h2 className="font-semibold">Library</h2>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[200px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {isLoading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : isError ? (
        <div className="p-4 text-sm text-destructive">Could not load entries: {(error as Error)?.message}</div>
      ) : (
        <TooltipProvider delayDuration={200}>
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
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    No entries yet.
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
                          {e.content.slice(0, 100)}{e.content.length > 100 ? "…" : ""}
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
                    <Button
                      variant="outline" size="sm"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(e.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      )}
    </Card>
  );
}
