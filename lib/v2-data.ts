import type { SupabaseClient } from "@supabase/supabase-js";

export type V2TaskLink = { id: string; label: string; url: string };
export type V2Task = { id: string; title: string; status: string; category: string; priority: number; estimatedMinutes: number; dueOn: string | null; notes: string | null; initiativeId: string | null; milestoneId: string | null; position: number; links: V2TaskLink[] };
export type V2Milestone = { id: string; title: string; status: string; initiativeId: string; workstreamId: string | null; position: number; tasks: V2Task[] };
export type V2Workstream = { id: string; title: string; initiativeId: string; position: number; milestones: V2Milestone[] };
export type V2Initiative = { id: string; title: string; purpose: string | null; desiredOutcome: string | null; status: string; priority: number; targetDate: string | null; workstreams: V2Workstream[]; looseTasks: V2Task[] };
export type V2Workspace = { initiatives: V2Initiative[]; unassignedTasks: V2Task[]; todayTasks: V2Task[]; allTasks: V2Task[] };
export type V2TaskDraft = { title: string; category: string; priority: number; estimatedMinutes: number; dueOn?: string | null; notes?: string | null; initiativeId?: string | null; milestoneId?: string | null };
export type V2InitiativeDraft = { title: string; purpose?: string | null; desiredOutcome?: string | null; status: string; priority: number; targetDate?: string | null };

type Row = Record<string, unknown>;
const asString = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const asNullableString = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
const asNumber = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function mapTask(row: Row, links: V2TaskLink[]): V2Task {
  return { id: asString(row.id), title: asString(row.title, "Untitled task"), status: asString(row.status, "ready"), category: asString(row.category, "life"), priority: asNumber(row.priority, 3), estimatedMinutes: asNumber(row.estimated_minutes, 30), dueOn: asNullableString(row.due_on), notes: asNullableString(row.notes), initiativeId: asNullableString(row.initiative_id), milestoneId: asNullableString(row.milestone_id), position: asNumber(row.position, 0), links };
}

export async function loadV2Workspace(client: SupabaseClient, userId: string): Promise<V2Workspace> {
  const [initiativesResult, workstreamsResult, milestonesResult, tasksResult, linksResult] = await Promise.all([
    client.from("initiatives").select("id,title,purpose,desired_outcome,status,priority,target_date,position").eq("user_id", userId).order("position"),
    client.from("workstreams").select("id,title,initiative_id,position").eq("user_id", userId).order("position"),
    client.from("milestones").select("id,title,status,initiative_id,workstream_id,position").eq("user_id", userId).order("position"),
    client.from("tasks").select("id,title,status,category,priority,estimated_minutes,due_on,notes,initiative_id,milestone_id,position,is_today,is_complete").eq("user_id", userId).order("position"),
    client.from("task_links").select("id,task_id,label,url,position").eq("user_id", userId).order("position")
  ]);
  const firstError = initiativesResult.error ?? workstreamsResult.error ?? milestonesResult.error ?? tasksResult.error ?? linksResult.error;
  if (firstError) throw firstError;
  const linkRows = (linksResult.data ?? []) as Array<{ id: string; task_id: string; label: string; url: string }>;
  const tasks = (tasksResult.data ?? []).map(row => mapTask(row as Row, linkRows.filter(link => link.task_id === row.id).map(link => ({ id: link.id, label: link.label, url: link.url }))));
  const taskRows = (tasksResult.data ?? []) as Row[];
  const todayIds = new Set(taskRows.filter(row => row.is_today === true && row.is_complete !== true).map(row => asString(row.id)));
  const milestones: V2Milestone[] = (milestonesResult.data ?? []).map(row => ({ id: row.id, title: row.title, status: row.status, initiativeId: row.initiative_id, workstreamId: row.workstream_id, position: row.position, tasks: tasks.filter(task => task.milestoneId === row.id) }));
  const workstreams: V2Workstream[] = (workstreamsResult.data ?? []).map(row => ({ id: row.id, title: row.title, initiativeId: row.initiative_id, position: row.position, milestones: milestones.filter(milestone => milestone.workstreamId === row.id) }));
  const initiatives: V2Initiative[] = (initiativesResult.data ?? []).map(row => ({ id: row.id, title: row.title, purpose: row.purpose, desiredOutcome: row.desired_outcome, status: row.status, priority: row.priority, targetDate: row.target_date, workstreams: workstreams.filter(workstream => workstream.initiativeId === row.id), looseTasks: tasks.filter(task => task.initiativeId === row.id && !task.milestoneId) }));
  return { initiatives, unassignedTasks: tasks.filter(task => !task.initiativeId), todayTasks: tasks.filter(task => todayIds.has(task.id)), allTasks: tasks };
}

