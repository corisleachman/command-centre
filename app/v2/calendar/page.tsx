"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink,
  Link2, Pencil, Search, Sparkles, Trash2, X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Task, type V2Workspace } from "../../../lib/v2-data";
import {
  callCalendar, loadCalendarStatus, localDateInput,
  type CalendarConnectionStatus, type GoogleCalendarEvent,
} from "../../../lib/v2-calendar";
import { assignTaskToDay, dateKey, tasksForDay, weekDays } from "../../../lib/v2-week-planner";
import styles from "./calendar.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };
const WORKDAY_START = 9 * 60;
const WORKDAY_END = 17 * 60 + 30;
const MAX_WEEKLY_PROPOSALS = 5;
const MAX_PER_INITIATIVE = 2;
type ViewMode = "week" | "day";
type DayPart = "morning" | "afternoon" | "auto";
type WeekEvents = Record<string, GoogleCalendarEvent[]>;
type ProposedTaskBlock = { task: V2Task; day: Date; startsAt: string; endsAt: string };

function minutesSinceMidnight(value: string) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function isoAt(day: Date, minutes: number) {
  const value = new Date(day);
  value.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return value.toISOString();
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function durationMinutes(event: GoogleCalendarEvent) {
  return Math.max(0, Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000));
}

function findFreeSlot(day: Date, minutes: number, events: GoogleCalendarEvent[], part: DayPart) {
  const rangeStart = part === "afternoon" ? 13 * 60 : WORKDAY_START;
  const rangeEnd = part === "morning" ? 13 * 60 : WORKDAY_END;
  const busy = events
    .filter(event => !event.allDay && event.status !== "cancelled")
    .map(event => ({ start: minutesSinceMidnight(event.start), end: minutesSinceMidnight(event.end) }))
    .sort((a, b) => a.start - b.start);
  for (let cursor = rangeStart; cursor + minutes <= rangeEnd; cursor += 15) {
    const end = cursor + minutes;
    if (!busy.some(event => cursor < event.end && end > event.start)) {
      return { startsAt: isoAt(day, cursor), endsAt: isoAt(day, end) };
    }
  }
  return null;
}

function eventMatchesTask(event: GoogleCalendarEvent, task: V2Task) {
  if (event.taskId === task.id) return true;
  const clean = event.title.replace(/^Focus:\s*/i, "").trim().toLowerCase();
  return clean === task.title.trim().toLowerCase();
}

