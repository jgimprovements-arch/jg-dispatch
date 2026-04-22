-- ═══════════════════════════════════════════════════════════════════════════
-- JG Restoration — Supabase schema additions for QBO enrichment
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this ONCE in the Supabase SQL Editor before deploying the Vercel
-- enrichment function. Adds:
--   1. qbo_refresh_token row in platform_settings (value filled in manually
--      after OAuth bootstrap — see QBO_ONBOARDING.md)
--   2. enrichment_runs audit table
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ensure platform_settings exists (in case it's not already there)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Reserve the row for the QBO refresh token.
-- The actual value gets written during the one-time OAuth bootstrap —
-- see QBO_ONBOARDING.md step 4.
INSERT INTO public.platform_settings (key, value)
VALUES ('qbo_refresh_token', 'SET_VIA_ONBOARDING')
ON CONFLICT (key) DO NOTHING;

-- 2. Run audit log
CREATE TABLE IF NOT EXISTS public.enrichment_runs (
  id           BIGSERIAL PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('success','failed','partial')),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ DEFAULT NOW(),
  steps        JSONB DEFAULT '[]'::jsonb,
  errors       JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_finished ON public.enrichment_runs (finished_at DESC);

-- RLS disabled to match the platform's standing pattern
ALTER TABLE public.platform_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrichment_runs   DISABLE ROW LEVEL SECURITY;

-- The Vercel function uses the SERVICE ROLE key (not anon), so no grants
-- to anon are needed. But if you want to view logs from the browser-side
-- platform, grant SELECT on enrichment_runs:
GRANT SELECT ON public.enrichment_runs TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sanity check after run:
--   SELECT * FROM public.platform_settings WHERE key = 'qbo_refresh_token';
--   SELECT * FROM public.enrichment_runs ORDER BY finished_at DESC LIMIT 5;
-- ═══════════════════════════════════════════════════════════════════════════
