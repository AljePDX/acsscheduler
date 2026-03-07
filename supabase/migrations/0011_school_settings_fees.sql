-- 0011_school_settings_fees.sql
-- Adds missed_shift_fee and extra_shift_credit to school_settings.
-- missed_shift_fee:   charged when a shift is marked as missed.
-- extra_shift_credit: credited when a parent completes a shift beyond their requirement.

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS missed_shift_fee    DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_shift_credit  DECIMAL(10,2) NOT NULL DEFAULT 0;
