-- 0013_teacher_flags_off_day_warning.sql
-- 1. is_flexible_teacher: family can be assigned to any class (not just their child's).
-- 2. is_assistant_teacher: family is deprioritised for extra shifts (higher cost to school).
-- 3. off_day_warning: shift was assigned on a day no child in the family attends.

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS is_flexible_teacher  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_assistant_teacher boolean NOT NULL DEFAULT false;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS off_day_warning boolean NOT NULL DEFAULT false;
