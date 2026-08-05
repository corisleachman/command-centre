import type { SupabaseClient } from "@supabase/supabase-js";

export type CalendarRoutine = {
  id: string;
  title: string;
  category: string;
  daysOfWeek: number[];
  preferredStart: string;
  preferredEnd: string;
  minimumMinutes: number;
  idealMinutes: number;
  priority: number;
  canSplit: boolean;
  isActive: boolean;
};

export const defaultRevenueRoutine = {
  title: "Revenue generation",
  category: "income",
  days_of_week: [1, 2, 3, 4, 5],
  preferred_start: "09:00",
  preferred_end: "12:00",
  minimum_minutes: 60,
  ideal_minutes: 90,
  priority: 1,
  can_split: true,
  is_active: true,
};

export async function loadCalendarRoutines(client: SupabaseClient, userId: string): Promise<CalendarRoutine[]> {
  const { data, error } = await client.from("calendar_routines").select("*").eq("user_id", userId).order("priority").order("created_at");
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id,
    title: row.title,
    category: row.category,
    daysOfWeek: row.days_of_week ?? [],
    preferredStart: String(row.preferred_start).slice(0, 5),
    preferredEnd: String(row.preferred_end).slice(0, 5),
    minimumMinutes: row.minimum_minutes,
    idealMinutes: row.ideal_minutes,
    priority: row.priority,
    canSplit: row.can_split,
    isActive: row.is_active,
  }));
}

export async function ensureDefaultRevenueRoutine(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("calendar_routines").select("id").eq("user_id", userId).ilike("title", "Revenue generation").maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;
  const { data: inserted, error: insertError } = await client.from("calendar_routines").insert({ user_id: userId, ...defaultRevenueRoutine }).select("id").single();
  if (insertError) throw insertError;
  return inserted.id as string;
}
