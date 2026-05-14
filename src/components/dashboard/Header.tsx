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
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { LogOut, Shield, Settings, ChevronDown } from "lucide-react";
import logoUrl from "@/assets/logo-vetramp-pursuit.png";

type NavItem = { label: string; to: string; hash?: string; matchHash?: string };

const NAV: NavItem[] = [
  { label: "Dashboard", to: "/" },
  { label: "Opportunities", to: "/", hash: "opportunities", matchHash: "opportunities" },
  { label: "Tracked", to: "/", hash: "tracked", matchHash: "tracked" },
  { label: "Analytics", to: "/", hash: "analytics", matchHash: "analytics" },
  { label: "Reports", to: "/", hash: "logs", matchHash: "logs" },
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
    if (item.to !== "/" && location.pathname.startsWith(item.to)) return true;
    if (!onHome) return false;
    if (item.matchHash) return currentHash === item.matchHash;
    if (item.to !== "/") return false;
    return !["opportunities", "tracked", "analytics", "logs", "in-progress", "historical"].includes(currentHash);
  };

  return (
    <header className="sticky top-0 z-30 bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-6 min-h-20 py-2 flex flex-wrap xl:flex-nowrap items-center gap-5">
        <Link to="/" className="flex items-center shrink-0 w-full md:w-auto" aria-label="VetRamp Pursuit home">
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
            return (
              <Link
                key={item.label}
                to={item.to}
                hash={item.hash}
                className={[
                  "relative px-4 py-2 text-sm font-medium rounded-md transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                ].join(" ")}
              >
                {item.label}
                {active && (
                  <span className="absolute -bottom-3 left-3 right-3 h-[2px] bg-primary rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-1 border-l border-border pl-2">
            {isAdmin && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" asChild aria-label="Admin">
                    <Link to="/admin"><Shield className="w-5 h-5" /></Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Admin</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild aria-label="Settings">
                  <Link to="/settings"><Settings className="w-5 h-5" /></Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-accent transition-colors ml-1">
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
        </TooltipProvider>
      </div>
    </header>
  );
}
