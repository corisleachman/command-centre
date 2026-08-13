import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assessConversation, type ExecutiveSourceMessage } from "../_shared/executive-policy.ts";

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
const POLICY_VERSION = "revenue-ea-v1";

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

async function gmailFetch(path: string, accessToken: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
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

async function accessToken(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: connection, error } = await admin.from("google_calendar_connections").select("encrypted_refresh_token,granted_scopes").eq("user_id", userId).single();
  if (error || !connection?.encrypted_refresh_token) throw new Error("Google account is not connected.");
  if (!(connection.granted_scopes ?? []).includes("https://www.googleapis.com/auth/gmail.readonly")) throw new Error("Gmail read permission is not connected.");
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
    return {
      id: String(message.id || ""),
      threadId: String(message.threadId || threadId),
      from,
      to: header(message, "To"),
      subject: header(message, "Subject") || "No subject",
      body: trimQuoted(bodyText(message.payload) || message.snippet || ""),
      date: header(message, "Date"),
      internalDate: Number(message.internalDate || Date.parse(header(message, "Date")) || Date.now()),
      mine: from.toLowerCase().includes(ownEmail),
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

async function persistAssessment(
  admin: ReturnType<typeof createClient>,
  userId: string,
  messages: ExecutiveSourceMessage[],
  sourceUrl: string,
) {
  if (!messages.length) throw new Error("No readable messages were found in this conversation.");
  const assessment = assessConversation(messages);
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
    model_provider: "rules",
    model_name: "revenue-ea-policy",
    model_version: "1",
    policy_version: POLICY_VERSION,
  }, { onConflict: "event_id,policy_version" }).select("id").single();
  if (assessmentError) throw assessmentError;

  if (assessment.attentionLevel === "silent" || !assessment.actions.length) {
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

async function scanInbox(admin: ReturnType<typeof createClient>, userId: string, maxResultsInput = 10) {
  const token = await accessToken(admin, userId);
  const maxResults = Math.min(Math.max(Number(maxResultsInput || 10), 1), 15);
  const query = "newer_than:3d label:inbox -category:promotions -category:social -category:forums";
  const list = await gmailFetch(`/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`, token);
  const threadIds = [...new Set((list.messages ?? []).map((message: any) => String(message.threadId || "")).filter(Boolean))];
  const results = [];
  for (const threadId of threadIds) {
    try {
      const messages = await loadThread(threadId, token);
      results.push(await persistAssessment(admin, userId, messages, `https://mail.google.com/mail/u/0/#all/${threadId}`));
    } catch (error) {
      results.push({ threadId, error: error instanceof Error ? error.message : "Unable to assess thread." });
    }
  }
  return { checked: threadIds.length, prepared: results.filter((result: any) => Boolean(result.packId)).length, results };
}

async function generateBrief(admin: ReturnType<typeof createClient>, userId: string) {
  const now = new Date();
  const briefDate = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const dayStart = new Date(`${briefDate}T00:00:00.000Z`).toISOString();
  const { data: packs, error: packsError } = await admin
    .from("action_packs")
    .select("id,title,executive_summary,attention_level,review_by,contact_name,organisation_name,status,action_items(id,approval_status)")
    .eq("user_id", userId)
    .in("status", ["ready_for_review", "approved", "executing", "failed"])
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

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Executive Agent error." }, 500);
  }
});
