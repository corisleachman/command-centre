-- Position values are generated from Date.now() for stable append ordering.
-- PostgreSQL integer is too small for millisecond timestamps, so widen these columns safely.

alter table if exists public.tasks
  alter column position type bigint using position::bigint;

alter table if exists public.initiatives
  alter column position type bigint using position::bigint;

alter table if exists public.workstreams
  alter column position type bigint using position::bigint;

alter table if exists public.milestones
  alter column position type bigint using position::bigint;

alter table if exists public.task_links
  alter column position type bigint using position::bigint;
