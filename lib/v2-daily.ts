import type { SupabaseClient } from "@supabase/supabase-js";
import type { V2Task } from "./v2-data";

export function activeTasks(tasks: V2Task[]) {
  return tasks.filter(task => task.status !== "complete" && task.status !== "cancelled");
}

export function recommendedNext(tasks: V2Task[], excludedIds: string[] = []) {
  return activeTasks(tasks)
    .filter(task => !excludedIds.includes(task.id))
    .sort((a, b) => b.priority - a.priority || (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || a.position - b.position)[0] ?? null;
}

export function completionSummary(tasks: V2Task[]) {
  const complete = tasks.filter(task => task.status === "complete");
  const minutes = complete.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  return { count: complete.length, minutes };
}

export async function setTaskState(client: SupabaseClient, userId: string, taskId: string, status: "ready" | "in_progress" | "blocked") {
  const { error } = await client.from("tasks").update({
    status,
    is_complete: false,
    completed_at: null,
    updated_at: new Date().toISOString()
  }).eq("id", taskId).eq("user_id", userId);
  if (error) throw error;
}

export async function replaceCompletedTodayTask(client: SupabaseClient, userId: string, completedTaskId: string, replacement: V2Task | null) {
  const now = new Date().toISOString();
  const { error: completeError } = await client.from("tasks").update({
    status: "complete",
    is_complete: true,
    is_today: false,
    completed_at: now,
    updated_at: now
  }).eq("id", completedTaskId).eq("user_id", userId);
  if (completeError) throw completeError;
  if (!replacement) return;
  const { error: replacementError } = await client.from("tasks").update({
    is_today: true,
    status: replacement.status === "blocked" ? "ready" : replacement.status,
    updated_at: now
  }).eq("id", replacement.id).eq("user_id", userId);
  if (replacementError) throw replacementError;
}
