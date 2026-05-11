import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  listUsers, setUserRole, setUserStatus, deleteUser,
  inviteUser, listInvites, resendInvite, cancelInvite,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ShieldCheck, UserMinus, UserCheck, Trash2, RotateCcw, X, Mail } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/admin")({ component: AdminPage });

function AdminPage() {
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
            <h1 className="text-xl font-bold tracking-tight">Team Administration</h1>
            <p className="text-xs text-muted-foreground">Manage users, roles, and invitations</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" /> Back to dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6">
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="invites">Invitations</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-4"><UsersPanel currentUserId={user.id} /></TabsContent>
          <TabsContent value="invites" className="mt-4"><InvitesPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const fetchUsers = useServerFn(listUsers);
  const setRoleFn = useServerFn(setUserRole);
  const setStatusFn = useServerFn(setUserStatus);
  const deleteUserFn = useServerFn(deleteUser);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchUsers(),
    retry: false,
  });

  const roleMut = useMutation({
    mutationFn: (vars: { userId: string; role: "admin" | "member" }) => setRoleFn({ data: vars }),
    onSuccess: () => { toast.success("Role updated."); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const statusMut = useMutation({
    mutationFn: (vars: { userId: string; status: "active" | "deactivated" }) => setStatusFn({ data: vars }),
    onSuccess: () => { toast.success("Status updated."); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (userId: string) => deleteUserFn({ data: { userId } }),
    onSuccess: () => { toast.success("User removed."); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Loading users…</div>;
  if (isError) return <Card className="p-6 text-sm text-destructive">Could not load users: {(error as Error)?.message ?? "permission denied"}</Card>;
  const users = data?.users ?? [];

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="text-right pr-4">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const isSelf = u.userId === currentUserId;
            return (
              <TableRow key={u.userId}>
                <TableCell className="font-medium">{u.displayName ?? "—"}{isSelf && <span className="text-xs text-muted-foreground ml-2">(you)</span>}</TableCell>
                <TableCell className="text-sm">{u.email}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    disabled={isSelf || roleMut.isPending}
                    onValueChange={(v) => roleMut.mutate({ userId: u.userId, role: v as "admin" | "member" })}
                  >
                    <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge variant={u.status === "active" ? "default" : "secondary"}>
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.createdAt ? format(new Date(u.createdAt), "MMM d, yyyy") : "—"}
                </TableCell>
                <TableCell className="text-right pr-4">
                  <div className="flex justify-end gap-1">
                    {u.status === "active" ? (
                      <Button
                        variant="outline" size="sm" disabled={isSelf || statusMut.isPending}
                        onClick={() => statusMut.mutate({ userId: u.userId, status: "deactivated" })}
                      ><UserMinus className="w-3.5 h-3.5 mr-1" /> Deactivate</Button>
                    ) : (
                      <Button
                        variant="outline" size="sm" disabled={statusMut.isPending}
                        onClick={() => statusMut.mutate({ userId: u.userId, status: "active" })}
                      ><UserCheck className="w-3.5 h-3.5 mr-1" /> Reactivate</Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isSelf}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {u.email}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes the user account and all of their personal data (proposal drafts, preferences). This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMut.mutate(u.userId)}>Remove user</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function InvitesPanel() {
  const qc = useQueryClient();
  const fetchInvites = useServerFn(listInvites);
  const inviteFn = useServerFn(inviteUser);
  const resendFn = useServerFn(resendInvite);
  const cancelFn = useServerFn(cancelInvite);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => fetchInvites(),
    retry: false,
  });
  const invites = data?.invites ?? [];

  const inviteMut = useMutation({
    mutationFn: (vars: { email: string; role: "admin" | "member" }) =>
      inviteFn({ data: { ...vars, origin: window.location.origin } }),
    onSuccess: (res) => {
      if (res.warning) toast.warning(`Invite created. Email note: ${res.warning}`);
      else toast.success("Invitation sent.");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resendMut = useMutation({
    mutationFn: (id: string) => resendFn({ data: { id, origin: window.location.origin } }),
    onSuccess: (res) => {
      if (res.warning) toast.warning(`Resent. Email note: ${res.warning}`);
      else toast.success("Invitation resent.");
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => { toast.success("Invitation cancelled."); qc.invalidateQueries({ queryKey: ["admin-invites"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="font-semibold mb-1">Invite a team member</h2>
        <p className="text-xs text-muted-foreground mb-4">
          They'll receive an email with a secure link to set their password and join.
        </p>
        <form
          className="flex flex-wrap gap-3 items-end"
          onSubmit={(e) => { e.preventDefault(); if (email) inviteMut.mutate({ email, role }); }}
        >
          <div className="flex-1 min-w-[240px]">
            <Label>Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
          </div>
          <div className="w-[140px]">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={inviteMut.isPending}>
            <Mail className="w-4 h-4 mr-1" /> Send invitation
          </Button>
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-6 py-3 border-b border-border">
          <h2 className="font-semibold">Pending & past invitations</h2>
        </div>
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : isError ? (
          <div className="p-4 text-sm text-destructive">Could not load invitations: {(error as Error)?.message ?? "permission denied"}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No invitations yet.</TableCell></TableRow>
              )}
              {invites.map((inv) => {
                const expired = inv.status === "pending" && new Date(inv.expires_at) < new Date();
                const variant = inv.status === "accepted" ? "default" : inv.status === "cancelled" ? "secondary" : expired ? "destructive" : "outline";
                const label = expired ? "expired" : inv.status;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium text-sm">{inv.email}</TableCell>
                    <TableCell className="text-sm capitalize">{inv.role}</TableCell>
                    <TableCell><Badge variant={variant}>{label}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(inv.created_at), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(inv.expires_at), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right pr-4">
                      {(inv.status === "pending" || expired) && (
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" disabled={resendMut.isPending}
                            onClick={() => resendMut.mutate(inv.id)}>
                            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Resend
                          </Button>
                          <Button variant="outline" size="sm" disabled={cancelMut.isPending}
                            onClick={() => cancelMut.mutate(inv.id)}>
                            <X className="w-3.5 h-3.5 mr-1" /> Cancel
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <ShieldCheck className="w-3.5 h-3.5" /> Roles are checked server-side on every request — UI gating is for convenience only.
      </p>
    </div>
  );
}
