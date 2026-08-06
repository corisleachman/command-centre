-- Historical migration marker.
--
-- The Command Centre relational execution foundation was already applied to the
-- remote database as legacy date-only version 20260803. Its schema is present.
-- This canonical marker prevents the original non-idempotent foundation SQL from
-- being replayed while aligning future migration history with 14-digit versions.

select 1;
