-- Allow authenticated users to manage only their own V2 hierarchy rows.
-- This is additive and does not alter or expose existing data.

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'initiatives',
    'workstreams',
    'milestones',
    'tasks',
    'task_links'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);

    policy_name := table_name || '_owner_insert';
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())',
        policy_name,
        table_name
      );
    end if;

    policy_name := table_name || '_owner_update';
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
        policy_name,
        table_name
      );
    end if;

    policy_name := table_name || '_owner_delete';
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())',
        policy_name,
        table_name
      );
    end if;
  end loop;
end
$$;
