create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  is_complete boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  entry_type text not null check (entry_type in ('blocker','decision','note')),
  content text not null,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists task_subtasks_task_id_idx on public.task_subtasks(task_id, position);
create index if not exists task_entries_task_id_idx on public.task_entries(task_id, created_at desc);
create index if not exists task_activity_task_id_idx on public.task_activity(task_id, created_at desc);

alter table public.task_subtasks enable row level security;
alter table public.task_entries enable row level security;
alter table public.task_activity enable row level security;

drop policy if exists "Users manage own task subtasks" on public.task_subtasks;
create policy "Users manage own task subtasks" on public.task_subtasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own task entries" on public.task_entries;
create policy "Users manage own task entries" on public.task_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own task activity" on public.task_activity;
create policy "Users manage own task activity" on public.task_activity for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
