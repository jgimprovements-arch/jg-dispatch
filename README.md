# JG Rebuild Scheduler — Session 1 Build

## What's in this folder

| File | Purpose |
|---|---|
| `01_ddl_rebuild.sql` | Schema: 9 tables + audit trigger + Realtime publication |
| `02_seeds_rebuild.sql` | Two placeholder phase templates + Custom (empty). **Replace once you send actual workflow.** |
| `03_rls_rebuild.sql` | Open-to-anon RLS (matches dispatch v2 Path A) |
| `99_rollback_rebuild.sql` | Drops all rebuild_* objects. Destructive. |
| `rebuild.html` | PM master view — projects list + phase board + selections + audit trail |

## Run order in Supabase SQL Editor

```
01_ddl_rebuild.sql        → creates all tables, trigger, publication
02_seeds_rebuild.sql      → placeholder templates (safe to re-run, idempotent)
03_rls_rebuild.sql        → enables RLS + open policies
```

Coexists with dispatch_v2 — no shared tables, no risk to live dispatch traffic. Run anytime.

## What's working in `rebuild.html`

- Project list (left rail) with status filters and search
- New Project modal — creates `rebuild_projects` row + auto-instantiates phases from template + auto-creates customer selection records for phases that need them
- Project detail pane with KPI strip (progress, blocked, selections, est. completion, status)
- Phases tab — full phase rows with status pills, sub assignment placeholder, scheduled dates, advance-status button, edit modal, **delay attribution one-tap modal** (per Q3 decision: warning + one-tap log = no manual paper-trail discipline required)
- Selections tab — overdue/due-soon highlighting, status, nudge button
- Audit Trail tab — pulls from `rebuild_phases_history`, shows action + changed columns + actor + timestamp
- Realtime subscription on rebuild_projects, rebuild_phases, rebuild_customer_selections

## What's stubbed / deferred

Every stub is intentional and noted as "next session" in the UI:

- **`SUPABASE_ANON_KEY`** is blank in the script — populate from your existing pages (same as index.html / sales.html)
- **PM email** is hardcoded to `pm@jg-restoration.com` — wire up Google SSO via auth.js next session
- **"Pull from Albi" button** — toast only; Zapier integration ships next session
- **"Push timeline note" button** — toast only; Albi note POST ships next session
- **Sub assignment UI** — phase shows assigned sub if set, but no picker yet (session 2)
- **Add Phase / Reorder buttons** — UI placeholder; not wired
- **Messages tab + Documents tab** — empty state with "ships next session" copy
- **Magic-link sub portal** — not in this session
- **Customer portal** — not in this session
- **SLA timer for customer messages** — schema present (`sla_due_at`, `sla_responded_at`); UI ships with messaging tab

## Locked architecture decisions (from this session)

1. **Albi is system of record** for customer/scope/project meta. Platform is the rebuild operating layer. Platform pushes events as Albi notes — buyer-friendly story (no Albi dependency to remove).
2. **Sub access** = magic-link tokens, persistent per-sub, auto-rotate every 90 days, SMS recovery.
3. **Customer messages** route to PM only with visible 1-business-day SLA + escalate-to-office button. Auto-acknowledge on submit.
4. **Selection deadlines** = warnings, not blocking. PM gets one-tap delay attribution prompt when phase starts past dependency window — no manual discipline needed for paper trail.
5. **Sub visibility** = own assignments only. No pipeline-depth leakage to subs.
6. **Delay attribution** = PM-only. Customer portal sees clean timeline. Receipts kept privately for billing disputes and SF&P diligence.

## Open items for next session

1. Send Josh's actual rebuild workflow → I update `02_seeds_rebuild.sql` to replace placeholder templates.
2. Wire `SUPABASE_ANON_KEY` and Google SSO auth into `rebuild.html`.
3. Build sub portal (`/sub/[token]`) — list of my assignments, accept/decline, self-schedule within window, completion photo upload.
4. Build customer portal (`/customer/[token]`) — read-only timeline, selections form with attachments, message thread, document access.
5. Magic-link issuance + 90-day rotation + SMS recovery (Zapier-driven).
6. Albi pull integration: webhook on Reconstruction project create → Code by Zapier → Edge Function `rebuild-init` → creates `rebuild_projects` row.
7. Albi push integration: phase status changes → POST timeline note to Albi project notes.
8. Notification layer: Zapier triggers for sub assignment, customer selection due, phase starting tomorrow.
9. Reporting: delay attribution rollup dashboard for SF&P diligence (cycle time, customer-caused delay %, sub no-show rate).

## Migration safety reminder

This is additive. Nothing dropped, nothing renamed, no shared tables with dispatch. Rollback = `99_rollback_rebuild.sql`.
