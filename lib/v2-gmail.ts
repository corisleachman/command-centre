import type { SupabaseClient } from "@supabase/supabase-js";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_COMMAND_CENTRE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
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

export type GmailConversationMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  mine: boolean;
  messageId: string;
  references: string;
};

export type GmailThreadResult = {
  accountEmail: string;
  threadId: string;
  subject: string;
  messages: GmailConversationMessage[];
};

export type GmailReplySuggestion = {
  reply: string;
  source: "ai" | "rules";
  state?: string;
  reason?: string;
};

export type GmailSendResult = {
  messageId: string;
  threadId: string | null;
};

export async function callGmail<T>(client: SupabaseClient, action: string, payload: Record<string, unknown> = {}) {
  const functionName = action === "suggestReply" ? "gmail-reply-api" : "gmail-api";
  const { data, error } = await client.functions.invoke(functionName, { body: { action, ...payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}
