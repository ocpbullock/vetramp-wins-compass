import { Link, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  LogOut,
  Shield,
  Settings,
  LayoutDashboard,
  Briefcase,
  BarChart3,
  FileText,
  Bell,
  ChevronDown,
} from "lucide-react";
import logoUrl from "@/assets/logo-vetramp-pursuit.png";

type NavItem = { label: string; icon: typeof LayoutDashboard; to: string; hash?: string; matchHash?: string };

const NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/" },
  { label: "Opportunities", icon: Briefcase, to: "/", hash: "opportunities", matchHash: "opportunities" },
  { label: "Analytics", icon: BarChart3, to: "/", hash: "analytics", matchHash: "analytics" },
  { label: "Reports", icon: FileText, to: "/", hash: "logs", matchHash: "logs" },
];

export function Header() {
  const { user, signOut, isAdmin } = useAuth();
  const location = useLocation();
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";
  const displayName =
    (user?.user_metadata as any)?.full_name ||
    (user?.user_metadata as any)?.name ||
    user?.email?.split("@")[0] ||
    "Account";

  const currentHash = typeof location.hash === "string" ? location.hash.replace(/^#/, "") : "";
  const onHome = location.pathname === "/";

  const isActive = (item: NavItem) => {
    if (!onHome) return false;
    if (item.matchHash) return currentHash === item.matchHash;
    // Dashboard is active when on / with no recognized tab hash
    return !["opportunities", "analytics", "logs", "in-progress", "historical"].includes(currentHash);
  };

  return (
    <header className="sticky top-0 z-30 bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center gap-6">
        <Link to="/" className="flex items-center shrink-0" aria-label="VetRamp Pursuit home">
          <img
            src={logoUrl}
            alt="VetRamp Pursuit"
            className="h-8 w-auto"
            width={1536}
            height={1024}
          />
        </Link>

        <nav className="hidden md:flex items-center gap-1 ml-2">
          {NAV.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                hash={item.hash}
                className={[
                  "relative flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                ].join(" ")}
              >
                <Icon className="w-4 h-4" />
                {item.label}
                {active && (
                  <span className="absolute -bottom-[17px] left-2 right-2 h-[2px] bg-primary rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand-red" />
          </Button>

          {isAdmin && (
            <Button variant="ghost" size="icon" asChild aria-label="Admin">
              <Link to="/admin"><Shield className="w-5 h-5" /></Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" asChild aria-label="Settings">
            <Link to="/settings"><Settings className="w-5 h-5" /></Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-accent transition-colors">
                <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                  {initials}
                </div>
                <div className="hidden sm:block text-left leading-tight">
                  <div className="text-sm font-semibold">{displayName}</div>
                  <div className="text-[11px] text-muted-foreground">VetRamp Team</div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground hidden sm:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-semibold">{displayName}</div>
                <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings"><Settings className="w-4 h-4 mr-2" /> Settings</Link>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem asChild>
                  <Link to="/admin"><Shield className="w-4 h-4 mr-2" /> Admin</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut()}>
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