export default function UnifiedCalendarPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [eventsByDay, setEventsByDay] = useState<WeekEvents>({});
  const [anchor, setAnchor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(localDateInput());
  const [view, setView] = useState<ViewMode>("week");
  const [query, setQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<GoogleCalendarEvent | null>(null);
  const [proposals, setProposals] = useState<ProposedTaskBlock[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setUser(data.session?.user ?? null);
      if (!data.session?.user) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function reloadWorkspace() {
    if (!supabase || !user) return;
    setLoading(true);
    try {
      const [nextWorkspace, nextStatus] = await Promise.all([
        loadV2Workspace(supabase, user.id),
        loadCalendarStatus(supabase, user.id),
      ]);
      setWorkspace(nextWorkspace);
      setStatus(nextStatus);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the planner.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) void reloadWorkspace(); }, [user]);

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const visibleDays = view === "day"
    ? days.filter(day => dateKey(day) === selectedDate).length ? days.filter(day => dateKey(day) === selectedDate) : [new Date(`${selectedDate}T12:00:00`)]
    : days;
  const activeTasks = workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled");
  const visibleEvents = Object.values(eventsByDay).flat().filter(event => event.status !== "cancelled");
  const backlog = activeTasks
    .filter(task => !visibleEvents.some(event => eventMatchesTask(event, task)))
    .filter(task => task.title.toLowerCase().includes(query.toLowerCase()));
  const calendarConnected = status?.status === "connected" && Boolean(status.selected_calendar_id);
  const initiativeTitle = (task: V2Task) => workspace.initiatives.find(item => item.id === task.initiativeId)?.title ?? "Unassigned";

  async function loadEvents() {
    if (!supabase || !status?.selected_calendar_id) { setEventsByDay({}); return; }
    setCalendarLoading(true);
    setError("");
    try {
      const targets = view === "day" ? visibleDays : days;
      const pairs = await Promise.all(targets.map(async day => {
        const key = dateKey(day);
        const result = await callCalendar<{ events: GoogleCalendarEvent[] }>(supabase, "events", {
          calendarId: status.selected_calendar_id,
          timeMin: new Date(`${key}T00:00:00`).toISOString(),
          timeMax: new Date(`${key}T23:59:59`).toISOString(),
        });
        return [key, result.events] as const;
      }));
      setEventsByDay(current => view === "day" ? { ...current, ...Object.fromEntries(pairs) } : Object.fromEntries(pairs));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read Google Calendar.");
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    setProposals([]);
    setSelectedEventIds(new Set());
    if (!loading && calendarConnected) void loadEvents();
    if (!calendarConnected) setEventsByDay({});
  }, [loading, status?.selected_calendar_id, anchor, selectedDate, view]);

  async function connectGoogle() {
    if (!supabase) return;
    setBusy(true);
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

  async function scheduleTask(task: V2Task, day: Date, part: DayPart = "auto") {
    if (!supabase || !user || !status?.selected_calendar_id) return;
    const key = dateKey(day);
    const existing = eventsByDay[key] ?? [];
    if (existing.some(event => eventMatchesTask(event, task))) {
      setError(`“${task.title}” is already in the Calendar on ${day.toLocaleDateString("en-GB", { weekday: "long" })}.`);
      return;
    }
    const slot = findFreeSlot(day, task.estimatedMinutes, existing, part);
    if (!slot) { setError(`No suitable ${part === "auto" ? "" : `${part} `}slot is available.`); return; }
    setBusy(true); setError(""); setMessage(""); setProgress(`Scheduling “${task.title}”…`);
    try {
      await callCalendar(supabase, "createBlock", {
        taskId: task.id, title: task.title, startsAt: slot.startsAt, endsAt: slot.endsAt,
        calendarId: status.selected_calendar_id, timeZone: "Europe/London",
      });
      await assignTaskToDay(supabase, user.id, task.id, day);
      setMessage(`Scheduled “${task.title}” on ${day.toLocaleDateString("en-GB", { weekday: "long" })} at ${timeLabel(slot.startsAt)}.`);
      await reloadWorkspace();
      await loadEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to schedule the task.");
    } finally { setBusy(false); setProgress(""); }
  }

  function buildPlan(targetDays: Date[]) {
    const candidates = [...backlog].sort((a, b) => b.priority - a.priority || a.position - b.position);
    if (!candidates.length) { setMessage("There are no unscheduled tasks to place."); return; }

    const working: WeekEvents = Object.fromEntries(targetDays.map(day => [dateKey(day), [...(eventsByDay[dateKey(day)] ?? [])]]));
    const initiativeCounts = new Map<string, number>();
    const next: ProposedTaskBlock[] = [];

    for (const task of candidates) {
      if (next.length >= (view === "week" ? MAX_WEEKLY_PROPOSALS : 3)) break;
      const group = task.initiativeId ?? "unassigned";
      if ((initiativeCounts.get(group) ?? 0) >= MAX_PER_INITIATIVE) continue;
      let choice: ProposedTaskBlock | null = null;
      for (const day of targetDays) {
        const key = dateKey(day);
        const slot = findFreeSlot(day, task.estimatedMinutes, working[key], "auto");
        if (slot) { choice = { task, day, startsAt: slot.startsAt, endsAt: slot.endsAt }; break; }
      }
      if (!choice) continue;
      next.push(choice);
      initiativeCounts.set(group, (initiativeCounts.get(group) ?? 0) + 1);
      working[dateKey(choice.day)].push({ id: `proposal-${task.id}`, title: task.title, start: choice.startsAt, end: choice.endsAt, allDay: false, status: "confirmed", editable: true, managed: true, taskId: task.id });
    }

    setProposals(next);
    setError("");
    setMessage(next.length ? `Review ${next.length} proposed block${next.length === 1 ? "" : "s"} before adding anything to Calendar.` : "No suitable free slots were found.");
  }

  async function applyPlan() {
    if (!supabase || !user || !status?.selected_calendar_id || !proposals.length) return;
    setBusy(true); setError(""); setMessage("");
    try {
      for (let index = 0; index < proposals.length; index += 1) {
        const block = proposals[index];
        setProgress(`Scheduling ${index + 1} of ${proposals.length}: ${block.task.title}`);
        await callCalendar(supabase, "createBlock", {
          taskId: block.task.id, title: block.task.title, startsAt: block.startsAt, endsAt: block.endsAt,
          calendarId: status.selected_calendar_id, timeZone: "Europe/London",
        });
        await assignTaskToDay(supabase, user.id, block.task.id, block.day);
      }
      setMessage(`Added ${proposals.length} reviewed task${proposals.length === 1 ? "" : "s"} to Calendar.`);
      setProposals([]);
      await reloadWorkspace();
      await loadEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to apply the reviewed plan.");
    } finally { setBusy(false); setProgress(""); }
  }

  async function deleteOneEvent(event: GoogleCalendarEvent) {
    if (!supabase || !user || !status?.selected_calendar_id || event.editable === false || event.allDay) return;
    if (!window.confirm(`Delete “${event.title}” from Google Calendar?`)) return;
    setBusy(true); setProgress(`Deleting “${event.title}”…`); setError("");
    try {
      await callCalendar(supabase, "deleteEvent", { eventId: event.id, blockId: event.blockId, calendarId: status.selected_calendar_id });
      if (event.taskId) await assignTaskToDay(supabase, user.id, event.taskId, null);
      setMessage(`Deleted “${event.title}”.`);
      await reloadWorkspace();
      await loadEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete the event.");
    } finally { setBusy(false); setProgress(""); }
  }

  async function deleteSelectedEvents() {
    if (!supabase || !user || !status?.selected_calendar_id || !selectedEventIds.size) return;
    const selected = visibleEvents.filter(event => selectedEventIds.has(event.id) && event.editable !== false && !event.allDay);
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected Calendar event${selected.length === 1 ? "" : "s"}? Linked tasks will return to the backlog.`)) return;
    setBusy(true); setError("");
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const event = selected[index];
        setProgress(`Deleting ${index + 1} of ${selected.length}: ${event.title}`);
        await callCalendar(supabase, "deleteEvent", { eventId: event.id, blockId: event.blockId, calendarId: status.selected_calendar_id });
        if (event.taskId) await assignTaskToDay(supabase, user.id, event.taskId, null);
      }
      setMessage(`Deleted ${selected.length} event${selected.length === 1 ? "" : "s"}.`);
      setSelectedEventIds(new Set());
      setSelectionMode(false);
      await reloadWorkspace();
      await loadEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete all selected events.");
    } finally { setBusy(false); setProgress(""); }
  }

  function toggleSelectedEvent(id: string) {
    setSelectedEventIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function shift(offset: number) {
    const next = new Date(anchor);
    next.setDate(next.getDate() + offset * (view === "week" ? 7 : 1));
    setAnchor(next);
    if (view === "day") setSelectedDate(dateKey(next));
  }

  if (!user && !loading) return <main className={styles.state}><div><h1>Sign in first</h1><Link href="/v2">Back to Command Centre</Link></div></main>;

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><span>CALENDAR PLANNER</span><h1>Your Google Calendar, plus your work.</h1><p>Manage commitments, schedule tasks and protect capacity from one place.</p></div>
      <div className={styles.toolbar}>
        <div className={styles.viewToggle}><button className={view === "week" ? styles.activeToggle : ""} onClick={() => setView("week")}>Week</button><button className={view === "day" ? styles.activeToggle : ""} onClick={() => { setView("day"); setSelectedDate(localDateInput(anchor)); }}>Day</button></div>
        <button onClick={() => buildPlan(view === "week" ? days : visibleDays)} disabled={busy || calendarLoading || !calendarConnected}><Sparkles size={17} /> {view === "week" ? "Propose my week" : "Propose this day"}</button>
        <button className={styles.secondaryToolbar} onClick={() => { setSelectionMode(current => !current); setSelectedEventIds(new Set()); }} disabled={busy}>{selectionMode ? "Cancel selection" : "Select events"}</button>
        {selectionMode && <button className={styles.deleteToolbar} onClick={() => void deleteSelectedEvents()} disabled={busy || !selectedEventIds.size}><Trash2 size={16} /> Delete selected ({selectedEventIds.size})</button>}
      </div>
    </header>

    {progress && <div className={styles.progress}><Clock3 size={17} /> {progress}</div>}
    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={17} /> {message}</div>}

    {proposals.length > 0 && <section className={styles.proposalPanel}>
      <div><span>PROPOSED PLAN</span><h2>Nothing has been added yet</h2><p>Command Centre has capped this plan at {view === "week" ? MAX_WEEKLY_PROPOSALS : 3} tasks and no more than {MAX_PER_INITIATIVE} from one initiative.</p></div>
      <div className={styles.proposalList}>{proposals.map(block => <article key={block.task.id}><div><strong>{block.task.title}</strong><small>{initiativeTitle(block.task)}</small></div><time>{block.day.toLocaleDateString("en-GB", { weekday: "short" })} {timeLabel(block.startsAt)}–{timeLabel(block.endsAt)}</time><button onClick={() => setProposals(current => current.filter(item => item.task.id !== block.task.id))}><X size={15} /></button></article>)}</div>
      <div className={styles.proposalActions}><button onClick={() => setProposals([])} disabled={busy}>Cancel</button><button onClick={() => void applyPlan()} disabled={busy}>Add {proposals.length} to Calendar</button></div>
    </section>}

    {loading ? <section className={styles.loading}>Loading your planner…</section> : !calendarConnected ? <section className={styles.connectCard}><CalendarDays size={34} /><h2>Connect Google Calendar</h2><p>The unified planner needs Calendar access to display and manage your schedule.</p><button onClick={connectGoogle} disabled={busy}><Link2 size={17} /> Connect Google Calendar</button></section> : <>
      <section className={styles.rangeBar}>
        <button onClick={() => shift(-1)}><ChevronLeft /></button>
        <strong>{view === "week" ? `${days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${days[4].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong>
        <button onClick={() => shift(1)}><ChevronRight /></button>
      </section>

      <section className={styles.plannerGrid}>
        <aside className={styles.backlog}>
          <div><span>UNSCHEDULED TASKS</span><h2>Waiting for time</h2><p>{backlog.length} task{backlog.length === 1 ? "" : "s"}</p></div>
          <label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks" /></label>
          <div className={styles.taskList}>{backlog.map(task => <article key={task.id}><strong>{task.title}</strong><small>{initiativeTitle(task)} · {task.estimatedMinutes} min · priority {task.priority}{task.dueOn ? ` · due ${task.dueOn}` : ""}</small><div>{visibleDays.map(day => <span key={dateKey(day)}><b>{day.toLocaleDateString("en-GB", { weekday: "short" })}</b><button onClick={() => void scheduleTask(task, day, "morning")} disabled={busy}>AM</button><button onClick={() => void scheduleTask(task, day, "afternoon")} disabled={busy}>PM</button></span>)}</div></article>)}{backlog.length === 0 && <p className={styles.empty}>No matching unscheduled tasks.</p>}</div>
        </aside>

        <div className={`${styles.calendarBoard} ${view === "day" ? styles.dayBoard : ""}`}>
          {visibleDays.map(day => {
            const key = dateKey(day);
            const events = [...(eventsByDay[key] ?? [])].filter(event => event.status !== "cancelled").sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            const datedTasks = tasksForDay(workspace.allTasks, day).filter(task => !events.some(event => eventMatchesTask(event, task)));
            const externalMinutes = events.filter(event => !event.managed).reduce((sum, event) => sum + durationMinutes(event), 0);
            const commandMinutes = events.filter(event => event.managed).reduce((sum, event) => sum + durationMinutes(event), 0);
            const remaining = Math.max(0, WORKDAY_END - WORKDAY_START - externalMinutes - commandMinutes);
            return <section className={styles.dayColumn} key={key}>
              <header><div><span>{day.toLocaleDateString("en-GB", { weekday: "long" })}</span><strong>{day.getDate()}</strong></div><small><Clock3 size={14} /> {Math.round(remaining / 15) / 4}h free</small></header>
              <div className={styles.capacity}><div><b>{Math.round(externalMinutes / 15) / 4}h commitments</b><b>{Math.round(commandMinutes / 15) / 4}h Command Centre</b></div><span>{Math.round(remaining / 15) / 4}h genuinely free</span></div>
              <div className={styles.timeline}>
                {events.map(event => <div key={event.id} className={`${styles.eventRow} ${event.managed ? styles.managedEvent : styles.googleEvent}`}>
                  {selectionMode && event.editable !== false && !event.allDay && <input type="checkbox" checked={selectedEventIds.has(event.id)} onChange={() => toggleSelectedEvent(event.id)} aria-label={`Select ${event.title}`} />}
                  <button className={styles.eventMain} onClick={() => selectionMode ? toggleSelectedEvent(event.id) : setSelectedEvent(event)}><time>{event.allDay ? "All day" : `${timeLabel(event.start)}–${timeLabel(event.end)}`}</time><strong>{event.title}</strong><small>{event.managed ? "Command Centre" : "Google Calendar"}{event.editable === false ? " · view only" : ""}</small></button>
                  {!selectionMode && event.editable !== false && !event.allDay && <button className={styles.quickDelete} onClick={() => void deleteOneEvent(event)} title="Delete event"><Trash2 size={14} /></button>}
                </div>)}
                {datedTasks.map(task => <article className={styles.unscheduledCard} key={task.id}><strong>{task.title}</strong><small>Task dated for this day, not yet in Calendar</small><button onClick={() => void scheduleTask(task, day, "auto")} disabled={busy}>Find a time</button></article>)}
                {!events.length && !datedTasks.length && <div className={styles.emptyDay}><CalendarDays size={20} /> No events or tasks</div>}
              </div>
            </section>;
          })}
        </div>
      </section>
    </>}

    {selectedEvent && status?.selected_calendar_id && <EventDrawer event={selectedEvent} calendarId={status.selected_calendar_id} userId={user?.id ?? ""} onClose={() => setSelectedEvent(null)} onChanged={async () => { setSelectedEvent(null); await reloadWorkspace(); await loadEvents(); }} />}
  </main>;
}

function EventDrawer({ event, calendarId, userId, onClose, onChanged }: { event: GoogleCalendarEvent; calendarId: string; userId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(localDateInput(new Date(event.start)));
  const [startTime, setStartTime] = useState(timeLabel(event.start));
  const [endTime, setEndTime] = useState(timeLabel(event.end));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = event.editable !== false && !event.allDay;

  async function save() {
    if (!supabase || !editable) return;
    setBusy(true); setError("");
    try {
      const startsAt = new Date(`${date}T${startTime}:00`).toISOString();
      const endsAt = new Date(`${date}T${endTime}:00`).toISOString();
      if (new Date(endsAt) <= new Date(startsAt)) throw new Error("End time must be after start time.");
      await callCalendar(supabase, "updateEvent", { eventId: event.id, blockId: event.blockId, calendarId, title: title.trim() || "Untitled event", startsAt, endsAt, timeZone: "Europe/London" });
      if (event.taskId && userId) await assignTaskToDay(supabase, userId, event.taskId, new Date(`${date}T12:00:00`));
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update event."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!supabase || !editable || !window.confirm(`Delete “${event.title}” from Google Calendar?`)) return;
    setBusy(true); setError("");
    try {
      await callCalendar(supabase, "deleteEvent", { eventId: event.id, blockId: event.blockId, calendarId });
      if (event.taskId && userId) await assignTaskToDay(supabase, userId, event.taskId, null);
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete event."); }
    finally { setBusy(false); }
  }

  return <div className={styles.drawerBackdrop} onClick={onClose}><aside className={styles.drawer} onClick={click => click.stopPropagation()}>
    <header><div><span>{event.managed ? "COMMAND CENTRE BLOCK" : "GOOGLE CALENDAR EVENT"}</span><h2>Manage event</h2></div><button onClick={onClose}><X /></button></header>
    {error && <div className={styles.drawerError}>{error}</div>}
    <label>Title<input value={title} onChange={change => setTitle(change.target.value)} disabled={!editable} /></label>
    <label>Date<input type="date" value={date} onChange={change => setDate(change.target.value)} disabled={!editable} /></label>
    <div className={styles.timeFields}><label>Starts<input type="time" value={startTime} onChange={change => setStartTime(change.target.value)} disabled={!editable} /></label><label>Ends<input type="time" value={endTime} onChange={change => setEndTime(change.target.value)} disabled={!editable} /></label></div>
    {!editable && <p className={styles.readOnly}>This event is view only or all-day. Manage it in Google Calendar.</p>}
    {event.taskId && <p className={styles.linkedNote}>Linked task will move with this event. Deleting the event returns the task to the backlog.</p>}
    <div className={styles.drawerActions}>{event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open in Google</a>}<button className={styles.deleteButton} onClick={() => void remove()} disabled={busy || !editable}><Trash2 size={16} /> Delete</button><button onClick={() => void save()} disabled={busy || !editable}><Pencil size={16} /> Save changes</button></div>
  </aside></div>;
}