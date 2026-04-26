-- ============================================================================
-- 03_rls_rebuild.sql — Row Level Security
-- Path A: open to anon, matches dispatch_v2 pattern.
-- App-level auth gates writes (sub portal uses access_token URL param;
-- customer portal uses customer_access_token; PM uses Google SSO).
-- Tighten later once magic-link infra is hardened in production.
-- ============================================================================

ALTER TABLE rebuild_subs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_phase_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_phase_template_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_phases                ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_customer_selections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuild_phases_history        ENABLE ROW LEVEL SECURITY;

-- Open policies (anon) — same posture as dispatch_v2.
-- TODO: tighten in v2 — sub access via WHERE access_token = current_setting(...).
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'rebuild_subs','rebuild_phase_templates','rebuild_phase_template_items',
    'rebuild_projects','rebuild_phases','rebuild_customer_selections',
    'rebuild_messages','rebuild_documents','rebuild_phases_history'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- ============================================================================
-- END 03_rls_rebuild.sql
-- ============================================================================
