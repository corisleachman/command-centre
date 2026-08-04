import type { SupabaseClient } from "@supabase/supabase-js";

export type V2TaskLink = { id: string; label: string; url: string };

export type V2Task = {
  id: string;
  title: string;
  status: string;
  category: string;
  priority: number;
  estimatedMinutes: number;
  dueOn: string | null;
  notes: string | null;
  initiativeId: string | null;
  milestoneId: string | null;
  position: number;
  links: V2TaskLink[];
};

export type V2Milestone = {
  id: string;
  title: string;
  status: string;
  initiativeId: string;
  workstreamId: string | null;
  position: number;
  tasks: V2Task[];
};

export type V2Workstream = {
  id: string;
  title: string;
  initiativeId: string;
  position: number;
  milestones: V2Milestone[];
};

export type V2Initiative = {
  id: string;
  title: string;
  purpose: string | null;
  desiredOutcome: string | null;
  status: string;
  priority: number;
  targetDate: string | null;
  workstreams: V2Workstream[];
  looseTasks: V2Task[];
};

export type V2Workspace = {
  initiatives: V2Initiative[];
  unassignedTasks: V2Task[];
  todayTasks: V2Task[];
  allTasks: V2Task[];
};

type Row = Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapTask(row: Row, links: V2TaskLink[]): V2Task {
  return {
    id: asString(row.id),
    title: asString(row.title, "Untitled task"),
    status: asString(row.status, "ready"),
    category: asString(row.category, "life"),
    priority: asNumber(row.priority, 3),
    estimatedMinutes: asNumber(row.estimated_minutes, 30),
    dueOn: asNullableString(row.due_on),
    notes: asNullableString(row.notes),
    initiativeId: asNullableString(row.initiative_id),
    milestoneId: asNullableString(row.milestone_id),
    position: asNumber(row.position, 0),
    links
  };
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

  const milestones: V2Milestone[] = (milestonesResult.data ?? []).map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    initiativeId: row.initiative_id,
    workstreamId: row.workstream_id,
    position: row.position,
    tasks: tasks.filter(task => task.milestoneId === row.id)
  }));

  const workstreams: V2Workstream[] = (workstreamsResult.data ?? []).map(row => ({
    id: row.id,
    title: row.title,
    initiativeId: row.initiative_id,
    position: row.position,
    milestones: milestones.filter(milestone => milestone.workstreamId === row.id)
  }));

  const initiatives: V2Initiative[] = (initiativesResult.data ?? []).map(row => ({
    id: row.id,
    title: row.title,
    purpose: row.purpose,
    desiredOutcome: row.desired_outcome,
    status: row.status,
    priority: row.priority,
    targetDate: row.target_date,
    workstreams: workstreams.filter(workstream => workstream.initiativeId === row.id),
    looseTasks: tasks.filter(task => task.initiativeId === row.id && !task.milestoneId)
  }));

  return {
    initiatives,
    unassignedTasks: tasks.filter(task => !task.initiativeId),
    todayTasks: tasks.filter(task => todayIds.has(task.id)),
    allTasks: tasks
  };
}

export async function setV2TaskComplete(client: SupabaseClient, userId: string, task: V2Task, complete: boolean) {
  const status = complete ? "complete" : "ready";
  const { error } = await client.from("tasks").update({
    status,
    is_complete: complete,
    is_today: complete ? false : task.status === "today",
    completed_at: complete ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq("id", task.id).eq("user_id", userId);
  if (error) throw error;
}
