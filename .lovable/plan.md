## Opportunity-Scoped Teams

Goal: let users spin up an "opportunity team" tied to a single proposal, invite teaming partners to it, and have those partners see only that proposal + read-only org capability data — never the parent org's other opportunities, proposals, starred/tracked lists, or search.

---

### 1. Schema (single migration)

`teams`
- add `team_type text not null default 'organization'` — values: `organization` | `opportunity`
- add `parent_team_id uuid references teams(id)` — opportunity teams point at their org

`proposals`
- add `opportunity_team_id uuid references teams(id)` — links a proposal to its dedicated opportunity team

Helper SECURITY DEFINER functions (avoid recursive RLS):
- `team_type(_team_id uuid) returns text`
- `parent_team_id(_team_id uuid) returns uuid`
- `user_opportunity_team_ids(_user_id uuid) returns setof uuid` — every opportunity team the user belongs to
- `user_parent_org_ids_via_opp(_user_id uuid) returns setof uuid` — parent orgs reachable via opportunity-team membership (for read-only capability data)

### 2. RLS rewrites

Opportunity-team members must see ONLY:
- their proposal (`proposals.opportunity_team_id = their_team`)
- that proposal's milestones, teaming, attachments (already scoped via proposal_id — no change needed)
- `teaming_partners` of their opportunity team
- READ-ONLY `knowledge_base`, `past_performance`, `contract_vehicles` of the parent org

Opportunity-team members must NOT see:
- other `proposals` of the parent org
- `starred_opportunities`, `tracked_opportunities`, `cached_searches`, `tango_cached_*` of the parent org
- other opportunity teams

Update SELECT policies on:
- `proposals` — allow when `is_team_member(team_id)` AND team is org, OR `is_team_member(opportunity_team_id)`
- `starred_opportunities`, `tracked_opportunities`, `cached_searches`, `tango_cached_*`, `cached_competitive_intel`, `ai_response_cache` — restrict to org-team membership only (exclude opportunity teams)
- `knowledge_base`, `past_performance`, `contract_vehicles` — allow read for opportunity team members of the parent org (insert/update/delete unchanged, org-only)
- `teaming_partners` — already team-scoped; works as-is for opportunity teams (each opp team has its own roster)

Write policies on `proposals`: allow update when user is member of either `team_id` (org) or `opportunity_team_id`.

### 3. Backend flow — "Create opportunity team"

New server fn `createOpportunityTeam.functions.ts`:
- Input: `{ parentTeamId, proposalId?, opportunityTitle, opportunitySource, opportunitySourceId }`
- Insert into `teams` with `team_type='opportunity'`, `parent_team_id=parentTeamId`, `name=truncate(title,60)`, slug from id
- Insert `team_members` row making caller `owner`
- If `proposalId` provided: update proposal's `opportunity_team_id`. Else create a draft proposal stub with the source fields and link it.
- Return `{ teamId, proposalId }`

### 4. UI

**Trigger points** for "Create Team":
- StarredTab row action → "Create Team & Propose"
- TrackedOpportunitiesTab row action → same
- Proposal intake step → "Invite teaming partners" button (creates opp team if not yet linked, opens invite modal)

**Header team switcher**
- Group dropdown into two sections: "Organizations" (team_type=organization) and "Opportunities" (team_type=opportunity, label = team name).
- When active team is opportunity-type, set a context flag in TeamProvider.

**Nav (Header.tsx)**
- When `activeTeam.team_type === 'opportunity'`: render only `Proposal | Capture Intel | Team`
- `Proposal` link → `/proposals/{proposalId}` (the linked proposal)
- `Capture Intel` → existing settings route, but the UI hides editing controls for KB/past perf/vehicles and shows "Read-only — provided by {parent org name}"
- `Team` → existing team management page filtered to current opp team

**Routing guards**
- `/`, `/admin`, search/starred/tracked tabs: if active team is opportunity-type, redirect to the linked proposal.

**Invite flow**
- `inviteToTeam` server fn already exists; extend payload to include opportunity context. Email/link copy: when team is opportunity-type, subject = "You're invited to collaborate on {opportunity title}", body mentions opp title and proposal link.
- Accept-invite handler: after accepting, if joined team is opportunity-type, navigate to `/proposals/{proposalId}` instead of `/`.

### 5. Files

Migration:
- `supabase/migrations/<ts>_opportunity_teams.sql`

Server functions (new):
- `src/lib/opportunity-teams.functions.ts` — `createOpportunityTeam`, `getOpportunityTeamProposal`

Edits:
- `src/components/dashboard/Header.tsx` — grouped team switcher + scoped nav
- `src/components/team/TeamProvider.tsx` (or equivalent) — expose `team_type`, `parent_team_id`
- `src/components/dashboard/StarredTab.tsx`, `TrackedOpportunitiesTab.tsx` — "Create Team" action
- `src/routes/proposals.$proposalId.tsx` — "Invite partners" button + opp-team awareness
- `src/routes/index.tsx`, `src/routes/admin.tsx`, `src/routes/settings.tsx` — guard for opportunity-team context (redirect / read-only)
- Invite acceptance route (find existing) — redirect to proposal when opp team
- `src/integrations/supabase/types.ts` — regenerated automatically after migration

### 6. Out of scope (call out, don't build)
- Backfilling existing proposals with opportunity teams (none exist yet under new model)
- Cross-opp-team search across a partner's multiple invitations (future)

---

I'll run the migration first, wait for approval, then implement the server fn + UI in one pass.
