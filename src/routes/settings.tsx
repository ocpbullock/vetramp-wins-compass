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
import { ArrowLeft, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { TeamPanel } from "@/components/settings/TeamPanel";
import { useTeamId } from "@/lib/team";
import { PartnersPanel } from "@/components/settings/PartnersPanel";
import { PastPerformancePanel } from "@/components/settings/PastPerformancePanel";
import { ContractVehiclesPanel } from "@/components/settings/ContractVehiclesPanel";
import { KnowledgeBasePanel } from "@/components/settings/KnowledgeBasePanel";
import { getOwnCompanyProfileData, saveOwnCompanyProfile } from "@/lib/companies";

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

  const validTabs = ["company", "knowledge", "team", "partners", "past-performance", "vehicles"];
  const hashTab = (location.hash || "").replace(/^#/, "");
  const initialTab = validTabs.includes(hashTab) ? hashTab : "knowledge";
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
            <h1 className="text-xl font-bold tracking-tight">Capture Intel</h1>
            <p className="text-xs text-muted-foreground">Company profile, knowledge base, team, partners, and past performance</p>
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
            <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="partners">Teaming Partners</TabsTrigger>
            <TabsTrigger value="past-performance">Past Performance</TabsTrigger>
            <TabsTrigger value="vehicles">Contract Vehicles</TabsTrigger>
          </TabsList>
          {isAdmin && <TabsContent value="company" className="mt-4"><CompanyProfilePanel /></TabsContent>}
          <TabsContent value="knowledge" className="mt-4"><KnowledgeBasePanel /></TabsContent>
          <TabsContent value="team" className="mt-4"><TeamPanel /></TabsContent>
          <TabsContent value="partners" className="mt-4"><PartnersPanel /></TabsContent>
          <TabsContent value="past-performance" className="mt-4"><PastPerformancePanel /></TabsContent>
          <TabsContent value="vehicles" className="mt-4"><ContractVehiclesPanel /></TabsContent>
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
  const teamId = useTeamId();
  const [form, setForm] = useState<ProfileData | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["company-profile", teamId],
    enabled: !!teamId,
    staleTime: 30 * 60 * 1000, // Slow-moving reference data
    queryFn: async () => {
      const pd = await getOwnCompanyProfileData(teamId!);
      return (pd ?? {}) as ProfileData;
    },
  });

  useEffect(() => {
    if (data !== undefined) {
      setForm(ensureShape(data as ProfileData));
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!teamId) throw new Error("No active team.");
      if (!form) throw new Error("Nothing to save.");
      await saveOwnCompanyProfile(teamId, form as Record<string, any>);
    },
    onSuccess: () => {
      toast.success("Company profile saved.");
      qc.invalidateQueries({ queryKey: ["company-profile"] });
      qc.invalidateQueries({ queryKey: ["pwin-self"] });
      qc.invalidateQueries({ queryKey: ["pwin-solo"] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      qc.invalidateQueries({ queryKey: ["setup-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Card className="p-6 text-sm text-muted-foreground">Loading profile…</Card>;
  if (isError) return <Card className="p-6 text-sm text-destructive">Could not load profile: {(error as Error)?.message}</Card>;
  if (!form) return <Card className="p-6 text-sm text-muted-foreground">No company profile yet.</Card>;

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

