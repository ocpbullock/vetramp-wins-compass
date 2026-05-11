-- proposals
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  solicitation_number text not null,
  notice_id text,
  opportunity_title text,
  agency text,
  naics_code text,
  set_aside text,
  response_deadline timestamptz,
  status text not null default 'intake',
  opportunity_data jsonb,
  opportunity_type text,
  estimated_value numeric,
  contract_type text,
  pop_base_months int,
  pop_option_months int,
  clearance_requirement text,
  user_notes text,
  customer_intel jsonb,
  customer_intel_verified boolean default false,
  compliance_matrix jsonb,
  compliance_gaps int default 0,
  staffing_plan jsonb,
  technical_approach jsonb,
  management_approach jsonb,
  transition_plan jsonb,
  price_strategy jsonb,
  sections jsonb default '{}'::jsonb,
  readiness_score int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.proposals enable row level security;

create policy "Users view own proposals" on public.proposals for select
  using (auth.uid() = user_id or has_role(auth.uid(), 'admin'::app_role));
create policy "Users insert own proposals" on public.proposals for insert
  with check (auth.uid() = user_id);
create policy "Users update own proposals" on public.proposals for update
  using (auth.uid() = user_id or has_role(auth.uid(), 'admin'::app_role));
create policy "Users delete own proposals" on public.proposals for delete
  using (auth.uid() = user_id or has_role(auth.uid(), 'admin'::app_role));

create trigger update_proposals_updated_at before update on public.proposals
  for each row execute function public.update_updated_at_column();

create index idx_proposals_user on public.proposals(user_id);
create index idx_proposals_status on public.proposals(status);

-- proposal_attachments
create table public.proposal_attachments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  filename text not null,
  file_type text,
  storage_path text not null,
  source text default 'manual',
  parsed_content text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

alter table public.proposal_attachments enable row level security;

create policy "Users view own attachments" on public.proposal_attachments for select
  using (exists (select 1 from public.proposals p where p.id = proposal_id
    and (p.user_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role))));
create policy "Users insert own attachments" on public.proposal_attachments for insert
  with check (exists (select 1 from public.proposals p where p.id = proposal_id and p.user_id = auth.uid()));
create policy "Users delete own attachments" on public.proposal_attachments for delete
  using (exists (select 1 from public.proposals p where p.id = proposal_id
    and (p.user_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role))));

create index idx_proposal_attachments_proposal on public.proposal_attachments(proposal_id);

-- company_profile
create table public.company_profile (
  id uuid primary key default gen_random_uuid(),
  profile_data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.company_profile enable row level security;

create policy "Authenticated read company profile" on public.company_profile for select
  to authenticated using (true);
create policy "Admins insert company profile" on public.company_profile for insert
  to authenticated with check (has_role(auth.uid(), 'admin'::app_role));
create policy "Admins update company profile" on public.company_profile for update
  to authenticated using (has_role(auth.uid(), 'admin'::app_role));

create trigger update_company_profile_updated_at before update on public.company_profile
  for each row execute function public.update_updated_at_column();

-- seed default company profile
insert into public.company_profile (profile_data) values ('{
  "legal_name": "LGE Consulting, LLC",
  "dba": "VetRamp",
  "uei": "N8HBYAZ9VGQ5",
  "cage": "9PKK3",
  "location": {"city": "Cedar Park", "state": "TX", "zip": "78613"},
  "primary_naics": "541512",
  "additional_naics": ["541511","541513","541519","541611"],
  "certifications": [
    {"name":"SBA-certified SDVOSB","status":"Active"},
    {"name":"Texas VetHUB Partner","status":"Active"},
    {"name":"HIRE Vets Medallion Award","status":"Active"}
  ],
  "core_services": [
    "IT Infrastructure & Network Engineering",
    "Cybersecurity & RMF/NIST Compliance",
    "Cloud Migration & Management",
    "Veteran Talent Solutions & Cleared Recruiting",
    "Healthcare IT & Mission Support",
    "Help Desk & Tier 1-3 Technical Support",
    "System Administration & DevSecOps"
  ],
  "past_performance": [
    {
      "contract_name":"Brooke Army Medical Center Support Services",
      "client":"Defense Health Agency / BAMC",
      "agency":"Department of Defense",
      "scope":"Multimedia production, training support, security operations, personnel onboarding at the largest DoD medical facility",
      "achievements":[
        "Managed security onboarding operations for 500+ personnel annually",
        "Produced training and multimedia content supporting medical readiness programs",
        "Maintained continuity of operations across facility modernization phases"
      ],
      "naics":"541512",
      "clearance_level":"Public Trust"
    }
  ],
  "federal_experience_agencies":["Army","Air Force","DHA","VA","DHS"],
  "differentiators":[
    "Veteran-owned and veteran-staffed — our workforce understands military culture, chain of command, and mission urgency",
    "Rapid mobilization: 30-day FOC with pre-vetted, clearance-ready talent pipeline",
    "Deep DoD healthcare IT experience through BAMC engagement",
    "Local Texas presence with recruiting partnerships at UT Austin, Texas A&M, and military transition programs",
    "SDVOSB set-aside eligible with full NIST 800-171 compliance posture"
  ],
  "founder": {"name": null, "branch": null, "rank": null, "bio": null}
}'::jsonb);

-- storage bucket for attachments
insert into storage.buckets (id, name, public) values ('proposal-attachments','proposal-attachments', false);

create policy "Users read own proposal files" on storage.objects for select to authenticated
  using (bucket_id = 'proposal-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users upload own proposal files" on storage.objects for insert to authenticated
  with check (bucket_id = 'proposal-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own proposal files" on storage.objects for delete to authenticated
  using (bucket_id = 'proposal-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Admins read all proposal files" on storage.objects for select to authenticated
  using (bucket_id = 'proposal-attachments' and has_role(auth.uid(), 'admin'::app_role));