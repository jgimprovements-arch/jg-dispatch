-- ── SALES PARTNERS ───────────────────────────────────────────────────────────
create table if not exists sales_partners (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  company text,
  type text, -- Plumber, Realtor, Insurance Agent, Property Manager, GC, Other
  phone text,
  email text,
  address text,
  city text,
  market text default 'Appleton', -- Appleton | Stevens Point
  tier text default 'B', -- A (top), B (active), C (cold)
  status text default 'Active', -- Active | Inactive | Prospect
  albi_contact_id text, -- link back to Albi
  notes text,
  last_touch_date date,
  touch_count integer default 0,
  referral_count integer default 0,
  referral_revenue numeric default 0
);
create index if not exists idx_partners_market on sales_partners(market);
create index if not exists idx_partners_type on sales_partners(type);
create index if not exists idx_partners_tier on sales_partners(tier);

-- ── SALES TOUCHES ─────────────────────────────────────────────────────────────
create table if not exists sales_touches (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  partner_id uuid references sales_partners(id) on delete cascade,
  partner_name text,
  touch_type text, -- Call | Visit | Email | Text | Drop-in | Event
  touch_date date default current_date,
  duration_min integer,
  outcome text, -- Positive | Neutral | No Answer | Left VM | Not Interested
  notes text,
  follow_up_needed boolean default false,
  follow_up_date date,
  logged_by text,
  market text
);
create index if not exists idx_touches_partner on sales_touches(partner_id);
create index if not exists idx_touches_date on sales_touches(touch_date desc);
create index if not exists idx_touches_followup on sales_touches(follow_up_date) where follow_up_needed = true;

-- ── SALES ROUTES ──────────────────────────────────────────────────────────────
create table if not exists sales_routes (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  route_date date not null,
  market text not null,
  rep_name text,
  stops jsonb, -- array of {partner_id, partner_name, address, order, completed, notes}
  status text default 'Planned', -- Planned | In Progress | Completed
  total_stops integer default 0,
  completed_stops integer default 0,
  notes text
);
create index if not exists idx_routes_date on sales_routes(route_date desc);
create index if not exists idx_routes_market on sales_routes(market);

-- ── FOLLOW-UPS ────────────────────────────────────────────────────────────────
create table if not exists sales_followups (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  partner_id uuid references sales_partners(id) on delete cascade,
  partner_name text,
  partner_type text,
  due_date date not null,
  priority text default 'Normal', -- High | Normal | Low
  reason text,
  notes text,
  assigned_to text,
  market text,
  completed boolean default false,
  completed_at timestamptz,
  touch_id uuid references sales_touches(id) on delete set null
);
create index if not exists idx_followups_due on sales_followups(due_date);
create index if not exists idx_followups_completed on sales_followups(completed);
