import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function b64ToBytes(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }

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

function senderName(from: string) {
  const clean = from.replace(/<[^>]+>/g, "").replace(/^\"|\"$/g, "").trim();
  return clean || from.split("@")[0] || "sender";
}

function senderFirstName(from: string) {
  return senderName(from).split(/\s+/)[0] || "there";
}

function actionSignal(message: any) {
  const subject = header(message, "Subject") || "No subject";
  const from = header(message, "From");
  const snippet = message.snippet || "";
  const text = `${subject} ${snippet}`.toLowerCase();
  const labels = new Set<string>(message.labelIds ?? []);
  let score = 0;
  const reasons: string[] = [];

  if (labels.has("UNREAD")) { score += 2; reasons.push("Unread"); }
  if (labels.has("IMPORTANT")) { score += 1; reasons.push("Marked important"); }
  if (/\b(can you|could you|would you|please|let me know|confirm|review|send|share|need you|follow up|follow-up|deadline|by (monday|tuesday|wednesday|thursday|friday|tomorrow|today))\b/i.test(text)) {
    score += 4;
    reasons.push("Contains an action request");
  }
  if (/\b(proposal|prospect|client|pitch|opportunity|contract|cv|resume|interview|meeting|intro|introduction)\b/i.test(text)) {
    score += 2;
    reasons.push("Relevant to active work");
  }
  if (/no[-_. ]?reply|newsletter|notifications?@|mailer-daemon/i.test(from)) {
    score -= 5;
    reasons.push("Likely automated");
  }
  const ageMs = Date.now() - Number(message.internalDate || 0);
  if (ageMs >= 0 && ageMs < 72 * 60 * 60 * 1000) { score += 1; reasons.push("Recent"); }

  const replyLikely = /\b(can you|could you|would you|let me know|confirm|reply|thoughts|what do you think)\b/i.test(text);
  const taskTitle = replyLikely ? `Reply to ${senderName(from)}: ${subject.replace(/^(re|fw|fwd):\s*/i, "")}` : `Action: ${subject.replace(/^(re|fw|fwd):\s*/i, "")}`;
  return { score, reasons: reasons.slice(0, 3), taskTitle };
}

function decodeBase64Url(value: string) {
  if (!value) return "";
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
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
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = bodyText(part);
      if (nested) return nested;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) return stripHtml(decodeBase64Url(payload.body.data));
  return "";
}

