import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type ExecutiveSourceMessage } from "../_shared/executive-policy.ts";
import { assessConversationWithIntelligence } from "../_shared/executive-intelligence.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const TOKEN_KEY = Deno.env.get("CALENDAR_TOKEN_ENCRYPTION_KEY")!;
const POLICY_VERSION = "revenue-ea-v4";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function b64ToBytes(value: string) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }

async function cryptoKey() {
  const raw = b64ToBytes(TOKEN_KEY);
  if (raw.byteLength !== 32) throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

async function decrypt(value: string) {
  const [ivPart, encryptedPart] = value.split(".");
  if (!ivPart || !encryptedPart) throw new Error("Stored Google token is invalid.");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivPart) }, await cryptoKey(), b64ToBytes(encryptedPart));
  return new TextDecoder().decode(decrypted);
}

async function gmailFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Gmail request failed (${response.status}): ${await response.text()}`);
  return response.json();
}

function header(message: any, name: string) {
  return message.payload?.headers?.find((item: any) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(value: string) {
  if (!value) return "";
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return ""; }
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function bodyText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
    for (const part of payload.parts) { const nested = bodyText(part); if (nested) return nested; }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) return stripHtml(decodeBase64Url(payload.body.data));
  return "";
}

function trimQuoted(value: string) {
  const kept: string[] = [];
  for (const line of value.replace(/\r/g, "").split("\n")) {
    const clean = line.trim();
    if (/^On .+wrote:$/i.test(clean) || /^-{2,}\s*(Original Message|Forwarded message)/i.test(clean) || /^>/.test(clean)) break;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function accessToken(admin: ReturnType<typeof createClient>, userId: string, requiredScopes = [GMAIL_READONLY_SCOPE]) {
  const { data: connection, error } = await admin.from("google_calendar_connections").select("encrypted_refresh_token,granted_scopes").eq("user_id", userId).single();
  if (error || !connection?.encrypted_refresh_token) throw new Error("Google account is not connected.");
  const granted = connection.granted_scopes ?? [];
  const missing = requiredScopes.filter(scope => !granted.includes(scope));
  if (missing.length) {
    const permission = missing.includes(DRIVE_FILE_SCOPE)
      ? "Google Drive file creation"
      : missing.includes(CALENDAR_EVENTS_SCOPE)
        ? "Google Calendar invitation"
        : missing.includes(GMAIL_SEND_SCOPE)
          ? "Gmail sending"
          : "Gmail reading";
    throw new Error(`${permission} permission is not connected. Reconnect Google from the Gmail page and approve the requested permission.`);
  }
  const refreshToken = await decrypt(connection.encrypted_refresh_token);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error(`Unable to refresh Google access: ${await response.text()}`);
  return (await response.json()).access_token as string;
}

async function loadThread(threadId: string, token: string): Promise<ExecutiveSourceMessage[]> {
  const [thread, profile] = await Promise.all([
    gmailFetch(`/users/me/threads/${encodeURIComponent(threadId)}?format=full`, token),
    gmailFetch("/users/me/profile", token),
  ]);
  const ownEmail = String(profile.emailAddress || "").toLowerCase();
  return (thread.messages ?? []).map((message: any) => {
    const from = header(message, "From");
    const listUnsubscribe = header(message, "List-Unsubscribe");
    const listId = header(message, "List-ID");
    const precedence = header(message, "Precedence").toLowerCase();
    const autoSubmitted = header(message, "Auto-Submitted").toLowerCase();
    const gmailLabels = Array.isArray(message.labelIds) ? message.labelIds.map(String) : [];
    return {
      id: String(message.id || ""),
      threadId: String(message.threadId || threadId),
      from,
      to: header(message, "To"),
      subject: header(message, "Subject") || "No subject",
      body: trimQuoted(bodyText(message.payload) || message.snippet || ""),
      date: header(message, "Date"),
      internalDate: Number(message.internalDate || Date.parse(header(message, "Date")) || Date.now()),
      mine: gmailLabels.includes("SENT") || from.toLowerCase().includes(ownEmail),
      automated: Boolean(listUnsubscribe || listId)
        || /bulk|list|junk/.test(precedence)
        || Boolean(autoSubmitted && autoSubmitted !== "no")
        || gmailLabels.includes("CATEGORY_PROMOTIONS"),
      gmailLabels,
    };
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function hashContent(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function explainGoogleDocumentFailure(status: number, detail: string) {
  if (/accessNotConfigured|SERVICE_DISABLED|API has not been used|is disabled/i.test(detail)) {
    return "Google Drive or Google Docs isn't enabled for the Google Cloud project connected to Command Centre. Enable both APIs, then retry document creation.";
  }
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficient Permission/i.test(detail)) {
    return "Google Drive permission is incomplete. Reconnect Google from the Gmail page, approve the requested Drive permission, then retry document creation.";
  }
  if (/invalid_grant|Token has been expired or revoked/i.test(detail)) {
    return "The Google connection has expired or been revoked. Reconnect Google from the Gmail page, then retry document creation.";
  }
  return `Google document creation failed (${status}). ${detail}`;
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodedSubject(subject: string) {
  const bytes = new TextEncoder().encode(subject);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function readableDocumentText(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function approvedContent(item: any, approval: any) {
  const content = item.content && typeof item.content === "object" ? { ...item.content } : {};
  const amendments = approval?.amendments && typeof approval.amendments === "object" ? approval.amendments : {};
  if (!Object.prototype.hasOwnProperty.call(amendments, "prepared_text")) return content;
  const preparedText = textValue(amendments.prepared_text);
  if (item.action_type === "reply_draft") content.body = preparedText;
  else if (item.action_type === "document_draft" || item.action_type === "meeting_brief") content.markdown = preparedText;
  else content.text = preparedText;
  return content;
}

async function sendApprovedEmail(accessTokenValue: string, content: Record<string, unknown>, threadId: string | null, actionItemId: string) {
  const to = stringValue(content.to).replace(/[\r\n]+/g, "");
  let subject = stringValue(content.subject);
  const body = textValue(content.body);
  if (!to || !subject || !body.trim()) throw new Error("The approved email is missing its recipient, subject or body.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("The approved email recipient is invalid.");

  const replyHeaders: string[] = [];
  if (threadId) {
    const thread = await gmailFetch(`/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`, accessTokenValue);
    const last = thread.messages?.[thread.messages.length - 1];
    const messageId = last ? header(last, "Message-ID") : "";
    const references = [last ? header(last, "References") : "", messageId].filter(Boolean).join(" ").trim();
    if (!/^re:/i.test(subject)) subject = `Re: ${subject.replace(/^re:\s*/i, "")}`;
    if (messageId) replyHeaders.push(`In-Reply-To: ${messageId}`);
    if (references) replyHeaders.push(`References: ${references}`);
  }

  const raw = [
    `To: ${to}`,
    `Subject: ${encodedSubject(subject)}`,
    `X-Command-Centre-Action-ID: ${actionItemId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    ...replyHeaders,
    "",
    body,
  ].join("\r\n");
  const sent = await gmailFetch("/users/me/messages/send", accessTokenValue, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeBase64Url(raw), ...(threadId ? { threadId } : {}) }),
  });
  return { reference: `gmail:${sent.id}`, message: `Email sent to ${to}.` };
}

