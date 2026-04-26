-- ============================================================================
-- JG PLATFORM — REBUILD SCHEDULER DDL
-- Mirrors dispatch_v2 patterns: per-row tables, history trigger, open RLS,
-- Realtime-friendly. Designed to coexist with existing dispatch + timeclock.
-- Run order: 01_ddl_rebuild.sql → 02_seeds_rebuild.sql → 03_rls_rebuild.sql
-- Rollback: 99_rollback_rebuild.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SUBCONTRACTOR ROSTER
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_subs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  primary_contact TEXT,
  phone TEXT,                                -- E.164 preferred; SMS recovery key
  email TEXT,
  trades TEXT[] NOT NULL DEFAULT '{}',       -- e.g. {framing, drywall, electrical}
  markets TEXT[] NOT NULL DEFAULT '{}',      -- {appleton, stevens_point}
  preferred BOOLEAN NOT NULL DEFAULT FALSE,
  rate_notes TEXT,                           -- free text: "$45/hr or $1.25/sqft"
  w9_on_file BOOLEAN NOT NULL DEFAULT FALSE,
  coi_on_file BOOLEAN NOT NULL DEFAULT FALSE,
  coi_expires DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  -- Magic-link auth
  access_token TEXT UNIQUE,                  -- persistent token (NULL until issued)
  token_issued_at TIMESTAMPTZ,
  token_rotates_at TIMESTAMPTZ,              -- 90 days post-issue, auto-rotate
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rebuild_subs_active ON rebuild_subs(active);
CREATE INDEX IF NOT EXISTS idx_rebuild_subs_trades ON rebuild_subs USING GIN(trades);
CREATE INDEX IF NOT EXISTS idx_rebuild_subs_markets ON rebuild_subs USING GIN(markets);
CREATE INDEX IF NOT EXISTS idx_rebuild_subs_token ON rebuild_subs(access_token);
CREATE INDEX IF NOT EXISTS idx_rebuild_subs_phone ON rebuild_subs(phone);


