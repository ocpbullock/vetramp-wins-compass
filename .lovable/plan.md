## Competitive Intelligence Module

A new module that, for any open SAM.gov opportunity, surfaces the likely incumbent, who the agency typically awards to, the set-aside competitive landscape, teaming candidates, and a transparent bid/no-bid scorecard — all powered by the USAspending API already in use.

### Phase 1 — Core (this build)

Ships the highest-value pieces end-to-end so it's usable today.

1. **Database**
   - New table `cached_competitive_intel` (cache_key, agency, naics, set_aside, payload jsonb, expires_at). 24h TTL. RLS: authenticated read/write.

2. **Edge function `competitive-intel`**
   Input: `{ solicitationNumber, agency, naicsCode, setAside, postedDate }`
   Runs three USAspending queries in parallel against `/api/v2/search/spending_by_award/`:
   - **Incumbent search** — same sub-agency + NAICS, period-of-performance ending within ±18 months of posted date, sorted by End Date desc. Also matches PIID office-prefix when extractable from solicitation number.
   - **Agency history** — same sub-agency (fallback top-tier) + NAICS, last 3 years, aggregated client-side by `recipient_id` → vendor rollup (awards, total $, avg $, most recent, set-aside).
   - **Market landscape** — NAICS + set_aside_type_codes nationwide, last 3 years, aggregated by recipient.
   Computes a deterministic **bid/no-bid scorecard** (NAICS / set-aside / agency exp / incumbent / size / competition / timeline → overall).
   Writes to `cached_competitive_intel`. Returns the structured payload from the spec.

3. **Edge function `vendor-profile`**
   Input: `{ recipientId }` (or vendorName fallback). Calls `/api/v2/recipient/{id}/` + a filtered `spending_by_award` to return vendor profile + contract history + NAICS/agency rollups.

4. **UI: "Compete" button + Modal**
   - Amber `Compete` button next to existing green `Propose` button on every row of the Opportunities table (all notice types).
   - `CompetitiveIntelModal` (max-w 1000px) with skeleton-loaded sections rendered in parallel:
     - Header: title, sol#, agency, NAICS, set-aside, deadline countdown (orange ≤14d, red ≤3d).
     - **Section A — Incumbent**: top candidate card (vendor, PIID, value, PoP, NAICS) + up to 2 alternates, or "Open Field" empty state.
     - **Section B — Agency Award History**: stat strip + ranked vendors table (clickable names) + top-10 bar chart (recharts).
     - **Section E — Bid/No-Bid Scorecard**: factor table with ✅/⚠️/❌ + overall verdict.
   - Vendor names anywhere open the **VendorDetailDrawer** (right-side, 400px): profile header, portfolio totals, NAICS/agency rollups, contract history table, and overlap assessment vs. user's searched NAICS.

5. **API client + caching**
   - `searchCompetitiveIntel()` and `getVendorProfile()` in `src/lib/api.ts`, both routed through edge functions, with the existing log-store integration.
   - Edge function checks cache before calling USAspending.

### Phase 2 — Deferred (follow-up)

Sections C (Set-Aside Landscape callout), D (Teaming Opportunities), and the dashboard-level **Competitive Intel tab** (market overview cards, top-competitors-across-NAICS table, agency heatmap, set-aside donut). Phase 1 already fetches the underlying data, so Phase 2 is mostly UI + one extra aggregation function.

### Technical Notes

- **Agency matching**: extract the most specific segment of SAM's `fullParentPathName` after splitting on `.`, query USAspending as `tier: "subtier"`; if zero results, retry with the top-tier segment as `tier: "toptier"`.
- **Incumbent PIID prefix**: regex `^([A-Z0-9]{6})` on solicitationNumber → match against USAspending `Award ID` startsWith. Combined with PoP-end-date proximity to posted date.
- **Vendor dedupe**: aggregate by `recipient_id` (stable), display the most recent name variant.
- **Scorecard rules** (deterministic, transparent):
  - NAICS: ✅ in 541511–541519, ⚠️ in 5415xx, else ❌
  - Set-aside: ✅ SDVOSBC/VSA/VSB, ⚠️ SBA/WOSB/EDWOSB/HZC, ❌ unrestricted/8A/8AN
  - Agency experience: derived from existing user awards prop (none in Phase 1 → ❌, with neutral copy)
  - Incumbent: ✅ none, ⚠️ small (<$2M), ❌ large
  - Size: ✅ if agency-NAICS avg ∈ $500K–$10M
  - Competition: ✅ <5 vendors, ⚠️ 5–15, ❌ >15
  - Timeline: from `responseDeadLine` (✅ >14d, ⚠️ 7–14, ❌ <7)
- **Caching**: edge-function side, key `${subAgency}|${naics}|${setAside||"none"}`, 24h TTL.
- **No new secrets**: USAspending is keyless. SAM.gov flow is unchanged.

### Files

- migration: `cached_competitive_intel` table + RLS
- new: `supabase/functions/competitive-intel/index.ts`
- new: `supabase/functions/vendor-profile/index.ts`
- update: `supabase/config.toml` (verify_jwt=false for both)
- new: `src/components/dashboard/CompetitiveIntelModal.tsx`
- new: `src/components/dashboard/VendorDetailDrawer.tsx`
- new: `src/components/dashboard/BidScorecard.tsx`
- update: `src/lib/api.ts` — add `searchCompetitiveIntel`, `getVendorProfile`, types
- update: `src/components/dashboard/OpportunitiesTab.tsx` — Compete button + modal wiring
- update: `src/routes/index.tsx` — modal/drawer state if needed at page level

Approve to proceed with Phase 1.