export async function setV2TaskComplete(client: SupabaseClient, userId: string, task: V2Task, complete: boolean) {
  const { error } = await client.from("tasks").update({ status: complete ? "complete" : "ready", is_complete: complete, is_today: complete ? false : task.status === "today", completed_at: complete ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", userId);
  if (error) throw error;
}

export async function updateV2Task(client: SupabaseClient, userId: string, taskId: string, updates: Partial<V2TaskDraft>) {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.estimatedMinutes !== undefined) payload.estimated_minutes = updates.estimatedMinutes;
  if (updates.dueOn !== undefined) payload.due_on = updates.dueOn || null;
  if (updates.notes !== undefined) payload.notes = updates.notes || null;
  if (updates.initiativeId !== undefined) payload.initiative_id = updates.initiativeId || null;
  if (updates.milestoneId !== undefined) payload.milestone_id = updates.milestoneId || null;
  const { error } = await client.from("tasks").update(payload).eq("id", taskId).eq("user_id", userId);
  if (error) throw error;
}

export async function createV2Task(client: SupabaseClient, userId: string, draft: V2TaskDraft) {
  const { error } = await client.from("tasks").insert({ user_id: userId, title: draft.title, category: draft.category, points: Math.max(1, draft.priority), status: "ready", priority: draft.priority, estimated_minutes: draft.estimatedMinutes, due_on: draft.dueOn || null, notes: draft.notes || null, initiative_id: draft.initiativeId || null, milestone_id: draft.milestoneId || null, is_today: false, is_complete: false, week_number: 1, energy_required: "standard", work_type: draft.category === "cash" ? "communication" : draft.category === "health" ? "health" : draft.category === "life" ? "life" : "deep_work", preferred_time: "any", position: Date.now() });
  if (error) throw error;
}

export async function addV2TaskLink(client: SupabaseClient, userId: string, taskId: string, label: string, url: string) { const { error } = await client.from("task_links").insert({ user_id: userId, task_id: taskId, label, url, position: Date.now() }); if (error) throw error; }
export async function deleteV2TaskLink(client: SupabaseClient, userId: string, linkId: string) { const { error } = await client.from("task_links").delete().eq("id", linkId).eq("user_id", userId); if (error) throw error; }

export async function createV2Initiative(client: SupabaseClient, userId: string, draft: V2InitiativeDraft): Promise<string> {
  const { data, error } = await client.from("initiatives").insert({ user_id: userId, title: draft.title, purpose: draft.purpose || null, desired_outcome: draft.desiredOutcome || null, status: draft.status, priority: draft.priority, target_date: draft.targetDate || null, position: Date.now() }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function updateV2Initiative(client: SupabaseClient, userId: string, initiativeId: string, draft: V2InitiativeDraft) {
  const { error } = await client.from("initiatives").update({ title: draft.title, purpose: draft.purpose || null, desired_outcome: draft.desiredOutcome || null, status: draft.status, priority: draft.priority, target_date: draft.targetDate || null, updated_at: new Date().toISOString() }).eq("id", initiativeId).eq("user_id", userId);
  if (error) throw error;
}

export async function createV2Workstream(client: SupabaseClient, userId: string, initiativeId: string, title: string) { const { error } = await client.from("workstreams").insert({ user_id: userId, initiative_id: initiativeId, title, position: Date.now() }); if (error) throw error; }
export async function updateV2Workstream(client: SupabaseClient, userId: string, workstreamId: string, title: string) { const { error } = await client.from("workstreams").update({ title, updated_at: new Date().toISOString() }).eq("id", workstreamId).eq("user_id", userId); if (error) throw error; }
export async function deleteV2Workstream(client: SupabaseClient, userId: string, workstreamId: string) { const { error } = await client.from("workstreams").delete().eq("id", workstreamId).eq("user_id", userId); if (error) throw error; }
export async function createV2Milestone(client: SupabaseClient, userId: string, initiativeId: string, workstreamId: string, title: string) { const { error } = await client.from("milestones").insert({ user_id: userId, initiative_id: initiativeId, workstream_id: workstreamId, title, status: "not_started", priority: 3, position: Date.now() }); if (error) throw error; }
export async function updateV2Milestone(client: SupabaseClient, userId: string, milestoneId: string, updates: { title: string; status: string }) { const { error } = await client.from("milestones").update({ title: updates.title, status: updates.status, updated_at: new Date().toISOString() }).eq("id", milestoneId).eq("user_id", userId); if (error) throw error; }
export async function deleteV2Milestone(client: SupabaseClient, userId: string, milestoneId: string) { const { error } = await client.from("milestones").delete().eq("id", milestoneId).eq("user_id", userId); if (error) throw error; }
