-- supabase/migrations/0010_swap_status_cancelled.sql
-- Add 'cancelled' to the swap_requests status check constraint.
-- PostgreSQL does not support altering enum CHECK constraints directly;
-- we drop and re-add the constraint.

ALTER TABLE swap_requests
  DROP CONSTRAINT IF EXISTS swap_requests_status_check;

ALTER TABLE swap_requests
  ADD CONSTRAINT swap_requests_status_check
    CHECK (status IN (
      'open',
      'pending_covering_approval',
      'pending_admin',
      'approved',
      'rejected',
      'cancelled'
    ));