async function createApprovedDocument(accessTokenValue: string, content: Record<string, unknown>, actionItemId: string) {
  const title = stringValue(content.title) || "Command Centre prepared document";
  const body = readableDocumentText(stringValue(content.markdown) || stringValue(content.text) || stringValue(content.body));
  if (!body) throw new Error("The approved document has no content.");

  const createResponse = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessTokenValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.document",
      appProperties: { commandCentreActionItemId: actionItemId },
    }),
  });
  if (!createResponse.ok) throw new Error(explainGoogleDocumentFailure(createResponse.status, await createResponse.text()));
  const file = await createResponse.json();

  const writeResponse = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessTokenValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: body } }] }),
  });
  if (!writeResponse.ok) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessTokenValue}` } });
    throw new Error(explainGoogleDocumentFailure(writeResponse.status, await writeResponse.text()));
  }
  const reference = stringValue(file.webViewLink) || `https://docs.google.com/document/d/${file.id}/edit`;
  return { reference, message: `Private Google Doc created: ${title}.` };
}

async function createApprovedTask(admin: ReturnType<typeof createClient>, userId: string, content: Record<string, unknown>, actionItemId: string, sourceUrl: string | null) {
  const title = stringValue(content.title);
  if (!title) throw new Error("The approved task has no title.");
  const proposedCategory = stringValue(content.category);
  const category = ["cash", "build", "health", "life"].includes(proposedCategory) ? proposedCategory : "cash";
  const proposedPriority = Number(content.priority);
  const priority = Number.isFinite(proposedPriority) ? Math.min(Math.max(Math.round(proposedPriority), 1), 5) : 3;
  const proposedMinutes = Number(content.estimated_minutes);
  const estimatedMinutes = Number.isFinite(proposedMinutes) ? Math.max(Math.round(proposedMinutes), 5) : 30;
  const proposedDueOn = stringValue(content.due_on);
  const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(proposedDueOn) ? proposedDueOn : null;
  const notes = [stringValue(content.description), sourceUrl ? `Source: ${sourceUrl}` : ""].filter(Boolean).join("\n\n") || null;
  const { data: task, error } = await admin.from("tasks").upsert({
    user_id: userId,
    executive_action_item_id: actionItemId,
    title,
    category,
    points: priority,
    status: "ready",
    priority,
    estimated_minutes: estimatedMinutes,
    due_on: dueOn,
    notes,
    is_today: false,
    is_complete: false,
    week_number: 1,
    energy_required: "standard",
    work_type: category === "cash" ? "communication" : category === "health" ? "health" : category === "life" ? "life" : "deep_work",
    preferred_time: "any",
    position: Date.now(),
  }, { onConflict: "executive_action_item_id" }).select("id").single();
  if (error) throw error;
  return { reference: `task:${task.id}`, message: `Task created: ${title}.` };
}

