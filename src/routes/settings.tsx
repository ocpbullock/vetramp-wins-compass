import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SetupChecklist } from "@/components/settings/SetupChecklist";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Trash2, Save, Loader2, Upload, FileText } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { TeamPanel } from "@/components/settings/TeamPanel";
import { PartnersPanel } from "@/components/settings/PartnersPanel";
import { PastPerformancePanel } from "@/components/settings/PastPerformancePanel";
import { ContractVehiclesPanel } from "@/components/settings/ContractVehiclesPanel";
import { AIUsagePanel } from "@/components/settings/AIUsagePanel";
import { DataHealthPanel } from "@/components/settings/DataHealthPanel";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

type Certification = { name: string; status: string };
type PastPerf = {
  contract_name: string;
  client: string;
  agency: string;
  scope: string;
  naics: string;
  clearance_level: string;
  achievements: string[];
};
type ProfileData = {
  legal_name?: string;
  dba?: string;
  uei?: string;
  cage?: string;
  primary_naics?: string;
  location?: { city?: string; state?: string; zip?: string };
  founder?: { name?: string; branch?: string; rank?: string; bio?: string };
  core_services?: string[];
  differentiators?: string[];
  certifications?: Certification[];
  past_performance?: PastPerf[];
  [k: string]: unknown;
};

