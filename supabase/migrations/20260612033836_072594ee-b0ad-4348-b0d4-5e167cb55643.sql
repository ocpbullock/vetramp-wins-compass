-- Add user notes + support for pasted reference text on proposal attachments
ALTER TABLE public.proposal_attachments
  ADD COLUMN IF NOT EXISTS notes text;

-- Pasted reference text has no file in storage; allow nullable storage_path
ALTER TABLE public.proposal_attachments
  ALTER COLUMN storage_path DROP NOT NULL;