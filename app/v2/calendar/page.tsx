"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CheckCircle2, Clock3, Link2, Plus, RefreshCcw, ShieldCheck } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Task, type V2Workspace } from "../../../lib/v2-data";
import { callCalendar, combineLocalDateTime, loadCalendarStatus, localDateInput, type CalendarConnectionStatus, type GoogleCalendarEvent, type GoogleCalendarOption } from "../../../lib/v2-calendar";
import styles from "./calendar.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

export default function CalendarPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarOption[]>([]);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [date, setDate] = useState(localDateInput());
  const [startTime, setStartTime] = useState("09:30");
  const [duration, setDuration] = useState(60);
  const [taskId, setTaskId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setUser(session?.user ?? null);
      if (!session?.user) { setLoading(false); return; }
      try {
        if (session.provider_refresh_token) {
          await callCalendar(supabase, "connect", {
            refreshToken: session.provider_refresh_token,
            accessToken: session.provider_token,
            expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
            scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
          });
        }
        const [calendarStatus, nextWorkspace] = await Promise.all([
          loadCalendarStatus(supabase, session.user.id),
          loadV2Workspace(supabase, session.user.id),
        ]);
        setStatus(calendarStatus);
        setWorkspace(nextWorkspace);
        setTaskId(nextWorkspace.todayTasks[0]?.id ?? nextWorkspace.allTasks.find(task => task.status !== "complete")?.id ?? "");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load Calendar.");
      } finally { setLoading(false); }
    });
  }, []);

  const activeTasks = useMemo(() => workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled"), [workspace.allTasks]);
  const selectedTask = activeTasks.find(task => task.id === taskId) ?? null;

  async function connectGoogle() {
    if (!supabase) return;
    setBusy(true); setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/v2/calendar/`,
        scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      },
    });
    if (authError) { setError(authError.message); setBusy(false); }
  }

  async function loadCalendars() {
    if (!supabase) return;
    setBusy(true); setError("");
    try {
      const result = await callCalendar<{ calendars: GoogleCalendarOption[] }>(supabase, "calendars");
      setCalendars(result.calendars);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load calendars."); }
    finally { setBusy(false); }
  }

  async function chooseCalendar(calendar: GoogleCalendarOption) {
    if (!supabase) return;
    setBusy(true); setError("");
    try {
      await callCalendar(supabase, "selectCalendar", { calendarId: calendar.id, calendarName: calendar.name });
      setStatus(current => current ? { ...current, selected_calendar_id: calendar.id, selected_calendar_name: calendar.name } : current);
      setMessage(`${calendar.name} is now the managed calendar.`);
      await loadDay(calendar.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to select calendar."); }
    finally { setBusy(false); }
  }

  async function loadDay(calendarId = status?.selected_calendar_id) {
    if (!supabase || !calendarId) return;
    setBusy(true); setError("");
    try {
      const from = new Date(`${date}T00:00:00`).toISOString();
      const to = new Date(`${date}T23:59:59`).toISOString();
      const result = await callCalendar<{ events: GoogleCalendarEvent[] }>(supabase, "events", { calendarId, timeMin: from, timeMax: to });
      setEvents(result.events);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load the day."); }
    finally { setBusy(false); }
  }

  async function createBlock() {
    if (!supabase || !selectedTask || !status?.selected_calendar_id) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const startsAt = combineLocalDateTime(date, startTime);
      const endsAt = new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString();
      await callCalendar(supabase, "createBlock", {
        taskId: selectedTask.id,
        title: selectedTask.title,
        startsAt,
        endsAt,
        calendarId: status.selected_calendar_id,
        timeZone: "Europe/London",
      });
      setMessage(`Blocked ${duration} minutes for “${selectedTask.title}”.`);
      await loadDay();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create the time block."); }
    finally { setBusy(false); }
  }

  if (!user && !loading) return <main className={styles.state}><div><h1>Sign in first</h1><Link href="/v2">Back to V2</Link></div></main>;

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><span>GOOGLE CALENDAR</span><h1>Turn priorities into protected time</h1><p>Read your existing commitments, choose the calendar Command Centre manages, and create focus blocks without touching unrelated meetings.</p></div>
      <div className={styles.trust}><ShieldCheck size={19} /><span>Only Command Centre-created blocks can be moved or deleted.</span></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={17} />{message}</div>}

    {loading ? <section className={styles.loading}>Loading Calendar connection…</section> : !status || status.status !== "connected" ?
      <section className={styles.connectCard}><CalendarDays size={32} /><h2>Connect Google Calendar</h2><p>This opens Google consent and requests offline Calendar access so Command Centre can keep your time blocks in sync.</p><button disabled={busy} onClick={connectGoogle}><Link2 size={17} /> Connect Google Calendar</button></section>
      : <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><CalendarDays size={19} /><h2>Connection</h2></div><span className={styles.connected}>Connected</span></div>
          <dl><div><dt>Google account</dt><dd>{status.google_account_email || "Connected account"}</dd></div><div><dt>Managed calendar</dt><dd>{status.selected_calendar_name || "Not selected"}</dd></div></dl>
          <button className={styles.secondary} disabled={busy} onClick={loadCalendars}><RefreshCcw size={16} /> {calendars.length ? "Refresh calendars" : "Choose calendar"}</button>
          {calendars.length > 0 && <div className={styles.calendarList}>{calendars.map(calendar => <button key={calendar.id} onClick={() => chooseCalendar(calendar)} className={calendar.id === status.selected_calendar_id ? styles.selectedCalendar : ""}><strong>{calendar.name}</strong><span>{calendar.primary ? "Primary" : calendar.accessRole}</span></button>)}</div>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><Clock3 size={19} /><h2>Block priority time</h2></div></div>
          <label>Task<select value={taskId} onChange={event => setTaskId(event.target.value)}>{activeTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
          <div className={styles.fields}><label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Start<input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} /></label><label>Duration<select value={duration} onChange={event => setDuration(Number(event.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hour</option><option value={90}>90 min</option><option value={120}>2 hours</option></select></label></div>
          <button disabled={busy || !selectedTask || !status.selected_calendar_id} onClick={createBlock}><Plus size={17} /> Add protected time</button>
          {!status.selected_calendar_id && <p className={styles.hint}>Choose a writable calendar first.</p>}
        </section>

        <section className={`${styles.panel} ${styles.dayPanel}`}>
          <div className={styles.panelHeader}><div><CalendarDays size={19} /><h2>{new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h2></div><button className={styles.iconButton} disabled={busy || !status.selected_calendar_id} onClick={() => loadDay()}><RefreshCcw size={16} /></button></div>
          <div className={styles.events}>{events.map(event => <article key={event.id}><time>{event.allDay ? "All day" : `${new Date(event.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${new Date(event.end).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}</time><strong>{event.title}</strong></article>)}{events.length === 0 && <p className={styles.hint}>No events loaded for this day.</p>}</div>
        </section>
      </div>}
  </main>;
}
