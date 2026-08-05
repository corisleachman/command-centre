"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CheckCircle2, Clock3, Link2, Plus, RefreshCcw, ShieldCheck, Sparkles, Target, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Workspace } from "../../../lib/v2-data";
import { callCalendar, combineLocalDateTime, loadCalendarStatus, localDateInput, type CalendarConnectionStatus, type GoogleCalendarEvent, type GoogleCalendarOption } from "../../../lib/v2-calendar";
import { ensureDefaultRevenueRoutine, loadCalendarRoutines, type CalendarRoutine } from "../../../lib/v2-calendar-routines";
import { findAvailableWindows, proposeWholeDayPlan, type ProposedCalendarBlock } from "../../../lib/v2-calendar-planner";
import styles from "./calendar.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

export default function CalendarPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [routines, setRoutines] = useState<CalendarRoutine[]>([]);
  const [calendars, setCalendars] = useState<GoogleCalendarOption[]>([]);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [date, setDate] = useState(localDateInput());
  const [startTime, setStartTime] = useState("09:30");
  const [duration, setDuration] = useState(60);
  const [taskId, setTaskId] = useState("");
  const [workdayStart, setWorkdayStart] = useState("09:00");
  const [workdayEnd, setWorkdayEnd] = useState("17:30");
  const [proposals, setProposals] = useState<ProposedCalendarBlock[]>([]);
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
        if (session.provider_refresh_token) await callCalendar(supabase, "connect", { refreshToken: session.provider_refresh_token, accessToken: session.provider_token, expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null, scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"] });
        await ensureDefaultRevenueRoutine(supabase, session.user.id);
        const [calendarStatus, nextWorkspace, nextRoutines] = await Promise.all([loadCalendarStatus(supabase, session.user.id), loadV2Workspace(supabase, session.user.id), loadCalendarRoutines(supabase, session.user.id)]);
        setStatus(calendarStatus); setWorkspace(nextWorkspace); setRoutines(nextRoutines);
        setTaskId(nextWorkspace.todayTasks[0]?.id ?? nextWorkspace.allTasks.find(task => task.status !== "complete")?.id ?? "");
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load Calendar."); }
      finally { setLoading(false); }
    });
  }, []);

  const activeTasks = useMemo(() => workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled"), [workspace.allTasks]);
  const selectedTask = activeTasks.find(task => task.id === taskId) ?? null;
  const plannedMinutes = proposals.reduce((total, block) => total + block.minutes, 0);

  async function connectGoogle() {
    if (!supabase) return;
    setBusy(true); setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/v2/calendar/`, scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly", queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } } });
    if (authError) { setError(authError.message); setBusy(false); }
  }

  async function loadCalendars() {
    if (!supabase) return; setBusy(true); setError("");
    try { const result = await callCalendar<{ calendars: GoogleCalendarOption[] }>(supabase, "calendars"); setCalendars(result.calendars); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load calendars."); }
    finally { setBusy(false); }
  }

  async function chooseCalendar(calendar: GoogleCalendarOption) {
    if (!supabase) return; setBusy(true); setError("");
    try { await callCalendar(supabase, "selectCalendar", { calendarId: calendar.id, calendarName: calendar.name }); setStatus(current => current ? { ...current, selected_calendar_id: calendar.id, selected_calendar_name: calendar.name } : current); setMessage(`${calendar.name} is now the managed calendar.`); await loadDay(calendar.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to select calendar."); }
    finally { setBusy(false); }
  }

  async function loadDay(calendarId = status?.selected_calendar_id) {
    if (!supabase || !calendarId) return; setBusy(true); setError(""); setProposals([]);
    try { const from = new Date(`${date}T00:00:00`).toISOString(); const to = new Date(`${date}T23:59:59`).toISOString(); const result = await callCalendar<{ events: GoogleCalendarEvent[] }>(supabase, "events", { calendarId, timeMin: from, timeMax: to }); setEvents(result.events); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load the day."); }
    finally { setBusy(false); }
  }

  async function createBlock() {
    if (!supabase || !selectedTask || !status?.selected_calendar_id) return; setBusy(true); setError(""); setMessage("");
    try { const startsAt = combineLocalDateTime(date, startTime); const endsAt = new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString(); await callCalendar(supabase, "createBlock", { taskId: selectedTask.id, title: selectedTask.title, startsAt, endsAt, calendarId: status.selected_calendar_id, timeZone: "Europe/London" }); setMessage(`Blocked ${duration} minutes for “${selectedTask.title}”.`); await loadDay(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create the time block."); }
    finally { setBusy(false); }
  }

  function buildPlan(mode: "whole-day" | "revenue") {
    setError(""); setMessage("");
    const windows = findAvailableWindows(date, events, workdayStart, workdayEnd);
    const candidates = workspace.todayTasks.length ? [...workspace.todayTasks, ...activeTasks.filter(task => !workspace.todayTasks.some(today => today.id === task.id))] : activeTasks;
    const selectedRoutines = mode === "revenue" ? routines.filter(routine => routine.category === "income") : routines;
    let next = proposeWholeDayPlan(candidates, selectedRoutines, windows, date, mode === "revenue" ? 1 : 10);
    if (mode === "revenue") next = next.filter(block => block.source === "routine").slice(0, 1);
    setProposals(next);
    if (!next.length) setError("No suitable free windows were found. Load the day first or widen the working hours.");
  }

  function removeProposal(id: string) { setProposals(current => current.filter(block => block.id !== id)); }

  async function applyPlan() {
    if (!supabase || !status?.selected_calendar_id || !proposals.length) return; setBusy(true); setError(""); setMessage("");
    try { for (const block of proposals) await callCalendar(supabase, "createBlock", { taskId: block.taskId, title: block.title, startsAt: block.startsAt, endsAt: block.endsAt, calendarId: status.selected_calendar_id, timeZone: "Europe/London" }); setMessage(`Added ${proposals.length} protected block${proposals.length === 1 ? "" : "s"}, totalling ${plannedMinutes} minutes.`); setProposals([]); await loadDay(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to apply the proposed plan."); }
    finally { setBusy(false); }
  }

  if (!user && !loading) return <main className={styles.state}><div><h1>Sign in first</h1><Link href="/v2">Back to V2</Link></div></main>;

  return <main className={styles.page}>
    <header className={styles.hero}><div><span>GOOGLE CALENDAR</span><h1>Turn priorities into protected time</h1><p>Protect recurring priorities first, then fit practical tasks around your real commitments.</p></div><div className={styles.trust}><ShieldCheck size={19} /><span>Only Command Centre-created blocks can be moved or deleted.</span></div></header>
    {error && <div className={styles.error}>{error}</div>}{message && <div className={styles.success}><CheckCircle2 size={17} />{message}</div>}

    {loading ? <section className={styles.loading}>Loading Calendar connection…</section> : !status || status.status !== "connected" ? <section className={styles.connectCard}><CalendarDays size={32} /><h2>Connect Google Calendar</h2><p>Connect once so Command Centre can read your commitments and protect time for priority work.</p><button disabled={busy} onClick={connectGoogle}><Link2 size={17} /> Connect Google Calendar</button></section> : <div className={styles.grid}>
      <section className={styles.panel}><div className={styles.panelHeader}><div><CalendarDays size={19} /><h2>Connection</h2></div><span className={styles.connected}>Connected</span></div><dl><div><dt>Google account</dt><dd>{status.google_account_email || "Connected account"}</dd></div><div><dt>Managed calendar</dt><dd>{status.selected_calendar_name || "Not selected"}</dd></div></dl><button className={styles.secondary} disabled={busy} onClick={loadCalendars}><RefreshCcw size={16} /> {calendars.length ? "Refresh calendars" : "Choose calendar"}</button>{calendars.length > 0 && <div className={styles.calendarList}>{calendars.map(calendar => <button key={calendar.id} onClick={() => chooseCalendar(calendar)} className={calendar.id === status.selected_calendar_id ? styles.selectedCalendar : ""}><strong>{calendar.name}</strong><span>{calendar.primary ? "Primary" : calendar.accessRole}</span></button>)}</div>}</section>

      <section className={styles.panel}><div className={styles.panelHeader}><div><Target size={19} /><h2>Protected routines</h2></div></div>{routines.map(routine => <article className={styles.routine} key={routine.id}><div><strong>{routine.title}</strong><span>{routine.idealMinutes} min · weekdays · preferably {routine.preferredStart}–{routine.preferredEnd}</span></div><b>Priority {routine.priority}</b></article>)}<p className={styles.hint}>Revenue generation is protected before ordinary tasks and can move around meetings.</p></section>

      <section className={`${styles.panel} ${styles.planPanel}`}><div className={styles.panelHeader}><div><Sparkles size={19} /><h2>Plan my day</h2></div></div><p className={styles.hint}>Loads recurring priorities first, then fills the remaining capacity with Today tasks and active work. Meeting buffers apply only around real calendar events.</p><div className={styles.fields}><label>Workday starts<input type="time" value={workdayStart} onChange={event => setWorkdayStart(event.target.value)} /></label><label>Workday ends<input type="time" value={workdayEnd} onChange={event => setWorkdayEnd(event.target.value)} /></label><label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div><div className={styles.planActions}><button disabled={busy || !status.selected_calendar_id} onClick={() => buildPlan("whole-day")}><Sparkles size={16} /> Plan my whole day</button><button className={styles.revenueButton} disabled={busy || !status.selected_calendar_id} onClick={() => buildPlan("revenue")}><Target size={16} /> Protect 90 min revenue</button></div>{proposals.length > 0 && <div className={styles.proposals}><div className={styles.planSummary}><strong>{proposals.length} blocks proposed</strong><span>{Math.floor(plannedMinutes / 60)}h {plannedMinutes % 60}m protected</span></div>{proposals.map(block => <article key={block.id}><div><strong>{block.title}</strong><span>{block.source === "routine" ? "Protected routine" : `Priority ${block.priority}`} · {block.minutes} min</span></div><time>{new Date(block.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–{new Date(block.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time><button aria-label={`Remove ${block.title}`} className={styles.removeButton} onClick={() => removeProposal(block.id)}><Trash2 size={15} /></button></article>)}<button disabled={busy} onClick={applyPlan}><CheckCircle2 size={16} /> Apply this plan</button></div>}</section>

      <section className={styles.panel}><div className={styles.panelHeader}><div><Clock3 size={19} /><h2>Schedule one task</h2></div></div><label>Task<select value={taskId} onChange={event => setTaskId(event.target.value)}>{activeTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><div className={styles.fields}><label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Start<input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} /></label><label>Duration<select value={duration} onChange={event => setDuration(Number(event.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hour</option><option value={90}>90 min</option><option value={120}>2 hours</option></select></label></div><button disabled={busy || !selectedTask || !status.selected_calendar_id} onClick={createBlock}><Plus size={17} /> Add protected time</button></section>

      <section className={`${styles.panel} ${styles.dayPanel}`}><div className={styles.panelHeader}><div><CalendarDays size={19} /><h2>{new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h2></div><button className={styles.iconButton} disabled={busy || !status.selected_calendar_id} onClick={() => loadDay()}><RefreshCcw size={16} /></button></div><div className={styles.events}>{events.map(event => <article key={event.id}><time>{event.allDay ? "All day" : `${new Date(event.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${new Date(event.end).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}</time><strong>{event.title}</strong></article>)}{events.length === 0 && <p className={styles.hint}>No events loaded. Use refresh before planning so meetings are accounted for.</p>}</div></section>
    </div>}
  </main>;
}
