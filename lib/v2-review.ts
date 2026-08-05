import type { SupabaseClient } from "@supabase/supabase-js";
import type { V2Task } from "./v2-data";

export type DailyReview = {
  id?: string;
  reviewDate: string;
  morningNote: string;
  eveningNote: string;
  energy: number | null;
  wins: string;
  blockers: string;
};

export type CompletedTaskSummary = { id: string; title: string; estimatedMinutes: number };

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function unfinishedBeforeToday(tasks: V2Task[], today = localDateKey()) {
  return tasks.filter(task => task.status !== "complete" && task.status !== "cancelled" && !!task.dueOn && task.dueOn < today);
}

export async function loadCompletedToday(client: SupabaseClient, userId: string, today = localDateKey()): Promise<CompletedTaskSummary[]> {
  const start = `${today}T00:00:00.000Z`;
  const end = `${today}T23:59:59.999Z`;
  const { data, error } = await client.from("tasks").select("id,title,estimated_minutes").eq("user_id", userId).gte("completed_at", start).lte("completed_at", end).order("completed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => ({ id: row.id, title: row.title, estimatedMinutes: row.estimated_minutes ?? 0 }));
}

export async function loadDailyReview(client: SupabaseClient, userId: string, reviewDate = localDateKey()): Promise<DailyReview> {
  const { data, error } = await client.from("daily_reviews").select("id, review_date, morning_note, evening_note, energy, wins, blockers").eq("user_id", userId).eq("review_date", reviewDate).maybeSingle();
  if (error) throw error;
  return {
    id: data?.id,
    reviewDate,
    morningNote: data?.morning_note ?? "",
    eveningNote: data?.evening_note ?? "",
    energy: data?.energy ?? null,
    wins: data?.wins ?? "",
    blockers: data?.blockers ?? ""
  };
}

export async function saveDailyReview(client: SupabaseClient, userId: string, review: DailyReview) {
  const { error } = await client.from("daily_reviews").upsert({
    user_id: userId,
    review_date: review.reviewDate,
    morning_note: review.morningNote || null,
    evening_note: review.eveningNote || null,
    energy: review.energy,
    wins: review.wins || null,
    blockers: review.blockers || null,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id,review_date" });
  if (error) throw error;
}

export async function carryTaskForward(client: SupabaseClient, userId: string, taskId: string, today = localDateKey()) {
  const { error } = await client.from("tasks").update({ due_on: today, is_today: true, updated_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", userId);
  if (error) throw error;
}
