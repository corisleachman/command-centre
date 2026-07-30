create extension if not exists "uuid-ossp";

create table if not exists public.tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null check (category in ('cash','build','health','life')),
  points integer not null default 1,
  is_today boolean not null default false,
  is_complete boolean not null default false,
  week_number integer not null default 1,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ideas (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'parked',
  created_at timestamptz not null default now()
);

create table if not exists public.metrics (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_key text not null,
  value numeric not null default 0,
  recorded_on date not null default current_date,
  unique(user_id, metric_key, recorded_on)
);

alter table public.tasks enable row level security;
alter table public.ideas enable row level security;
alter table public.metrics enable row level security;

create policy "Users manage own tasks" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own ideas" on public.ideas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own metrics" on public.metrics for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
