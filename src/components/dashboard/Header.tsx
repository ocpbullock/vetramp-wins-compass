import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { LogOut, BookOpen, ChevronDown, Menu, X, Shield } from "lucide-react";
import logoUrl from "@/assets/logo-vetramp-pursuit.png";

type NavItem = {
  label: string;
  to: string;
  hash?: string;
  matchHash?: string;
  icon?: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { label: "Search", to: "/", hash: "opportunities", matchHash: "opportunities" },
  { label: "Proposals", to: "/", hash: "in-progress", matchHash: "in-progress" },
  { label: "Capture Intel", to: "/settings", icon: BookOpen },
];

export function Header() {
  const { user, signOut, isAdmin } = useAuth();
  const { currentTeam, userRole } = useTeam();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isTeamAdmin = userRole === "owner" || userRole === "admin";
  const showAdminLink = isAdmin || isTeamAdmin;

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";
  const displayName =
    (user?.user_metadata as any)?.full_name ||
    (user?.user_metadata as any)?.name ||
    user?.email?.split("@")[0] ||
    "Account";

  const currentHash = typeof location.hash === "string" ? location.hash.replace(/^#/, "") : "";
  const onHome = location.pathname === "/";

  const isActive = (item: NavItem) => {
    if (item.to === "/settings") return location.pathname.startsWith("/settings");
    if (!onHome) return false;
    if (item.matchHash) return currentHash === item.matchHash;
    return false;
  };

  return (
    <header className="sticky top-0 z-30 bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-6 min-h-20 py-2 flex items-center gap-5">
        <Link to="/" className="flex items-center shrink-0" aria-label="VetRamp Pursuit home">
          <img
            src={logoUrl}
            alt="VetRamp Pursuit"
            className="h-12 sm:h-14 md:h-16 lg:h-18 w-auto max-w-full object-contain"
            width={1679}
            height={322}
          />
        </Link>

        <nav className="hidden md:flex items-center gap-2 ml-0 xl:ml-4">
          {NAV.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                hash={item.hash}
                className={[
                  "relative px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                ].join(" ")}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {item.label}
                {active && (
                  <span className="absolute -bottom-3 left-3 right-3 h-[2px] bg-primary rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-accent transition-colors ml-1">
              <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                {initials}
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <div className="text-sm font-semibold">{displayName}</div>
                <div className="text-[11px] text-muted-foreground truncate max-w-[140px]">{currentTeam?.name ?? "No team"}</div>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-semibold">{displayName}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
              {currentTeam && <div className="text-xs text-muted-foreground truncate mt-1">Team: {currentTeam.name}</div>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {showAdminLink && (
              <DropdownMenuItem asChild>
                <Link to="/admin"><Shield className="w-4 h-4 mr-2" /> Admin</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => signOut()}>
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Toggle navigation"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {mobileOpen && (
        <nav className="md:hidden border-t border-border bg-card">
          <div className="max-w-[1400px] mx-auto px-6 py-3 flex flex-col gap-1">
            {NAV.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  hash={item.hash}
                  onClick={() => setMobileOpen(false)}
                  className={[
                    "px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2",
                    active
                      ? "bg-accent text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  ].join(" ")}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {item.label}
                </Link>
              );
            })}
            {showAdminLink && (
              <Link
                to="/admin"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <Shield className="w-4 h-4" /> Admin
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
