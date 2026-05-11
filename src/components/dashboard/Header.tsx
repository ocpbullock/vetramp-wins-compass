import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut, Shield } from "lucide-react";

export function Header() {
  const { user, signOut, isAdmin } = useAuth();
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";
  return (
    <header className="sticky top-0 z-30 bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Federal Contracts Dashboard</h1>
          <p className="text-xs text-muted-foreground">Active Opportunities + Historical Awards · VetRamp</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin"><Shield className="w-4 h-4 mr-1" /> Admin</Link>
            </Button>
          )}
          <span className="hidden sm:block text-xs text-muted-foreground">{user?.email}</span>
          <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-1" /> Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
