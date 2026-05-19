-- Make knowledge_base.user_id NOT NULL. Existing rows already have a non-null
-- user_id (verified prior to writing this migration); the explicit DELETE
-- below is a defensive backfill in case any orphan rows appear before the
-- ALTER runs. Deleting orphan KB rows is safer than retaining unattributable
-- documents that would bypass the RLS insert policy after the constraint flips.
DELETE FROM public.knowledge_base WHERE user_id IS NULL;
ALTER TABLE public.knowledge_base ALTER COLUMN user_id SET NOT NULL;