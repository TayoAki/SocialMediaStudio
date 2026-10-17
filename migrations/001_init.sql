-- 001_init: core schema, tenant scoping and row-level security.
-- Runtime code connects as app_runtime (no BYPASSRLS, not owner). Every
-- transaction sets app.user_id / app.workspace_id / app.actor_kind LOCALLY
-- after server-side session + membership verification (src/data/db.ts).

create extension if not exists pgcrypto;
create schema if not exists app;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login password 'app_runtime' nobypassrls;
  end if;
end $$;

create or replace function app.ws() returns uuid language sql stable as
$$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;
create or replace function app.uid() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create or replace function app.is_worker() returns boolean language sql stable as
$$ select coalesce(current_setting('app.actor_kind', true), '') in ('worker', 'cleanup') $$;

create table users (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  email text not null,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name text not null check (length(name) between 1 and 120),
  locale text not null default 'en',
  timezone text not null,
  status text not null default 'active' check (status in ('active', 'deleting', 'deleted')),
  daily_budget_micros bigint not null default 5000000,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table memberships (
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('owner', 'editor', 'approver', 'viewer')),
  primary key (workspace_id, user_id)
);

create or replace function app.is_member(w uuid) returns boolean
language sql stable security definer set search_path = public, app as
$$ select exists (select 1 from memberships m where m.workspace_id = w and m.user_id = app.uid()) $$;

-- Scope predicate used by every tenant table policy.
create or replace function app.in_scope(w uuid) returns boolean language sql stable as
$$ select w is not null and w = app.ws() and (app.is_worker() or app.is_member(w)) $$;

create table brand_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  version int not null,
  business_description text not null default '',
  audience text not null default '',
  offer text not null default '',
  voice_rules text not null default '',
  prohibited_claims text not null default '',
  approved_urls text[] not null default '{}',
  colors text[] not null default '{}',
  website text,
  created_at timestamptz not null default now(),
  unique (workspace_id, version),
  unique (workspace_id, id)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_profile_version int not null,
  name text not null,
  objective text not null default '',
  brief text not null default '',
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'archived')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  provider text not null,
  secret_ciphertext text not null,
  key_version int not null,
  fingerprint text not null,
  status text not null check (status in ('valid', 'invalid', 'revoked', 'superseded')),
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  connection_id uuid not null,
  external_account_id text not null,
  platform text not null,
  display_name text not null,
  capabilities jsonb not null default '{}',
  allowed boolean not null default false,
  health text not null default 'ok',
  unique (connection_id, external_account_id),
  unique (workspace_id, id),
  foreign key (workspace_id, connection_id) references provider_connections (workspace_id, id)
);

create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  client_message_id text not null,
  role text not null check (role in ('user', 'coordinator', 'researcher', 'creator', 'scheduler', 'analytics')),
  body text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, client_message_id, role),
  foreign key (workspace_id, campaign_id) references campaigns (workspace_id, id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  plan_id uuid not null,
  plan_key text not null,
  role text not null check (role in ('coordinator', 'researcher', 'creator', 'scheduler', 'analytics')),
  depends_on text[] not null default '{}',
  inputs jsonb not null default '{}',
  input_revision int not null default 1,
  state text not null default 'queued',
  attempts int not null default 0,
  error_code text,
  output jsonb,
  summary text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (plan_id, plan_key),
  unique (workspace_id, id),
  foreign key (workspace_id, campaign_id) references campaigns (workspace_id, id)
);

create table task_events (
  seq bigserial primary key,
  workspace_id uuid not null,
  task_id uuid not null,
  state text not null,
  message text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, task_id) references tasks (workspace_id, id)
);

