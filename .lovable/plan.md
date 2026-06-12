## Goal

Introduce a unified, team-scoped `companies` table that represents **every** company the team tracks — their own company, teaming partners, primes, competitors, and vendor lookups. `PartnersPanel` becomes the universal company-profile manager. The legacy `company_profile` (singleton JSON blob) and `teaming_partners` rows migrate into this new table.

## Schema

New table `public.companies`:

- `id uuid pk`, `team_id uuid → teams(id)`, `created_by uuid`, `created_at`, `updated_at`
- Identity: `name text not null`, `uei text`, `cage_code text`, `duns text`, `website text`
- Classification: `certifications text[]`, `set_asides text[]`, `naics_codes text[]`, `contract_vehicles text[]`
- Narrative: `capabilities_narrative text`, `past_performance jsonb default '[]'` (array of `{title, customer, value, period, role, summary}` entries)
- Contacts: `poc_name`, `poc_email`, `poc_phone`
- Relationship: `is_own_company boolean default false`, `is_existing_partner boolean default false`, `worked_together_before boolean default false`, `relationship_strength int check between 0 and 100`, `relationship_status text default 'prospective'` (active/prospective/inactive)
- Source/links: `source text` (manual / sam_gov / vendor_lookup / legacy_profile / legacy_partner), `external_ref jsonb` (UEI lookup payload, sam.gov entity id, etc.)
- `notes text`
- Partial unique index: one `is_own_company=true` per team.

Standard four-step migration: CREATE TABLE → GRANT (authenticated CRUD via team role, service_role ALL) → ENABLE RLS → POLICIES (read = `is_team_member`, write = `team_role_in(owner/admin/member)`, delete = owner/admin). Trigger for `updated_at`.

### Data migration (same migration file)

1. Insert one row per existing `company_profile` row with `is_own_company=true`, mapping JSON fields (`companyName`, `uei`, `cage`, `naics`, `certifications`, `contractVehicles`, `capabilities`, `pastPerformance`) into columns. `source='legacy_profile'`.
2. Insert one row per `teaming_partners` row, copying all overlapping fields, `is_own_company=false`, `is_existing_partner=true`, `source='legacy_partner'`. Track the old id in `external_ref->>'legacy_partner_id'` so existing FKs from `proposal_teaming` / `proposal_outreach_drafts` can be remapped in a follow-up step.
3. Add nullable `company_id uuid → companies(id)` to `proposal_teaming` and `proposal_outreach_drafts`; backfill from the `external_ref` mapping. Keep the legacy `partner_id` columns for now (no destructive drop in this pass) so nothing breaks mid-rollout.

`company_profile` and `teaming_partners` tables are **kept** for one release as read-only fallbacks; new writes go to `companies`. A follow-up migration will drop them once code paths are confirmed.

## Code changes

### Data layer
- `src/lib/companies.ts`: typed CRUD helpers (`listCompanies`, `getOwnCompany`, `upsertCompany`, `deleteCompany`, `companyFromVendorLookup(payload)`, `companyFromSamEntity(entity)`).
- `src/lib/company-profile.ts` (new shim): existing `getCompanyProfile()` / `saveCompanyProfile()` callers keep working by reading/writing the `is_own_company=true` row of `companies` (with JSON-shape adapter for backward compat with prompts that already consume the legacy shape).

### UI
- Rename/expand `src/components/settings/PartnersPanel.tsx` → `CompaniesPanel.tsx` (keep a re-export so the settings route doesn't break). Lists all companies in the team with filter chips: `Own`, `Partners`, `Primes`, `Competitors`, `All`. Row actions: edit, delete, "mark as partner", relationship-strength slider.
- Edit dialog covers every column above, including relationship fields and a `past_performance` array editor (add/remove entries).
- The "own company" row is pinned at the top with a distinctive badge; settings' existing "Company Profile" form becomes a thin wrapper that opens this same dialog scoped to the own-company row.
- `VendorDetailDrawer` and the search-entities result view get a **"Save as company"** button → opens the dialog prefilled via `companyFromVendorLookup` / `companyFromSamEntity`, defaulting `source` and `external_ref` accordingly.

### Touchpoints updated to read from `companies`
- `proposals.$proposalId.tsx`: teaming step reads partners from `companies` where `is_own_company=false`. New `company_id` saved alongside legacy `partner_id` until cutover.
- `TeamCompositionAnalyzer`, `SuggestedPartnersCard`, `PartnerResearch`, `TeamingCard`, `TeamingOutreachModal`, `PrimeContractorCombobox`, `ProposalModal`, `SolutionDesignStep`, `CompetitiveIntelModal`, `setup-status.ts`: switch their queries to the new helpers. Where they previously consumed the legacy `company_profile` JSON, the shim returns the same shape so prompt strings don't change.

### Edge functions
- `_shared/user-context.ts` and any function reading `company_profile` continue working through the shim (server-side admin client reads the `is_own_company=true` row and reshapes it). No edge-function signature changes in this pass.

## Out of scope (follow-ups)
- Dropping `company_profile` / `teaming_partners` and the legacy `partner_id` columns.
- Reworking edge-function prompts to consume the richer `companies` shape directly.
- Bulk import / dedupe UI for companies discovered via search.

## Validation
- Existing intake autosave test still passes.
- New `tests/companies-migrate.test.ts`: given fake `company_profile` + `teaming_partners` rows, the SQL migration produces the expected `companies` rows (run as a SQL fixture against a scratch schema, or as pure-TS validation of the mapping functions in `src/lib/companies.ts`).
- Manual: open Settings → Companies, confirm own-company row + each legacy partner appears; edit relationship strength; on a proposal, the teaming step still lists/selects the same partners.