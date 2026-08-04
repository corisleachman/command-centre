import type { SupabaseClient } from "@supabase/supabase-js";

export type PlannerTask = {
  id: string;
  title: string;
  category: string;
  priority: number;
  estimatedMinutes: number;
  dueOn: string | null;
  initiativeId: string | null;
  initiativeTitle: string | null;
  isToday: boolean;
  position: number;
};

export async function loadPlannerTasks(client: SupabaseClient, userId: string): Promise<PlannerTask[]> {
  const [tasksResult, initiativesResult] = await Promise.all([
    client.from("tasks").select("id,title,category,priority,estimated_minutes,due_on,initiative_id,is_today,position,status,is_complete").eq("user_id", userId).neq("status", "cancelled").eq("is_complete", false),
    client.from("initiatives").select("id,title").eq("user_id", userId)
  ]);
  const error = tasksResult.error ?? initiativesResult.error;
  if (error) throw error;
  const initiativeTitles = new Map((initiativesResult.data ?? []).map(row => [row.id, row.title]));
  return (tasksResult.data ?? []).map(row => ({
    id: row.id,
    title: row.title,
    category: row.category ?? "life",
    priority: row.priority ?? 3,
    estimatedMinutes: row.estimated_minutes ?? 30,
    dueOn: row.due_on,
    initiativeId: row.initiative_id,
    initiativeTitle: row.initiative_id ? initiativeTitles.get(row.initiative_id) ?? null : null,
    isToday: row.is_today === true,
    position: row.position ?? 0
  })).sort((a, b) => Number(b.isToday) - Number(a.isToday) || a.position - b.position || b.priority - a.priority);
}

export async function saveTodayPlan(client: SupabaseClient, userId: string, taskIds: string[]) {
  const { error: resetError } = await client.from("tasks").update({ is_today: false, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("is_today", true);
  if (resetError) throw resetError;
  for (let index = 0; index < taskIds.length; index += 1) {
    const { error } = await client.from("tasks").update({ is_today: true, position: index + 1, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", taskIds[index]);
    if (error) throw error;
  }
}
