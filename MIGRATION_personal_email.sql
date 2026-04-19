-- ═══════════════════════════════════════════════════════════════════════
-- JG Platform — Add personal_email column to employees
-- ═══════════════════════════════════════════════════════════════════════
-- Purpose: Let employees sign in with their personal Gmail while keeping
--          their @jg-restoration.com or work email in `email` for comms.
--
-- Auth flow after this migration:
--   - Google Sign-In: check both `email` and `personal_email` for match
--   - Email/password: Supabase Auth account can be created with either
--   - Contact list: shows work email (email) + personal email if present
--
-- Run this once in Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════

-- 1) Add the column (TEXT, lowercase expected, unique but nullable)
ALTER TABLE employees 
  ADD COLUMN IF NOT EXISTS personal_email TEXT;

-- 2) Add a case-insensitive index so auth lookups are fast
CREATE INDEX IF NOT EXISTS idx_employees_personal_email_lower 
  ON employees (LOWER(personal_email))
  WHERE personal_email IS NOT NULL;

-- 3) Enforce unique (case-insensitive) to prevent two employees sharing one personal email
CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_personal_email_ci 
  ON employees (LOWER(personal_email))
  WHERE personal_email IS NOT NULL AND personal_email != '';

-- 4) Verify by listing all employees with their email fields
SELECT name, role, email, personal_email, active
FROM employees
WHERE active = true
ORDER BY role, name;
