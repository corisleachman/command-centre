"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Task, type V2Workspace } from "../../../lib/v2-data";
import {
  callCalendar,
  loadCalendarStatus,
  type CalendarConnectionStatus,
  type GoogleCalendarEvent,
} from "../../../lib/v2-calendar";
import { assignTaskToDay, dateKey, tasksForDay, weekDays } from "../../../lib/v2-week-planner";
import styles from "./week.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };
const WORKDAY_START = 9 * 60;
const WORKDAY_END = 17 * 60 + 30;
const DAILY_CAPACITY = WORKDAY_END - WORKDAY_START;
type DayPart = "auto" | "morning" | "afternoon";

type WeekEvents = Record<string, GoogleCalendarEvent[]>;

function minutesSinceMidnight(value: string) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function isoAt(day: Date, minutes: number) {
  const value = new Date(day);
  value.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return value.toISOString();
}

function findFreeSlot(day: Date, minutes: number, events: GoogleCalendarEvent[], part: DayPart) {
  const rangeStart = part === "afternoon" ? 13 * 60 : WORKDAY_START;
  const rangeEnd = part === "morning" ? 13 * 60 : WORKDAY_END;
  const busy = events
    .filter((event) => !event.allDay && event.status !== "cancelled")
    .map((event) => ({ start: minutesSinceMidnight(event.start), end: minutesSinceMidnight(event.end) }))
    .sort((a, b) => a.start - b.start);

  for (let cursor = rangeStart; cursor + minutes <= rangeEnd; cursor += 15) {
    const end = cursor + minutes;
    if (!busy.some((event) => cursor < event.end && end > event.start)) {
      return { startsAt: isoAt(day, cursor), endsAt: isoAt(day, end), startMinutes: cursor, endMinutes: end };
    }
  }
  return null;
}

function eventMinutes(events: GoogleCalendarEvent[]) {
  return events.reduce((total, event) => {
    if (event.allDay || event.status === "cancelled") return total;
    const start = Math.max(WORKDAY_START, minutesSinceMidnight(event.start));
    const end = Math.min(WORKDAY_END, minutesSinceMidnight(event.end));
    return total + Math.max(0, end - start);
  }, 0);
}

