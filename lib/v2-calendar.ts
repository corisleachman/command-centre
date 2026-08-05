import type { SupabaseClient } from "@supabase/supabase-js";

export type CalendarConnectionStatus = {
  google_account_email: string | null;
  selected_calendar_id: string | null;
  selected_calendar_name: string | null;
  granted_scopes: string[];
  status: "disconnected" | "connected" | "error" | "revoked";
  last_sync_at: string | null;
  last_error: string | null;
};

export type GoogleCalendarOption = { id: string; name: string; primary: boolean; accessRole: string };
export type GoogleCalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; status: string };

export async function loadCalendarStatus(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("google_calendar_connection_status").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as CalendarConnectionStatus | null;
}

export async function callCalendar<T>(client: SupabaseClient, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await client.functions.invoke("calendar-api", { body: { action, ...payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function localDateInput(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function combineLocalDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}
