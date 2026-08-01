import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Runtime checks still guard environments where Supabase is not configured.
// The stable client type prevents TypeScript from losing the earlier null check
// inside delayed callbacks such as setTimeout.
export const supabase = (url && anonKey ? createClient(url, anonKey) : null) as SupabaseClient;