-- ----------------------------------------------------------------------------
-- 2. PHASE TEMPLATES (loss-type → ordered phase library)
-- Configurable so Josh can drop in real JG workflow without schema changes.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_phase_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                 -- e.g. "Water Loss Rebuild"
  loss_type TEXT,                            -- water | fire | mold | custom
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rebuild_phase_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES rebuild_phase_templates(id) ON DELETE CASCADE,
  sequence INT NOT NULL,                     -- 10, 20, 30 for easy re-ordering
  phase_name TEXT NOT NULL,                  -- e.g. "Drywall"
  trade TEXT,                                -- which sub trade handles this
  default_duration_days INT DEFAULT 1,
  requires_customer_selection BOOLEAN NOT NULL DEFAULT FALSE,
  customer_selection_label TEXT,             -- e.g. "Paint colors"
  customer_selection_lead_days INT DEFAULT 7, -- how many days before phase
  predecessor_phase_name TEXT,               -- soft dep; can't start until X done
  notes TEXT,
  UNIQUE (template_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_phase_template_items_tpl ON rebuild_phase_template_items(template_id);


-- ----------------------------------------------------------------------------
-- 3. REBUILD PROJECTS (one row per Albi Reconstruction project)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  albi_project_id TEXT NOT NULL UNIQUE,      -- numeric Albi ID as text for safety
  albi_job_number TEXT,                      -- e.g. "Lam-2214-FRE"
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  property_address TEXT,
  market TEXT NOT NULL,                      -- appleton | stevens_point
  loss_type TEXT,                            -- water | fire | mold | other
  template_id UUID REFERENCES rebuild_phase_templates(id),
  pm_email TEXT,                             -- assigned PM (JG Google email)
  status TEXT NOT NULL DEFAULT 'planning',   -- planning | active | on_hold | complete | cancelled
  scope_amount NUMERIC(12,2),
  estimated_start DATE,
  estimated_completion DATE,
  actual_start DATE,
  actual_completion DATE,
  -- Customer magic-link
  customer_access_token TEXT UNIQUE,
  customer_token_expires TIMESTAMPTZ,        -- completion + 90 days
  -- Albi sync metadata
  albi_last_pulled_at TIMESTAMPTZ,
  albi_last_pushed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rebuild_projects_albi ON rebuild_projects(albi_project_id);
CREATE INDEX IF NOT EXISTS idx_rebuild_projects_status ON rebuild_projects(status);
CREATE INDEX IF NOT EXISTS idx_rebuild_projects_market ON rebuild_projects(market);
CREATE INDEX IF NOT EXISTS idx_rebuild_projects_pm ON rebuild_projects(pm_email);
CREATE INDEX IF NOT EXISTS idx_rebuild_projects_customer_token ON rebuild_projects(customer_access_token);


-- ----------------------------------------------------------------------------
-- 4. PHASES (per-project, instantiated from template, but freely editable)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES rebuild_projects(id) ON DELETE CASCADE,
  sequence INT NOT NULL,
  phase_name TEXT NOT NULL,
  trade TEXT,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | scheduled | in_progress | complete | skipped | blocked
  -- Sub assignment
  assigned_sub_id UUID REFERENCES rebuild_subs(id),
  assigned_at TIMESTAMPTZ,
  sub_accepted_at TIMESTAMPTZ,               -- sub clicked "accept"
  sub_self_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
  -- PM-set window for sub self-scheduling
  window_earliest DATE,
  window_latest DATE,
  -- Sub-committed dates
  scheduled_start DATE,
  scheduled_end DATE,
  -- Actuals
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  -- Customer selection dependency
  requires_customer_selection BOOLEAN NOT NULL DEFAULT FALSE,
  customer_selection_label TEXT,
  customer_selection_id UUID,                -- FK populated below; set ON UPDATE
  -- Predecessor (soft dep by phase_name within this project)
  predecessor_phase_name TEXT,
  -- Delay tracking (PM-only visibility per Q3 decision)
  delay_attribution TEXT,                    -- sub_no_show | sub_late | customer_selection_pending | material_backorder | weather | scope_change | pm_reschedule | none
  delay_notes TEXT,
  delay_logged_at TIMESTAMPTZ,
  delay_logged_by TEXT,
  -- Photos / completion proof
  completion_photos JSONB DEFAULT '[]'::jsonb,   -- array of storage URLs
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_rebuild_phases_project ON rebuild_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_rebuild_phases_sub ON rebuild_phases(assigned_sub_id);
CREATE INDEX IF NOT EXISTS idx_rebuild_phases_status ON rebuild_phases(status);
CREATE INDEX IF NOT EXISTS idx_rebuild_phases_window ON rebuild_phases(window_earliest, window_latest);


-- ----------------------------------------------------------------------------
-- 5. CUSTOMER SELECTIONS (paint colors, flooring SKUs, fixture choices)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_customer_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES rebuild_projects(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES rebuild_phases(id) ON DELETE SET NULL,
  label TEXT NOT NULL,                       -- "Paint colors", "Flooring SKU"
  description TEXT,                          -- PM-written guidance
  due_date DATE,                             -- soft deadline
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | submitted | approved | revised
  selection_value TEXT,                      -- customer-provided value
  selection_attachments JSONB DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ,
  pm_approved_at TIMESTAMPTZ,
  pm_approved_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_selections_project ON rebuild_customer_selections(project_id);
CREATE INDEX IF NOT EXISTS idx_selections_phase ON rebuild_customer_selections(phase_id);
CREATE INDEX IF NOT EXISTS idx_selections_status ON rebuild_customer_selections(status);


-- ----------------------------------------------------------------------------
-- 6. MESSAGES (project-scoped threads — customer↔PM and sub↔PM)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES rebuild_projects(id) ON DELETE CASCADE,
  thread_type TEXT NOT NULL,                 -- customer | sub | internal
  sub_id UUID REFERENCES rebuild_subs(id),   -- only for thread_type=sub
  sender_role TEXT NOT NULL,                 -- pm | customer | sub | office
  sender_name TEXT,
  sender_identifier TEXT,                    -- email or phone
  body TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  read_by_recipient_at TIMESTAMPTZ,
  escalated_to_office BOOLEAN NOT NULL DEFAULT FALSE,
  escalated_at TIMESTAMPTZ,
  -- SLA tracking (per Q "PM only with SLA + escalate-to-office")
  sla_due_at TIMESTAMPTZ,                    -- 1 business day from inbound customer msg
  sla_responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_project ON rebuild_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON rebuild_messages(thread_type, sub_id);
CREATE INDEX IF NOT EXISTS idx_messages_sla_open ON rebuild_messages(sla_due_at) WHERE sla_responded_at IS NULL;


-- ----------------------------------------------------------------------------
-- 7. DOCUMENTS (COIs, change orders, signed walkthroughs, etc)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES rebuild_projects(id) ON DELETE CASCADE,
  sub_id UUID REFERENCES rebuild_subs(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,                    -- coi | change_order | signed_walkthrough | scope_sheet | photo_set | other
  visibility TEXT NOT NULL DEFAULT 'internal', -- internal | customer | sub
  filename TEXT NOT NULL,
  storage_url TEXT NOT NULL,                 -- supabase storage path
  size_bytes BIGINT,
  uploaded_by TEXT,
  signed_by TEXT,
  signed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (project_id IS NOT NULL OR sub_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON rebuild_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_sub ON rebuild_documents(sub_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON rebuild_documents(doc_type);


-- ----------------------------------------------------------------------------
-- 8. AUDIT HISTORY (mirrors dispatch_assignments_history_v2 pattern)
-- SECURITY DEFINER trigger captures actor from app.jg_platform_user setting
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rebuild_phases_history (
  id BIGSERIAL PRIMARY KEY,
  phase_id UUID,
  project_id UUID,
  action TEXT NOT NULL,                      -- INSERT | UPDATE | DELETE
  changed_columns TEXT[],
  before_data JSONB,
  after_data JSONB,
  actor TEXT,                                -- pulled from current_setting('app.jg_platform_user')
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phases_history_phase ON rebuild_phases_history(phase_id);
CREATE INDEX IF NOT EXISTS idx_phases_history_project ON rebuild_phases_history(project_id);
CREATE INDEX IF NOT EXISTS idx_phases_history_changed_at ON rebuild_phases_history(changed_at);

CREATE OR REPLACE FUNCTION rebuild_phases_audit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor TEXT;
  v_changed_cols TEXT[];
BEGIN
  -- Pull actor from session var; fall back to 'system'
  BEGIN
    v_actor := current_setting('app.jg_platform_user', true);
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;
  IF v_actor IS NULL OR v_actor = '' THEN v_actor := 'system'; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO rebuild_phases_history (phase_id, project_id, action, after_data, actor)
    VALUES (NEW.id, NEW.project_id, 'INSERT', to_jsonb(NEW), v_actor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Compute changed columns
    SELECT array_agg(key) INTO v_changed_cols
    FROM jsonb_each(to_jsonb(NEW))
    WHERE to_jsonb(NEW)->key IS DISTINCT FROM to_jsonb(OLD)->key;
    IF v_changed_cols IS NULL OR array_length(v_changed_cols, 1) = 0 THEN
      RETURN NEW; -- no-op write
    END IF;
    INSERT INTO rebuild_phases_history (phase_id, project_id, action, changed_columns, before_data, after_data, actor)
    VALUES (NEW.id, NEW.project_id, 'UPDATE', v_changed_cols, to_jsonb(OLD), to_jsonb(NEW), v_actor);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO rebuild_phases_history (phase_id, project_id, action, before_data, actor)
    VALUES (OLD.id, OLD.project_id, 'DELETE', to_jsonb(OLD), v_actor);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rebuild_phases_audit ON rebuild_phases;
CREATE TRIGGER trg_rebuild_phases_audit
  AFTER INSERT OR UPDATE OR DELETE ON rebuild_phases
  FOR EACH ROW EXECUTE FUNCTION rebuild_phases_audit();


-- ----------------------------------------------------------------------------
-- 9. updated_at auto-bump triggers (lightweight, common pattern)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rebuild_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_subs_touch ON rebuild_subs;
CREATE TRIGGER trg_subs_touch BEFORE UPDATE ON rebuild_subs
  FOR EACH ROW EXECUTE FUNCTION rebuild_touch_updated_at();

DROP TRIGGER IF EXISTS trg_projects_touch ON rebuild_projects;
CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON rebuild_projects
  FOR EACH ROW EXECUTE FUNCTION rebuild_touch_updated_at();

DROP TRIGGER IF EXISTS trg_phases_touch ON rebuild_phases;
CREATE TRIGGER trg_phases_touch BEFORE UPDATE ON rebuild_phases
  FOR EACH ROW EXECUTE FUNCTION rebuild_touch_updated_at();

DROP TRIGGER IF EXISTS trg_selections_touch ON rebuild_customer_selections;
CREATE TRIGGER trg_selections_touch BEFORE UPDATE ON rebuild_customer_selections
  FOR EACH ROW EXECUTE FUNCTION rebuild_touch_updated_at();


-- ----------------------------------------------------------------------------
-- 10. Realtime publication (matches dispatch v2 pattern)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rebuild_projects; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rebuild_phases; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rebuild_customer_selections; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rebuild_messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rebuild_subs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ============================================================================
-- END 01_ddl_rebuild.sql
-- ============================================================================
