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

async function googleFetch(path: string, accessToken: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
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
      const profile = await googleFetch("/users/me/profile", accessToken);
      return json({ accountEmail: profile.emailAddress });
    }

    if (action === "actionInbox") {
      const maxResults = Math.min(Math.max(Number(body.maxResults || 40), 1), 50);
      const query = typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : "newer_than:14d label:inbox -category:promotions -category:social -category:forums";
      const list = await googleFetch(`/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`, accessToken);
      const refs = list.messages ?? [];
      const messages = await Promise.all(refs.map((ref: any) => googleFetch(`/users/me/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, accessToken)));
      const profile = await googleFetch("/users/me/profile", accessToken);
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
        };
      }).sort((a: any, b: any) => b.score - a.score || Number(b.internalDate || 0) - Number(a.internalDate || 0));
      return json({ accountEmail: profile.emailAddress, messages: mapped });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Gmail error." }, 500);
  }
});
