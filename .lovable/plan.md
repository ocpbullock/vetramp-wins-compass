## Goal

Add a role-based admin system on top of the existing Supabase auth so you can share the app with your team. Two roles: `admin` and `member`. Admins get a `/admin` panel for user management and email invites; members only see permitted UI.

## 1. Database (migration)

Create a proper roles table (kept separate from `profiles` to avoid privilege-escalation patterns) plus an invites table.

- **enum** `app_role`: `admin`, `member`
- **table** `user_roles`: `user_id` (FK to auth.users, cascade delete), `role`, unique on (user_id, role)
- **table** `user_invites`: `email`, `role`, `invited_by`, `token` (uuid), `status` (`pending` | `accepted` | `cancelled`), `expires_at`, `created_at`
- **column on `profiles`**: `status` (`active` | `deactivated`, default `active`)
- **security-definer function** `public.has_role(_user_id uuid, _role app_role) returns bool` — used everywhere instead of subqueries against `user_roles` (prevents recursive RLS).
- **trigger update** to `handle_new_user`: on first signup, also insert a `member` row into `user_roles`. If a matching pending invite exists for the email, upgrade to the invite's role and mark the invite `accepted`.
- **RLS**:
  - `user_roles`: members read their own row; admins read/insert/update/delete all (via `has_role(auth.uid(),'admin')`).
  - `user_invites`: admins only.
  - `profiles`: keep current view-all policy; add admin-only update for `status`.
- **First admin bootstrap**: after migration, manually promote your current account by inserting a row into `user_roles`. I'll do this via the data tool once you confirm which email is the founding admin.

## 2. Auth context

Extend `src/lib/auth.tsx` to also load `role` and `status` after sign-in:
- expose `role: 'admin' | 'member' | null`, `isAdmin: boolean`, `status`
- if `status === 'deactivated'`, force sign-out with a toast

## 3. Routes & access control

- `/admin` — new route, gated. If not signed in → `/auth`. If signed in but not admin → `/` with a toast.
- `/accept-invite?token=...` — public route. Validates the token, asks the user to set a password, signs them up, links them to the invite email, marks invite accepted.
- Existing `/` dashboard stays accessible to both roles. Header shows an "Admin" link only when `isAdmin`.

## 4. Admin panel UI (`src/routes/admin.tsx` + `src/components/admin/*`)

Two tabs:

**Users tab**
- Table: Name · Email · Role · Status · Joined
- Row actions: Promote to admin / Demote to member, Deactivate / Reactivate, Remove user
- "Remove" calls a server function that deletes the auth user (service-role) and cascades

**Invites tab**
- "Invite member" form: email + role
- Pending invites table: Email · Role · Invited by · Sent · Expires
- Row actions: Resend (re-send email, bump expiry), Cancel

## 5. Invite email flow

Use Lovable's built-in auth email infrastructure. Two pieces:
- Server function `inviteUser({ email, role })` (admin-only, uses service role): creates a `user_invites` row, then calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: '<origin>/accept-invite?token=...' })`. Supabase sends the email; the recipient lands on `/accept-invite` to set a password.
- `/accept-invite` page completes signup. The DB trigger reads the pending invite for that email and assigns the right role automatically.

If you want branded invite emails, we can scaffold custom auth email templates in a follow-up — not required for the system to work.

## 6. Server functions (`src/lib/admin.functions.ts`)

All `.middleware([requireSupabaseAuth])` + an `assertAdmin(context)` helper that calls `has_role`:
- `listUsers()` — joins profiles + roles + auth.users (via admin client) for created_at + last_sign_in
- `setUserRole({ userId, role })`
- `setUserStatus({ userId, status })`
- `deleteUser({ userId })`
- `inviteUser({ email, role })`
- `listInvites()`, `resendInvite({ id })`, `cancelInvite({ id })`

## 7. UI gating helpers

- `<AdminOnly>` wrapper component
- `useRole()` hook reading from auth context
- Header gets a conditional "Admin" link

## Out of scope (ask if you want)

- Per-feature/per-resource permissions beyond admin/member
- Audit log of admin actions
- Branded invite email templates (we can scaffold after)
- SSO / multi-tenant orgs

## Open questions

1. Confirm the email of the **first admin** — I'll promote that account immediately after the migration so you're not locked out of `/admin`.
2. When an admin "removes" a user, should their data (proposal_drafts, etc.) be deleted too, or just the auth account? Default I'll use: delete the auth user, cascade their personal rows.
