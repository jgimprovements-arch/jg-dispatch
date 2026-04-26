-- ============================================================================
-- 02_seeds_rebuild.sql — Starter data
-- NOTE: Phase templates here are PLACEHOLDERS. Josh will replace with actual
-- JG workflow. Templates are 100% editable in-app — no schema dependency.
-- Subcontractor roster is intentionally empty (build-from-scratch decision).
-- ============================================================================

-- Placeholder template: Generic Rebuild (works for water/general)
INSERT INTO rebuild_phase_templates (name, loss_type, description)
VALUES ('Generic Rebuild (placeholder)', 'water',
  'Replace with actual JG workflow. Edit phases in admin UI.')
ON CONFLICT (name) DO NOTHING;

WITH tpl AS (SELECT id FROM rebuild_phase_templates WHERE name = 'Generic Rebuild (placeholder)')
INSERT INTO rebuild_phase_template_items
  (template_id, sequence, phase_name, trade, default_duration_days,
   requires_customer_selection, customer_selection_label, customer_selection_lead_days,
   predecessor_phase_name)
SELECT tpl.id, seq, name, trade, dur, sel, sel_label, sel_lead, pred FROM tpl, (VALUES
  (10,  'Demo Verification',    NULL,         1,  FALSE, NULL,                  0,  NULL),
  (20,  'Framing Repair',       'framing',    2,  FALSE, NULL,                  0,  'Demo Verification'),
  (30,  'Insulation',           'insulation', 1,  FALSE, NULL,                  0,  'Framing Repair'),
  (40,  'Drywall',              'drywall',    3,  FALSE, NULL,                  0,  'Insulation'),
  (50,  'Prime / Paint',        'paint',      2,  TRUE,  'Paint Color Selection', 7, 'Drywall'),
  (60,  'Trim',                 'trim',       1,  FALSE, NULL,                  0,  'Prime / Paint'),
  (70,  'Flooring',             'flooring',   2,  TRUE,  'Flooring SKU Selection',10, 'Trim'),
  (80,  'Final Clean',          NULL,         1,  FALSE, NULL,                  0,  'Flooring'),
  (90,  'Customer Walkthrough', NULL,         1,  FALSE, NULL,                  0,  'Final Clean')
) AS v(seq, name, trade, dur, sel, sel_label, sel_lead, pred)
ON CONFLICT (template_id, sequence) DO NOTHING;


-- Placeholder template: Fire Loss Rebuild
INSERT INTO rebuild_phase_templates (name, loss_type, description)
VALUES ('Fire Rebuild (placeholder)', 'fire',
  'Replace with actual JG fire workflow. Edit phases in admin UI.')
ON CONFLICT (name) DO NOTHING;

WITH tpl AS (SELECT id FROM rebuild_phase_templates WHERE name = 'Fire Rebuild (placeholder)')
INSERT INTO rebuild_phase_template_items
  (template_id, sequence, phase_name, trade, default_duration_days,
   requires_customer_selection, customer_selection_label, customer_selection_lead_days,
   predecessor_phase_name)
SELECT tpl.id, seq, name, trade, dur, sel, sel_label, sel_lead, pred FROM tpl, (VALUES
  (10,  'Demo Verification',    NULL,         1,  FALSE, NULL,                    0,  NULL),
  (20,  'Structural Repair',    'framing',    3,  FALSE, NULL,                    0,  'Demo Verification'),
  (30,  'Electrical Rough',     'electrical', 2,  FALSE, NULL,                    0,  'Structural Repair'),
  (40,  'Plumbing Rough',       'plumbing',   2,  FALSE, NULL,                    0,  'Structural Repair'),
  (50,  'HVAC',                 'hvac',       2,  FALSE, NULL,                    0,  'Structural Repair'),
  (60,  'Insulation',           'insulation', 1,  FALSE, NULL,                    0,  'HVAC'),
  (70,  'Drywall',              'drywall',    4,  FALSE, NULL,                    0,  'Insulation'),
  (80,  'Prime / Paint',        'paint',      3,  TRUE,  'Paint Color Selection', 7,  'Drywall'),
  (90,  'Cabinets',             'cabinets',   2,  TRUE,  'Cabinet Style Selection',14,'Prime / Paint'),
  (100, 'Countertops',          'counters',   1,  TRUE,  'Countertop Selection',  14, 'Cabinets'),
  (110, 'Trim',                 'trim',       2,  FALSE, NULL,                    0,  'Countertops'),
  (120, 'Flooring',             'flooring',   3,  TRUE,  'Flooring SKU Selection',10, 'Trim'),
  (130, 'Fixtures',             'plumbing',   1,  TRUE,  'Fixture Selection',     10, 'Flooring'),
  (140, 'Appliances',           NULL,         1,  TRUE,  'Appliance Selection',   14, 'Fixtures'),
  (150, 'Final Clean',          NULL,         1,  FALSE, NULL,                    0,  'Appliances'),
  (160, 'Customer Walkthrough', NULL,         1,  FALSE, NULL,                    0,  'Final Clean')
) AS v(seq, name, trade, dur, sel, sel_label, sel_lead, pred)
ON CONFLICT (template_id, sequence) DO NOTHING;


-- Empty Custom template (PM builds from scratch in UI)
INSERT INTO rebuild_phase_templates (name, loss_type, description)
VALUES ('Custom (build from scratch)', 'custom',
  'Empty template — add phases manually per project.')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- END 02_seeds_rebuild.sql
-- ============================================================================
