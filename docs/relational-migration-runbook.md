# Command Centre relational migration runbook

## Purpose

Move the current `command_centre_state.state` JSON into the v1 relational execution model without changing the live application's read path yet.

## Safety model

- The source JSON remains untouched.
- The first migration creates only additive tables, columns, indexes and policies.
- The second migration stores the complete source JSON in `migration_status.source_backup` before inserting rows.
- Every migrated task receives a stable `legacy_id`, making reruns idempotent.
- Existing task notes and links are preserved.
- Today's selected tasks are represented in a dated `daily_plan`.
- Ideas are copied into `ideas_v1` with `not_now` status.
- The Song Room launch tracker becomes a standard initiative with workstreams, milestones and tasks.
- The migration raises an exception and rolls back if verification counts do not match.
- The web application continues reading `command_centre_state` until a later cutover PR.

## Migrations applied in order

1. `20260803_v1_execution_foundation.sql`
2. `20260803_migrate_legacy_command_centre_state.sql`

## Deployment

Use the manual GitHub Action:

1. Open **Actions**.
2. Choose **Supabase validate and deploy**.
3. Run against `main` with action `deploy` only after the migration PR is merged.

The workflow links to the configured Supabase project and runs `supabase db push`.

## Verification

After deployment, open the Supabase SQL editor and run:

```sql
select *
from public.command_centre_migration_verification;
```

Expected result:

- `status = verified`
- `source_tasks = relational_tasks`
- `source_ideas = relational_ideas`
- `error_message` is null

Additional checks:

```sql
select title, category, status, is_today, is_complete, notes, legacy_id
from public.tasks
order by created_at, position;
```

```sql
select i.title as initiative, w.title as workstream, m.title as milestone, count(t.id) as actions
from public.initiatives i
left join public.workstreams w on w.initiative_id = i.id
left join public.milestones m on m.workstream_id = w.id
left join public.tasks t on t.milestone_id = m.id
group by i.title, w.title, m.title
order by i.title, w.title, m.position;
```

```sql
select plan_date, slot, position, t.title
from public.daily_plans dp
join public.daily_plan_tasks dpt on dpt.daily_plan_id = dp.id
join public.tasks t on t.id = dpt.task_id
order by plan_date desc, position;
```

## Rollback

No rollback should be needed because the live app still reads the legacy JSON state.

If the relational rows need to be removed before cutover, use the stored backup as the source of truth and delete only rows created by this migration. Do not delete or alter `command_centre_state`.

A later cutover migration will be written only after:

- verification passes
- the relational UI has been tested on Vercel preview
- existing tasks, notes, links, ideas and Song Room progress match
- sign-in and cross-device sync work

## Next implementation step

Add a relational repository layer to the Next.js app and enable it behind a feature flag. During that phase, the app can compare legacy and relational reads before switching writes.