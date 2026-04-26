-- ============================================================================
-- 99_rollback_rebuild.sql — Drop all rebuild scheduler objects
-- DESTRUCTIVE. Run only to back out of the rebuild scheduler entirely.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_rebuild_phases_audit ON rebuild_phases;
DROP TRIGGER IF EXISTS trg_subs_touch ON rebuild_subs;
DROP TRIGGER IF EXISTS trg_projects_touch ON rebuild_projects;
DROP TRIGGER IF EXISTS trg_phases_touch ON rebuild_phases;
DROP TRIGGER IF EXISTS trg_selections_touch ON rebuild_customer_selections;

DROP FUNCTION IF EXISTS rebuild_phases_audit() CASCADE;
DROP FUNCTION IF EXISTS rebuild_touch_updated_at() CASCADE;

-- Drop in dependency order
DROP TABLE IF EXISTS rebuild_phases_history       CASCADE;
DROP TABLE IF EXISTS rebuild_documents            CASCADE;
DROP TABLE IF EXISTS rebuild_messages             CASCADE;
DROP TABLE IF EXISTS rebuild_customer_selections  CASCADE;
DROP TABLE IF EXISTS rebuild_phases               CASCADE;
DROP TABLE IF EXISTS rebuild_projects             CASCADE;
DROP TABLE IF EXISTS rebuild_phase_template_items CASCADE;
DROP TABLE IF EXISTS rebuild_phase_templates      CASCADE;
DROP TABLE IF EXISTS rebuild_subs                 CASCADE;

-- ============================================================================
-- END 99_rollback_rebuild.sql
-- ============================================================================
