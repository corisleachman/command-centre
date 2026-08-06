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

function bytesToB64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function b64ToBytes(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }

async function cryptoKey() {
  const raw = b64ToBytes(TOKEN_KEY);
  if (raw.byteLength !== 32) throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), new TextEncoder().encode(value)));
  return `${bytesToB64(iv)}.${bytesToB64(encrypted)}`;
}

async function decrypt(value: string) {
  const [ivPart, encryptedPart] = value.split(".");
  if (!ivPart || !encryptedPart) throw new Error("Stored Calendar token is invalid.");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivPart) }, await cryptoKey(), b64ToBytes(encryptedPart));
  return new TextDecoder().decode(decrypted);
}

async function googleFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Google Calendar request failed (${response.status}): ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
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
    const body = await request.json();
    const action = body.action as string;

    if (action === "connect") {
      if (!body.refreshToken) return json({ error: "Google did not return a refresh token. Reconnect with consent enabled." }, 400);
      const encryptedRefreshToken = await encrypt(body.refreshToken);
      const profile = body.accessToken
        ? await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${body.accessToken}` } }).then(result => result.ok ? result.json() : null)
        : null;
      const { error } = await admin.from("google_calendar_connections").upsert({
        user_id: user.id,
        google_account_email: profile?.email ?? user.email ?? null,
        encrypted_refresh_token: encryptedRefreshToken,
        access_token_expires_at: body.expiresAt ?? null,
        granted_scopes: body.scopes ?? [],
        status: "connected",
        last_error: null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ connected: true });
    }

    const { data: connection, error: connectionError } = await admin.from("google_calendar_connections").select("*").eq("user_id", user.id).single();
    if (connectionError || !connection?.encrypted_refresh_token) return json({ error: "Google Calendar is not connected." }, 409);

    const refreshToken = await decrypt(connection.encrypted_refresh_token);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text();
      await admin.from("google_calendar_connections").update({ status: "error", last_error: detail, updated_at: new Date().toISOString() }).eq("user_id", user.id);
      throw new Error(`Unable to refresh Google access: ${detail}`);
    }
    const token = await tokenResponse.json();
    const accessToken = token.access_token as string;

    if (action === "calendars") {
      const result = await googleFetch("/users/me/calendarList?minAccessRole=reader", accessToken);
      return json({ calendars: (result.items ?? []).map((item: any) => ({ id: item.id, name: item.summary, primary: !!item.primary, accessRole: item.accessRole })) });
    }

    if (action === "selectCalendar") {
      const { error } = await admin.from("google_calendar_connections").update({ selected_calendar_id: body.calendarId, selected_calendar_name: body.calendarName, updated_at: new Date().toISOString() }).eq("user_id", user.id);
      if (error) throw error;
      return json({ selected: true });
    }

    const selectedCalendarId = body.calendarId || connection.selected_calendar_id || "primary";
    const calendarId = encodeURIComponent(selectedCalendarId);

    if (action === "events") {
      const params = new URLSearchParams({ timeMin: body.timeMin, timeMax: body.timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
      const [result, calendar] = await Promise.all([
        googleFetch(`/calendars/${calendarId}/events?${params}`, accessToken),
        googleFetch(`/calendars/${calendarId}`, accessToken),
      ]);
      const editable = ["owner", "writer"].includes(calendar.accessRole || "");
      return json({ events: (result.items ?? []).map((item: any) => ({
        id: item.id,
        title: item.summary || "Busy",
        start: item.start?.dateTime || item.start?.date,
        end: item.end?.dateTime || item.end?.date,
        allDay: !!item.start?.date,
        status: item.status,
        htmlLink: item.htmlLink || null,
        editable,
        managed: item.extendedProperties?.private?.commandCentreManaged === "true",
        taskId: item.extendedProperties?.private?.commandCentreTaskId || null,
        blockId: item.extendedProperties?.private?.commandCentreBlockId || null,
      })) });
    }

    if (action === "createBlock") {
      const blockId = crypto.randomUUID();
      const event = await googleFetch(`/calendars/${calendarId}/events`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          summary: `Focus: ${body.title}`,
          description: "Created and managed by Command Centre.",
          start: { dateTime: body.startsAt, timeZone: body.timeZone || "Europe/London" },
          end: { dateTime: body.endsAt, timeZone: body.timeZone || "Europe/London" },
          transparency: "opaque",
          extendedProperties: { private: { commandCentreManaged: "true", commandCentreBlockId: blockId, commandCentreTaskId: body.taskId } },
        }),
      });
      const { error } = await admin.from("calendar_blocks").insert({ id: blockId, user_id: user.id, task_id: body.taskId, google_calendar_id: decodeURIComponent(calendarId), google_event_id: event.id, starts_at: body.startsAt, ends_at: body.endsAt, status: "planned", locked: !!body.locked, planner_managed: true, command_centre_managed: true, source_fingerprint: `google:${event.id}` });
      if (error) {
        await googleFetch(`/calendars/${calendarId}/events/${encodeURIComponent(event.id)}`, accessToken, { method: "DELETE" });
        throw error;
      }
      return json({ blockId, eventId: event.id, htmlLink: event.htmlLink });
    }

    if (action === "updateEvent") {
      if (!body.eventId) return json({ error: "Event ID is required." }, 400);
      const eventPath = `/calendars/${calendarId}/events/${encodeURIComponent(body.eventId)}`;
      const event = await googleFetch(eventPath, accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          summary: body.title,
          start: { dateTime: body.startsAt, timeZone: body.timeZone || "Europe/London" },
          end: { dateTime: body.endsAt, timeZone: body.timeZone || "Europe/London" },
        }),
      });
      if (body.blockId) {
        await admin.from("calendar_blocks").update({ starts_at: body.startsAt, ends_at: body.endsAt, status: "moved", updated_at: new Date().toISOString() }).eq("id", body.blockId).eq("user_id", user.id);
      }
      return json({ updated: true, eventId: event.id });
    }

    if (action === "deleteEvent") {
      if (!body.eventId) return json({ error: "Event ID is required." }, 400);
      await googleFetch(`/calendars/${calendarId}/events/${encodeURIComponent(body.eventId)}`, accessToken, { method: "DELETE" });
      if (body.blockId) await admin.from("calendar_blocks").delete().eq("id", body.blockId).eq("user_id", user.id);
      return json({ deleted: true });
    }

    if (action === "moveBlock" || action === "deleteBlock") {
      const { data: block, error } = await admin.from("calendar_blocks").select("*").eq("id", body.blockId).eq("user_id", user.id).eq("command_centre_managed", true).single();
      if (error || !block) return json({ error: "Managed block not found." }, 404);
      if (block.locked && action === "moveBlock") return json({ error: "This block is locked." }, 409);
      const blockCalendar = encodeURIComponent(block.google_calendar_id);
      const eventPath = `/calendars/${blockCalendar}/events/${encodeURIComponent(block.google_event_id)}`;
      if (action === "deleteBlock") {
        await googleFetch(eventPath, accessToken, { method: "DELETE" });
        await admin.from("calendar_blocks").delete().eq("id", block.id).eq("user_id", user.id);
        return json({ deleted: true });
      }
      await googleFetch(eventPath, accessToken, { method: "PATCH", body: JSON.stringify({ start: { dateTime: body.startsAt, timeZone: body.timeZone || "Europe/London" }, end: { dateTime: body.endsAt, timeZone: body.timeZone || "Europe/London" } }) });
      await admin.from("calendar_blocks").update({ starts_at: body.startsAt, ends_at: body.endsAt, status: "moved", updated_at: new Date().toISOString() }).eq("id", block.id).eq("user_id", user.id);
      return json({ moved: true });
    }

    if (action === "disconnect") {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      await admin.from("google_calendar_connections").update({ encrypted_refresh_token: null, status: "revoked", selected_calendar_id: null, selected_calendar_name: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
      return json({ disconnected: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Calendar error." }, 500);
  }
});
