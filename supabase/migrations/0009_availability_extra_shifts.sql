-- supabase/migrations/0009_availability_extra_shifts.sql

ALTER TABLE availability
  ADD COLUMN extra_shifts_willing TEXT NOT NULL DEFAULT '0'
    CHECK (extra_shifts_willing IN ('0', '1-2', '3-4', '5+'));

COMMENT ON COLUMN availability.extra_shifts_willing IS
  'How many extra shifts (beyond required) the family is willing to take this month.
   Values: 0 = none, 1-2 = one or two, 3-4 = three or four, 5+ = five or more.';
