-- ═══════════════════════════════════════════════════════════════════════════
-- JG Restoration — Adjuster Rebuttals Intelligence Table
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor for project nuykvchgecpiuikoerze.
-- Creates the table that adjuster.html reads from for pattern learning,
-- and writes to when a rebuttal is signed off.
--
-- Safe to run multiple times — uses IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.adjuster_rebuttals (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Project & adjuster identity
  project_name    TEXT,
  adjuster_name   TEXT,
  carrier         TEXT,
  claim_number    TEXT,
  adjuster_email  TEXT,

  -- Dollar positions
  jg_total        TEXT,
  adjuster_total  TEXT,
  total_disputed  TEXT,

  -- Item-level outcomes at sign-off
  items_defended  INTEGER DEFAULT 0,
  items_conceded  INTEGER DEFAULT 0,
  defended_items  JSONB DEFAULT '[]'::jsonb,
  conceded_items  JSONB DEFAULT '[]'::jsonb,

  -- OUTSMART LAYER: payment outcome (filled in later, after cheque arrives)
  -- This is what turns the tool from "AI writer" to "carrier scoring engine"
  payment_received_amount  TEXT,
  payment_received_date    DATE,
  days_to_payment          INTEGER,
  final_outcome            TEXT CHECK (final_outcome IN ('paid_full','paid_partial','denied','pending','withdrawn') OR final_outcome IS NULL),
  followup_required        BOOLEAN DEFAULT FALSE,
  outcome_notes            TEXT
);

-- Indexes to make the intel lookup fast as the table grows
CREATE INDEX IF NOT EXISTS idx_adjuster_rebuttals_adjuster ON public.adjuster_rebuttals (LOWER(adjuster_name));
CREATE INDEX IF NOT EXISTS idx_adjuster_rebuttals_carrier  ON public.adjuster_rebuttals (LOWER(carrier));
CREATE INDEX IF NOT EXISTS idx_adjuster_rebuttals_created  ON public.adjuster_rebuttals (created_at DESC);

-- RLS DISABLED (matches pattern used by sales_partners, sales_touches, etc.
-- per the platform's standing rules). If you later enable RLS, remember the
-- anon key is the one the browser uses.
ALTER TABLE public.adjuster_rebuttals DISABLE ROW LEVEL SECURITY;

-- Grant the anon role read + write (needed by the browser-side tool)
GRANT SELECT, INSERT, UPDATE ON public.adjuster_rebuttals TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.adjuster_rebuttals_id_seq TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- OPTIONAL: Backfill view for pre-sale presentation
-- ═══════════════════════════════════════════════════════════════════════════
-- Creates a materialized view that rolls up carrier-level behavior.
-- This is the "proprietary data moat" for the SF&P sale — refresh nightly.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.carrier_pattern_summary AS
SELECT
  LOWER(TRIM(carrier))                              AS carrier_key,
  MIN(carrier)                                      AS carrier_display,
  COUNT(*)                                          AS dispute_count,
  SUM(items_defended)                               AS total_items_defended,
  SUM(items_conceded)                               AS total_items_conceded,
  CASE
    WHEN SUM(items_defended + items_conceded) > 0
    THEN ROUND(SUM(items_defended)::numeric / SUM(items_defended + items_conceded) * 100, 1)
    ELSE NULL
  END                                               AS defend_rate_pct,
  COUNT(*) FILTER (WHERE final_outcome = 'paid_full')    AS paid_full_count,
  COUNT(*) FILTER (WHERE final_outcome = 'paid_partial') AS paid_partial_count,
  COUNT(*) FILTER (WHERE final_outcome = 'denied')       AS denied_count,
  AVG(days_to_payment) FILTER (WHERE days_to_payment IS NOT NULL) AS avg_days_to_payment,
  MAX(created_at)                                   AS most_recent_dispute
FROM public.adjuster_rebuttals
WHERE carrier IS NOT NULL AND TRIM(carrier) != ''
GROUP BY LOWER(TRIM(carrier));

GRANT SELECT ON public.carrier_pattern_summary TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE. Verify with:
--   SELECT * FROM public.adjuster_rebuttals LIMIT 1;
--   SELECT * FROM public.carrier_pattern_summary;
-- ═══════════════════════════════════════════════════════════════════════════
