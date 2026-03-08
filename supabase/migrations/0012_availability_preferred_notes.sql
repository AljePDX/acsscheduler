-- 0012_availability_preferred_notes.sql
-- 1. preferred_dates: subset of available_dates a parent most wants to be assigned.
-- 2. notes: freeform per-month scheduler note visible to admin only.
-- 3. shifts.family_id is now nullable — NULL means "open slot, not yet assigned".

ALTER TABLE availability
  ADD COLUMN IF NOT EXISTS preferred_dates  date[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes            text;

ALTER TABLE shifts
  ALTER COLUMN family_id DROP NOT NULL;
