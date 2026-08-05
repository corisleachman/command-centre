"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Ban, Check, CheckCircle2, Clock3, Play, RefreshCw, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Task, type V2Workspace } from "../../../lib/v2-data";
import { completionSummary, recommendedNext, replaceCompletedTodayTask, setTaskState } from "../../../lib/v2-daily";
import styles from "./daily.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

export default function DailyExecutionPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
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
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load daily execution."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (user) void reload(); }, [user]);

  const planned = workspace.todayTasks.filter(task => task.status !== "complete" && task.status !== "cancelled").slice(0, 3);
  const next = useMemo(() => recommendedNext(workspace.allTasks, planned.map(task => task.id)), [workspace.allTasks, planned]);
  const summary = completionSummary(workspace.allTasks);
  const active = planned.find(task => task.status === "in_progress") ?? planned[0] ?? null;

  async function changeState(task: V2Task, status: "ready" | "in_progress" | "blocked") {
    if (!supabase || !user) return;
    setBusy(true);
    try { await setTaskState(supabase, user.id, task.id, status); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update task state."); }
    finally { setBusy(false); }
  }

  async function complete(task: V2Task) {
    if (!supabase || !user) return;
    setBusy(true);
    try {
      const replacement = recommendedNext(workspace.allTasks, [...planned.map(item => item.id), task.id]);
      await replaceCompletedTodayTask(supabase, user.id, task.id, replacement);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to complete task."); }
    finally { setBusy(false); }
  }

  if (!user) return <main className={styles.auth}><div><h1>{loading ? "Checking your session..." : "Sign in first"}</h1>{!loading && <Link href="/v2">Back to V2</Link>}</div></main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link className={styles.back} href="/v2"><ArrowLeft size={17} /> Back to dashboard</Link><span>DAILY EXECUTION</span><h1>Keep the day moving</h1><p>Finish one thing, surface the next, and keep your attention on the work that matters.</p></div>
      <Link className={styles.planLink} href="/v2/planner">Edit today’s plan <ArrowRight size={17} /></Link>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Loading today...</div> : <>
      <section className={styles.hero}>
        <article className={styles.focusCard}>
          <span>CURRENT FOCUS</span>
          {active ? <><h2>{active.title}</h2><p>{active.estimatedMinutes} minutes · priority {active.priority}</p><div className={styles.actions}><button onClick={() => void changeState(active, "in_progress")} disabled={busy}><Play size={16} /> Start</button><button onClick={() => void changeState(active, "blocked")} disabled={busy}><Ban size={16} /> Blocked</button><button className={styles.complete} onClick={() => void complete(active)} disabled={busy}><Check size={16} /> Complete</button></div></> : <div className={styles.clear}><CheckCircle2 /><h2>Your planned work is complete</h2><p>Use the Today planner to choose another priority or stop for the day.</p></div>}
        </article>
        <article className={styles.summary}><span>DAY SO FAR</span><strong>{summary.count}</strong><p>tasks completed</p><small><Clock3 size={15} /> {Math.round(summary.minutes / 15) / 4} hours of estimated work</small></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}><div className={styles.cardHead}><div><span>TODAY’S QUEUE</span><h2>Planned priorities</h2></div><strong>{planned.length}/3</strong></div><div className={styles.list}>{planned.map((task, index) => <div key={task.id} className={styles.task}><i>{index + 1}</i><div><strong>{task.title}</strong><small>{task.status.replace("_", " ")} · {task.estimatedMinutes} min</small></div><div className={styles.taskActions}><button onClick={() => void changeState(task, "in_progress")} disabled={busy}><Play size={14} /></button><button onClick={() => void changeState(task, "blocked")} disabled={busy}><Ban size={14} /></button><button onClick={() => void complete(task)} disabled={busy}><Check size={14} /></button></div></div>)}{planned.length === 0 && <p className={styles.empty}>Nothing currently planned.</p>}</div></article>
        <article className={styles.card}><div className={styles.cardHead}><div><span>RECOMMENDED NEXT</span><h2>Best available action</h2></div><Sparkles size={21} /></div>{next ? <div className={styles.recommendation}><strong>{next.title}</strong><p>Priority {next.priority} · {next.estimatedMinutes} minutes{next.dueOn ? ` · due ${next.dueOn}` : ""}</p><Link href="/v2/planner">Add through planner <ArrowRight size={15} /></Link></div> : <div className={styles.clear}><RefreshCw /><p>No additional active tasks are available.</p></div>}</article>
      </section>
    </>}
  </main>;
}
