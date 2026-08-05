-- Secure Google Calendar integration foundation.
-- Provider tokens are only readable by service-role/Edge Functions, never directly by the browser.

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_account_email text,
  selected_calendar_id text,
  selected_calendar_name text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  status text not null default 'disconnected' check (status in ('disconnected','connected','error','revoked')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;

-- Users can see non-secret connection metadata only through a safe view.
create or replace view public.google_calendar_connection_status
with (security_invoker = true)
as
select
  user_id,
  google_account_email,
  selected_calendar_id,
  selected_calendar_name,
  access_token_expires_at,
  granted_scopes,
  status,
  last_sync_at,
  last_error,
  created_at,
  updated_at
from public.google_calendar_connections;

alter view public.google_calendar_connection_status set (security_invoker = true);

drop policy if exists "Users can read their calendar connection status" on public.google_calendar_connections;
create policy "Users can read their calendar connection status"
on public.google_calendar_connections
for select
to authenticated
using (user_id = auth.uid());

-- Browser clients must not insert/update/delete token records directly.
-- Edge Functions use the Supabase service role for these operations.

create index if not exists calendar_blocks_user_time_idx
  on public.calendar_blocks(user_id, starts_at, ends_at);

alter table public.calendar_blocks
  add column if not exists command_centre_managed boolean not null default true,
  add column if not exists source_fingerprint text;

create unique index if not exists calendar_blocks_source_fingerprint_unique
  on public.calendar_blocks(user_id, source_fingerprint)
  where source_fingerprint is not null;