function trimQuoted(value: string) {
  const lines = value.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const clean = line.trim();
    if (/^On .+wrote:$/i.test(clean)) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)/i.test(clean)) break;
    if (/^>/.test(clean)) break;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractEmail(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.trim() || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || value.trim();
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

function ruleBasedReply(messages: Array<{ mine: boolean; from: string; body: string }>, angle = "") {
  const incoming = [...messages].reverse().find(item => !item.mine) ?? messages[messages.length - 1];
  const text = incoming?.body?.trim() || "";
  const lower = text.toLowerCase();
  const first = senderFirstName(incoming?.from || "");
  let middle = "Thanks for getting back to me. That sounds good from my side.";

  if (/\b(no|not right now|not at the moment|pass|decline|unfortunately)\b/.test(lower)) {
    middle = "Thanks for letting me know. I appreciate you coming back to me, and no problem at all.";
  } else if (/\b(available|availability|call|chat|meet|meeting|time works|when can)\b/.test(lower)) {
    middle = "Thanks for getting back to me. Happy to find a time that works and keep things moving.";
  } else if (/\b(send|share|forward|proposal|deck|cv|details|information)\b/.test(lower)) {
    middle = "Thanks for the note. I’ll get that across and make sure you have what you need.";
  } else if (/\b(thanks|thank you|great|sounds good|perfect|yes|absolutely)\b/.test(lower)) {
    middle = "Thanks, that sounds good. I’m happy to take the next step from here.";
  } else if (/\?/.test(text)) {
    middle = "Thanks for getting back to me. I’ve picked up your question and will come back with a clear answer.";
  }

  let reply = `Hi ${first},\n\n${middle}\n\nBest,\nCoris`;
  if (angle === "warmer") reply = `Hi ${first},\n\nReally good to hear from you. ${middle}\n\nHope all’s well your side.\n\nBest,\nCoris`;
  if (angle === "shorter") reply = `Hi ${first},\n\n${middle}\n\nBest,\nCoris`;
  if (angle === "direct") reply = `Hi ${first},\n\n${middle.replace("Thanks for getting back to me. ", "")}\n\nBest,\nCoris`;
  if (angle === "formal") reply = `Hi ${first},\n\nThank you for your message. ${middle.replace(/^Thanks[^.]*\.\s*/, "")}\n\nKind regards,\nCoris Leachman`;
  return reply;
}

async function mapThread(threadId: string, accessToken: string) {
  const [thread, profile] = await Promise.all([
    gmailFetch(`/users/me/threads/${encodeURIComponent(threadId)}?format=full`, accessToken),
    gmailFetch("/users/me/profile", accessToken),
  ]);
  const accountEmail = String(profile.emailAddress || "").toLowerCase();
  const messages = (thread.messages ?? []).map((message: any) => {
    const from = header(message, "From");
    return {
      id: message.id,
      threadId: message.threadId,
      from,
      to: header(message, "To"),
      subject: header(message, "Subject") || "No subject",
      date: header(message, "Date"),
      body: trimQuoted(bodyText(message.payload) || message.snippet || ""),
      mine: from.toLowerCase().includes(accountEmail),
      messageId: header(message, "Message-ID"),
      references: header(message, "References"),
    };
  });
  return { accountEmail: profile.emailAddress || "", threadId, subject: messages[messages.length - 1]?.subject || "No subject", messages };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing authorization." }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session." }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: connection, error: connectionError } = await admin.from("google_calendar_connections").select("*").eq("user_id", user.id).single();
    if (connectionError || !connection?.encrypted_refresh_token) return json({ error: "Google account is not connected." }, 409);

    const body = await request.json();
    const action = body.action as string;
    const refreshToken = await decrypt(connection.encrypted_refresh_token);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    if (!tokenResponse.ok) throw new Error(`Unable to refresh Google access: ${await tokenResponse.text()}`);
    const token = await tokenResponse.json();
    const accessToken = token.access_token as string;

    if (action === "profile") {
      const profile = await gmailFetch("/users/me/profile", accessToken);
      return json({ accountEmail: profile.emailAddress });
    }

    if (action === "actionInbox") {
      const maxResults = Math.min(Math.max(Number(body.maxResults || 40), 1), 50);
      const query = typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : "newer_than:14d label:inbox -category:promotions -category:social -category:forums";
      const list = await gmailFetch(`/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`, accessToken);
      const refs = list.messages ?? [];
      const messages = await Promise.all(refs.map((ref: any) => gmailFetch(`/users/me/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, accessToken)));
      const profile = await gmailFetch("/users/me/profile", accessToken);
      const mapped = messages.map((message: any) => {
        const signal = actionSignal(message);
        return {
          id: message.id,
          threadId: message.threadId,
          subject: header(message, "Subject") || "No subject",
          from: header(message, "From"),
          to: header(message, "To"),
          date: header(message, "Date"),
          snippet: message.snippet || "",
          unread: (message.labelIds ?? []).includes("UNREAD"),
          important: (message.labelIds ?? []).includes("IMPORTANT"),
          score: signal.score,
          reasons: signal.reasons,
          suggestedTaskTitle: signal.taskTitle,
          gmailUrl: `https://mail.google.com/mail/u/0/#all/${message.threadId}`,
          internalDate: Number(message.internalDate || 0),
        };
      }).sort((a: any, b: any) => b.score - a.score || b.internalDate - a.internalDate);
      return json({ accountEmail: profile.emailAddress, messages: mapped.map(({ internalDate: _internalDate, ...item }: any) => item) });
    }

    if (action === "thread") {
      if (!body.threadId) return json({ error: "threadId is required." }, 400);
      return json(await mapThread(String(body.threadId), accessToken));
    }

    if (action === "suggestReply") {
      if (!body.threadId) return json({ error: "threadId is required." }, 400);
      const thread = await mapThread(String(body.threadId), accessToken);
      return json({ reply: ruleBasedReply(thread.messages, String(body.angle || "")), source: "rules" });
    }

    if (action === "send") {
      const to = String(body.to || "").trim();
      let subject = String(body.subject || "").trim();
      const messageBody = String(body.body || "").trim();
      const threadId = body.threadId ? String(body.threadId) : null;
      if (!to || !subject || !messageBody) return json({ error: "To, subject and body are required." }, 400);

      let replyHeaders: string[] = [];
      if (threadId) {
        const thread = await mapThread(threadId, accessToken);
        const last = thread.messages[thread.messages.length - 1];
        if (!/^re:/i.test(subject)) subject = `Re: ${subject.replace(/^re:\s*/i, "")}`;
        const refs = [last?.references, last?.messageId].filter(Boolean).join(" ").trim();
        if (last?.messageId) replyHeaders.push(`In-Reply-To: ${last.messageId}`);
        if (refs) replyHeaders.push(`References: ${refs}`);
      }

      const raw = [
        `To: ${to}`,
        `Subject: ${encodedSubject(subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        ...replyHeaders,
        "",
        messageBody,
      ].join("\r\n");
      const result = await gmailFetch("/users/me/messages/send", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: encodeBase64Url(raw), ...(threadId ? { threadId } : {}) }),
      });
      return json({ messageId: result.id, threadId: result.threadId ?? threadId });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Gmail error." }, 500);
  }
});
