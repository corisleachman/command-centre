import type { SupabaseClient } from "@supabase/supabase-js";

export type InitiativeStatus = "idea" | "planned" | "active" | "paused" | "blocked" | "complete" | "stopped";
export type TaskStatus = "backlog" | "ready" | "today" | "in_progress" | "waiting" | "blocked" | "complete" | "cancelled";

export type RelationalTask = {
  id: string;
  initiative_id: string | null;
  milestone_id: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: number;
  estimated_minutes: number;
  due_on: string | null;
  position: number;
};

export type RelationalMilestone = {
  id: string;
  initiative_id: string;
  workstream_id: string | null;
  title: string;
  outcome_statement: string | null;
  status: string;
  priority: number;
  target_date: string | null;
  position: number;
};

export type RelationalWorkstream = {
  id: string;
  initiative_id: string;
  title: string;
  description: string | null;
  position: number;
};

export type RelationalInitiative = {
  id: string;
  title: string;
  purpose: string | null;
  desired_outcome: string | null;
  status: InitiativeStatus;
  priority: number;
  target_date: string | null;
  position: number;
  workstreams: RelationalWorkstream[];
  milestones: RelationalMilestone[];
  tasks: RelationalTask[];
};

export async function loadInitiatives(client: SupabaseClient): Promise<RelationalInitiative[]> {
  const [initiativesResult, workstreamsResult, milestonesResult, tasksResult] = await Promise.all([
    client.from("initiatives").select("id,title,purpose,desired_outcome,status,priority,target_date,position").order("position"),
    client.from("workstreams").select("id,initiative_id,title,description,position").order("position"),
    client.from("milestones").select("id,initiative_id,workstream_id,title,outcome_statement,status,priority,target_date,position").order("position"),
    client.from("tasks").select("id,initiative_id,milestone_id,title,notes,status,priority,estimated_minutes,due_on,position").not("initiative_id", "is", null).order("position")
  ]);

  const errors = [initiativesResult.error, workstreamsResult.error, milestonesResult.error, tasksResult.error].filter(Boolean);
  if (errors.length) throw errors[0];

  const workstreams = (workstreamsResult.data ?? []) as RelationalWorkstream[];
  const milestones = (milestonesResult.data ?? []) as RelationalMilestone[];
  const tasks = (tasksResult.data ?? []) as RelationalTask[];

  return ((initiativesResult.data ?? []) as Omit<RelationalInitiative, "workstreams" | "milestones" | "tasks">[]).map(initiative => ({
    ...initiative,
    workstreams: workstreams.filter(item => item.initiative_id === initiative.id),
    milestones: milestones.filter(item => item.initiative_id === initiative.id),
    tasks: tasks.filter(item => item.initiative_id === initiative.id)
  }));
}

export function initiativeProgress(initiative: RelationalInitiative): number {
  if (!initiative.tasks.length) return 0;
  const complete = initiative.tasks.filter(task => task.status === "complete").length;
  return Math.round((complete / initiative.tasks.length) * 100);
}
