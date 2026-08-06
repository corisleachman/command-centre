# Supabase migration recovery

The production migration ledger previously contained date-only versions (`20260803` through `20260807`). Those files have now been represented locally by canonical 14-digit versions.

The recovery deployment must run `supabase db push --include-all` once because the canonical versions sort before newer migrations already recorded remotely. After that deployment succeeds, remove `--include-all` and the legacy `migration repair` step so normal deployments return to pending-only `supabase db push`.
