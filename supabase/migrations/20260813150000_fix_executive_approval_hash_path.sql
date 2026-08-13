-- pgcrypto functions are installed in Supabase's extensions schema.
-- Make that schema available to the exact-version approval function.

alter function public.approve_executive_action_item(uuid, text, jsonb)
  set search_path = public, extensions;
