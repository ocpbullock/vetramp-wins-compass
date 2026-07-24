
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS watch_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_watched_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.opportunity_watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  team_id uuid NULL,
  event_type text NOT NULL CHECK (event_type IN ('new_notice','deadline_change','attachment_update')),
  notice_id text NULL,
  notice_type text NULL,
  title text NULL,
  posted_date date NULL,
  detail text NULL,
  maturity_hint text NULL,
  reviewed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_watch_events_proposal_id_idx
  ON public.opportunity_watch_events(proposal_id);
CREATE INDEX IF NOT EXISTS opportunity_watch_events_reviewed_idx
  ON public.opportunity_watch_events(proposal_id, reviewed);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_watch_events TO authenticated;
GRANT ALL ON public.opportunity_watch_events TO service_role;

ALTER TABLE public.opportunity_watch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View opportunity watch events"
  ON public.opportunity_watch_events FOR SELECT
  USING (private.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Insert opportunity watch events"
  ON public.opportunity_watch_events FOR INSERT
  WITH CHECK (private.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Update opportunity watch events"
  ON public.opportunity_watch_events FOR UPDATE
  USING (private.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Delete opportunity watch events"
  ON public.opportunity_watch_events FOR DELETE
  USING (private.user_can_see_proposal(proposal_id, auth.uid()));
