-- Executive Agent foundation.
-- Adds an auditable event -> assessment -> action-pack workflow without
-- changing the existing Command Centre task or Gmail read paths.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists public.executive_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('gmail','calendar','task','crm','manual','system')),
  source_event_id text,
  event_type text not null,
  idempotency_key text not null,
  entity_type text,
  entity_id text,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processing','assessed','ignored','failed')),
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  attempt_count integer not null default 0,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);

create table if not exists public.attention_assessments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.executive_events(id) on delete cascade,
  category text not null,
  summary text not null,
  previous_state text,
  new_state text,
  changes jsonb not null default '[]'::jsonb,
  explicit_requests jsonb not null default '[]'::jsonb,
  commitments jsonb not null default '[]'::jsonb,
  missing_facts jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  recommended_response_by timestamptz,
  consequence_of_delay text,
  attention_score integer not null check (attention_score between 0 and 100),
  attention_level text not null check (attention_level in ('interrupt_now','top_of_today','morning_brief','silent')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  model_provider text not null default 'rules',
  model_name text,
  model_version text,
  policy_version text not null default 'revenue-ea-v1',
  created_at timestamptz not null default now(),
  unique(event_id, policy_version)
);

create table if not exists public.action_packs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.executive_events(id) on delete cascade,
  assessment_id uuid not null references public.attention_assessments(id) on delete cascade,
  title text not null,
  executive_summary text not null,
  why_now text,
  status text not null default 'preparing' check (status in ('preparing','ready_for_review','approved','executing','completed','dismissed','failed','superseded')),
  attention_level text not null check (attention_level in ('interrupt_now','top_of_today','morning_brief','silent')),
  review_by timestamptz,
  contact_name text,
  organisation_name text,
  external_opportunity_id text,
  source_url text,
  missing_facts jsonb not null default '[]'::jsonb,
  proposed_changes jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  read_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  dismissal_reason text,
  superseded_by uuid references public.action_packs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, assessment_id)
);

create table if not exists public.action_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_pack_id uuid not null references public.action_packs(id) on delete cascade,
  action_type text not null check (action_type in ('reply_draft','document_draft','meeting_brief','calendar_proposal','task_create','task_reprioritise','opportunity_patch','follow_up_schedule','metric_entry','notification')),
  title text not null,
  content jsonb not null default '{}'::jsonb,
  content_version integer not null default 1,
  content_hash text not null,
  approval_required boolean not null default true,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','not_required')),
  execution_status text not null default 'not_started' check (execution_status in ('not_started','queued','executing','completed','failed','cancelled')),
  approved_at timestamptz,
  executed_at timestamptz,
  external_result_reference text,
  last_error text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(action_pack_id, action_type, content_version)
);

create table if not exists public.action_approvals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_item_id uuid not null references public.action_items(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected','amended')),
  approved_content_hash text not null,
  amendments jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.executive_notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_pack_id uuid references public.action_packs(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app','browser')),
  attention_level text not null check (attention_level in ('interrupt_now','top_of_today','morning_brief','silent')),
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','delivered','read','dismissed','failed')),
  deliver_after timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.executive_briefs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_date date not null,
  timezone text not null default 'Europe/London',
  title text not null,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','ready','delivered','read','superseded')),
  generated_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, brief_date)
);

create table if not exists public.executive_operating_rules (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null,
  rule_text text not null,
  config jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, rule_key, version)
);

