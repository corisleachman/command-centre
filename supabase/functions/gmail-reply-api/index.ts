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

type ConversationMessage = {
  from: string;
  body: string;
  mine: boolean;
  internalDate: number;
  subject: string;
};

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
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
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

function senderName(from: string) {
  const clean = from.replace(/<[^>]+>/g, "").replace(/^\"|\"$/g, "").trim();
  return clean || from.split("@")[0] || "there";
}

function firstName(from: string) { return senderName(from).split(/\s+/)[0] || "there"; }

function daysSince(ms: number) {
  if (!ms) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function elapsedPhrase(days: number) {
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days <= 4) return "a few days ago";
  if (days <= 8) return "last week";
  return "a little while ago";
}

function applyTone(first: string, core: string, angle: string, state: string) {
  if (angle === "shorter") return `Hi ${first},\n\n${core}\n\nBest,\nCoris`;
  if (angle === "warmer") return `Hi ${first},\n\nHope you're well. ${core}\n\nHappy to pick things up whenever useful.\n\nBest,\nCoris`;
  if (angle === "direct") return `Hi ${first},\n\n${core.replace(/^Just /, "")}\n\nBest,\nCoris`;
  if (angle === "formal") return `Hi ${first},\n\n${core}\n\nKind regards,\nCoris Leachman`;
  const ending = state === "waiting_after_delivery" ? "Happy to talk anything through if useful." : "Best,";
  return state === "waiting_after_delivery"
    ? `Hi ${first},\n\n${core}\n\n${ending}\n\nBest,\nCoris`
    : `Hi ${first},\n\n${core}\n\nBest,\nCoris`;
}

function classifyAndDraft(messages: ConversationMessage[], angle = "") {
  const sorted = [...messages].sort((a, b) => a.internalDate - b.internalDate);
  const last = sorted[sorted.length - 1];
  const lastIncoming = [...sorted].reverse().find(item => !item.mine);
  const counterpart = lastIncoming ?? sorted.find(item => !item.mine) ?? last;
  const first = firstName(counterpart?.from || "");
  if (!last) return { reply: `Hi ${first},\n\nJust following up.\n\nBest,\nCoris`, state: "unknown", reason: "No usable conversation content was found." };

  const threadText = sorted.map(item => `${item.subject} ${item.body}`).join(" ").toLowerCase();
  const lastText = `${last.subject} ${last.body}`.toLowerCase();
  const days = daysSince(last.internalDate);
  const proposalContext = /\b(proposal|scope|costs?|pricing|deck|recommendation|recommendations|document|pdf)\b/.test(threadText);
  const delivered = /\b(attached|attachment|please find|here(?:'s| is)|sending over|sent over|as promised|following (?:our|the) call|proposal.*(?:attached|over)|deck.*(?:attached|over))\b/.test(lastText);

  if (last.mine) {
    let state = "waiting_after_outbound";
    let reason = `Your message ${elapsedPhrase(days)} is the latest message in the thread, so the next email should be a follow-up rather than another promise to act.`;
    let core: string;

    if (proposalContext && delivered) {
      state = "waiting_after_delivery";
      reason = `You sent the latest message ${elapsedPhrase(days)} and it appears to contain or deliver the proposal/material you had promised. No later reply is present.`;
      core = days <= 1
        ? "Just checking the proposal came through okay. No rush on it, but let me know if anything is unclear when you get a chance to look through it."
        : "Just following up on the proposal I sent over. I wanted to see if you've had a chance to look through it and whether you have any questions or initial thoughts.";
    } else if (/\b(let me know|keen to hear|thoughts|what do you think|does that work|works for you|suit you)\b/.test(lastText)) {
      state = "waiting_for_answer";
      reason = `Your latest email asked for a response ${elapsedPhrase(days)}, and there is no subsequent reply.`;
      core = "Just following up on my last note to see what you think. No problem if you've been tied up, but it'd be good to know whether it makes sense to pick this back up.";
    } else {
      core = days <= 1
        ? "Just checking my last note came through okay. No rush, but let me know when you've had a chance to take a look."
        : "Just following up on my last note in case it got buried. Let me know where things have landed when you get a chance.";
    }

    return { reply: applyTone(first, core, angle, state), state, reason };
  }

  const incoming = last.body.trim();
  const lower = incoming.toLowerCase();
  let state = "reply_to_incoming";
  let reason = "The other person sent the latest message, so the draft responds to that message and the preceding thread context.";
  let core = "Thanks for coming back to me. That sounds good from my side.";

  if (/\b(no|not right now|not at the moment|pass|decline|unfortunately|won't be able|not able to)\b/.test(lower)) {
    state = "declined";
    core = "Thanks for letting me know. I appreciate you coming back to me, and no problem at all.";
  } else if (/\b(received|got it|have it|came through|thanks for sending|thank you for sending)\b/.test(lower) && proposalContext) {
    state = "proposal_received";
    core = "Glad it came through. Have a look when you get a chance and let me know if there are any questions or anything you'd like me to expand on.";
  } else if (/\b(available|availability|call|chat|meet|meeting|time works|when can|calendar)\b/.test(lower)) {
    state = "scheduling";
    core = "Thanks for getting back to me. Happy to get a time in the diary and keep things moving.";
  } else if (/\b(send|share|forward|proposal|deck|cv|details|information)\b/.test(lower)) {
    state = "action_requested";
    const alreadySentLater = sorted.some(item => item.mine && item.internalDate > last.internalDate && /\b(attached|sending over|sent over|as promised|proposal|deck)\b/i.test(item.body));
    core = alreadySentLater
      ? "Just following up on the material I sent over to make sure you have everything you need. Let me know if there are any questions."
      : "Thanks for the note. I'll get that across and make sure you have what you need.";
  } else if (/\?/.test(incoming)) {
    state = "question_received";
    core = "Thanks for getting back to me. I've picked up your question and will come back with a clear answer.";
  } else if (/\b(thanks|thank you|great|sounds good|perfect|yes|absolutely)\b/.test(lower)) {
    state = "positive_acknowledgement";
    core = "Thanks, that sounds good. I'm happy to take the next step from here.";
  }

  return { reply: applyTone(first, core, angle, state), state, reason };
}

async function loadConversation(threadId: string, accessToken: string) {
  const [thread, profile] = await Promise.all([
    gmailFetch(`/users/me/threads/${encodeURIComponent(threadId)}?format=full`, accessToken),
    gmailFetch("/users/me/profile", accessToken),
  ]);
  const accountEmail = String(profile.emailAddress || "").toLowerCase();
  return (thread.messages ?? []).map((message: any): ConversationMessage => {
    const from = header(message, "From");
    return {
      from,
      subject: header(message, "Subject") || "No subject",
      body: trimQuoted(bodyText(message.payload) || message.snippet || ""),
      mine: from.toLowerCase().includes(accountEmail),
      internalDate: Number(message.internalDate || Date.parse(header(message, "Date")) || 0),
    };
  });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing authorization." }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session." }, 401);

    const body = await request.json();
    if (body.action !== "suggestReply") return json({ error: "Unknown action." }, 400);
    if (!body.threadId) return json({ error: "threadId is required." }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: connection, error: connectionError } = await admin.from("google_calendar_connections").select("encrypted_refresh_token").eq("user_id", user.id).single();
    if (connectionError || !connection?.encrypted_refresh_token) return json({ error: "Google account is not connected." }, 409);

    const refreshToken = await decrypt(connection.encrypted_refresh_token);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    if (!tokenResponse.ok) throw new Error(`Unable to refresh Google access: ${await tokenResponse.text()}`);
    const token = await tokenResponse.json();

    const messages = await loadConversation(String(body.threadId), token.access_token as string);
    const suggestion = classifyAndDraft(messages, String(body.angle || ""));
    return json({ ...suggestion, source: "rules" });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Gmail reply error." }, 500);
  }
});
