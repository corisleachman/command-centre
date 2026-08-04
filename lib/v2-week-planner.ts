import type { SupabaseClient } from "@supabase/supabase-js";
import type { V2Task } from "./v2-data";

export function startOfWeek(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

export function weekDays(date = new Date()) {
  const start = startOfWeek(date);
  return Array.from({ length: 5 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return value;
  });
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function tasksForDay(tasks: V2Task[], day: Date) {
  const key = dateKey(day);
  return tasks.filter(task => task.dueOn === key && task.status !== "complete" && task.status !== "cancelled");
}

export async function assignTaskToDay(client: SupabaseClient, userId: string, taskId: string, day: Date | null) {
  const { error } = await client.from("tasks").update({
    due_on: day ? dateKey(day) : null,
    updated_at: new Date().toISOString()
  }).eq("id", taskId).eq("user_id", userId);
  if (error) throw error;
}
