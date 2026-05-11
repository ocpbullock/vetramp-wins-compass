import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";

export type AppRole = "admin" | "member";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: AppRole | null;
  isAdmin: boolean;
  status: "active" | "deactivated" | null;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  role: null,
  isAdmin: false,
  status: null,
  signOut: async () => {},
  refreshRole: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole | null>(null);
  const [status, setStatus] = useState<"active" | "deactivated" | null>(null);

  async function loadRoleAndStatus(userId: string) {
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("status").eq("user_id", userId).maybeSingle(),
    ]);
    const roles = (roleRows ?? []).map((r) => r.role as AppRole);
    const newRole: AppRole | null = roles.includes("admin") ? "admin" : roles.includes("member") ? "member" : null;
    const newStatus = (profile?.status ?? "active") as "active" | "deactivated";
    setRole(newRole);
    setStatus(newStatus);
    if (newStatus === "deactivated") {
      toast.error("Your account has been deactivated.");
      await supabase.auth.signOut();
    }
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        // defer to avoid deadlocks per supabase guidance
        setTimeout(() => loadRoleAndStatus(s.user.id), 0);
      } else {
        setRole(null);
        setStatus(null);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadRoleAndStatus(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        role,
        isAdmin: role === "admin",
        status,
        signOut: async () => { await supabase.auth.signOut(); },
        refreshRole: async () => {
          if (session?.user) await loadRoleAndStatus(session.user.id);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
