create table if not exists public.daily_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_date date not null,
  morning_note text,
  evening_note text,
  energy integer check (energy between 1 and 5),
  wins text,
  blockers text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, review_date)
);

alter table public.daily_reviews enable row level security;

drop policy if exists "Users manage their daily reviews" on public.daily_reviews;
create policy "Users manage their daily reviews"
on public.daily_reviews
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
