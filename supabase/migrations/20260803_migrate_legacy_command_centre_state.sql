-- Migrate the current Command Centre JSON state into the v1 relational model.
-- This migration is additive and idempotent. It keeps command_centre_state intact
-- as the rollback source until a later, explicit cutover migration.

create or replace function public.cc_safe_int(value text, fallback_value integer)
returns integer
language plpgsql
immutable
as $$
begin
  return coalesce(nullif(value, '')::integer, fallback_value);
exception when others then
  return fallback_value;
end;
$$;

do $$
declare
  state_row record;
  source_state jsonb;
  source_task jsonb;
  source_link jsonb;
  source_idea jsonb;
  launch_state jsonb;
  launch_milestone jsonb;
  launch_action jsonb;
  migrated_task_id uuid;
  v_daily_plan_id uuid;
  song_room_initiative_id uuid;
  workstream_id uuid;
  milestone_id uuid;
  source_task_count integer;
  migrated_task_count integer;
  source_idea_count integer;
  migrated_idea_count integer;
  source_launch_action_count integer;
  migrated_launch_action_count integer;
  task_position integer;
  link_position integer;
  milestone_position integer;
  action_position integer;
  task_category text;
  task_points integer;
  task_done boolean;
  task_today boolean;
  task_week integer;
begin
  for state_row in
    select user_id, state, updated_at
    from public.command_centre_state
  loop
    source_state := coalesce(state_row.state, '{}'::jsonb);

    insert into public.migration_status (
      user_id, migration_key, status, source_backup, migrated_at, updated_at
    ) values (
      state_row.user_id,
      'v1_execution_foundation',
      'running',
      source_state,
      now(),
      now()
    )
    on conflict (user_id) do update set
      migration_key = excluded.migration_key,
      status = 'running',
      source_backup = coalesce(public.migration_status.source_backup, excluded.source_backup),
      migrated_at = now(),
      verified_at = null,
      error_message = null,
      updated_at = now();

    insert into public.daily_plans (user_id, plan_date, status, capacity, created_by)
    values (state_row.user_id, current_date, 'active', 'standard', 'user')
    on conflict (user_id, plan_date) do update set updated_at = now()
    returning id into v_daily_plan_id;

    task_position := 0;
    for source_task in
      select value
      from jsonb_array_elements(coalesce(source_state->'tasks', '[]'::jsonb))
    loop
      task_position := task_position + 1;
      task_category := case source_task->>'category'
        when 'cash' then 'cash'
        when 'build' then 'build'
        when 'health' then 'health'
        when 'life' then 'life'
        else 'life'
      end;
      task_points := public.cc_safe_int(source_task->>'points', 1);
      task_done := coalesce((source_task->>'done')::boolean, false);
      task_today := coalesce((source_task->>'today')::boolean, false);
      task_week := public.cc_safe_int(source_task->>'week', 1);

      insert into public.tasks (
        user_id, title, category, points, is_today, is_complete, week_number,
        completed_at, notes, status, priority, estimated_minutes, energy_required,
        work_type, preferred_time, position, legacy_id, created_at, updated_at
      ) values (
        state_row.user_id,
        coalesce(nullif(trim(source_task->>'title'), ''), 'Untitled task'),
        task_category,
        greatest(task_points, 1),
        task_today,
        task_done,
        greatest(task_week, 1),
        case when task_done then coalesce(state_row.updated_at, now()) else null end,
        nullif(trim(source_task->>'notes'), ''),
        case
          when task_done then 'complete'::public.task_status
          when task_today then 'today'::public.task_status
          else 'ready'::public.task_status
        end,
        case when task_points >= 5 then 5 when task_points >= 3 then 4 else 3 end,
        case when task_points >= 5 then 90 when task_points >= 3 then 60 else 30 end,
        'standard'::public.task_energy,
        case
          when task_category = 'cash' then 'communication'::public.task_work_type
          when task_category = 'health' then 'health'::public.task_work_type
          when task_category = 'life' then 'life'::public.task_work_type
          else 'deep_work'::public.task_work_type
        end,
        'any', task_position,
        coalesce(source_task->>'id', 'legacy-' || task_position::text),
        coalesce(state_row.updated_at, now()), now()
      )
      on conflict (user_id, legacy_id) where legacy_id is not null do update set
        title = excluded.title,
        category = excluded.category,
        points = excluded.points,
        is_today = excluded.is_today,
        is_complete = excluded.is_complete,
        week_number = excluded.week_number,
        completed_at = excluded.completed_at,
        notes = excluded.notes,
        status = excluded.status,
        priority = excluded.priority,
        estimated_minutes = excluded.estimated_minutes,
        work_type = excluded.work_type,
        position = excluded.position,
        updated_at = now()
      returning id into migrated_task_id;

      if task_today then
        insert into public.daily_plan_tasks (
          daily_plan_id, task_id, user_id, slot, position, locked
        ) values (
          v_daily_plan_id, migrated_task_id, state_row.user_id, 'big_three', task_position, false
        )
        on conflict (daily_plan_id, task_id) do update set
          slot = excluded.slot,
          position = excluded.position;
      end if;

      link_position := 0;
      for source_link in
        select value
        from jsonb_array_elements(coalesce(source_task->'links', '[]'::jsonb))
      loop
        if nullif(trim(source_link->>'url'), '') is not null then
          link_position := link_position + 1;
          insert into public.task_links (user_id, task_id, label, url, position)
          select state_row.user_id, migrated_task_id,
            coalesce(nullif(trim(source_link->>'label'), ''), 'Open'),
            trim(source_link->>'url'), link_position
          where not exists (
            select 1 from public.task_links existing
            where existing.task_id = migrated_task_id
              and existing.url = trim(source_link->>'url')
          );
        end if;
      end loop;
    end loop;

    for source_idea in
      select value from jsonb_array_elements(coalesce(source_state->'ideas', '[]'::jsonb))
    loop
      if nullif(trim(source_idea #>> '{}'), '') is not null then
        insert into public.ideas_v1 (user_id, title, status, created_at, updated_at)
        select state_row.user_id, trim(source_idea #>> '{}'), 'not_now', coalesce(state_row.updated_at, now()), now()
        where not exists (
          select 1 from public.ideas_v1 existing
          where existing.user_id = state_row.user_id
            and existing.title = trim(source_idea #>> '{}')
        );
      end if;
    end loop;

    launch_state := source_state->'songRoomLaunch';
    if launch_state is not null and jsonb_typeof(launch_state) = 'object' then
      insert into public.initiatives (
        user_id, title, purpose, desired_outcome, status, priority,
        target_date, position, legacy_key, created_at, updated_at
      ) values (
        state_row.user_id,
        'The Song Room launch',
        'Prepare, validate and launch The Song Room through a structured execution roadmap.',
        'Launch a properly tested, marketed and measurable product and validate willingness to pay.',
        'active', 4,
        case when nullif(launch_state->>'targetDate', '') is not null then (launch_state->>'targetDate')::date else null end,
        1, 'song-room-launch', coalesce(state_row.updated_at, now()), now()
      )
      on conflict (user_id, legacy_key) do update set
        target_date = excluded.target_date,
        updated_at = now()
      returning id into song_room_initiative_id;

      milestone_position := 0;
      for launch_milestone in
        select value from jsonb_array_elements(coalesce(launch_state->'milestones', '[]'::jsonb))
      loop
        milestone_position := milestone_position + 1;

        insert into public.workstreams (user_id, initiative_id, title, position)
        values (
          state_row.user_id, song_room_initiative_id,
          coalesce(nullif(trim(launch_milestone->>'workstream'), ''), 'General'),
          milestone_position
        )
        on conflict (initiative_id, title) do update set updated_at = now()
        returning id into workstream_id;

        insert into public.milestones (
          user_id, initiative_id, workstream_id, title, outcome_statement,
          status, priority, position, legacy_key, created_at, updated_at
        ) values (
          state_row.user_id,
          song_room_initiative_id,
          workstream_id,
          coalesce(nullif(trim(launch_milestone->>'title'), ''), 'Untitled milestone'),
          case when nullif(trim(launch_milestone->>'stage'), '') is not null
            then 'Stage: ' || trim(launch_milestone->>'stage') else null end,
          case
            when not exists (
              select 1 from jsonb_array_elements(coalesce(launch_milestone->'actions', '[]'::jsonb)) a
              where coalesce(a->>'status', 'not_started') <> 'complete'
            ) then 'complete'
            when exists (
              select 1 from jsonb_array_elements(coalesce(launch_milestone->'actions', '[]'::jsonb)) a
              where a->>'status' = 'blocked'
            ) then 'blocked'
            when exists (
              select 1 from jsonb_array_elements(coalesce(launch_milestone->'actions', '[]'::jsonb)) a
              where a->>'status' in ('in_progress','review','complete')
            ) then 'in_progress'
            else 'not_started'
          end,
          4, milestone_position,
          coalesce(launch_milestone->>'id', 'song-room-milestone-' || milestone_position::text),
          coalesce(state_row.updated_at, now()), now()
        )
        on conflict (initiative_id, legacy_key) do update set
          title = excluded.title,
          outcome_statement = excluded.outcome_statement,
          status = excluded.status,
          workstream_id = excluded.workstream_id,
          position = excluded.position,
          updated_at = now()
        returning id into milestone_id;

        action_position := 0;
        for launch_action in
          select value from jsonb_array_elements(coalesce(launch_milestone->'actions', '[]'::jsonb))
        loop
          action_position := action_position + 1;
          insert into public.tasks (
            user_id, initiative_id, milestone_id, title, category, points,
            is_today, is_complete, week_number, completed_at, notes, status,
            priority, estimated_minutes, energy_required, work_type, due_on,
            preferred_time, position, legacy_id, created_at, updated_at
          ) values (
            state_row.user_id, song_room_initiative_id, milestone_id,
            coalesce(nullif(trim(launch_action->>'title'), ''), 'Untitled launch action'),
            'build',
            case launch_action->>'priority' when 'critical' then 5 when 'important' then 3 else 1 end,
            false,
            coalesce(launch_action->>'status', 'not_started') = 'complete',
            1,
            case when launch_action->>'status' = 'complete' then coalesce(state_row.updated_at, now()) else null end,
            nullif(trim(launch_action->>'notes'), ''),
            case launch_action->>'status'
              when 'complete' then 'complete'::public.task_status
              when 'in_progress' then 'in_progress'::public.task_status
              when 'blocked' then 'blocked'::public.task_status
              when 'review' then 'waiting'::public.task_status
              else 'ready'::public.task_status
            end,
            case launch_action->>'priority' when 'critical' then 5 when 'important' then 4 else 3 end,
            case launch_action->>'priority' when 'critical' then 60 when 'important' then 45 else 30 end,
            'standard',
            case
              when lower(coalesce(launch_action->>'title', '')) like any (array['%email%','%contact%','%invite%','%outreach%']) then 'communication'::public.task_work_type
              when lower(coalesce(launch_action->>'title', '')) like any (array['%create%','%write%','%draft%','%design%']) then 'creative'::public.task_work_type
              else 'deep_work'::public.task_work_type
            end,
            case when nullif(launch_action->>'dueDate', '') is not null then (launch_action->>'dueDate')::date else null end,
            'any', action_position,
            'song-room-action:' || coalesce(launch_action->>'id', milestone_position::text || ':' || action_position::text),
            coalesce(state_row.updated_at, now()), now()
          )
          on conflict (user_id, legacy_id) where legacy_id is not null do update set
            initiative_id = excluded.initiative_id,
            milestone_id = excluded.milestone_id,
            title = excluded.title,
            points = excluded.points,
            is_complete = excluded.is_complete,
            completed_at = excluded.completed_at,
            notes = excluded.notes,
            status = excluded.status,
            priority = excluded.priority,
            estimated_minutes = excluded.estimated_minutes,
            due_on = excluded.due_on,
            position = excluded.position,
            updated_at = now()
          returning id into migrated_task_id;

          if nullif(trim(launch_action->>'link'), '') is not null then
            insert into public.task_links (user_id, task_id, label, url, position)
            select state_row.user_id, migrated_task_id, 'Open', trim(launch_action->>'link'), 1
            where not exists (
              select 1 from public.task_links existing
              where existing.task_id = migrated_task_id
                and existing.url = trim(launch_action->>'link')
            );
          end if;
        end loop;
      end loop;
    end if;

    source_task_count := jsonb_array_length(coalesce(source_state->'tasks', '[]'::jsonb));
    select count(*) into migrated_task_count
    from public.tasks
    where user_id = state_row.user_id
      and legacy_id is not null
      and legacy_id not like 'song-room-action:%';

    source_idea_count := jsonb_array_length(coalesce(source_state->'ideas', '[]'::jsonb));
    select count(*) into migrated_idea_count
    from public.ideas_v1
    where user_id = state_row.user_id;

    source_launch_action_count := 0;
    if launch_state is not null and jsonb_typeof(launch_state) = 'object' then
      select coalesce(sum(jsonb_array_length(coalesce(m->'actions', '[]'::jsonb))), 0)::integer
      into source_launch_action_count
      from jsonb_array_elements(coalesce(launch_state->'milestones', '[]'::jsonb)) m;
    end if;

    select count(*) into migrated_launch_action_count
    from public.tasks
    where user_id = state_row.user_id
      and legacy_id like 'song-room-action:%';

    if migrated_task_count >= source_task_count
       and migrated_idea_count >= source_idea_count
       and migrated_launch_action_count >= source_launch_action_count then
      update public.migration_status set
        status = 'verified', verified_at = now(), error_message = null, updated_at = now()
      where user_id = state_row.user_id;
    else
      update public.migration_status set
        status = 'failed',
        error_message = format(
          'Verification mismatch: tasks %s/%s, ideas %s/%s, launch actions %s/%s',
          migrated_task_count, source_task_count,
          migrated_idea_count, source_idea_count,
          migrated_launch_action_count, source_launch_action_count
        ),
        updated_at = now()
      where user_id = state_row.user_id;
      raise exception 'Command Centre migration verification failed for user %', state_row.user_id;
    end if;
  end loop;
end;
$$;

create or replace view public.command_centre_migration_verification as
select
  ms.user_id,
  ms.status,
  ms.migrated_at,
  ms.verified_at,
  jsonb_array_length(coalesce(ms.source_backup->'tasks', '[]'::jsonb)) as source_tasks,
  count(distinct t.id) filter (where t.legacy_id is not null and t.legacy_id not like 'song-room-action:%') as relational_tasks,
  jsonb_array_length(coalesce(ms.source_backup->'ideas', '[]'::jsonb)) as source_ideas,
  count(distinct i.id) as relational_ideas,
  ms.error_message
from public.migration_status ms
left join public.tasks t on t.user_id = ms.user_id
left join public.ideas_v1 i on i.user_id = ms.user_id
group by ms.user_id, ms.status, ms.migrated_at, ms.verified_at, ms.source_backup, ms.error_message;

revoke all on public.command_centre_migration_verification from anon;
grant select on public.command_centre_migration_verification to authenticated;