export default function WeekPlannerPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [calendarStatus, setCalendarStatus] = useState<CalendarConnectionStatus | null>(null);
  const [eventsByDay, setEventsByDay] = useState<WeekEvents>({});
  const [anchor, setAnchor] = useState(new Date());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [busy, setBusy] = useState(false);
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

  async function reload() {
    if (!supabase || !user) return;
    setLoading(true);
    try {
      const [nextWorkspace, nextStatus] = await Promise.all([
        loadV2Workspace(supabase, user.id),
        loadCalendarStatus(supabase, user.id),
      ]);
      setWorkspace(nextWorkspace);
      setCalendarStatus(nextStatus);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load week planner.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) void reload(); }, [user]);
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekKeys = useMemo(() => new Set(days.map(dateKey)), [days]);
  const backlog = workspace.allTasks
    .filter((task) => task.status !== "complete" && task.status !== "cancelled" && (!task.dueOn || !weekKeys.has(task.dueOn)))
    .filter((task) => task.title.toLowerCase().includes(query.toLowerCase()));
  const initiativeTitle = (task: V2Task) => workspace.initiatives.find((item) => item.id === task.initiativeId)?.title ?? "Unassigned";
  const calendarConnected = calendarStatus?.status === "connected" && Boolean(calendarStatus.selected_calendar_id);

  async function loadWeekEvents() {
    if (!supabase || !calendarStatus?.selected_calendar_id) {
      setEventsByDay({});
      return;
    }
    setCalendarLoading(true);
    try {
      const pairs = await Promise.all(days.map(async (day) => {
        const key = dateKey(day);
        const result = await callCalendar<{ events: GoogleCalendarEvent[] }>(supabase, "events", {
          calendarId: calendarStatus.selected_calendar_id,
          timeMin: new Date(`${key}T00:00:00`).toISOString(),
          timeMax: new Date(`${key}T23:59:59`).toISOString(),
        });
        return [key, result.events] as const;
      }));
      setEventsByDay(Object.fromEntries(pairs));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Calendar capacity.");
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && calendarConnected) void loadWeekEvents();
    if (!calendarConnected) setEventsByDay({});
  }, [loading, calendarStatus?.selected_calendar_id, anchor]);

  async function move(taskId: string, day: Date | null) {
    if (!supabase || !user) return;
    setBusy(true);
    try { await assignTaskToDay(supabase, user.id, taskId, day); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to move task."); }
    finally { setBusy(false); }
  }

  async function scheduleTask(task: V2Task, day: Date, part: DayPart = "auto") {
    if (!supabase || !user) return;
    if (!calendarConnected || !calendarStatus?.selected_calendar_id) {
      setError("Connect and select Google Calendar before scheduling work blocks.");
      return;
    }
    const key = dateKey(day);
    const slot = findFreeSlot(day, task.estimatedMinutes, eventsByDay[key] ?? [], part);
    if (!slot) {
      setError(`No ${part === "auto" ? "suitable" : part} slot is available on ${day.toLocaleDateString("en-GB", { weekday: "long" })}.`);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      await callCalendar(supabase, "createBlock", {
        taskId: task.id,
        title: task.title,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        calendarId: calendarStatus.selected_calendar_id,
        timeZone: "Europe/London",
      });
      await assignTaskToDay(supabase, user.id, task.id, day);
      setEventsByDay((current) => ({
        ...current,
        [key]: [...(current[key] ?? []), {
          id: `local-${task.id}-${slot.startsAt}`,
          title: task.title,
          start: slot.startsAt,
          end: slot.endsAt,
          allDay: false,
          status: "confirmed",
        }],
      }));
      setMessage(`Scheduled “${task.title}” for ${day.toLocaleDateString("en-GB", { weekday: "long" })} at ${new Date(slot.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the Calendar block.");
    } finally {
      setBusy(false);
    }
  }

  async function scheduleRemainingWeek() {
    if (!supabase || !user || !calendarConnected || !calendarStatus?.selected_calendar_id) {
      setError("Connect and select Google Calendar before scheduling the week.");
      return;
    }
    const candidates = [...backlog].sort((a, b) => b.priority - a.priority || a.position - b.position);
    if (!candidates.length) {
      setMessage("There are no unscheduled tasks to place this week.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    const workingEvents: WeekEvents = Object.fromEntries(days.map((day) => [dateKey(day), [...(eventsByDay[dateKey(day)] ?? [])]]));
    let scheduled = 0;
    try {
      for (const task of candidates) {
        let chosen: { day: Date; slot: NonNullable<ReturnType<typeof findFreeSlot>> } | null = null;
        for (const day of days) {
          const slot = findFreeSlot(day, task.estimatedMinutes, workingEvents[dateKey(day)] ?? [], "auto");
          if (slot) { chosen = { day, slot }; break; }
        }
        if (!chosen) continue;
        await callCalendar(supabase, "createBlock", {
          taskId: task.id,
          title: task.title,
          startsAt: chosen.slot.startsAt,
          endsAt: chosen.slot.endsAt,
          calendarId: calendarStatus.selected_calendar_id,
          timeZone: "Europe/London",
        });
        await assignTaskToDay(supabase, user.id, task.id, chosen.day);
        const key = dateKey(chosen.day);
        workingEvents[key].push({
          id: `local-${task.id}-${chosen.slot.startsAt}`,
          title: task.title,
          start: chosen.slot.startsAt,
          end: chosen.slot.endsAt,
          allDay: false,
          status: "confirmed",
        });
        scheduled += 1;
      }
      setEventsByDay(workingEvents);
      setMessage(`Scheduled ${scheduled} task${scheduled === 1 ? "" : "s"} into available time this week${scheduled < candidates.length ? `; ${candidates.length - scheduled} still need capacity` : ""}.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to schedule the remaining week.");
    } finally {
      setBusy(false);
    }
  }

  function shiftWeek(offset: number) {
    const next = new Date(anchor);
    next.setDate(next.getDate() + offset * 7);
    setAnchor(next);
  }

  if (!user) return <main className={styles.auth}><div><h1>{loading ? "Checking your session..." : "Sign in first"}</h1>{!loading && <Link href="/v2">Back to V2</Link>}</div></main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/v2" className={styles.back}><ArrowLeft size={17} /> Back to dashboard</Link><span>WEEK PLANNER</span><h1>Put the work into time</h1><p>Schedule tasks around real commitments without rebuilding every event by hand.</p></div>
      <div className={styles.headerTools}>
        <button className={styles.autoButton} onClick={() => void scheduleRemainingWeek()} disabled={busy || loading || calendarLoading || !calendarConnected}><Sparkles size={17} /> Schedule the rest of my week</button>
        <div className={styles.weekControls}><button onClick={() => shiftWeek(-1)}><ChevronLeft /></button><strong>{days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {days[4].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong><button onClick={() => shiftWeek(1)}><ChevronRight /></button></div>
      </div>
    </header>

    {!calendarConnected && !loading && <div className={styles.notice}><CalendarDays size={18} /><div><strong>Calendar scheduling is not ready</strong><span>Connect and select a Google Calendar to turn weekday choices into protected work blocks.</span></div><Link href="/v2/calendar">Open Calendar setup</Link></div>}
    {calendarLoading && <div className={styles.notice}><Clock3 size={18} /><div><strong>Reading this week’s commitments</strong><span>Capacity and scheduling controls will be ready in a moment.</span></div></div>}
    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={17} /> {message}</div>}

    {loading ? <div className={styles.state}>Loading your week...</div> : <section className={styles.board}>
      <aside className={styles.backlog}>
        <div><span>BACKLOG</span><h2>Unscheduled work</h2><p>{backlog.length} task{backlog.length === 1 ? "" : "s"} waiting for time.</p></div>
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" /></label>
        <div className={styles.taskList}>{backlog.map((task) => <article key={task.id}>
          <strong>{task.title}</strong><small>{initiativeTitle(task)} · {task.estimatedMinutes} min · priority {task.priority}</small>
          <div className={styles.scheduleGrid}>{days.map((day) => <div className={styles.dayChoice} key={dateKey(day)}><b>{day.toLocaleDateString("en-GB", { weekday: "short" })}</b><button onClick={() => void scheduleTask(task, day, "morning")} disabled={busy || calendarLoading || !calendarConnected}>AM</button><button onClick={() => void scheduleTask(task, day, "afternoon")} disabled={busy || calendarLoading || !calendarConnected}>PM</button></div>)}</div>
        </article>)}{backlog.length === 0 && <p className={styles.empty}>No matching unscheduled tasks.</p>}</div>
      </aside>

      <div className={styles.days}>{days.map((day) => {
        const key = dateKey(day);
        const tasks = tasksForDay(workspace.allTasks, day);
        const taskMinutes = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
        const meetingMinutes = eventMinutes(eventsByDay[key] ?? []);
        const available = Math.max(0, DAILY_CAPACITY - meetingMinutes);
        const overloaded = taskMinutes > available;
        return <section key={key} className={`${styles.day} ${overloaded ? styles.overloaded : ""}`}>
          <header><div><span>{day.toLocaleDateString("en-GB", { weekday: "long" })}</span><strong>{day.getDate()}</strong></div><small><Clock3 size={14} /> {Math.round(taskMinutes / 15) / 4}h tasks</small></header>
          <div className={styles.capacity}><span style={{ width: `${Math.min(100, available ? taskMinutes / available * 100 : 100)}%` }} /><div><b>{Math.round(available / 15) / 4}h available</b><small>{Math.round(meetingMinutes / 15) / 4}h already committed</small></div></div>
          {overloaded && <p className={styles.overloadWarning}>Over capacity by {taskMinutes - available} minutes.</p>}
          <div>{tasks.map((task) => <article key={task.id}><button className={styles.remove} onClick={() => void move(task.id, null)} disabled={busy} title="Return task to the unscheduled list"><X size={14} /></button><strong>{task.title}</strong><small>{initiativeTitle(task)}</small><span>{task.estimatedMinutes} min</span></article>)}{tasks.length === 0 && <div className={styles.dayEmpty}><CalendarDays size={20} /> No tasks scheduled</div>}</div>
        </section>;
      })}</div>
    </section>}
  </main>;
}
