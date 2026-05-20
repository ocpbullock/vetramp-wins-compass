import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam, type Team, type TeamRole } from "@/lib/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Building2, Briefcase, Check, Plus, UserPlus, Trash2, Archive, Loader2, ExternalLink, RefreshCw, XCircle, LogOut, Edit2, Users,
} from "lucide-react";
import { toast } from "sonner";
import { inviteToOpportunityTeam } from "@/lib/opportunity-teams.functions";
import { listTeamInvites, resendTeamInvite, cancelTeamInvite, listTeamProposals } from "@/lib/teams.functions";

export const Route = createFileRoute("/teams")({ component: TeamsPage });

type TeamRow = Team & {
  status: "active" | "archived";
  created_at: string;
  member_count: number;
  my_role: TeamRole;
};

const ROLES: TeamRole[] = ["owner", "admin", "member", "viewer"];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "team";
}

function TeamsPage() {
  const { user, loading: authLoading } = useAuth();
  const { currentTeam, setCurrentTeam, refreshTeam } = useTeam();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [manageTeamId, setManageTeamId] = useState<string | null>(null);

  const teamsQ = useQuery({
    queryKey: ["all-my-teams", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<TeamRow[]> => {
      if (!user) return [];
      const { data: memberships, error } = await supabase
        .from("team_members")
        .select("role, team_id, teams:team_id ( id, name, slug, created_by, team_type, parent_team_id, status, created_at )")
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      const rows = (memberships ?? []).map((r: any) => ({
        team: r.teams,
        role: r.role as TeamRole,
      })).filter((r) => !!r.team);
      const teamIds = rows.map((r) => r.team.id);
      const counts: Record<string, number> = {};
      if (teamIds.length) {
        const { data: members } = await supabase
          .from("team_members")
          .select("team_id")
          .in("team_id", teamIds);
        for (const m of members ?? []) {
          counts[m.team_id] = (counts[m.team_id] ?? 0) + 1;
        }
      }
      return rows.map((r) => ({
        ...r.team,
        status: (r.team.status ?? "active") as "active" | "archived",
        created_at: r.team.created_at,
        member_count: counts[r.team.id] ?? 0,
        my_role: r.role,
      } as TeamRow));
    },
  });

  const teams = teamsQ.data ?? [];
  const orgTeams = teams
    .filter((t) => t.team_type === "organization")
    .sort((a, b) => a.name.localeCompare(b.name));
  const oppTeams = teams
    .filter((t) => t.team_type === "opportunity")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });

  if (authLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!user) {
    return (
      <div className="p-8">
        <Link to="/auth" className="text-primary underline">Sign in</Link> to manage teams.
      </div>
    );
  }

  const manageTeam = manageTeamId ? teams.find((t) => t.id === manageTeamId) ?? null : null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/" })} aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Team Management</h1>
            <p className="text-sm text-muted-foreground">View and manage organizations and opportunity teams you belong to.</p>
          </div>
        </div>
        <Button onClick={() => setOpenCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> Create team
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Organization teams ({orgTeams.length})
        </h2>
        {teamsQ.isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
        ) : orgTeams.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No organization teams yet.</Card>
        ) : (
          <div className="grid gap-3">
            {orgTeams.map((t) => (
              <TeamCard
                key={t.id}
                team={t}
                isActive={currentTeam?.id === t.id}
                onActivate={() => { setCurrentTeam(t.id); toast.success(`Switched to ${t.name}`); }}
                onManage={() => setManageTeamId(t.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Briefcase className="w-4 h-4" /> Opportunity teams ({oppTeams.length})
        </h2>
        {oppTeams.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No opportunity teams yet.</Card>
        ) : (
          <div className="grid gap-3">
            {oppTeams.map((t) => (
              <TeamCard
                key={t.id}
                team={t}
                isActive={currentTeam?.id === t.id}
                onActivate={() => { setCurrentTeam(t.id); toast.success(`Switched to ${t.name}`); }}
                onManage={() => setManageTeamId(t.id)}
              />
            ))}
          </div>
        )}
      </section>

      <CreateTeamDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["all-my-teams"] });
          refreshTeam();
        }}
      />

      {manageTeam && (
        <ManageTeamDialog
          team={manageTeam}
          open={!!manageTeam}
          onOpenChange={(o) => { if (!o) setManageTeamId(null); }}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["all-my-teams"] });
            refreshTeam();
          }}
        />
      )}
    </div>
  );
}

