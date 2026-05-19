
-- Add storage RLS policies for proposal-attachments paths scoped by proposal id,
-- so opportunity-team collaborators (not just the uploader) can read/upload/delete
-- files for proposals they can access. Path scheme: 'proposals/{proposalId}/...'.
-- Existing user-folder policies remain for backwards compatibility with older files.

CREATE POLICY "Read proposal files by proposal access"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'proposal-attachments'
  AND (storage.foldername(name))[1] = 'proposals'
  AND public.user_can_see_proposal(((storage.foldername(name))[2])::uuid, auth.uid())
);

CREATE POLICY "Upload proposal files by proposal access"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'proposal-attachments'
  AND (storage.foldername(name))[1] = 'proposals'
  AND public.user_can_see_proposal(((storage.foldername(name))[2])::uuid, auth.uid())
);

CREATE POLICY "Delete proposal files by proposal access"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'proposal-attachments'
  AND (storage.foldername(name))[1] = 'proposals'
  AND public.user_can_see_proposal(((storage.foldername(name))[2])::uuid, auth.uid())
);
