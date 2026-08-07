import type { SupabaseClient } from "@supabase/supabase-js";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_COMMAND_CENTRE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  GMAIL_READONLY_SCOPE,
];

export type GmailActionMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  unread: boolean;
  important: boolean;
  score: number;
  reasons: string[];
  suggestedTaskTitle: string;
  gmailUrl: string;
};

export type GmailInboxResult = {
  accountEmail: string;
  messages: GmailActionMessage[];
};

export async function callGmail<T>(client: SupabaseClient, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await client.functions.invoke("gmail-api", { body: { action, ...payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}
