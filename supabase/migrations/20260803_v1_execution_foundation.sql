-- Command Centre v1 relational execution foundation
-- Design migration only. Apply after review in a controlled Supabase environment.

create extension if not exists "pgcrypto";

create type public.initiative_status as enum ('idea','planned','active','paused','blocked','complete','stopped');
create type public.task_status as enum ('backlog','ready','today','in_progress','waiting','blocked','complete','cancelled');
create type public.task_energy as enum ('low','standard','high');
create type public.task_work_type as enum ('deep_work','admin','communication','meeting','creative','health','life');
create type public.plan_status as enum ('draft','active','closed');
create type public.external_provider as enum ('google_calendar','gmail','google_drive','google_contacts','github','url');

create table if not exists public.life_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  position integer not null default 0,
  confidence text check (confidence in ('green','amber','red')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.planning_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned' check (status in ('planned','active','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table if not exists public.objectives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  life_area_id uuid references public.life_areas(id) on delete set null,
  planning_cycle_id uuid references public.planning_cycles(id) on delete set null,
  title text not null,
  outcome_statement text,
  status text not null default 'active' check (status in ('planned','active','paused','complete','stopped')),
  priority integer not null default 3 check (priority between 1 and 5),
  starts_on date,
  target_date date,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.initiatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  objective_id uuid references public.objectives(id) on delete set null,
  life_area_id uuid references public.life_areas(id) on delete set null,
  title text not null,
  purpose text,
  desired_outcome text,
  status public.initiative_status not null default 'planned',
  priority integer not null default 3 check (priority between 1 and 5),
  starts_on date,
  target_date date,
  decision_gate text,
  constraints text,
  progress_override numeric(5,2) check (progress_override between 0 and 100),
  position integer not null default 0,
  legacy_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, legacy_key)
);

create table if not exists public.initiative_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'not_started' check (status in ('not_started','active','blocked','complete','skipped')),
  starts_on date,
  target_date date,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workstreams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (initiative_id, title)
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  phase_id uuid references public.initiative_phases(id) on delete set null,
  workstream_id uuid references public.workstreams(id) on delete set null,
  title text not null,
  outcome_statement text,
  status text not null default 'not_started' check (status in ('not_started','in_progress','blocked','review','complete','cancelled')),
  priority integer not null default 3 check (priority between 1 and 5),
  target_date date,
  position integer not null default 0,
  legacy_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (initiative_id, legacy_key)
);

-- Replace the existing prototype tasks table only after data verification.
-- This migration extends it where possible, preserving its identity.
alter table public.tasks add column if not exists initiative_id uuid references public.initiatives(id) on delete set null;
alter table public.tasks add column if not exists milestone_id uuid references public.milestones(id) on delete set null;
alter table public.tasks add column if not exists objective_id uuid references public.objectives(id) on delete set null;
alter table public.tasks add column if not exists definition_of_done text;
alter table public.tasks add column if not exists notes text;
alter table public.tasks add column if not exists status public.task_status not null default 'ready';
alter table public.tasks add column if not exists priority integer not null default 3;
alter table public.tasks add column if not exists estimated_minutes integer not null default 30;
alter table public.tasks add column if not exists energy_required public.task_energy not null default 'standard';
alter table public.tasks add column if not exists work_type public.task_work_type not null default 'deep_work';
alter table public.tasks add column if not exists due_on date;
alter table public.tasks add column if not exists earliest_start_on date;
alter table public.tasks add column if not exists preferred_time text check (preferred_time in ('morning','afternoon','evening','any'));
alter table public.tasks add column if not exists is_splittable boolean not null default true;
alter table public.tasks add column if not exists position integer not null default 0;
alter table public.tasks add column if not exists legacy_id text;
alter table public.tasks add column if not exists updated_at timestamptz not null default now();

-- Keep legacy columns during compatibility mode: category, points, is_today,
-- is_complete, week_number and completed_at.

create unique index if not exists tasks_user_legacy_id_unique
  on public.tasks(user_id, legacy_id)
  where legacy_id is not null;