create table if not exists public.executive_feedback (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_pack_id uuid references public.action_packs(id) on delete cascade,
  assessment_id uuid references public.attention_assessments(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('correct_useful','important_no_interrupt','should_interrupt','not_important','wrong_interpretation','draft_direction')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.executive_agent_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.executive_events(id) on delete set null,
  correlation_id text not null,
  stage text not null,
  status text not null check (status in ('started','completed','failed','skipped')),
  provider text,
  model text,
  prompt_version text,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  retry_count integer not null default 0,
  safe_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.google_calendar_connections
  add column if not exists gmail_history_id text,
  add column if not exists gmail_watch_expires_at timestamptz,
  add column if not exists gmail_last_event_at timestamptz,
  add column if not exists gmail_last_recovery_sync_at timestamptz;

alter table public.tasks
  add column if not exists source_event_id uuid references public.executive_events(id) on delete set null,
  add column if not exists action_pack_id uuid references public.action_packs(id) on delete set null,
  add column if not exists revenue_proximity text check (revenue_proximity is null or revenue_proximity in ('none','90_days','30_days','7_days','immediate')),
  add column if not exists recommendation_explanation text,
  add column if not exists replacement_reason text;

create index if not exists executive_events_user_received_idx on public.executive_events(user_id, received_at desc);
create index if not exists executive_events_pending_idx on public.executive_events(status, received_at) where status in ('pending','failed');
create index if not exists attention_assessments_user_level_idx on public.attention_assessments(user_id, attention_level, created_at desc);
create index if not exists action_packs_user_review_idx on public.action_packs(user_id, status, review_by, created_at desc);
create index if not exists action_items_pack_position_idx on public.action_items(action_pack_id, position, created_at);
create index if not exists executive_notifications_delivery_idx on public.executive_notifications(user_id, status, deliver_after);
create unique index if not exists executive_notifications_pack_channel_unique on public.executive_notifications(action_pack_id, channel) where action_pack_id is not null;
create index if not exists executive_feedback_pack_idx on public.executive_feedback(action_pack_id, created_at desc);
create index if not exists executive_agent_runs_correlation_idx on public.executive_agent_runs(correlation_id, created_at);

alter table public.executive_events enable row level security;
alter table public.attention_assessments enable row level security;
alter table public.action_packs enable row level security;
alter table public.action_items enable row level security;
alter table public.action_approvals enable row level security;
alter table public.executive_notifications enable row level security;
alter table public.executive_briefs enable row level security;
alter table public.executive_operating_rules enable row level security;
alter table public.executive_feedback enable row level security;
alter table public.executive_agent_runs enable row level security;

drop policy if exists "Users read own executive events" on public.executive_events;
create policy "Users read own executive events" on public.executive_events for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users read own attention assessments" on public.attention_assessments;
create policy "Users read own attention assessments" on public.attention_assessments for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users read own action packs" on public.action_packs;
create policy "Users read own action packs" on public.action_packs for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users update own action packs" on public.action_packs;

drop policy if exists "Users read own action items" on public.action_items;
create policy "Users read own action items" on public.action_items for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users update own action items" on public.action_items;

drop policy if exists "Users read own action approvals" on public.action_approvals;
create policy "Users read own action approvals" on public.action_approvals for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users create own action approvals" on public.action_approvals;

drop policy if exists "Users read own executive notifications" on public.executive_notifications;
create policy "Users read own executive notifications" on public.executive_notifications for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users update own executive notifications" on public.executive_notifications;
create policy "Users update own executive notifications" on public.executive_notifications for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own executive briefs" on public.executive_briefs;
create policy "Users read own executive briefs" on public.executive_briefs for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users update own executive briefs" on public.executive_briefs;
create policy "Users update own executive briefs" on public.executive_briefs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own executive rules" on public.executive_operating_rules;
create policy "Users manage own executive rules" on public.executive_operating_rules for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own executive feedback" on public.executive_feedback;
create policy "Users read own executive feedback" on public.executive_feedback for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users create own executive feedback" on public.executive_feedback;
create policy "Users create own executive feedback" on public.executive_feedback for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users read own executive agent runs" on public.executive_agent_runs;
create policy "Users read own executive agent runs" on public.executive_agent_runs for select to authenticated using (auth.uid() = user_id);

create or replace function public.seed_executive_agent_rules(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Not authorised';
  end if;

  insert into public.executive_operating_rules (user_id, rule_key, rule_text, config)
  values
    (p_user_id, 'cash_first', 'Immediate contracted income and live consultancy opportunities take precedence over speculative product work.', '{"priority":100}'::jsonb),
    (p_user_id, 'prepare_by_default', 'Prepare internal and reversible work before asking Coris, but require approval before external commitments.', '{"external_approval_required":true}'::jsonb),
    (p_user_id, 'protect_big_three', 'Replace a Big Three task only when waiting has a material commercial or personal consequence.', '{"minimum_attention_level":"top_of_today"}'::jsonb),
    (p_user_id, 'protect_health_family', 'Health and family commitments are not automatically displaced by commercial work.', '{"automatic_replacement":false}'::jsonb),
    (p_user_id, 'quiet_hours', 'Hold ordinary commercial interruptions overnight and surface them in the morning brief.', '{"start":"21:00","end":"07:30","timezone":"Europe/London"}'::jsonb)
  on conflict (user_id, rule_key, version) do nothing;
end;
$$;

revoke all on function public.seed_executive_agent_rules(uuid) from public;
grant execute on function public.seed_executive_agent_rules(uuid) to authenticated;

create or replace function public.manage_executive_action_pack(
  p_action_pack_id uuid,
  p_action text,
  p_snoozed_until timestamptz default null,
  p_reason text default null
)
returns public.action_packs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack public.action_packs;
begin
  select * into v_pack
  from public.action_packs
  where id = p_action_pack_id
    and user_id = auth.uid()
  for update;

  if v_pack.id is null then
    raise exception 'Action pack not found';
  end if;

  if p_action = 'read' then
    update public.action_packs
    set read_at = coalesce(read_at, now()), updated_at = now()
    where id = p_action_pack_id
    returning * into v_pack;
  elsif p_action = 'snooze' then
    if p_snoozed_until is null or p_snoozed_until <= now() then
      raise exception 'Snooze time must be in the future';
    end if;
    update public.action_packs
    set snoozed_until = p_snoozed_until, updated_at = now()
    where id = p_action_pack_id
    returning * into v_pack;
  elsif p_action = 'dismiss' then
    if v_pack.status not in ('ready_for_review','approved','failed') then
      raise exception 'This action pack cannot be dismissed in its current state';
    end if;
    update public.action_packs
    set status = 'dismissed',
        dismissed_at = now(),
        dismissal_reason = nullif(trim(coalesce(p_reason, '')), ''),
        updated_at = now()
    where id = p_action_pack_id
    returning * into v_pack;
  else
    raise exception 'Unsupported action pack command';
  end if;

  return v_pack;
end;
$$;

revoke all on function public.manage_executive_action_pack(uuid, text, timestamptz, text) from public;
grant execute on function public.manage_executive_action_pack(uuid, text, timestamptz, text) to authenticated;

create or replace function public.approve_executive_action_item(
  p_action_item_id uuid,
  p_content_hash text,
  p_amendments jsonb default '{}'::jsonb
)
returns public.action_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.action_items;
  v_approved_hash text;
begin
  select * into v_item
  from public.action_items
  where id = p_action_item_id
    and user_id = auth.uid()
  for update;

  if v_item.id is null then
    raise exception 'Action item not found';
  end if;

  if v_item.content_hash is distinct from p_content_hash then
    raise exception 'This prepared action changed after it was opened. Review the latest version before approving.';
  end if;

  if v_item.approval_status = 'approved' then
    return v_item;
  end if;

  v_approved_hash := encode(
    digest(v_item.content::text || coalesce(p_amendments, '{}'::jsonb)::text, 'sha256'),
    'hex'
  );

  insert into public.action_approvals (
    user_id, action_item_id, decision, approved_content_hash, amendments
  ) values (
    auth.uid(), p_action_item_id,
    case when p_amendments = '{}'::jsonb then 'approved' else 'amended' end,
    v_approved_hash,
    coalesce(p_amendments, '{}'::jsonb)
  );

  update public.action_items
  set approval_status = 'approved',
      approved_at = now(),
      updated_at = now()
  where id = p_action_item_id
  returning * into v_item;

  if not exists (
    select 1 from public.action_items
    where action_pack_id = v_item.action_pack_id
      and approval_required = true
      and approval_status = 'pending'
  ) then
    update public.action_packs
    set status = 'approved', updated_at = now()
    where id = v_item.action_pack_id
      and user_id = auth.uid()
      and status = 'ready_for_review';
  end if;

  return v_item;
end;
$$;

revoke all on function public.approve_executive_action_item(uuid, text, jsonb) from public;
grant execute on function public.approve_executive_action_item(uuid, text, jsonb) to authenticated;