create table research_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  canonical_url text not null,
  title text not null,
  retrieved_at timestamptz not null,
  published_at timestamptz,
  excerpt text not null default '',
  supported_claims text[] not null default '{}',
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references tasks (workspace_id, id)
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  storage_key text not null,
  mime text not null,
  width int not null,
  height int not null,
  bytes int not null,
  checksum text not null,
  origin text not null check (origin in ('upload', 'generated', 'derived')),
  provider text,
  generation_params jsonb,
  rights_attested boolean not null default false,
  parent_asset_id uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  concept text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, campaign_id) references campaigns (workspace_id, id)
);

create table post_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  post_id uuid not null,
  platform text not null check (platform in ('instagram', 'linkedin')),
  editorial_state text not null default 'draft' check (editorial_state in ('draft', 'in_review', 'approved', 'published')),
  current_revision int not null default 1,
  version int not null default 1,
  unique (workspace_id, id),
  foreign key (workspace_id, post_id) references posts (workspace_id, id)
);

create table variant_revisions (
  workspace_id uuid not null,
  variant_id uuid not null,
  revision int not null,
  caption text not null,
  alt_text text not null default '',
  asset_id uuid,
  source_ids uuid[] not null default '{}',
  brand_profile_version int not null,
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (variant_id, revision),
  foreign key (workspace_id, variant_id) references post_variants (workspace_id, id),
  foreign key (workspace_id, asset_id) references assets (workspace_id, id)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  approver_id uuid not null references users(id),
  variant_id uuid not null,
  revision int not null,
  digest text not null,
  tuple jsonb not null,
  decision text not null check (decision in ('approved', 'rejected')),
  consumed_at timestamptz,
  invalidated_reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, variant_id) references post_variants (workspace_id, id)
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  variant_id uuid not null,
  revision int not null,
  account_id uuid not null,
  approval_id uuid not null,
  local_time text not null,
  timezone text not null,
  scheduled_utc timestamptz not null,
  schedule_generation int not null default 1,
  desired_state text not null,
  state text not null,
  observed_provider_state text,
  observed_at timestamptz,
  provider_submission_id text,
  provider_schedule_id text,
  remote_url text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (approval_id, account_id),
  unique (workspace_id, id),
  foreign key (workspace_id, variant_id) references post_variants (workspace_id, id),
  foreign key (workspace_id, account_id) references social_accounts (workspace_id, id),
  foreign key (workspace_id, approval_id) references approvals (workspace_id, id)
);
create index deliveries_account_time on deliveries (account_id, scheduled_utc);
create index deliveries_ws_state on deliveries (workspace_id, state);

create table provider_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  delivery_id uuid not null,
  kind text not null check (kind in ('create', 'update', 'cancel')),
  schedule_generation int not null,
  logical_key text not null unique,
  payload jsonb not null,
  payload_digest text not null,
  state text not null default 'pending' check (state in ('pending', 'in_flight', 'succeeded', 'failed', 'outcome_unknown', 'resolved')),
  attempts int not null default 0,
  external_id text,
  error_class text,
  reconciliation_evidence jsonb,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, delivery_id) references deliveries (workspace_id, id)
);

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  kind text not null,
  aggregate_id uuid not null,
  aggregate_version int not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'dead')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  claimed_until timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, aggregate_id, aggregate_version)
);
create index outbox_due on outbox_events (status, available_at);

create table metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  delivery_id uuid not null,
  platform text not null,
  metric text not null,
  value numeric,
  availability text not null check (availability in ('available', 'unavailable', 'stale', 'permission_expired')),
  reason text,
  provider_snapshot_at timestamptz,
  fetched_at timestamptz not null,
  foreign key (workspace_id, delivery_id) references deliveries (workspace_id, id)
);

create table audit_events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id),
  actor text not null,
  action text not null,
  aggregate_id uuid,
  aggregate_version int,
  summary jsonb not null default '{}',
  correlation_id text,
  created_at timestamptz not null default now()
);

create table usage_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  logical_key text not null unique,
  category text not null,
  reserved_micros bigint not null,
  settled_micros bigint,
  state text not null check (state in ('reserved', 'settled', 'unknown')),
  created_at timestamptz not null default now()
);

