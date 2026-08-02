import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TaskLink = {
  id?: number | string;
  label?: string;
  url?: string;
};

type CommandCentreTask = {
  id: number | string;
  title: string;
  category: "cash" | "build" | "health" | "life";
  points?: number;
  done?: boolean;
  today?: boolean;
  week?: number;
  notes?: string;
  links?: TaskLink[];
};

const allowedOrigin = Deno.env.get("PLANNER_ALLOWED_ORIGIN") ?? "https://corisleachman.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function estimatedMinutes(points = 1) {
  if (points >= 5) return 90;
  if (points >= 3) return 60;
  return 30;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expectedToken = Deno.env.get("PLANNER_ACCESS_TOKEN");
  const plannerUserId = Deno.env.get("PLANNER_USER_ID");
  const suppliedToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!expectedToken || !plannerUserId) {
    return json({ error: "Planner endpoint is not configured" }, 503);
  }

  if (!suppliedToken || suppliedToken !== expectedToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase environment is incomplete" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("command_centre_state")
    .select("state, updated_at")
    .eq("user_id", plannerUserId)
    .maybeSingle();

  if (error) {
    console.error("planner-tasks query failed", error);
    return json({ error: "Unable to load command centre tasks" }, 500);
  }

  const state = (data?.state ?? {}) as {
    tasks?: CommandCentreTask[];
    ideas?: string[];
  };

  const tasks = (state.tasks ?? [])
    .filter((task) => task && typeof task.title === "string")
    .map((task) => ({
      id: task.id,
      title: task.title.trim(),
      category: task.category,
      priority: task.points && task.points >= 5 ? "high" : task.points && task.points >= 3 ? "medium" : "normal",
      points: task.points ?? 1,
      status: task.done ? "complete" : task.today ? "today" : "next",
      is_complete: Boolean(task.done),
      is_today: Boolean(task.today),
      week_number: task.week ?? 1,
      estimated_minutes: estimatedMinutes(task.points),
      notes: task.notes?.trim() || null,
      links: (task.links ?? [])
        .filter((link) => link?.url)
        .map((link) => ({ label: link.label?.trim() || "Open", url: link.url })),
    }));

  return json({
    generated_at: new Date().toISOString(),
    source_updated_at: data?.updated_at ?? null,
    active_tasks: tasks.filter((task) => !task.is_complete),
    completed_tasks: tasks.filter((task) => task.is_complete),
    ideas: state.ideas ?? [],
  });
});
