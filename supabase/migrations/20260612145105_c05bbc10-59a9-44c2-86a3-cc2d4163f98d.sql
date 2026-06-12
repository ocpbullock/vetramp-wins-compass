-- Store only a SHA-256 hash of invite tokens at rest.
-- The raw UUID token continues to live only in the emailed magic link.
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS token_hash text;

-- Backfill: hash existing raw tokens so in-flight invites keep working.
UPDATE public.user_invites
   SET token_hash = encode(digest(token::text, 'sha256'), 'hex')
 WHERE token_hash IS NULL;

-- Drop the unique constraint on raw token, then the column itself.
ALTER TABLE public.user_invites DROP CONSTRAINT IF EXISTS user_invites_token_key;
ALTER TABLE public.user_invites DROP COLUMN IF EXISTS token;

ALTER TABLE public.user_invites ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_token_hash_key UNIQUE (token_hash);

-- Track when (and by whom) a single-use invite was consumed. Status flips
-- from 'pending' to 'accepted' atomically; accepted_at gives an audit trail.
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
