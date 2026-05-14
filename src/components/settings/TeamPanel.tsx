import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam, type TeamRole } from "@/lib/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Save, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

const ROLES: TeamRole[] = ["owner", "admin", "member", "viewer"];

export function TeamPanel() {
  const { user } = useAuth();
  const { currentTeam, teamMembers, userRole, loading, refreshTeam, refreshMembers } = useTeam();
  const qc = useQueryClient();
  const canManage = userRole === "owner" || userRole === "admin";
  const isOwner = userRole === "owner";

  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");

  // Sync local team name when team loads
  useQuery({
    queryKey: ["team-name-sync", currentTeam?.id],
    enabled: !!currentTeam,
    queryFn: () => {
      setTeamName(currentTeam?.name ?? "");
      return null;
    },
  });

  const renameMut = useMutation({
    mutationFn: async () => {
      if (!currentTeam) throw new Error("No team");
      const { error } = await supabase.from("teams").update({ name: teamName.trim() }).eq("id", currentTeam.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Team renamed"); refreshTeam(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!currentTeam) throw new Error("No team");
      const email = inviteEmail.trim().toLowerCase();
      if (!email) throw new Error("Email is required");
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, email")
        .ilike("email", email)
        .maybeSingle();
      if (pErr) throw new Error(pErr.message);
      if (!profile) throw new Error("No user with that email has signed up yet.");
      const { error } = await supabase
        .from("team_members")
        .insert({ team_id: currentTeam.id, user_id: profile.user_id, role: inviteRole });
      if (error) throw new Error(error.message.includes("duplicate") ? "Already a member" : error.message);
    },
    onSuccess: () => {
      toast.success("Member added");
      setInviteEmail("");
      refreshMembers();
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRoleMut = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: TeamRole }) => {
      const { error } = await supabase.from("team_members").update({ role }).eq("id", memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Role updated"); refreshMembers(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from("team_members").delete().eq("id", memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Member removed"); refreshMembers(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Loading team…</Card>;
  if (!currentTeam) return <Card className="p-6 text-sm text-muted-foreground">No team available.</Card>;

  const ownerCount = teamMembers.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Team details</h2>
          <Badge variant="secondary">{userRole ?? "—"}</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              disabled={!isOwner}
            />
            <p className="text-xs text-muted-foreground mt-1">Slug: {currentTeam.slug}</p>
          </div>
          <Button
            onClick={() => renameMut.mutate()}
            disabled={!isOwner || renameMut.isPending || !teamName.trim() || teamName === currentTeam.name}
          >
            {renameMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Save
          </Button>
        </div>
      </Card>

      {canManage && (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold">Invite member</h2>
          <p className="text-xs text-muted-foreground">
            Add an existing account by email. They must have signed up first — email invitations aren't available yet.
          </p>
          <form
            className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 items-end"
            onSubmit={(e) => { e.preventDefault(); inviteMut.mutate(); }}
          >
            <div>
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email" type="email" value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as TeamRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== "owner" || isOwner).map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={inviteMut.isPending || !inviteEmail.trim()}>
              {inviteMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
              Add
            </Button>
          </form>
        </Card>
      )}

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Members</h2>
          <Badge variant="secondary">{teamMembers.length}</Badge>
        </div>
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
            {teamMembers.map((m) => {
              const isSelf = m.user_id === user?.id;
              const isLastOwner = m.role === "owner" && ownerCount <= 1;
              const canEditRole = canManage && !isLastOwner;
              const canRemove = (canManage || isSelf) && !isLastOwner;
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.display_name ?? "—"} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.email ?? "—"}</TableCell>
                  <TableCell>
                    {canEditRole ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => updateRoleMut.mutate({ memberId: m.id, role: v as TeamRole })}
                      >
                        <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
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
                          <Button variant="ghost" size="icon" aria-label="Remove member">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove member?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {isSelf
                                ? "You will leave this team. You can be re-added by a team owner."
                                : `Remove ${m.display_name ?? m.email ?? "this member"} from the team?`}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeMut.mutate(m.id)}>Remove</AlertDialogAction>
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
      </Card>
    </div>
  );
}
