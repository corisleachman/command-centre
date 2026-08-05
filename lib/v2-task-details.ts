import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskSubtask = { id: string; title: string; isComplete: boolean; position: number };
export type TaskEntry = { id: string; type: "blocker" | "decision" | "note"; content: string; isResolved: boolean; createdAt: string };
export type TaskActivity = { id: string; action: string; detail: string | null; createdAt: string };

export async function loadTaskDetails(client: SupabaseClient, userId: string, taskId: string) {
  const [{ data: subtasks, error: subtaskError }, { data: entries, error: entryError }, { data: activity, error: activityError }] = await Promise.all([
    client.from("task_subtasks").select("id,title,is_complete,position").eq("user_id", userId).eq("task_id", taskId).order("position"),
    client.from("task_entries").select("id,entry_type,content,is_resolved,created_at").eq("user_id", userId).eq("task_id", taskId).order("created_at", { ascending: false }),
    client.from("task_activity").select("id,action,detail,created_at").eq("user_id", userId).eq("task_id", taskId).order("created_at", { ascending: false }).limit(30)
  ]);
  if (subtaskError) throw subtaskError;
  if (entryError) throw entryError;
  if (activityError) throw activityError;
  return {
    subtasks: (subtasks ?? []).map(row => ({ id: row.id, title: row.title, isComplete: row.is_complete, position: row.position })) as TaskSubtask[],
    entries: (entries ?? []).map(row => ({ id: row.id, type: row.entry_type, content: row.content, isResolved: row.is_resolved, createdAt: row.created_at })) as TaskEntry[],
    activity: (activity ?? []).map(row => ({ id: row.id, action: row.action, detail: row.detail, createdAt: row.created_at })) as TaskActivity[]
  };
}

async function logActivity(client: SupabaseClient, userId: string, taskId: string, action: string, detail?: string) {
  const { error } = await client.from("task_activity").insert({ user_id: userId, task_id: taskId, action, detail: detail ?? null });
  if (error) throw error;
}

export async function addSubtask(client: SupabaseClient, userId: string, taskId: string, title: string, position: number) {
  const { error } = await client.from("task_subtasks").insert({ user_id: userId, task_id: taskId, title, position });
  if (error) throw error;
  await logActivity(client, userId, taskId, "Subtask added", title);
}

export async function toggleSubtask(client: SupabaseClient, userId: string, taskId: string, subtaskId: string, isComplete: boolean, title: string) {
  const { error } = await client.from("task_subtasks").update({ is_complete: isComplete, updated_at: new Date().toISOString() }).eq("id", subtaskId).eq("user_id", userId);
  if (error) throw error;
  await logActivity(client, userId, taskId, isComplete ? "Subtask completed" : "Subtask reopened", title);
}

export async function deleteSubtask(client: SupabaseClient, userId: string, taskId: string, subtaskId: string, title: string) {
  const { error } = await client.from("task_subtasks").delete().eq("id", subtaskId).eq("user_id", userId);
  if (error) throw error;
  await logActivity(client, userId, taskId, "Subtask removed", title);
}

export async function addTaskEntry(client: SupabaseClient, userId: string, taskId: string, type: TaskEntry["type"], content: string) {
  const { error } = await client.from("task_entries").insert({ user_id: userId, task_id: taskId, entry_type: type, content });
  if (error) throw error;
  await logActivity(client, userId, taskId, `${type[0].toUpperCase()}${type.slice(1)} added`, content);
}

export async function toggleEntryResolved(client: SupabaseClient, userId: string, taskId: string, entry: TaskEntry) {
  const next = !entry.isResolved;
  const { error } = await client.from("task_entries").update({ is_resolved: next, updated_at: new Date().toISOString() }).eq("id", entry.id).eq("user_id", userId);
  if (error) throw error;
  await logActivity(client, userId, taskId, next ? `${entry.type} resolved` : `${entry.type} reopened`, entry.content);
}

export async function deleteTaskEntry(client: SupabaseClient, userId: string, taskId: string, entry: TaskEntry) {
  const { error } = await client.from("task_entries").delete().eq("id", entry.id).eq("user_id", userId);
  if (error) throw error;
  await logActivity(client, userId, taskId, `${entry.type} removed`, entry.content);
}
