-- Allow 'pending_approval' as a remnant status.
-- Companion migration to the manager remnant approval workflow
-- (commit c029380). The app's VALID_STATUSES already included
-- pending_approval; this widens the DB check constraint to match.

ALTER TABLE public.remnants
  DROP CONSTRAINT remnants_status_check;

ALTER TABLE public.remnants
  ADD CONSTRAINT remnants_status_check
  CHECK (status = ANY (ARRAY['available'::text, 'hold'::text, 'sold'::text, 'pending_approval'::text]));