async function selectedCalendarId(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("google_calendar_connections")
    .select("selected_calendar_id")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return stringValue(data?.selected_calendar_id) || "primary";
}

async function calendarFetch(calendarId: string, path: string, accessTokenValue: string, init: RequestInit = {}) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessTokenValue}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = await response.text();
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficient Permission/i.test(detail)) {
      throw new Error("Google Calendar permission is incomplete. Reconnect Google from the Gmail page, approve Calendar access, then retry the invitation.");
    }
    if (/invalid_grant|Token has been expired or revoked/i.test(detail)) {
      throw new Error("The Google connection has expired or been revoked. Reconnect Google from the Gmail page, then retry the invitation.");
    }
    throw new Error(`Google Calendar request failed (${response.status}): ${detail}`);
  }
  return response.json();
}

function calendarMoment(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function createApprovedCalendarInvite(
  admin: ReturnType<typeof createClient>,
  userId: string,
  accessTokenValue: string,
  content: Record<string, unknown>,
  actionItemId: string,
  sourceUrl: string | null,
) {
  const eventTitle = stringValue(content.event_title) || stringValue(content.title) || "Meeting";
  const attendeeEmail = stringValue(content.attendee_email).toLowerCase();
  const attendeeName = stringValue(content.attendee_name);
  const startsAt = stringValue(content.starts_at);
  const endsAt = stringValue(content.ends_at);
  const timezone = stringValue(content.timezone) || "Europe/London";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendeeEmail)) throw new Error("The approved invitation has an invalid attendee email address.");
  const startTime = Date.parse(startsAt);
  const endTime = Date.parse(endsAt);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) throw new Error("The approved invitation has an invalid start or end time.");
  if (startTime <= Date.now()) throw new Error("The approved meeting time is now in the past. Review the conversation and prepare a new time before creating the invitation.");

  const calendarId = await selectedCalendarId(admin, userId);
  const privateProperty = encodeURIComponent(`commandCentreActionItemId=${actionItemId}`);
  const existing = await calendarFetch(calendarId, `/events?privateExtendedProperty=${privateProperty}&showDeleted=false&maxResults=1`, accessTokenValue);
  const existingEvent = existing.items?.[0];
  if (existingEvent) {
    const reference = stringValue(existingEvent.htmlLink) || `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(existingEvent.id || "")}`;
    return { reference, message: `This diary invitation had already been created for ${attendeeEmail}. No duplicate was sent.` };
  }

  const conflicts = await calendarFetch(
    calendarId,
    `/events?singleEvents=true&showDeleted=false&orderBy=startTime&maxResults=10&timeMin=${encodeURIComponent(new Date(startTime).toISOString())}&timeMax=${encodeURIComponent(new Date(endTime).toISOString())}`,
    accessTokenValue,
  );
  const blocking = (conflicts.items ?? []).find((event: any) => event.status !== "cancelled" && event.transparency !== "transparent");
  if (blocking) {
    const conflictTitle = stringValue(blocking.summary) || "another diary event";
    throw new Error(`Diary conflict: ${conflictTitle} overlaps ${calendarMoment(startsAt, timezone)}. Nothing was created or sent. Review the time before trying again.`);
  }

  const created = await calendarFetch(calendarId, "/events?sendUpdates=all", accessTokenValue, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: eventTitle,
      description: [stringValue(content.description), sourceUrl ? `Source conversation: ${sourceUrl}` : ""].filter(Boolean).join("\n\n"),
      start: { dateTime: startsAt, timeZone: timezone },
      end: { dateTime: endsAt, timeZone: timezone },
      attendees: [{ email: attendeeEmail, ...(attendeeName ? { displayName: attendeeName } : {}) }],
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      extendedProperties: { private: { commandCentreActionItemId: actionItemId } },
    }),
  });
  const reference = stringValue(created.htmlLink) || `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(created.id || "")}`;
  return {
    reference,
    message: `Diary invitation created for ${attendeeName || attendeeEmail} on ${calendarMoment(startsAt, timezone)}. Google Calendar sent the invitation.`,
  };
}

