"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3, Search, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Task, type V2Workspace } from "../../../lib/v2-data";
import { assignTaskToDay, dateKey, tasksForDay, weekDays } from "../../../lib/v2-week-planner";
import styles from "./week.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

export default function WeekPlannerPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [anchor, setAnchor] = useState(new Date());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); if (!data.session?.user) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function reload() {
    if (!supabase || !user) return;
    setLoading(true);
    try { setWorkspace(await loadV2Workspace(supabase, user.id)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load week planner."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (user) void reload(); }, [user]);
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekKeys = new Set(days.map(dateKey));
  const backlog = workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled" && (!task.dueOn || !weekKeys.has(task.dueOn))).filter(task => task.title.toLowerCase().includes(query.toLowerCase()));
  const initiativeTitle = (task: V2Task) => workspace.initiatives.find(item => item.id === task.initiativeId)?.title ?? "Unassigned";

  async function move(taskId: string, day: Date | null) {
    if (!supabase || !user) return;
    setBusy(true);
    try { await assignTaskToDay(supabase, user.id, taskId, day); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to move task."); }
    finally { setBusy(false); }
  }

  function shiftWeek(offset: number) {
    const next = new Date(anchor);
    next.setDate(next.getDate() + offset * 7);
    setAnchor(next);
  }

  if (!user) return <main className={styles.auth}><div><h1>{loading ? "Checking your session..." : "Sign in first"}</h1>{!loading && <Link href="/v2">Back to V2</Link>}</div></main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/v2" className={styles.back}><ArrowLeft size={17} /> Back to dashboard</Link><span>WEEK PLANNER</span><h1>Distribute the work</h1><p>Give each day a realistic load before the week gives it one for you.</p></div>
      <div className={styles.weekControls}><button onClick={() => shiftWeek(-1)}><ChevronLeft /></button><strong>{days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {days[4].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong><button onClick={() => shiftWeek(1)}><ChevronRight /></button></div>
    </header>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Loading your week...</div> : <section className={styles.board}>
      <aside className={styles.backlog}><div><span>BACKLOG</span><h2>Unscheduled work</h2></div><label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks" /></label><div className={styles.taskList}>{backlog.map(task => <article key={task.id}><strong>{task.title}</strong><small>{initiativeTitle(task)} · {task.estimatedMinutes} min</small><div>{days.map(day => <button key={dateKey(day)} onClick={() => void move(task.id, day)} disabled={busy}>{day.toLocaleDateString("en-GB", { weekday: "short" })}</button>)}</div></article>)}{backlog.length === 0 && <p className={styles.empty}>No matching unscheduled tasks.</p>}</div></aside>
      <div className={styles.days}>{days.map(day => { const tasks = tasksForDay(workspace.allTasks, day); const minutes = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0); return <section key={dateKey(day)} className={styles.day}><header><div><span>{day.toLocaleDateString("en-GB", { weekday: "long" })}</span><strong>{day.getDate()}</strong></div><small><Clock3 size={14} /> {Math.round(minutes / 15) / 4}h planned</small></header><div>{tasks.map(task => <article key={task.id}><button className={styles.remove} onClick={() => void move(task.id, null)} disabled={busy}><X size={14} /></button><strong>{task.title}</strong><small>{initiativeTitle(task)}</small><span>{task.estimatedMinutes} min</span><div>{days.filter(other => dateKey(other) !== dateKey(day)).map(other => <button key={dateKey(other)} onClick={() => void move(task.id, other)} disabled={busy}>{other.toLocaleDateString("en-GB", { weekday: "short" })}</button>)}</div></article>)}{tasks.length === 0 && <div className={styles.dayEmpty}><CalendarDays size={20} /> No tasks scheduled</div>}</div></section>; })}</div>
    </section>}
  </main>;
}
