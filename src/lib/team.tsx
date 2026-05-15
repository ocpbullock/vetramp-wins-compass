import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type TeamRole = "owner" | "admin" | "member" | "viewer";

export type TeamType = "organization" | "opportunity";

export type Team = {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  team_type: TeamType;
  parent_team_id: string | null;
};

export type TeamMember = {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  email?: string | null;
  display_name?: string | null;
};

type TeamCtx = {
  currentTeam: Team | null;
  teamMembers: TeamMember[];
  userRole: TeamRole | null;
  loading: boolean;
  refreshTeam: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  setCurrentTeam: (id: string) => void;
};

const Ctx = createContext<TeamCtx>({
  currentTeam: null,
  teamMembers: [],
  userRole: null,
  loading: true,
  refreshTeam: async () => {},
  refreshMembers: async () => {},
  setCurrentTeam: () => {},
});

const SELECTED_TEAM_KEY = "vetramp.currentTeamId";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "team";
}

export function TeamProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [currentTeam, setCurrentTeamState] = useState<Team | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [userRole, setUserRole] = useState<TeamRole | null>(null);
  const [loading, setLoading] = useState(true);
  const bootstrappedFor = useRef<string | null>(null);
  // Race-condition guard: if a bootstrap is already running and another team
  // switch comes in, queue the latest requested team id and run it once the
  // current bootstrap settles. We only keep the *latest* queued id — older
  // pending switches are discarded since they're stale.
  const bootstrapInFlight = useRef(false);
  const queuedTeamId = useRef<string | null>(null);

  const loadMembers = useCallback(async (teamId: string, uid: string) => {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, team_id, user_id, role, joined_at")
      .eq("team_id", teamId);
    const ids = (members ?? []).map((m) => m.user_id);
    let profilesById: Record<string, { email: string | null; display_name: string | null }> = {};
    if (ids.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, email, display_name")
        .in("user_id", ids);
      profilesById = Object.fromEntries(
        (profiles ?? []).map((p) => [p.user_id, { email: p.email ?? null, display_name: p.display_name ?? null }]),
      );
    }
    const enriched: TeamMember[] = (members ?? []).map((m) => ({
      ...(m as TeamMember),
      role: m.role as TeamRole,
      email: profilesById[m.user_id]?.email ?? null,
      display_name: profilesById[m.user_id]?.display_name ?? null,
    }));
    setTeamMembers(enriched);
    const me = enriched.find((m) => m.user_id === uid);
    setUserRole(me?.role ?? null);
  }, []);

  const bootstrap = useCallback(async (uid: string) => {
    if (bootstrapInFlight.current) {
      // Should be guarded by callers, but double-check to avoid concurrent runs.
      return;
    }
    bootstrapInFlight.current = true;
    setLoading(true);
    try {
      const { data: memberships, error } = await supabase
        .from("team_members")
        .select("team_id, role, teams:team_id ( id, name, slug, created_by )")
        .eq("user_id", uid);
      if (error) throw error;

      const rows = (memberships ?? []) as Array<{
        team_id: string;
        role: TeamRole;
        teams: { id: string; name: string; slug: string; created_by: string | null } | null;
      }>;

      let chosen: Team | null = null;
      if (rows.length === 0) {
        // Auto-create personal team
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name, email")
          .eq("user_id", uid)
          .maybeSingle();
        const baseName = profile?.display_name?.trim() || profile?.email?.split("@")[0] || "My";
        const name = `${baseName}'s Team`;
        const slug = `${slugify(baseName)}-${uid.slice(0, 8)}`;
        const { data: created, error: tErr } = await supabase
          .from("teams")
          .insert({ name, slug, created_by: uid })
          .select("id, name, slug, created_by")
          .single();
        if (tErr) throw tErr;
        const { error: mErr } = await supabase
          .from("team_members")
          .insert({ team_id: created.id, user_id: uid, role: "owner" });
        if (mErr) throw mErr;
        chosen = created as Team;
      } else {
        const stored = typeof window !== "undefined" ? localStorage.getItem(SELECTED_TEAM_KEY) : null;
        const match = rows.find((r) => r.team_id === stored && r.teams) ?? rows.find((r) => r.teams);
        chosen = (match?.teams as Team) ?? null;
      }

      setCurrentTeamState(chosen);
      if (chosen) {
        if (typeof window !== "undefined") localStorage.setItem(SELECTED_TEAM_KEY, chosen.id);
        await loadMembers(chosen.id, uid);
      } else {
        setTeamMembers([]);
        setUserRole(null);
      }
    } finally {
      setLoading(false);
      bootstrapInFlight.current = false;
      // If a team switch came in while we were running, process the latest one.
      const next = queuedTeamId.current;
      if (next) {
        queuedTeamId.current = null;
        if (typeof window !== "undefined") localStorage.setItem(SELECTED_TEAM_KEY, next);
        bootstrappedFor.current = null;
        // Fire-and-forget; errors surface via the inner try/catch above.
        void bootstrap(uid);
      }
    }
  }, [loadMembers]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setCurrentTeamState(null);
      setTeamMembers([]);
      setUserRole(null);
      bootstrappedFor.current = null;
      setLoading(false);
      return;
    }
    if (bootstrappedFor.current === user.id) return;
    bootstrappedFor.current = user.id;
    bootstrap(user.id).catch((e) => {
      console.error("Team bootstrap failed", e);
      setLoading(false);
    });
  }, [user, authLoading, bootstrap]);

  const refreshTeam = useCallback(async () => {
    if (user) {
      bootstrappedFor.current = null;
      await bootstrap(user.id);
    }
  }, [user, bootstrap]);

  const refreshMembers = useCallback(async () => {
    if (currentTeam && user) await loadMembers(currentTeam.id, user.id);
  }, [currentTeam, user, loadMembers]);

  const setCurrentTeam = useCallback((id: string) => {
    if (typeof window !== "undefined") localStorage.setItem(SELECTED_TEAM_KEY, id);
    if (!user) return;
    if (bootstrapInFlight.current) {
      // Defer: the in-flight bootstrap will pick this up when it completes,
      // overwriting any earlier queued switch with the latest request.
      queuedTeamId.current = id;
      return;
    }
    bootstrappedFor.current = null;
    void bootstrap(user.id);
  }, [user, bootstrap]);

  return (
    <Ctx.Provider value={{ currentTeam, teamMembers, userRole, loading, refreshTeam, refreshMembers, setCurrentTeam }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTeam = () => useContext(Ctx);
export const useTeamId = () => useContext(Ctx).currentTeam?.id ?? null;