async function settlePackStatus(admin: ReturnType<typeof createClient>, userId: string, packId: string) {
  const { data: items, error } = await admin.from("action_items").select("approval_required,approval_status,execution_status").eq("user_id", userId).eq("action_pack_id", packId);
  if (error) throw error;
  const failed = (items ?? []).some(item => item.execution_status === "failed");
  const pending = (items ?? []).some(item => item.approval_required && item.approval_status === "pending");
  const status = failed ? "failed" : pending ? "ready_for_review" : "approved";
  const { error: packError } = await admin.from("action_packs").update({ status, updated_at: new Date().toISOString() }).eq("id", packId).eq("user_id", userId).in("status", ["ready_for_review", "approved", "executing", "failed"]);
  if (packError) throw packError;
}

async function executeApprovedAction(admin: ReturnType<typeof createClient>, userId: string, actionItemId: string) {
  const { data: item, error: itemError } = await admin.from("action_items").select("id,action_pack_id,action_type,content,approval_status,execution_status,external_result_reference").eq("id", actionItemId).eq("user_id", userId).maybeSingle();
  if (itemError) throw itemError;
  if (!item) throw new Error("Prepared action not found.");
  if (item.approval_status !== "approved") throw new Error("Approve the exact version before executing it.");
  if (item.execution_status === "completed") {
    return { status: "completed" as const, actionType: item.action_type, externalReference: item.external_result_reference, message: "This approved action has already been completed." };
  }
  if (!["reply_draft", "document_draft", "calendar_proposal", "task_create"].includes(item.action_type)) throw new Error("This action is approval-only in the current release.");

  const [{ data: pack, error: packError }, { data: approval, error: approvalError }] = await Promise.all([
    admin.from("action_packs").select("id,event_id,status,source_url").eq("id", item.action_pack_id).eq("user_id", userId).maybeSingle(),
    admin.from("action_approvals").select("amendments,approved_content_hash,decided_at").eq("action_item_id", item.id).eq("user_id", userId).order("decided_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (packError) throw packError;
  if (approvalError) throw approvalError;
  if (!pack || !["ready_for_review", "approved", "executing", "failed"].includes(pack.status)) throw new Error("This action pack is no longer executable.");
  if (!approval) throw new Error("The immutable approval record is missing.");

  console.info("[executive-agent] approved execution starting", { userId, actionItemId, actionType: item.action_type });

  let googleToken: string | null = null;
  try {
    if (item.action_type === "reply_draft") googleToken = await accessToken(admin, userId, [GMAIL_SEND_SCOPE]);
    if (item.action_type === "document_draft") googleToken = await accessToken(admin, userId, [DRIVE_FILE_SCOPE]);
    if (item.action_type === "calendar_proposal") googleToken = await accessToken(admin, userId, [CALENDAR_EVENTS_SCOPE]);
  } catch (error) {
    console.error("[executive-agent] approved execution preflight failed", { userId, actionItemId, actionType: item.action_type, detail: error instanceof Error ? error.message : "Google connection preflight failed." });
    throw error;
  }

  const { data: claimed, error: claimError } = await admin.from("action_items").update({ execution_status: "executing", last_error: null, updated_at: new Date().toISOString() }).eq("id", item.id).eq("user_id", userId).in("execution_status", ["not_started", "failed"]).select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new Error("This approved action is already being executed. Reload before trying again.");

  const content = approvedContent(item, approval);
  let externalReference: string | null = null;
  try {
    let result: { reference: string; message: string };
    if (item.action_type === "reply_draft") {
      const { data: event, error: eventError } = await admin.from("executive_events").select("entity_type,entity_id").eq("id", pack.event_id).eq("user_id", userId).maybeSingle();
      if (eventError) throw eventError;
      const threadId = event?.entity_type === "gmail_thread" ? event.entity_id : null;
      result = await sendApprovedEmail(googleToken!, content, threadId, item.id);
    } else if (item.action_type === "document_draft") {
      result = await createApprovedDocument(googleToken!, content, item.id);
    } else if (item.action_type === "calendar_proposal") {
      result = await createApprovedCalendarInvite(admin, userId, googleToken!, content, item.id, pack.source_url);
    } else {
      result = await createApprovedTask(admin, userId, content, item.id, pack.source_url);
    }
    externalReference = result.reference;
    const { error: completionError } = await admin.from("action_items").update({ execution_status: "completed", executed_at: new Date().toISOString(), external_result_reference: externalReference, last_error: null, updated_at: new Date().toISOString() }).eq("id", item.id).eq("user_id", userId).eq("execution_status", "executing");
    if (completionError) throw completionError;
    await settlePackStatus(admin, userId, pack.id);
    console.info("[executive-agent] approved execution completed", { userId, actionItemId, actionType: item.action_type, externalReference });
    return { status: "completed" as const, actionType: item.action_type, externalReference, message: result.message };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Approved action execution failed.";
    console.error("[executive-agent] approved execution failed", { userId, actionItemId, actionType: item.action_type, externalActionCompleted: Boolean(externalReference), detail });
    if (!externalReference) {
      await admin.from("action_items").update({ execution_status: "failed", last_error: detail, updated_at: new Date().toISOString() }).eq("id", item.id).eq("user_id", userId).eq("execution_status", "executing");
      await settlePackStatus(admin, userId, pack.id);
    }
    throw new Error(externalReference ? "The external action completed, but its confirmation could not be recorded. Do not retry it until the execution record is checked." : detail);
  }
}

async function supersedeEarlierThreadPacks(
  admin: ReturnType<typeof createClient>,
  userId: string,
  threadId: string,
  currentEventId: string,
  now: string,
  supersededBy: string | null = null,
) {
  const { data: earlierEvents, error: eventsError } = await admin
    .from("executive_events")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "gmail")
    .eq("entity_type", "gmail_thread")
    .eq("entity_id", threadId)
    .neq("id", currentEventId);
  if (eventsError) throw eventsError;
  const earlierEventIds = (earlierEvents ?? []).map(event => event.id);
  if (!earlierEventIds.length) return;
  const { error: packsError } = await admin
    .from("action_packs")
    .update({ status: "superseded", superseded_by: supersededBy, updated_at: now })
    .eq("user_id", userId)
    .in("event_id", earlierEventIds)
    .in("status", ["ready_for_review", "approved", "failed"]);
  if (packsError) throw packsError;
}

async function persistAssessment(
  admin: ReturnType<typeof createClient>,
  userId: string,
  messages: ExecutiveSourceMessage[],
  sourceUrl: string,
) {
  if (!messages.length) throw new Error("No readable messages were found in this conversation.");
  const interpreted = await assessConversationWithIntelligence(messages);
  const assessment = interpreted.assessment;
  const sortedMessages = [...messages].sort((left, right) => left.internalDate - right.internalDate);
  const latestMessage = sortedMessages[sortedMessages.length - 1];
  const idempotencyKey = `gmail:${latestMessage.id}:${POLICY_VERSION}`;
  const now = new Date().toISOString();

  const { data: existingEvent, error: existingEventError } = await admin
    .from("executive_events")
    .select("id,status")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingEventError) throw existingEventError;
  if (existingEvent && (existingEvent.status === "assessed" || existingEvent.status === "ignored")) {
    const [{ data: existingAssessment, error: existingAssessmentError }, { data: existingPack, error: existingPackError }] = await Promise.all([
      admin.from("attention_assessments").select("id").eq("event_id", existingEvent.id).eq("policy_version", POLICY_VERSION).maybeSingle(),
      admin.from("action_packs").select("id").eq("event_id", existingEvent.id).maybeSingle(),
    ]);
    if (existingAssessmentError) throw existingAssessmentError;
    if (existingPackError) throw existingPackError;
    if (existingAssessment) {
      return { eventId: existingEvent.id, assessmentId: existingAssessment.id, packId: existingPack?.id ?? null, assessment };
    }
  }

  const { data: event, error: eventError } = await admin.from("executive_events").upsert({
    user_id: userId,
    source: "gmail",
    source_event_id: latestMessage.id,
    event_type: latestMessage.mine ? "gmail_message_sent" : "gmail_message_received",
    idempotency_key: idempotencyKey,
    entity_type: "gmail_thread",
    entity_id: latestMessage.threadId,
    occurred_at: new Date(latestMessage.internalDate).toISOString(),
    received_at: now,
    status: "processing",
    payload: { thread_id: latestMessage.threadId, subject: latestMessage.subject, from: latestMessage.from, source_url: sourceUrl },
    attempt_count: 1,
    updated_at: now,
  }, { onConflict: "user_id,idempotency_key" }).select("id").single();
  if (eventError) throw eventError;

  const { data: assessmentRow, error: assessmentError } = await admin.from("attention_assessments").upsert({
    user_id: userId,
    event_id: event.id,
    category: assessment.category,
    summary: assessment.summary,
    previous_state: assessment.previousState,
    new_state: assessment.newState,
    changes: assessment.changes,
    explicit_requests: assessment.explicitRequests,
    commitments: assessment.commitments,
    missing_facts: assessment.missingFacts,
    evidence: assessment.evidence,
    recommended_response_by: assessment.recommendedResponseBy,
    consequence_of_delay: assessment.consequenceOfDelay,
    attention_score: assessment.attentionScore,
    attention_level: assessment.attentionLevel,
    confidence: assessment.confidence,
    model_provider: interpreted.model.provider,
    model_name: interpreted.model.name,
    model_version: interpreted.model.version,
    policy_version: POLICY_VERSION,
  }, { onConflict: "event_id,policy_version" }).select("id").single();
  if (assessmentError) throw assessmentError;

  if (assessment.attentionLevel === "silent" || !assessment.actions.length) {
    await supersedeEarlierThreadPacks(admin, userId, latestMessage.threadId, event.id, now);
    await admin.from("executive_events").update({ status: "ignored", processed_at: now, updated_at: now }).eq("id", event.id);
    return { eventId: event.id, assessmentId: assessmentRow.id, packId: null, assessment };
  }

  const { data: pack, error: packError } = await admin.from("action_packs").upsert({
    user_id: userId,
    event_id: event.id,
    assessment_id: assessmentRow.id,
    title: assessment.title,
    executive_summary: assessment.summary,
    why_now: assessment.whyNow,
    status: "ready_for_review",
    attention_level: assessment.attentionLevel,
    review_by: assessment.recommendedResponseBy,
    contact_name: assessment.contactName,
    organisation_name: assessment.organisationName || null,
    source_url: sourceUrl,
    missing_facts: assessment.missingFacts,
    proposed_changes: assessment.changes,
    confidence: assessment.confidence,
    updated_at: now,
  }, { onConflict: "event_id,assessment_id" }).select("id").single();
  if (packError) throw packError;
  await supersedeEarlierThreadPacks(admin, userId, latestMessage.threadId, event.id, now, pack.id);

  for (const action of assessment.actions) {
    const contentHash = await hashContent(action.content);
    const { error } = await admin.from("action_items").upsert({
      user_id: userId,
      action_pack_id: pack.id,
      action_type: action.type,
      title: action.title,
      content: action.content,
      content_version: 1,
      content_hash: contentHash,
      approval_required: true,
      approval_status: "pending",
      execution_status: "not_started",
      position: action.position,
      updated_at: now,
    }, { onConflict: "action_pack_id,action_type,content_version" });
    if (error) throw error;
  }

  const notificationPayload = {
    user_id: userId,
    action_pack_id: pack.id,
    channel: "in_app",
    attention_level: assessment.attentionLevel,
    title: assessment.title,
    body: assessment.summary,
    status: "pending",
    deliver_after: now,
    updated_at: now,
  };
  const { data: existingNotification } = await admin.from("executive_notifications").select("id").eq("action_pack_id", pack.id).eq("channel", "in_app").maybeSingle();
  const notificationResult = existingNotification?.id
    ? await admin.from("executive_notifications").update(notificationPayload).eq("id", existingNotification.id)
    : await admin.from("executive_notifications").insert(notificationPayload);
  if (notificationResult.error) throw notificationResult.error;

  await admin.from("executive_events").update({ status: "assessed", processed_at: now, updated_at: now }).eq("id", event.id);
  return { eventId: event.id, assessmentId: assessmentRow.id, packId: pack.id, assessment };
}

async function retainLatestIncomingPreparation(
  admin: ReturnType<typeof createClient>,
  userId: string,
  messages: ExecutiveSourceMessage[],
  sourceUrl: string,
) {
  const sorted = [...messages].sort((left, right) => left.internalDate - right.internalDate);
  if (!sorted.at(-1)?.mine) return null;
  const incomingIndex = sorted.findLastIndex(message => !message.mine);
  if (incomingIndex < 0) return null;

  const historical = await persistAssessment(admin, userId, sorted.slice(0, incomingIndex + 1), sourceUrl);
  if (!historical.packId) return null;

  const now = new Date().toISOString();
  const { error: replyError } = await admin
    .from("action_items")
    .update({ approval_status: "not_required", execution_status: "cancelled", last_error: null, updated_at: now })
    .eq("action_pack_id", historical.packId)
    .eq("user_id", userId)
    .eq("action_type", "reply_draft")
    .neq("execution_status", "completed");
  if (replyError) throw replyError;

  const { data: followOnItems, error: followOnError } = await admin
    .from("action_items")
    .select("id,action_type,approval_status,execution_status")
    .eq("action_pack_id", historical.packId)
    .eq("user_id", userId)
    .neq("action_type", "reply_draft");
  if (followOnError) throw followOnError;
  const hasFollowOnDecision = (followOnItems ?? []).some(item =>
    item.execution_status !== "completed"
      && item.execution_status !== "cancelled"
      && (item.approval_status === "pending" || item.execution_status === "failed")
  );
  const contact = historical.assessment.contactName || historical.assessment.organisationName || "this conversation";
  const packUpdate = hasFollowOnDecision
    ? {
        status: "ready_for_review",
        title: `${contact}: follow-on actions are ready`,
        executive_summary: `You have replied to ${contact}. The prepared follow-on work remains available for review.`,
        why_now: "The reply is handled. Review the remaining document, task and commercial follow-on actions when ready.",
        attention_level: "morning_brief",
        review_by: null,
        superseded_by: null,
        updated_at: now,
      }
    : { status: "superseded", updated_at: now };
  const [{ data: retainedPacks, error: packError }, { error: notificationError }] = await Promise.all([
    admin.from("action_packs").update(packUpdate).eq("id", historical.packId).eq("user_id", userId).in("status", ["ready_for_review", "approved", "failed", "superseded"]).select("id"),
    admin
      .from("executive_notifications")
      .update({ status: "dismissed", updated_at: now })
      .eq("action_pack_id", historical.packId)
      .eq("user_id", userId)
      .eq("status", "pending"),
  ]);
  if (packError) throw packError;
  if (notificationError) throw notificationError;
  return retainedPacks?.length ? historical.packId : null;
}

async function scanInbox(admin: ReturnType<typeof createClient>, userId: string, maxResultsInput = 10) {
  const token = await accessToken(admin, userId);
  const maxResults = Math.min(Math.max(Number(maxResultsInput || 10), 1), 15);
  const query = "newer_than:3d {label:inbox label:sent} -category:promotions -category:social -category:forums";
  const list = await gmailFetch(`/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`, token);
  const threadIds = [...new Set((list.messages ?? []).map((message: any) => String(message.threadId || "")).filter(Boolean))];
  const results = [];
  for (const threadId of threadIds) {
    try {
      const messages = await loadThread(threadId, token);
      const sourceUrl = `https://mail.google.com/mail/u/0/#all/${threadId}`;
      const current = await persistAssessment(admin, userId, messages, sourceUrl);
      const retainedPackId = await retainLatestIncomingPreparation(admin, userId, messages, sourceUrl);
      results.push({ ...current, retainedPackId });
    } catch (error) {
      results.push({ threadId, error: error instanceof Error ? error.message : "Unable to assess thread." });
    }
  }
  return {
    checked: threadIds.length,
    prepared: results.filter((result: any) => Boolean(result.packId)).length,
    retained: results.filter((result: any) => Boolean(result.retainedPackId)).length,
    results,
  };
}

async function generateBrief(admin: ReturnType<typeof createClient>, userId: string) {
  const now = new Date();
  const briefDate = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const dayStart = new Date(`${briefDate}T00:00:00.000Z`).toISOString();
  const { data: packs, error: packsError } = await admin
    .from("action_packs")
    .select("id,title,executive_summary,attention_level,review_by,contact_name,organisation_name,status,action_items(id,approval_status)")
    .eq("user_id", userId)
    .in("status", ["ready_for_review", "executing", "failed"])
    .or(`snoozed_until.is.null,snoozed_until.lte.${now.toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (packsError) throw packsError;
  const { count: suppressedCount, error: suppressedError } = await admin
    .from("attention_assessments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("attention_level", "silent")
    .gte("created_at", dayStart);
  if (suppressedError) throw suppressedError;

  const entries = (packs ?? []).map((pack: any) => ({
    pack_id: pack.id,
    title: pack.title,
    summary: pack.executive_summary,
    attention_level: pack.attention_level,
    review_by: pack.review_by,
    contact: pack.contact_name || pack.organisation_name || null,
    prepared_items: (pack.action_items ?? []).length,
    pending_approvals: (pack.action_items ?? []).filter((item: any) => item.approval_status === "pending").length,
  }));
  const immediate = entries.filter(entry => entry.attention_level === "interrupt_now" || entry.attention_level === "top_of_today");
  const canWait = entries.filter(entry => entry.attention_level === "morning_brief");
  const content = {
    commercial_movement: immediate,
    prepared_work: entries.filter(entry => entry.pending_approvals > 0),
    can_wait: canWait,
    suppressed_noise_count: suppressedCount ?? 0,
  };
  const title = immediate.length
    ? `${immediate.length} important change${immediate.length === 1 ? " needs" : "s need"} attention`
    : entries.length
      ? `${entries.length} prepared action${entries.length === 1 ? " is" : "s are"} ready to review`
      : "No commercial change needs attention";
  const { data: brief, error: briefError } = await admin.from("executive_briefs").upsert({
    user_id: userId,
    brief_date: briefDate,
    timezone: "Europe/London",
    title,
    content,
    status: "ready",
    generated_at: now.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: "user_id,brief_date" }).select("id,title,content,brief_date,generated_at").single();
  if (briefError) throw briefError;
  return brief;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await request.json();
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (body.action === "scanAllConnected") {
      const expectedSecret = Deno.env.get("EXECUTIVE_AGENT_CRON_SECRET") || "";
      const providedSecret = request.headers.get("X-Executive-Agent-Secret") || "";
      if (!expectedSecret || providedSecret !== expectedSecret) return json({ error: "Invalid monitor secret." }, 401);
      const { data: connections, error: connectionError } = await admin
        .from("google_calendar_connections")
        .select("user_id,granted_scopes,status")
        .eq("status", "connected")
        .contains("granted_scopes", ["https://www.googleapis.com/auth/gmail.readonly"]);
      if (connectionError) throw connectionError;
      const users = [];
      for (const connection of connections ?? []) {
        try {
          const scan = await scanInbox(admin, connection.user_id, Number(body.maxResults || 10));
          const brief = await generateBrief(admin, connection.user_id);
          users.push({ userId: connection.user_id, ...scan, briefId: brief.id });
        } catch (error) {
          users.push({ userId: connection.user_id, error: error instanceof Error ? error.message : "Unable to scan connected inbox." });
        }
      }
      return json({ usersChecked: users.length, users });
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing authorization." }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session." }, 401);

    if (body.action === "prepareThread") {
      const threadId = String(body.threadId || "").trim();
      if (!threadId) return json({ error: "threadId is required." }, 400);
      const token = await accessToken(admin, user.id);
      const messages = await loadThread(threadId, token);
      const result = await persistAssessment(admin, user.id, messages, `https://mail.google.com/mail/u/0/#all/${threadId}`);
      return json(result);
    }

    if (body.action === "scanInbox") {
      const scan = await scanInbox(admin, user.id, Number(body.maxResults || 10));
      const brief = await generateBrief(admin, user.id);
      return json({ ...scan, briefId: brief.id });
    }

    if (body.action === "generateBrief") {
      return json(await generateBrief(admin, user.id));
    }

    if (body.action === "executeApprovedAction") {
      const itemId = String(body.itemId || "").trim();
      if (!itemId) return json({ error: "itemId is required." }, 400);
      return json(await executeApprovedAction(admin, user.id, itemId));
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Executive Agent error." }, 500);
  }
});
