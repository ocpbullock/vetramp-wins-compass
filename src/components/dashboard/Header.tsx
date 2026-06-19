import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
import { LogOut, BookOpen, ChevronDown, Menu, X, Shield, Building2, Briefcase, Check, Users, Target, Search, Handshake, LayoutDashboard } from "lucide-react";
import { getOpportunityTeamProposal } from "@/lib/opportunity-teams.functions";
import logoUrl from "@/assets/logo-vetramp-pursuit.png";

type NavItem = {
  label: string;
  to: string;
  hash?: string;
  matchHash?: string;
  icon?: React.ComponentType<{ className?: string }>;
  description?: string;
};

const ORG_NAV: NavItem[] = [
  { label: "Workspace", to: "/", icon: LayoutDashboard, description: "Dashboard and quick actions" },
  { label: "Opportunities", to: "/opportunities", icon: Target, description: "Your tracked pipeline and proposals" },
  { label: "Discover", to: "/discover", icon: Search, description: "Search and browse SAM.gov solicitations" },
  { label: "Partners", to: "/partners", icon: Handshake, description: "Teaming partners and competitors" },
  { label: "Intel", to: "/settings", icon: BookOpen, description: "Company profile and knowledge base" },
];

export function Header() {
  const { user, signOut, isAdmin } = useAuth();
  const { currentTeam, userRole, availableTeams, setCurrentTeam } = useTeam();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [oppProposalId, setOppProposalId] = useState<string | null>(null);
  const fetchOppProposal = useServerFn(getOpportunityTeamProposal);

  const isOpp = currentTeam?.team_type === "opportunity";

  // For opportunity teams, look up the linked proposal so the "Proposal" nav
  // link can deep-link to it.
  useEffect(() => {
    let cancelled = false;
    if (!isOpp || !currentTeam) {
      setOppProposalId(null);
      return;
    }
    fetchOppProposal({ data: { teamId: currentTeam.id } })
      .then((res) => { if (!cancelled) setOppProposalId(res.proposal?.id ?? null); })
      .catch(() => { if (!cancelled) setOppProposalId(null); });
    return () => { cancelled = true; };
  }, [isOpp, currentTeam, fetchOppProposal]);

  const isTeamAdmin = userRole === "owner" || userRole === "admin";
  const showAdminLink = (isAdmin || isTeamAdmin) && !isOpp;

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";
  const displayName =
    (user?.user_metadata as any)?.full_name ||
    (user?.user_metadata as any)?.name ||
    user?.email?.split("@")[0] ||
    "Account";

  const onHome = location.pathname === "/";

  const NAV: NavItem[] = isOpp
    ? [
        { label: "Intel", to: "/settings", icon: BookOpen },
      ]
    : ORG_NAV;

  const isActive = (item: NavItem) => {
    if (item.to === "/settings") return location.pathname.startsWith("/settings");
    if (item.to === "/") return onHome;
    if (item.to === "/opportunities") return location.pathname === "/opportunities";
    if (item.to === "/partners") return location.pathname === "/partners";
    if (item.to === "/discover") return location.pathname === "/discover";
    return location.pathname === item.to;
  };
  

  const orgTeams = availableTeams.filter((t) => t.team_type === "organization");
  const oppTeams = availableTeams.filter((t) => t.team_type === "opportunity");

  return (
    <header className="sticky top-0 z-30 bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-4 min-h-16 py-2 flex items-center gap-3">
        <Link to="/" className="flex items-center shrink-0" aria-label="VetRamp Pursuit home">
          <img
            src={logoUrl}
            alt="VetRamp Pursuit"
            className="h-10 sm:h-12 md:h-14 w-auto max-w-full object-contain"
            width={1679}
            height={322}
          />
        </Link>

        <nav className="hidden md:flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {isOpp && oppProposalId && (
            <Link
              to="/proposals/$proposalId"
              params={{ proposalId: oppProposalId }}
              className={[
                "relative px-3 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 shrink-0",
                location.pathname.startsWith("/proposals/")
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              ].join(" ")}
            >
              Opportunity
            </Link>
          )}
          {NAV.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                hash={item.hash}
                title={item.description}
                className={[
                  "relative px-3 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 shrink-0",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                ].join(" ")}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {item.label}
                {active && (
                  <span className="absolute -bottom-2 left-2 right-2 h-[2px] bg-primary rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Team switcher */}
        {availableTeams.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 max-w-[220px]">
                {isOpp ? <Briefcase className="w-3.5 h-3.5 shrink-0" /> : <Building2 className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{currentTeam?.name ?? "Select team"}</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {orgTeams.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Organizations
                  </DropdownMenuLabel>
                  {orgTeams.map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => setCurrentTeam(t.id)}>
                      <Building2 className="w-4 h-4 mr-2 opacity-70" />
                      <span className="flex-1 truncate">{t.name}</span>
                      {t.id === currentTeam?.id && <Check className="w-3.5 h-3.5 opacity-70" />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {oppTeams.length > 0 && (
                <>
                  {orgTeams.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Opportunities
                  </DropdownMenuLabel>
                  {oppTeams.map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => setCurrentTeam(t.id)}>
                      <Briefcase className="w-4 h-4 mr-2 opacity-70" />
                      <span className="flex-1 truncate">{t.name}</span>
                      {t.id === currentTeam?.id && <Check className="w-3.5 h-3.5 opacity-70" />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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
            <DropdownMenuItem asChild>
              <Link to="/teams"><Users className="w-4 h-4 mr-2" /> Manage Teams</Link>
            </DropdownMenuItem>
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
            {isOpp && oppProposalId && (
              <Link
                to="/proposals/$proposalId"
                params={{ proposalId: oppProposalId }}
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                Opportunity
              </Link>
            )}
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
                  <div className="flex flex-col leading-tight">
                    <span>{item.label}</span>
                    {item.description && (
                      <span className="text-[11px] opacity-60 font-normal">{item.description}</span>
                    )}
                  </div>
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