-- RLS on every tenant table.
do $$
declare t text;
begin
  foreach t in array array['brand_profiles','campaigns','provider_connections','social_accounts',
    'conversation_messages','tasks','task_events','research_sources','assets','posts','post_variants',
    'variant_revisions','approvals','deliveries','provider_operations','outbox_events','metric_snapshots',
    'audit_events','usage_records','memberships']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy scope on %I using (app.in_scope(workspace_id)) with check (app.in_scope(workspace_id))', t);
    execute format('grant select, insert, update on %I to app_runtime', t);
  end loop;
end $$;

alter table workspaces enable row level security;
alter table workspaces force row level security;
create policy scope on workspaces using (app.in_scope(id)) with check (app.in_scope(id));
grant select, update on workspaces to app_runtime;

-- Audit is append-only for runtime.
revoke update on audit_events from app_runtime;
grant usage on sequence audit_events_id_seq, task_events_seq_seq to app_runtime;

grant usage on schema app, public to app_runtime;
grant usage on all sequences in schema public to app_runtime;
grant select, insert on users to app_runtime;

-- Narrow definer functions: workspace creation (needs membership before scope exists),
-- listing one's own workspaces, and worker outbox claims.
create or replace function app.create_workspace(p_user uuid, p_name text, p_tz text)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare w uuid;
begin
  if p_user is null or p_user <> app.uid() then raise exception 'actor mismatch'; end if;
  insert into workspaces (owner_id, name, timezone) values (p_user, p_name, p_tz) returning id into w;
  insert into memberships values (w, p_user, 'owner');
  insert into brand_profiles (workspace_id, version) values (w, 1);
  return w;
end $$;

create or replace function app.my_workspaces()
returns table (id uuid, name text, timezone text, role text) language sql stable security definer
set search_path = public, app as $$
  select w.id, w.name, w.timezone, m.role from workspaces w join memberships m on m.workspace_id = w.id
  where m.user_id = app.uid() and w.status = 'active' order by w.created_at
$$;

create or replace function app.claim_outbox(p_limit int, p_lease_seconds int)
returns table (id uuid, workspace_id uuid, kind text, aggregate_id uuid, aggregate_version int)
language sql volatile security definer set search_path = public, app as $$
  update outbox_events o set status = 'claimed', attempts = o.attempts + 1,
    claimed_until = now() + make_interval(secs => p_lease_seconds)
  where o.id in (
    select e.id from outbox_events e
    where (e.status = 'pending' and e.available_at <= now())
       or (e.status = 'claimed' and e.claimed_until < now())
    order by e.available_at limit p_limit for update skip locked)
  returning o.id, o.workspace_id, o.kind, o.aggregate_id, o.aggregate_version
$$;

revoke all on function app.claim_outbox(int, int) from public;
grant execute on function app.claim_outbox(int, int), app.create_workspace(uuid, text, text),
  app.my_workspaces(), app.ws(), app.uid(), app.is_worker(), app.is_member(uuid), app.in_scope(uuid) to app_runtime;

-- Worker helper: which workspaces have stale in-flight operations (ids only).
create or replace function app.stale_operations(p_seconds int)
returns table (workspace_id uuid) language sql stable security definer set search_path = public, app as $$
  select distinct workspace_id from provider_operations where state = 'in_flight' and updated_at < now() - make_interval(secs => p_seconds)
$$;
create or replace function app.due_polls(p_ahead_seconds int)
returns table (workspace_id uuid, delivery_id uuid) language sql stable security definer set search_path = public, app as $$
  select workspace_id, id from deliveries
  where provider_submission_id is not null and state in ('schedule_pending','scheduled','processing','change_pending')
    and scheduled_utc <= now() + make_interval(secs => p_ahead_seconds)
$$;
grant execute on function app.stale_operations(int), app.due_polls(int) to app_runtime;
