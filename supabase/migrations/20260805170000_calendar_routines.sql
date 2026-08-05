create table if not exists public.calendar_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null default 'income',
  days_of_week integer[] not null default '{1,2,3,4,5}',
  preferred_start time not null default '09:00',
  preferred_end time not null default '12:00',
  minimum_minutes integer not null default 60 check (minimum_minutes between 15 and 480),
  ideal_minutes integer not null default 90 check (ideal_minutes between 15 and 480),
  priority integer not null default 1 check (priority between 1 and 5),
  can_split boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calendar_routines enable row level security;

create policy "Users can read own calendar routines" on public.calendar_routines for select using (auth.uid() = user_id);
create policy "Users can insert own calendar routines" on public.calendar_routines for insert with check (auth.uid() = user_id);
create policy "Users can update own calendar routines" on public.calendar_routines for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own calendar routines" on public.calendar_routines for delete using (auth.uid() = user_id);

create unique index if not exists calendar_routines_user_title_idx on public.calendar_routines(user_id, lower(title));