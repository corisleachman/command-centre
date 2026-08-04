-- Backfill the Song Room roadmap if it was saved after the original relational migration.
-- Safe to rerun: all initiative, workstream, milestone and task writes are idempotent.

do $$
declare
  v_state record;
  v_launch jsonb;
  v_milestone jsonb;
  v_action jsonb;
  v_initiative_id uuid;
  v_workstream_id uuid;
  v_milestone_id uuid;
  v_task_id uuid;
  v_milestone_position integer;
  v_action_position integer;
begin
  for v_state in
    select user_id, state, updated_at
    from public.command_centre_state
    where state ? 'songRoomLaunch'
  loop
    v_launch := v_state.state->'songRoomLaunch';
    if v_launch is null or jsonb_typeof(v_launch) <> 'object' then
      continue;
    end if;

    insert into public.initiatives (
      user_id, title, purpose, desired_outcome, status, priority,
      target_date, position, legacy_key, created_at, updated_at
    ) values (
      v_state.user_id,
      'The Song Room launch',
      'Prepare, validate and launch The Song Room through a structured execution roadmap.',
      'Launch a properly tested, marketed and measurable product and validate willingness to pay.',
      'active',
      5,
      case when nullif(v_launch->>'targetDate', '') is not null then (v_launch->>'targetDate')::date else null end,
      1,
      'song-room-launch',
      coalesce(v_state.updated_at, now()),
      now()
    )
    on conflict (user_id, legacy_key) do update set
      title = excluded.title,
      target_date = excluded.target_date,
      status = 'active',
      updated_at = now()
    returning id into v_initiative_id;

    v_milestone_position := 0;
    for v_milestone in
      select value from jsonb_array_elements(coalesce(v_launch->'milestones', '[]'::jsonb))
    loop
      v_milestone_position := v_milestone_position + 1;

      insert into public.workstreams (user_id, initiative_id, title, position)
      values (
        v_state.user_id,
        v_initiative_id,
        coalesce(nullif(trim(v_milestone->>'workstream'), ''), 'General'),
        v_milestone_position
      )
      on conflict (initiative_id, title) do update set
        position = least(public.workstreams.position, excluded.position),
        updated_at = now()
      returning id into v_workstream_id;

      insert into public.milestones (
        user_id, initiative_id, workstream_id, title, outcome_statement,
        status, priority, position, legacy_key, created_at, updated_at
      ) values (
        v_state.user_id,
        v_initiative_id,
        v_workstream_id,
        coalesce(nullif(trim(v_milestone->>'title'), ''), 'Untitled milestone'),
        case when nullif(trim(v_milestone->>'stage'), '') is not null then 'Stage: ' || trim(v_milestone->>'stage') else null end,
        case
          when not exists (
            select 1 from jsonb_array_elements(coalesce(v_milestone->'actions', '[]'::jsonb)) action_row
            where coalesce(action_row->>'status', 'not_started') <> 'complete'
          ) then 'complete'
          when exists (
            select 1 from jsonb_array_elements(coalesce(v_milestone->'actions', '[]'::jsonb)) action_row
            where action_row->>'status' = 'blocked'
          ) then 'blocked'
          when exists (
            select 1 from jsonb_array_elements(coalesce(v_milestone->'actions', '[]'::jsonb)) action_row
            where action_row->>'status' in ('in_progress','review','complete')
          ) then 'in_progress'
          else 'not_started'
        end,
        4,
        v_milestone_position,
        coalesce(v_milestone->>'id', 'song-room-milestone-' || v_milestone_position::text),
        coalesce(v_state.updated_at, now()),
        now()
      )
      on conflict (initiative_id, legacy_key) do update set
        workstream_id = excluded.workstream_id,
        title = excluded.title,
        outcome_statement = excluded.outcome_statement,
        status = excluded.status,
        position = excluded.position,
        updated_at = now()
      returning id into v_milestone_id;

      v_action_position := 0;
      for v_action in
        select value from jsonb_array_elements(coalesce(v_milestone->'actions', '[]'::jsonb))
      loop
        v_action_position := v_action_position + 1;

        insert into public.tasks (
          user_id, initiative_id, milestone_id, title, category, points,
          is_today, is_complete, week_number, completed_at, notes, status,
          priority, estimated_minutes, energy_required, work_type, due_on,
          preferred_time, position, legacy_id, created_at, updated_at
        ) values (
          v_state.user_id,
          v_initiative_id,
          v_milestone_id,
          coalesce(nullif(trim(v_action->>'title'), ''), 'Untitled launch action'),
          'build',
          case v_action->>'priority' when 'critical' then 5 when 'important' then 3 else 1 end,
          false,
          coalesce(v_action->>'status', 'not_started') = 'complete',
          1,
          case when v_action->>'status' = 'complete' then coalesce(v_state.updated_at, now()) else null end,
          nullif(trim(v_action->>'notes'), ''),
          case v_action->>'status'
            when 'complete' then 'complete'::public.task_status
            when 'in_progress' then 'in_progress'::public.task_status
            when 'blocked' then 'blocked'::public.task_status
            when 'review' then 'waiting'::public.task_status
            else 'ready'::public.task_status
          end,
          case v_action->>'priority' when 'critical' then 5 when 'important' then 4 else 3 end,
          case v_action->>'priority' when 'critical' then 60 when 'important' then 45 else 30 end,
          'standard',
          case
            when lower(coalesce(v_action->>'title', '')) like any (array['%email%','%contact%','%invite%','%outreach%']) then 'communication'::public.task_work_type
            when lower(coalesce(v_action->>'title', '')) like any (array['%create%','%write%','%draft%','%design%']) then 'creative'::public.task_work_type
            else 'deep_work'::public.task_work_type
          end,
          case when nullif(v_action->>'dueDate', '') is not null then (v_action->>'dueDate')::date else null end,
          'any',
          v_action_position,
          'song-room-action:' || coalesce(v_action->>'id', v_milestone_position::text || ':' || v_action_position::text),
          coalesce(v_state.updated_at, now()),
          now()
        )
        on conflict (user_id, legacy_id) where legacy_id is not null do update set
          initiative_id = excluded.initiative_id,
          milestone_id = excluded.milestone_id,
          title = excluded.title,
          is_complete = excluded.is_complete,
          completed_at = excluded.completed_at,
          notes = excluded.notes,
          status = excluded.status,
          priority = excluded.priority,
          estimated_minutes = excluded.estimated_minutes,
          due_on = excluded.due_on,
          position = excluded.position,
          updated_at = now()
        returning id into v_task_id;

        if nullif(trim(v_action->>'link'), '') is not null then
          insert into public.task_links (user_id, task_id, label, url, position)
          select v_state.user_id, v_task_id, 'Open', trim(v_action->>'link'), 1
          where not exists (
            select 1 from public.task_links existing
            where existing.task_id = v_task_id and existing.url = trim(v_action->>'link')
          );
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;
