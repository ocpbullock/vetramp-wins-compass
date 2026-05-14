## Multi-User Team Support — Implementation Plan

Foundational change: introduce a teams/organizations model so all proposal & tracking data can be shared across team members with role-based permissions.

### 1. Database migration

**New tables**
- `teams`: `id`, `name`, `slug` (unique), `created_by` (uuid, references auth.users), `created_at`
- `team_members`: `id`, `team_id` (FK teams, on delete cascade), `user_id` (uuid, references auth.users on delete cascade), `role` (text check in `'owner','admin','member','viewer'`), `joined_at`, unique(`team_id`,`user_id`)

**Add `team_id` (nullable, FK teams on delete set null) to:**
- `proposals`, `tracked_opportunities`, `proposal_drafts`, `company_profile`

**Security definer helpers** (avoid RLS recursion):
- `public.is_team_member(_team_id uuid, _user_id uuid) returns boolean`
- `public.team_role(_team_id uuid, _user_id uuid) returns text`

**RLS**
- `teams`: select if member; insert if `created_by = auth.uid()`; update/delete if owner.
- `team_members`: select rows for teams the user belongs to; insert/update/delete if owner or admin of that team; users can always select their own membership.
- For `proposals`, `tracked_opportunities`, `proposal_drafts`:
  - SELECT: `user_id = auth.uid() OR (team_id IS NOT NULL AND is_team_member(team_id, auth.uid())) OR has_role(auth.uid(),'admin')`
  - INSERT: `user_id = auth.uid()` AND (team_id IS NULL OR is_team_member(team_id, auth.uid()) with role in owner/admin/member)
  - UPDATE/DELETE: own row, or team_id matches a team where role in owner/admin (delete) / owner/admin/member (update). Viewers cannot write.
- `company_profile`: SELECT if team member or no team_id (legacy); UPDATE/INSERT if owner/admin of team or global admin (existing behavior preserved as fallback).

Existing per-user policies replaced by these unified ones.

### 2. Team context provider — `src/lib/team.tsx`

- `TeamProvider` wraps app inside `AuthProvider`.
- On auth ready: query `team_members` joined with `teams` for current user.
  - If empty → create a personal team (`name: "<display_name>'s Team"`, `slug: <userId-prefix>`) and insert membership as `owner`.
  - Else pick first (later: persisted selection).
- Exposes via `useTeam()`: `currentTeam`, `teamMembers`, `userRole`, `refreshTeam()`, `setCurrentTeam(id)` (for future switching).
- Helper `useTeamId()` returns `currentTeam?.id` for inserts.

### 3. Wire team_id into create flows

Find existing inserts to `proposals`, `tracked_opportunities`, `proposal_drafts` and add `team_id: currentTeam.id`. Keep `user_id` set as today.

### 4. Settings — Team tab (`src/routes/settings.tsx`)

Add "Team" tab alongside Company Profile and Knowledge Base.

Panel contents:
- Team name (editable for owners) + slug
- Member list table: avatar/name/email, role select (owner/admin/member/viewer), remove button. Owners can change roles & remove (cannot demote/remove last owner). Non-owners see read-only roles.
- Invite member form: email + role select + "Add member" button. Looks up `profiles` by email, inserts into `team_members`. If no profile exists, surface a toast: "User must sign up first."

### 5. Header update (`src/components/dashboard/Header.tsx`)

In the avatar dropdown area show team name as a small muted line under the user's display name. No new nav item.

### 6. Files

- New: `supabase/migrations/<ts>_teams.sql`, `src/lib/team.tsx`, `src/components/settings/TeamPanel.tsx`
- Edit: `src/routes/__root.tsx` (or wherever AuthProvider lives) to wrap with TeamProvider, `src/routes/settings.tsx`, `src/components/dashboard/Header.tsx`, and any component currently inserting proposals/tracked_opportunities/proposal_drafts to attach `team_id`.

### Out of scope (this turn)
- Email invitations (deferred — invites are direct adds for now)
- Team switching UI (single current team auto-selected; switcher can come later)
- Backfilling `team_id` for legacy rows (rows remain personal/null and stay visible to original owner via `user_id` policy)

Confirm and I'll execute the migration first, then code.