create table if not exists public.task_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  label text not null default 'Open',
  url text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  is_complete boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  status public.plan_status not null default 'draft',
  capacity public.task_energy not null default 'standard',
  first_task_id uuid references public.tasks(id) on delete set null,
  summary text,
  created_by text not null default 'user' check (created_by in ('user','planner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create table if not exists public.daily_plan_tasks (
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null default 'big_three' check (slot in ('big_three','follow_up','appointment','momentum')),
  position integer not null default 0,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (daily_plan_id, task_id)
);

create table if not exists public.external_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.external_provider not null,
  external_id text,
  title text,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_resources (
  task_id uuid not null references public.tasks(id) on delete cascade,
  resource_id uuid not null references public.external_resources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null default 'reference',
  created_at timestamptz not null default now(),
  primary key (task_id, resource_id)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  organisation text,
  role text,
  relationship_context text,
  google_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_contacts (
  task_id uuid not null references public.tasks(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null default 'related',
  primary key (task_id, contact_id)
);

create table if not exists public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  google_calendar_id text,
  google_event_id text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned','moved','complete','missed','cancelled')),
  locked boolean not null default false,
  planner_managed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index if not exists calendar_blocks_google_event_unique
  on public.calendar_blocks(user_id, google_calendar_id, google_event_id)
  where google_event_id is not null;

create table if not exists public.planner_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/London',
  working_days integer[] not null default array[1,2,3,4,5],
  workday_start time not null default '09:00',
  workday_end time not null default '17:30',
  lunch_start time default '12:30',
  lunch_end time default '13:30',
  minimum_block_minutes integer not null default 30,
  maximum_planned_minutes integer not null default 300,
  daily_buffer_minutes integer not null default 60,
  deep_work_preference text not null default 'morning',
  auto_planning_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.planner_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_type text not null check (run_type in ('manual','nightly','morning','midday')),
  target_date date,
  status text not null default 'running' check (status in ('running','complete','failed','skipped')),
  tasks_considered integer not null default 0,
  events_created integer not null default 0,
  events_updated integer not null default 0,
  events_deleted integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ideas_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'not_now' check (status in ('not_now','review','promoted','discarded')),
  review_on date,
  promoted_to_initiative_id uuid references public.initiatives(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.migration_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  migration_key text not null default 'v1_execution_foundation',
  status text not null default 'not_started' check (status in ('not_started','running','verified','rolled_back','failed')),
  source_backup jsonb,
  migrated_at timestamptz,
  verified_at timestamptz,
  error_message text,
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists initiatives_user_status_idx on public.initiatives(user_id, status);
create index if not exists milestones_initiative_position_idx on public.milestones(initiative_id, position);
create index if not exists tasks_user_status_due_idx on public.tasks(user_id, status, due_on);
create index if not exists tasks_initiative_position_idx on public.tasks(initiative_id, position);
create index if not exists daily_plans_user_date_idx on public.daily_plans(user_id, plan_date);
create index if not exists calendar_blocks_user_start_idx on public.calendar_blocks(user_id, starts_at);

-- RLS
alter table public.life_areas enable row level security;
alter table public.planning_cycles enable row level security;
alter table public.objectives enable row level security;
alter table public.initiatives enable row level security;
alter table public.initiative_phases enable row level security;
alter table public.workstreams enable row level security;
alter table public.milestones enable row level security;
alter table public.task_links enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.daily_plans enable row level security;
alter table public.daily_plan_tasks enable row level security;
alter table public.external_resources enable row level security;
alter table public.task_resources enable row level security;
alter table public.contacts enable row level security;
alter table public.task_contacts enable row level security;
alter table public.calendar_blocks enable row level security;
alter table public.planner_preferences enable row level security;
alter table public.planner_runs enable row level security;
alter table public.ideas_v1 enable row level security;
alter table public.migration_status enable row level security;

-- Single-user ownership policies. Service-role Edge Functions bypass RLS and must
-- still filter by the explicit user being processed.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'life_areas','planning_cycles','objectives','initiatives','initiative_phases',
    'workstreams','milestones','task_links','task_checklist_items','task_dependencies',
    'daily_plans','daily_plan_tasks','external_resources','task_resources','contacts',
    'task_contacts','calendar_blocks','planner_preferences','planner_runs','ideas_v1',
    'migration_status'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      'Users manage own ' || table_name,
      table_name
    );
  exception
    when duplicate_object then null;
  end loop;
end $$;

-- Compatibility trigger: keep prototype boolean fields aligned while the old UI
-- still reads them. Remove after the relational UI migration is verified.
create or replace function public.sync_task_legacy_flags()
returns trigger
language plpgsql
as $$
begin
  new.is_complete := (new.status = 'complete');
  new.is_today := (new.status = 'today');
  if new.status = 'complete' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'complete' then
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sync_task_legacy_flags_trigger on public.tasks;
create trigger sync_task_legacy_flags_trigger
before insert or update of status on public.tasks
for each row execute function public.sync_task_legacy_flags();
