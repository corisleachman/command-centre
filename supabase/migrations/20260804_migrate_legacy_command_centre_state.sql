-- Historical migration marker.
--
-- The legacy Command Centre JSON migration was applied to the remote database
-- as version 20260804 by the original staged deployment workflow.
-- The migration's data changes are already present and verified remotely.
-- This file keeps local migration history aligned with Supabase so future
-- migrations can be deployed normally without repairing or replaying history.

select 1;
