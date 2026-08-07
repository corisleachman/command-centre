"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Inbox,
  ListTodo,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import {
  loadV2Workspace,
  setV2TaskComplete,
  type V2Task,
  type V2Workspace,
} from "../../lib/v2-data";
import {
  callCalendar,
  loadCalendarStatus,
  localDateInput,
  type CalendarConnectionStatus,
  type GoogleCalendarEvent,
} from "../../lib/v2-calendar";
import { assignTaskToDay } from "../../lib/v2-week-planner";
import { proposeDailyPlan, type DailyPlanBlock } from "../../lib/v2-daily-intelligence";
import CreateTaskModal from "./components/CreateTaskModal";
import styles from "./v2.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

function taskMeta(task: V2Task) {
  const label = task.category === "cash" ? "Revenue" : task.category === "build" ? "Build" : task.category === "health" ? "Health" : "Life";
  return `${label} · ${task.estimatedMinutes} min${task.dueOn ? ` · due ${task.dueOn}` : ""}`;
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function V2Page() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [calendarStatus, setCalendarStatus] = useState<CalendarConnectionStatus | null>(null);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [proposal, setProposal] = useState<DailyPlanBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showNewTask, setShowNewTask] = useState(false);
  const today = localDateInput();

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      setLoading(false);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setUser(data.session?.user ?? null);
      if (!data.session?.user) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      if (!session?.user) setLoading(false);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
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
      setCalendarStatus(nextStatus);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Today.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) void reloadWorkspace(); }, [user]);

  const calendarConnected = calendarStatus?.status === "connected" && Boolean(calendarStatus.selected_calendar_id);

  async function loadTodayEvents() {
    if (!supabase || !calendarStatus?.selected_calendar_id) { setEvents([]); return; }
    setCalendarLoading(true);
    try {
      const result = await callCalendar<{ events: GoogleCalendarEvent[] }>(supabase, "events", {
        calendarId: calendarStatus.selected_calendar_id,
        timeMin: new Date(`${today}T00:00:00`).toISOString(),
        timeMax: new Date(`${today}T23:59:59`).toISOString(),
      });
      setEvents(result.events.filter(event => event.status !== "cancelled"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read today's Calendar.");
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => { if (!loading && calendarConnected) void loadTodayEvents(); }, [loading, calendarStatus?.selected_calendar_id]);

  const intelligence = useMemo(() => proposeDailyPlan(workspace, events, today), [workspace, events, today]);
  const activeTasks = workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled");
  const bigThree = workspace.todayTasks.length ? workspace.todayTasks.slice(0, 3) : intelligence.recommendations.slice(0, 3).map(item => item.task);
  const nextEvent = [...events]
    .filter(event => !event.allDay && new Date(event.end).getTime() > Date.now())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  const nextAction = intelligence.recommendations[0] ?? null;
  const revenueAction = intelligence.recommendations.find(item => item.task.category === "cash") ?? null;
  const overdueCount = activeTasks.filter(task => task.dueOn && task.dueOn < today).length;
  const inboxCount = workspace.unassignedTasks.filter(task => task.status !== "complete" && task.status !== "cancelled").length;

  async function toggleComplete(task: V2Task) {
    if (!supabase || !user) return;
    setSaving(true);
    try {
      await setV2TaskComplete(supabase, user.id, task, task.status !== "complete");
      await reloadWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update task.");
    } finally { setSaving(false); }
  }

  function buildProposal() {
    setError("");
    setMessage("");
    if (!calendarConnected) {
      setError("Connect Google Calendar before planning the day.");
      return;
    }
    if (!intelligence.blocks.length) {
      setError("There is not enough free time to place a sensible plan around today's commitments.");
      return;
    }
    setProposal(intelligence.blocks);
  }

  async function approvePlan() {
    if (!supabase || !user || !calendarStatus?.selected_calendar_id || !proposal.length) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      for (let index = 0; index < proposal.length; index += 1) {
        const block = proposal[index];
        setProgress(`Scheduling ${index + 1} of ${proposal.length}: ${block.title}`);
        await callCalendar(supabase, "createBlock", {
          taskId: block.taskId,
          title: block.title,
          startsAt: block.startsAt,
          endsAt: block.endsAt,
          calendarId: calendarStatus.selected_calendar_id,
          timeZone: "Europe/London",
        });
        await assignTaskToDay(supabase, user.id, block.taskId, new Date(`${today}T12:00:00`));
      }
      setProposal([]);
      setProgress("");
      setMessage("Today's plan is now protected in Google Calendar.");
      await reloadWorkspace();
      await loadTodayEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to apply today's plan.");
    } finally {
      setProgress("");
      setSaving(false);
    }
  }

  if (!user && !loading) {
    return <main className={styles.authPage}><div className={styles.authCard}><span className={styles.kicker}>COMMAND CENTRE V2</span><h1>Sign in first</h1><p>Today uses your existing Command Centre session.</p><Link className={styles.primaryLink} href="/">Open Command Centre <ArrowRight size={18} /></Link></div></main>;
  }

  return <main className={styles.todayPage}>
    <header className={styles.todayHeader}>
      <div><span className={styles.kicker}>TODAY · {new Date(`${today}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</span><h1>What deserves your time today?</h1><p>Command Centre weighs priorities, deadlines, income and real Calendar capacity before recommending the day.</p></div>
      <div className={styles.todayHeaderActions}><button className={styles.secondaryTodayButton} onClick={() => setShowNewTask(true)}><Plus size={17} /> Add task</button><button className={styles.planTodayButton} onClick={buildProposal} disabled={loading || calendarLoading || saving || !calendarConnected}><Sparkles size={17} /> Propose my day</button></div>
    </header>

    {loading && <div className={styles.stateCard}>Loading your Command Centre...</div>}
    {calendarLoading && !loading && <div className={styles.infoCard}>Reading today's Google Calendar commitments…</div>}
    {error && <div className={styles.errorCard}>{error}</div>}
    {message && <div className={styles.successCard}><CheckCircle2 size={17} /> {message}</div>}
    {progress && <div className={styles.infoCard}><Clock3 size={17} /> {progress}</div>}

    {!loading && <>
      <section className={styles.commandGrid}>
        <article className={styles.bigThreeCard}>
          <div className={styles.cardHeading}><div><span className={styles.kicker}>BIG THREE</span><h2>Only these matter now</h2></div><span>{bigThree.length}/3</span></div>
          <div className={styles.taskList}>{bigThree.map((task, index) => <div className={styles.taskRow} key={task.id}><button className={styles.taskNumber} onClick={() => void toggleComplete(task)} disabled={saving}>{task.status === "complete" ? <Check size={18} /> : index + 1}</button><div className={styles.taskCopy}><strong>{task.title}</strong><small>{taskMeta(task)}</small></div><Link className={styles.openTaskLink} href="/v2/tasks"><ArrowRight size={18} /></Link></div>)}{!bigThree.length && <div className={styles.empty}><CheckCircle2 /><strong>No active priority work</strong><p>Add a task or review your backlog.</p></div>}</div>
        </article>

        <article className={styles.daySignalCard}>
          <span className={styles.kicker}>DAY SIGNALS</span>
          <div className={styles.signalMetric}><strong>{Math.round(intelligence.remainingAfterPlan / 15) / 4}h</strong><span>capacity after a sensible plan</span></div>
          <div className={styles.signalRow}><span><CalendarDays size={16} /> Existing commitments</span><strong>{Math.round(intelligence.committedMinutes / 15) / 4}h</strong></div>
          <div className={styles.signalRow}><span><Target size={16} /> Overdue actions</span><strong>{overdueCount}</strong></div>
          <div className={styles.signalRow}><span><Inbox size={16} /> Inbox</span><strong>{inboxCount}</strong></div>
          <Link className={styles.calendarLink} href="/v2/calendar">Open Calendar planner <ArrowRight size={15} /></Link>
        </article>
      </section>

      <section className={styles.signalGrid}>
        <article className={styles.signalCard}><span className={styles.kicker}>NEXT EVENT</span>{nextEvent ? <><strong>{nextEvent.title}</strong><p>{timeLabel(nextEvent.start)}–{timeLabel(nextEvent.end)}</p></> : <><strong>No upcoming event</strong><p>Your remaining time is currently open.</p></>}</article>
        <article className={styles.signalCard}><span className={styles.kicker}>NEXT RECOMMENDED ACTION</span>{nextAction ? <><strong>{nextAction.task.title}</strong><p>{nextAction.reasons.join(" · ")}</p></> : <><strong>Nothing urgent</strong><p>No active task currently outranks the rest.</p></>}</article>
        <article className={styles.signalCard}><span className={styles.kicker}>REVENUE ACTION</span>{revenueAction ? <><strong>{revenueAction.task.title}</strong><p>{revenueAction.reasons.join(" · ")}</p></> : <><strong>Add a revenue action</strong><p>No active cash task is available for prioritisation.</p></>}</article>
      </section>

      {proposal.length > 0 && <section className={styles.planReviewCard}>
        <div className={styles.planReviewHeader}><div><span className={styles.kicker}>PROPOSED DAY · REVIEW BEFORE APPLYING</span><h2>A deliberately limited plan</h2><p>Maximum six work blocks, one major task per initiative where possible, plus protected buffer time. Nothing has been added to Calendar yet.</p></div><button className={styles.clearProposalButton} onClick={() => setProposal([])}><X size={16} /> Clear</button></div>
        <div className={styles.planMetrics}><span><strong>{proposal.length}</strong> work blocks</span><span><strong>{Math.round(proposal.reduce((sum, block) => sum + block.minutes, 0) / 15) / 4}h</strong> proposed work</span><span><strong>{Math.round(intelligence.bufferMinutes / 15) / 4}h</strong> protected buffer</span></div>
        <div className={styles.planBlocks}>{proposal.map(block => <article key={block.id}><div className={styles.planTime}><strong>{timeLabel(block.startsAt)}</strong><span>{timeLabel(block.endsAt)}</span></div><div><strong>{block.title}</strong><small>{block.initiativeTitle} · {block.reasons.join(" · ")}</small></div><button aria-label={`Remove ${block.title}`} onClick={() => setProposal(current => current.filter(item => item.id !== block.id))}><X size={16} /></button></article>)}</div>
        <div className={styles.planFooter}><p>{intelligence.overloaded ? "This day is over capacity. Remove work before applying." : "Calendar changes only happen after approval."}</p><button className={styles.planTodayButton} onClick={() => void approvePlan()} disabled={saving || intelligence.overloaded || !proposal.length}><CheckCircle2 size={17} /> Approve and add to Calendar</button></div>
      </section>}

      <section className={styles.todayLowerGrid}>
        <article className={styles.todayMiniCard}><div className={styles.sectionHeading}><div><span className={styles.kicker}>TOP RECOMMENDATIONS</span><h2>Why these rise</h2></div><Link href="/v2/tasks">All tasks <ArrowRight size={15} /></Link></div><div className={styles.recommendationList}>{intelligence.recommendations.slice(0, 5).map(item => <div key={item.task.id}><span className={item.task.category === "cash" ? styles.revenuePill : styles.categoryPill}>{item.task.category === "cash" ? <TrendingUp size={13} /> : <ListTodo size={13} />}{item.task.category}</span><strong>{item.task.title}</strong><small>{item.reasons.join(" · ")}</small></div>)}</div></article>
        <article className={styles.todayMiniCard}><div className={styles.sectionHeading}><div><span className={styles.kicker}>INBOX SUMMARY</span><h2>{inboxCount} unassigned actions</h2></div><Link href="/v2/capture">Open Inbox <ArrowRight size={15} /></Link></div><p className={styles.mutedCopy}>Today does not expose the full backlog. Capture and organise work in Inbox, then let planning surface what deserves attention.</p></article>
      </section>
    </>}

    {showNewTask && user && <CreateTaskModal userId={user.id} initiatives={workspace.initiatives} onClose={() => setShowNewTask(false)} onCreated={async () => { setShowNewTask(false); await reloadWorkspace(); }} />}
  </main>;
}
