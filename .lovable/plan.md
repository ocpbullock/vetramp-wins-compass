# Federal Contracts Dashboard — Build Plan

A multi-user app for VetRamp to find federal opportunities, analyze historical awards, and generate AI proposal drafts.

## Phase 1 — Backend Foundation (Lovable Cloud)

1. **Enable Lovable Cloud** (auth, Postgres, edge functions, AI Gateway).
2. **Database schema** (migration):
   - `cached_searches` — shared 4-hour TTL cache keyed by hash of search params.
   - `proposal_drafts` — per-user, RLS on `user_id`.
   - `user_preferences` — per-user defaults.
3. **Secrets**: request `SAM_GOV_API_KEY` from the user. (`LOVABLE_API_KEY` is auto-provisioned for AI.)
4. **Edge functions** (Supabase):
   - `search-sam` — loops through NAICS codes (one per request), 500ms delay, server-side API key, returns merged + deduped opportunities.
   - `search-usaspending` — POST proxy to `/spending_by_award/`.
   - `usaspending-detail` — GET `/awards/{id}/`.
   - `usaspending-analytics` — calls `spending_over_time` + `spending_by_category`.
   - `generate-proposal` — calls Lovable AI Gateway (gemini-3-flash-preview) with the full VetRamp proposal prompt; saves draft.

## Phase 2 — Auth & App Shell

- Email/password + magic link via Supabase Auth.
- `/auth` page (login/signup), `/` protected dashboard.
- Header with title, subtitle, user avatar, logout.
- React Query with `staleTime: 4h`, fetch only on Search click.

## Phase 3 — Search Controls

- Sticky search bar:
  - NAICS multi-select grouped (Computer/IT, Software/Cloud, Telecom, Consulting, Hardware).
  - Quick buttons: Select All / Clear / IT Only.
  - Default selection: 541511, 541512, 541513, 541519.
  - Date range pickers (default last 12 months).
  - Optional keyword.
  - Search button (primary blue).
- Progress bar with status text during multi-NAICS fetch.
- 4 stat cards (Active Opps, Award Notices, Historical Awards, Total Obligated).

## Phase 4 — Tabs

1. **Active Opportunities** — filterable/sortable table, color-coded type badges, links to SAM.gov, "Propose" button on Solicitation/Sources Sought/Combined/Presol only.
2. **Historical Awards** — filterable table, set-aside code mapping, "Details" modal hitting USAspending award detail endpoint.
3. **Analytics** — Recharts: top vendors (horizontal bar), agency distribution (doughnut), monthly obligations (vertical bar).
4. **Logs** — monospace timestamped log of API calls/errors/cache events, color coded.

## Phase 5 — Proposal Generator

- Full-screen modal opened by Propose button.
- Pre-fills opportunity context + hardcoded VetRamp company info into AI prompt (the full prompt in the spec).
- Streamed AI generation via Lovable AI.
- Actions: Copy, Download .docx (using `docx` lib), Save Draft (to `proposal_drafts`).

## Phase 6 — Caching

- React Query 4h staleTime in browser.
- `cached_searches` table: edge functions check cache first, write on miss.

## Phase 7 — Design

- White cards on `#f8f9fa`, blue primary `#2563eb`, money green `#059669`.
- System font stack, professional, responsive.
- Tokens defined in `src/styles.css` using oklch.

## Technical Notes

- SAM.gov requires server-side key + sequential per-NAICS requests (10 req / 5 min limit).
- USAspending public but proxied for consistency + logging.
- All API calls logged into Logs tab via a Zustand log store.
- Set-aside code map: SBA→Small Business, SDVOSBC→SDVOSB, WOSBSS→WOSB, 8A→8(a), HZC→HUBZone, VSA→VOSB, ISBEE→Econ. Disadvantaged WOSB, SBP→Small Business.
- Propose button gating: notice types `k` (Combined Synopsis/Solicitation), `o` (Solicitation), `r` (Sources Sought), `p` (Presolicitation) only.

## Scope for First Version

I'll deliver Phases 1–5 fully working in this turn. Some polish (e.g., advanced team view, magic link UI niceties) can iterate after.

## Open question

I need one secret from you to make SAM.gov work: a free API key from https://api.data.gov. I'll prompt for it after enabling Cloud.
