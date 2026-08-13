-- Make approved task execution idempotent. A prepared action can create at
-- most one Command Centre task, even if the client retries after a timeout.

alter table public.tasks
  add column if not exists executive_action_item_id uuid
  references public.action_items(id) on delete set null;

create unique index if not exists tasks_executive_action_item_id_key
  on public.tasks(executive_action_item_id);