function SettingsPage() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const validTabs = ["company", "knowledge", "team", "partners", "past-performance", "vehicles", "ai-usage", "data-health"];
  const hashTab = (location.hash || "").replace(/^#/, "");
  const initialTab = validTabs.includes(hashTab) ? hashTab : (isAdmin ? "company" : "team");
  const [tab, setTab] = useState<string>(initialTab);
  useEffect(() => {
    if (hashTab && validTabs.includes(hashTab)) setTab(hashTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashTab]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-xs text-muted-foreground">Team, company profile, and knowledge base</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" /> Back to dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 space-y-6">
        <SetupChecklist />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {isAdmin && <TabsTrigger value="company">Company Profile</TabsTrigger>}
            {isAdmin && <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>}
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="partners">Teaming Partners</TabsTrigger>
            <TabsTrigger value="past-performance">Past Performance</TabsTrigger>
            <TabsTrigger value="vehicles">Contract Vehicles</TabsTrigger>
            <TabsTrigger value="ai-usage">API &amp; AI Usage</TabsTrigger>
            <TabsTrigger value="data-health">Data Health</TabsTrigger>
          </TabsList>
          {isAdmin && <TabsContent value="company" className="mt-4"><CompanyProfilePanel /></TabsContent>}
          {isAdmin && <TabsContent value="knowledge" className="mt-4"><KnowledgeBasePanel /></TabsContent>}
          <TabsContent value="team" className="mt-4"><TeamPanel /></TabsContent>
          <TabsContent value="partners" className="mt-4"><PartnersPanel /></TabsContent>
          <TabsContent value="past-performance" className="mt-4"><PastPerformancePanel /></TabsContent>
          <TabsContent value="vehicles" className="mt-4"><ContractVehiclesPanel /></TabsContent>
          <TabsContent value="ai-usage" className="mt-4 space-y-4"><TangoUsagePanel /><AIUsagePanel /></TabsContent>
          <TabsContent value="data-health" className="mt-4"><DataHealthPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ensureShape(p: ProfileData | null | undefined): ProfileData {
  return {
    legal_name: "",
    dba: "",
    uei: "",
    cage: "",
    primary_naics: "",
    ...(p ?? {}),
    location: { city: "", state: "", zip: "", ...(p?.location ?? {}) },
    founder: { name: "", branch: "", rank: "", bio: "", ...(p?.founder ?? {}) },
    core_services: p?.core_services ?? [],
    differentiators: p?.differentiators ?? [],
    certifications: p?.certifications ?? [],
    past_performance: p?.past_performance ?? [],
  };
}

function CompanyProfilePanel() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ProfileData | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["company-profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_profile")
        .select("id, profile_data")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  useEffect(() => {
    if (data) {
      setRowId(data.id);
      setForm(ensureShape(data.profile_data as ProfileData));
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!rowId || !form) throw new Error("Nothing to save.");
      const { error } = await supabase
        .from("company_profile")
        .update({ profile_data: form as never })
        .eq("id", rowId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Company profile saved.");
      qc.invalidateQueries({ queryKey: ["company-profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Card className="p-6 text-sm text-muted-foreground">Loading profile…</Card>;
  if (isError) return <Card className="p-6 text-sm text-destructive">Could not load profile: {(error as Error)?.message}</Card>;
  if (!form) return <Card className="p-6 text-sm text-muted-foreground">No company profile row found.</Card>;

  const update = (patch: Partial<ProfileData>) => setForm((f) => ({ ...(f ?? {}), ...patch }));
  const updateLocation = (patch: Partial<NonNullable<ProfileData["location"]>>) =>
    setForm((f) => ({ ...(f ?? {}), location: { ...(f?.location ?? {}), ...patch } }));
  const updateFounder = (patch: Partial<NonNullable<ProfileData["founder"]>>) =>
    setForm((f) => ({ ...(f ?? {}), founder: { ...(f?.founder ?? {}), ...patch } }));

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Identity</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Legal name" value={form.legal_name ?? ""} onChange={(v) => update({ legal_name: v })} />
          <Field label="DBA" value={form.dba ?? ""} onChange={(v) => update({ dba: v })} />
          <Field label="UEI" value={form.uei ?? ""} onChange={(v) => update({ uei: v })} />
          <Field label="CAGE" value={form.cage ?? ""} onChange={(v) => update({ cage: v })} />
          <Field label="Primary NAICS" value={form.primary_naics ?? ""} onChange={(v) => update({ primary_naics: v })} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="City" value={form.location?.city ?? ""} onChange={(v) => updateLocation({ city: v })} />
          <Field label="State" value={form.location?.state ?? ""} onChange={(v) => updateLocation({ state: v })} />
          <Field label="Zip" value={form.location?.zip ?? ""} onChange={(v) => updateLocation({ zip: v })} />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Founder</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Name" value={form.founder?.name ?? ""} onChange={(v) => updateFounder({ name: v })} />
          <Field label="Branch" value={form.founder?.branch ?? ""} onChange={(v) => updateFounder({ branch: v })} />
          <Field label="Rank" value={form.founder?.rank ?? ""} onChange={(v) => updateFounder({ rank: v })} />
        </div>
        <div>
          <Label>Bio</Label>
          <Textarea
            rows={4}
            value={form.founder?.bio ?? ""}
            onChange={(e) => updateFounder({ bio: e.target.value })}
          />
        </div>
      </Card>

      <StringListCard
        title="Core services"
        items={form.core_services ?? []}
        onChange={(items) => update({ core_services: items })}
        placeholder="e.g. Cybersecurity & RMF/NIST Compliance"
      />

      <StringListCard
        title="Differentiators"
        items={form.differentiators ?? []}
        onChange={(items) => update({ differentiators: items })}
        placeholder="What makes you stand out"
      />

      <CertificationsCard
        items={form.certifications ?? []}
        onChange={(items) => update({ certifications: items })}
      />

      <Card className="p-4 text-xs text-muted-foreground border-dashed">
        Past performance is now managed in the structured <strong>Past Performance</strong> tab. The freeform list here is deprecated.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
            : <><Save className="w-4 h-4 mr-1" /> Save changes</>}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function StringListCard({
  title, items, onChange, placeholder,
}: { title: string; items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  return (
    <Card className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={item} placeholder={placeholder}
              onChange={(e) => {
                const next = [...items]; next[i] = e.target.value; onChange(next);
              }}
            />
            <Button variant="outline" size="icon" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus className="w-4 h-4 mr-1" /> Add
      </Button>
    </Card>
  );
}

function CertificationsCard({
  items, onChange,
}: { items: Certification[]; onChange: (items: Certification[]) => void }) {
  return (
    <Card className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Certifications</h2>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <div className="space-y-2">
        {items.map((cert, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-2">
            <Input
              value={cert.name} placeholder="Certification name"
              onChange={(e) => {
                const next = [...items]; next[i] = { ...cert, name: e.target.value }; onChange(next);
              }}
            />
            <Input
              value={cert.status} placeholder="Status (e.g. Active)"
              onChange={(e) => {
                const next = [...items]; next[i] = { ...cert, status: e.target.value }; onChange(next);
              }}
            />
            <Button variant="outline" size="icon" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={() => onChange([...items, { name: "", status: "Active" }])}>
        <Plus className="w-4 h-4 mr-1" /> Add certification
      </Button>
    </Card>
  );
}

function PastPerformanceCard({
  items, onChange,
}: { items: PastPerf[]; onChange: (items: PastPerf[]) => void }) {
  const updateOne = (i: number, patch: Partial<PastPerf>) => {
    const next = [...items]; next[i] = { ...items[i], ...patch }; onChange(next);
  };
  const addEmpty = () => onChange([...items, {
    contract_name: "", client: "", agency: "", scope: "",
    naics: "", clearance_level: "", achievements: [],
  }]);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Past performance</h2>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {items.map((pp, i) => (
        <div key={i} className="border border-border rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Entry #{i + 1}</span>
            <Button variant="outline" size="sm" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Contract name" value={pp.contract_name} onChange={(v) => updateOne(i, { contract_name: v })} />
            <Field label="Client" value={pp.client} onChange={(v) => updateOne(i, { client: v })} />
            <Field label="Agency" value={pp.agency} onChange={(v) => updateOne(i, { agency: v })} />
            <Field label="NAICS" value={pp.naics} onChange={(v) => updateOne(i, { naics: v })} />
            <Field label="Clearance level" value={pp.clearance_level} onChange={(v) => updateOne(i, { clearance_level: v })} />
          </div>
          <div>
            <Label>Scope</Label>
            <Textarea rows={3} value={pp.scope} onChange={(e) => updateOne(i, { scope: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Achievements</Label>
            {pp.achievements.map((a, ai) => (
              <div key={ai} className="flex gap-2">
                <Input
                  value={a}
                  onChange={(e) => {
                    const next = [...pp.achievements]; next[ai] = e.target.value;
                    updateOne(i, { achievements: next });
                  }}
                />
                <Button variant="outline" size="icon"
                  onClick={() => updateOne(i, { achievements: pp.achievements.filter((_, idx) => idx !== ai) })}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm"
              onClick={() => updateOne(i, { achievements: [...pp.achievements, ""] })}>
              <Plus className="w-4 h-4 mr-1" /> Add achievement
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addEmpty}>
        <Plus className="w-4 h-4 mr-1" /> Add past performance entry
      </Button>
    </Card>
  );
}

const KB_CATEGORIES = [
  { value: "past_performance", label: "Past Performance" },
  { value: "personnel", label: "Personnel / Resumes" },
  { value: "capability", label: "Capability Statement" },
  { value: "boilerplate", label: "Boilerplate / Templates" },
  { value: "pricing", label: "Pricing Strategy" },
  { value: "win_theme", label: "Win Themes" },
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

function KnowledgeBasePanel() {
  return (
    <div className="space-y-6">
      <KbUploadCard />
      <KbLibraryCard />
    </div>
  );
}

function KbUploadCard() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("past_performance");
  const [tagsInput, setTagsInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const ingestMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      if (!title.trim()) throw new Error("Title is required.");
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
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["kb-entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_base")
        .select("id,category,title,content,source_filename,tags,created_at")
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
        </TooltipProvider>
      )}
    </Card>
  );
}
