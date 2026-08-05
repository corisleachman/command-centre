import type { SupabaseClient } from "@supabase/supabase-js";

export type LifeArea = { id: string; name: string; description: string; position: number };
export type Objective = { id: string; lifeAreaId: string | null; title: string; outcomeStatement: string; status: string; priority: number; targetDate: string | null; position: number };
export type ObjectiveInitiative = { id: string; title: string; objectiveId: string | null; status: string };

export const recommendedAreas = [
  { name: "Income and career", description: "Build dependable income through the right mix of consultancy, senior roles and relationships." },
  { name: "Business and products", description: "Turn owned products and services into useful, sustainable sources of value and income." },
  { name: "Health and fitness", description: "Protect health, rebuild strength and improve body composition with realistic routines." },
  { name: "Family and finances", description: "Create financial resilience and support the family's important milestones." },
  { name: "Creative work and music", description: "Make, finish and release meaningful creative work rather than leaving it indefinitely in progress." },
] as const;

export const recommendedObjectives = [
  { area: "Income and career", title: "Build a sustainable consultancy income", outcome: "Create a repeatable consultancy proposition, pipeline and client base that generates dependable monthly income.", priority: 1 },
  { area: "Income and career", title: "Secure the right senior role or portfolio of work", outcome: "Choose and secure work that uses senior growth and marketing experience without sacrificing autonomy or long-term direction.", priority: 2 },
  { area: "Business and products", title: "Monetise The Song Room", outcome: "Launch a credible paid product, attract active musicians and prove that the product can generate recurring revenue.", priority: 1 },
  { area: "Health and fitness", title: "Improve health, strength and body composition", outcome: "Build sustainable nutrition, movement and strength habits that support CIDP recovery, energy and reduced abdominal fat.", priority: 1 },
  { area: "Family and finances", title: "Strengthen household financial security", outcome: "Reduce expensive debt, rebuild savings, improve pension provision and create clear funds for predictable family costs.", priority: 1 },
  { area: "Family and finances", title: "Support key family milestones", outcome: "Plan and provide practical and financial support for university, education and other important family transitions.", priority: 2 },
  { area: "Creative work and music", title: "Complete and release meaningful music", outcome: "Move selected songs from unfinished ideas to completed, released work with a consistent creative rhythm.", priority: 2 },
] as const;

export async function loadObjectivesWorkspace(client: SupabaseClient, userId: string) {
  const [areasResult, objectivesResult, initiativesResult] = await Promise.all([
    client.from("life_areas").select("id,name,description,position").eq("user_id", userId).order("position"),
    client.from("objectives").select("id,life_area_id,title,outcome_statement,status,priority,target_date,position").eq("user_id", userId).order("priority").order("position"),
    client.from("initiatives").select("id,title,objective_id,status").eq("user_id", userId).order("position"),
  ]);
  if (areasResult.error) throw areasResult.error;
  if (objectivesResult.error) throw objectivesResult.error;
  if (initiativesResult.error) throw initiativesResult.error;
  return {
    areas: (areasResult.data ?? []).map(row => ({ id: row.id, name: row.name, description: row.description ?? "", position: row.position ?? 0 })) as LifeArea[],
    objectives: (objectivesResult.data ?? []).map(row => ({ id: row.id, lifeAreaId: row.life_area_id, title: row.title, outcomeStatement: row.outcome_statement ?? "", status: row.status, priority: row.priority, targetDate: row.target_date, position: row.position ?? 0 })) as Objective[],
    initiatives: (initiativesResult.data ?? []).map(row => ({ id: row.id, title: row.title, objectiveId: row.objective_id, status: row.status })) as ObjectiveInitiative[],
  };
}

export async function seedRecommendedObjectives(client: SupabaseClient, userId: string) {
  const areaRows = recommendedAreas.map((area, index) => ({ user_id: userId, name: area.name, description: area.description, position: index }));
  const { error: areaError } = await client.from("life_areas").upsert(areaRows, { onConflict: "user_id,name" });
  if (areaError) throw areaError;
  const { data: areas, error: loadError } = await client.from("life_areas").select("id,name").eq("user_id", userId);
  if (loadError) throw loadError;
  const areaMap = new Map((areas ?? []).map(area => [area.name, area.id]));
  const rows = recommendedObjectives.map((objective, index) => ({ user_id: userId, life_area_id: areaMap.get(objective.area) ?? null, title: objective.title, outcome_statement: objective.outcome, priority: objective.priority, status: "active", position: index }));
  const existing = await client.from("objectives").select("title").eq("user_id", userId);
  if (existing.error) throw existing.error;
  const titles = new Set((existing.data ?? []).map(item => item.title));
  const missing = rows.filter(row => !titles.has(row.title));
  if (missing.length) {
    const { error } = await client.from("objectives").insert(missing);
    if (error) throw error;
  }
}

export async function saveObjective(client: SupabaseClient, userId: string, objective: Partial<Objective> & { title: string }) {
  const payload = {
    user_id: userId,
    life_area_id: objective.lifeAreaId || null,
    title: objective.title.trim(),
    outcome_statement: objective.outcomeStatement?.trim() || null,
    status: objective.status || "active",
    priority: objective.priority || 3,
    target_date: objective.targetDate || null,
    position: objective.position || 0,
  };
  if (objective.id) {
    const { error } = await client.from("objectives").update(payload).eq("id", objective.id).eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await client.from("objectives").insert(payload);
    if (error) throw error;
  }
}

export async function deleteObjective(client: SupabaseClient, userId: string, objectiveId: string) {
  const { error } = await client.from("objectives").delete().eq("id", objectiveId).eq("user_id", userId);
  if (error) throw error;
}

export async function assignInitiativeObjective(client: SupabaseClient, userId: string, initiativeId: string, objectiveId: string | null) {
  const { error } = await client.from("initiatives").update({ objective_id: objectiveId }).eq("id", initiativeId).eq("user_id", userId);
  if (error) throw error;
}