function TeamCard({
  team, isActive, onActivate, onManage,
}: {
  team: TeamRow;
  isActive: boolean;
  onActivate: () => void;
  onManage: () => void;
}) {
  const isOpp = team.team_type === "opportunity";
  return (
    <Card className="p-4 flex items-start justify-between gap-4 hover:border-primary/40 transition-colors">
      <button
        type="button"
        onClick={onActivate}
        className="flex-1 text-left flex items-start gap-3 min-w-0"
      >
        <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${isOpp ? "bg-amber-500/15 text-amber-700" : "bg-blue-500/15 text-blue-700"}`}>
          {isOpp ? <Briefcase className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{team.name}</span>
            {isActive && <Badge className="bg-primary/15 text-primary border-primary/20" variant="outline"><Check className="w-3 h-3 mr-1" />Currently Active</Badge>}
            <Badge variant="outline" className="text-[10px] uppercase">{team.my_role}</Badge>
            {isOpp && (
              <Badge variant={team.status === "archived" ? "secondary" : "outline"} className="text-[10px] uppercase">
                {team.status}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1"><Users className="w-3 h-3" />{team.member_count} member{team.member_count === 1 ? "" : "s"}</span>
            <span>Created {team.created_at ? new Date(team.created_at).toLocaleDateString() : "—"}</span>
          </div>
        </div>
      </button>
      <Button variant="outline" size="sm" onClick={onManage}>
        Manage
      </Button>
    </Card>
  );
}

function CreateTeamDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { user } = useAuth();
  const { currentTeam } = useTeam();
  const [name, setName] = useState("");
  const [teamType, setTeamType] = useState<"organization" | "opportunity">("organization");
  const [linkedProposalId, setLinkedProposalId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const proposalsQ = useQuery({
    queryKey: ["unlinked-proposals", currentTeam?.id],
    enabled: open && teamType === "opportunity" && !!currentTeam && currentTeam.team_type === "organization",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("id, opportunity_title, solicitation_number")
        .eq("team_id", currentTeam!.id)
        .is("opportunity_team_id", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  async function handleCreate() {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const slug = `${slugify(trimmed)}-${crypto.randomUUID().slice(0, 8)}`;
      let parentTeamId: string | null = null;
      if (teamType === "opportunity") {
        if (!currentTeam || currentTeam.team_type !== "organization") {
          throw new Error("Switch to an organization team before creating an opportunity team.");
        }
        parentTeamId = currentTeam.id;
      }
      const { data: team, error: tErr } = await supabase
        .from("teams")
        .insert({
          name: trimmed,
          slug,
          created_by: user.id,
          team_type: teamType,
          parent_team_id: parentTeamId,
        })
        .select("id")
        .single();
      if (tErr) throw new Error(tErr.message);
      const { error: mErr } = await supabase
        .from("team_members")
        .insert({ team_id: team.id, user_id: user.id, role: "owner" });
      if (mErr) throw new Error(mErr.message);
      if (teamType === "opportunity" && linkedProposalId) {
        await supabase.from("proposals").update({ opportunity_team_id: team.id }).eq("id", linkedProposalId);
      }
      toast.success("Team created");
      setName(""); setLinkedProposalId(""); setTeamType("organization");
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create team");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
          <DialogDescription>Start a new organization or opportunity team. You become the owner.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="new-team-name">Team name</Label>
            <Input id="new-team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Company" />
          </div>
          <div>
            <Label>Team type</Label>
            <RadioGroup value={teamType} onValueChange={(v) => setTeamType(v as "organization" | "opportunity")} className="mt-2 grid grid-cols-2 gap-2">
              <Label className="flex items-center gap-2 border rounded-md p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="organization" />
                <Building2 className="w-4 h-4" /> Organization
              </Label>
              <Label className="flex items-center gap-2 border rounded-md p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="opportunity" />
                <Briefcase className="w-4 h-4" /> Opportunity
              </Label>
            </RadioGroup>
          </div>
          {teamType === "opportunity" && (
            <div>
              <Label>Link to existing proposal (optional)</Label>
              <Select value={linkedProposalId} onValueChange={setLinkedProposalId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {(proposalsQ.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.opportunity_title ?? p.solicitation_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Only unlinked proposals from your current organization team are shown.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleCreate} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageTeamDialog({
  team, open, onOpenChange, onChanged,
}: {
  team: TeamRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = team.my_role === "owner" || team.my_role === "admin";
  const isOwner = team.my_role === "owner";
  const isOpp = team.team_type === "opportunity";

  const [name, setName] = useState(team.name);
  useEffect(() => { setName(team.name); }, [team.name]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");

  const inviteFn = useServerFn(inviteToOpportunityTeam);
  const listInvitesFn = useServerFn(listTeamInvites);
  const resendFn = useServerFn(resendTeamInvite);
  const cancelFn = useServerFn(cancelTeamInvite);
  const listProposalsFn = useServerFn(listTeamProposals);

  const membersQ = useQuery({
    queryKey: ["team-members-full", team.id],
    enabled: open,
    queryFn: async () => {
      const { data: members, error } = await supabase
        .from("team_members")
        .select("id, user_id, role, joined_at")
        .eq("team_id", team.id);
      if (error) throw new Error(error.message);
      const ids = (members ?? []).map((m) => m.user_id);
      let profilesById: Record<string, { email: string | null; display_name: string | null }> = {};
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, email, display_name")
          .in("user_id", ids);
        profilesById = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, { email: p.email, display_name: p.display_name }]));
      }
      return (members ?? []).map((m) => ({
        ...m,
        email: profilesById[m.user_id]?.email ?? null,
        display_name: profilesById[m.user_id]?.display_name ?? null,
      }));
    },
  });

  const invitesQ = useQuery({
    queryKey: ["team-invites", team.id],
    enabled: open && canManage,
    queryFn: () => listInvitesFn({ data: { teamId: team.id } }),
  });

  const proposalsQ = useQuery({
    queryKey: ["team-proposals", team.id],
    enabled: open && isOpp,
    queryFn: () => listProposalsFn({ data: { teamId: team.id } }),
  });

  const ownerCount = useMemo(
    () => (membersQ.data ?? []).filter((m) => m.role === "owner").length,
    [membersQ.data],
  );

  const renameMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").update({ name: name.trim() }).eq("id", team.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Team renamed"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: async (next: "active" | "archived") => {
      const { error } = await supabase.from("teams").update({ status: next }).eq("id", team.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, next) => { toast.success(next === "archived" ? "Team archived" : "Team restored"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").delete().eq("id", team.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Team deleted"); onOpenChange(false); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim().toLowerCase();
      if (!email) throw new Error("Email required");
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      await inviteFn({ data: { teamId: team.id, email, origin } });
    },
    onSuccess: () => {
      toast.success("Invite sent");
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["team-invites", team.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRoleMut = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: TeamRole }) => {
      const { error } = await supabase.from("team_members").update({ role }).eq("id", memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["team-members-full", team.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from("team_members").delete().eq("id", memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["team-members-full", team.id] });
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isOpp ? <Briefcase className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
            Manage team
            <Badge variant="outline" className="text-[10px] uppercase">{team.my_role}</Badge>
            {isOpp && <Badge variant={team.status === "archived" ? "secondary" : "outline"} className="text-[10px] uppercase">{team.status}</Badge>}
          </DialogTitle>
          <DialogDescription>{team.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Rename */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Team details</Label>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
              </div>
              <Button
                onClick={() => renameMut.mutate()}
                disabled={!canManage || renameMut.isPending || !name.trim() || name === team.name}
              >
                <Edit2 className="w-4 h-4 mr-1" /> Save
              </Button>
            </div>
          </div>

          {/* Invite */}
          {canManage && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Invite member</Label>
              <form
                className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-2 items-end"
                onSubmit={(e) => { e.preventDefault(); inviteMut.mutate(); }}
              >
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as TeamRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.filter((r) => r !== "owner" || isOwner).map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={inviteMut.isPending || !inviteEmail.trim()}>
                  {inviteMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
                  Invite
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">An email invite is sent. Role on the invite is captured; the new member joins as the role you set.</p>
            </div>
          )}

          {/* Members */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Members ({membersQ.data?.length ?? 0})</Label>
            </div>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(membersQ.data ?? []).map((m) => {
                    const isSelf = m.user_id === user?.id;
                    const isLastOwner = m.role === "owner" && ownerCount <= 1;
                    const canEditRole = canManage && !isSelf && !isLastOwner;
                    const canRemove = (canManage || isSelf) && !isLastOwner;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">
                          {m.display_name ?? "—"} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{m.email ?? "—"}</TableCell>
                        <TableCell>
                          {canEditRole ? (
                            <Select
                              value={m.role}
                              onValueChange={(v) => updateRoleMut.mutate({ memberId: m.id, role: v as TeamRole })}
                            >
                              <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ROLES.filter((r) => r !== "owner" || isOwner).map((r) => (
                                  <SelectItem key={r} value={r}>{r}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline">{m.role}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(m.joined_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {canRemove && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label={isSelf ? "Leave" : "Remove"}>
                                  {isSelf ? <LogOut className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{isSelf ? "Leave team?" : "Remove member?"}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {isSelf
                                      ? "You will lose access to this team's data. You can be re-added by an owner."
                                      : `Remove ${m.display_name ?? m.email ?? "this member"}?`}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => removeMut.mutate(m.id)}>
                                    {isSelf ? "Leave" : "Remove"}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pending invites */}
          {canManage && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Pending invites</Label>
              {(invitesQ.data?.invites ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No invites.</p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(invitesQ.data?.invites ?? []).map((inv) => {
                        const expired = new Date(inv.expires_at) < new Date() && inv.status === "pending";
                        const displayStatus = expired ? "expired" : inv.status;
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="text-sm">{inv.email}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px] uppercase">{displayStatus}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</TableCell>
                            <TableCell className="flex gap-1">
                              {(inv.status === "pending" || expired) && (
                                <>
                                  <Button
                                    variant="ghost" size="icon" aria-label="Resend"
                                    onClick={async () => {
                                      try {
                                        await resendFn({ data: { id: inv.id, origin: window.location.origin } });
                                        toast.success("Invite resent");
                                        qc.invalidateQueries({ queryKey: ["team-invites", team.id] });
                                      } catch (e) {
                                        toast.error(e instanceof Error ? e.message : "Failed");
                                      }
                                    }}
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" aria-label="Revoke"
                                    onClick={async () => {
                                      try {
                                        await cancelFn({ data: { id: inv.id } });
                                        toast.success("Invite revoked");
                                        qc.invalidateQueries({ queryKey: ["team-invites", team.id] });
                                      } catch (e) {
                                        toast.error(e instanceof Error ? e.message : "Failed");
                                      }
                                    }}
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {/* Linked proposals (opportunity teams) */}
          {isOpp && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Linked proposals</Label>
              {(proposalsQ.data?.proposals ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No linked proposals.</p>
              ) : (
                <div className="space-y-1">
                  {(proposalsQ.data?.proposals ?? []).map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { onOpenChange(false); navigate({ to: "/proposals/$proposalId", params: { proposalId: p.id } }); }}
                      className="w-full text-left flex items-center justify-between p-2 border rounded-md hover:bg-accent text-sm"
                    >
                      <span className="truncate">{p.opportunity_title ?? p.solicitation_number}</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Danger zone for opp teams */}
          {isOpp && isOwner && (
            <div className="space-y-2 border-t pt-4">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Danger zone</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => archiveMut.mutate(team.status === "archived" ? "active" : "archived")}
                  disabled={archiveMut.isPending}
                >
                  <Archive className="w-4 h-4 mr-1" />
                  {team.status === "archived" ? "Restore team" : "Archive team"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="w-4 h-4 mr-1" /> Delete team
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this team?</AlertDialogTitle>
                      <AlertDialogDescription>
                        All members will lose access to the linked proposal workspace. The proposal itself is not deleted, but invited partners will no longer be able to open it.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMut.mutate()}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
