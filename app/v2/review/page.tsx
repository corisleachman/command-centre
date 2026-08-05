"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, RotateCcw, Save, Sunrise, Sunset } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Workspace } from "../../../lib/v2-data";
import { carryTaskForward, loadCompletedToday, loadDailyReview, localDateKey, saveDailyReview, unfinishedBeforeToday, type CompletedTaskSummary, type DailyReview } from "../../../lib/v2-review";
import styles from "./review.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };
const blankReview: DailyReview = { reviewDate: localDateKey(), morningNote: "", eveningNote: "", energy: null, wins: "", blockers: "" };

export default function DailyReviewPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [review, setReview] = useState(blankReview);
  const [completed, setCompleted] = useState<CompletedTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
    try {
      const [nextWorkspace, nextReview, nextCompleted] = await Promise.all([
        loadV2Workspace(supabase, user.id),
        loadDailyReview(supabase, user.id),
        loadCompletedToday(supabase, user.id)
      ]);
      setWorkspace(nextWorkspace); setReview(nextReview); setCompleted(nextCompleted); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load daily review."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (user) void reload(); }, [user]);

  const carryForward = useMemo(() => unfinishedBeforeToday(workspace.allTasks), [workspace.allTasks]);
  const completedMinutes = completed.reduce((sum, task) => sum + task.estimatedMinutes, 0);

  async function save() {
    if (!supabase || !user) return;
    setBusy(true); setMessage("");
    try { await saveDailyReview(supabase, user.id, review); setMessage("Saved"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save review."); }
    finally { setBusy(false); }
  }

  async function carry(taskId: string) {
    if (!supabase || !user) return;
    setBusy(true);
    try { await carryTaskForward(supabase, user.id, taskId); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to carry task forward."); }
    finally { setBusy(false); }
  }

  if (!user) return <main className={styles.auth}><div><h1>{loading ? "Checking your session..." : "Sign in first"}</h1>{!loading && <Link href="/v2">Back to V2</Link>}</div></main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/v2" className={styles.back}><ArrowLeft size={17} /> Back to dashboard</Link><span>DAILY RHYTHM</span><h1>Start clear. Finish honest.</h1><p>Carry forward deliberately in the morning, then close the loop before the day disappears.</p></div>
      <button className={styles.save} onClick={() => void save()} disabled={busy}><Save size={17} /> {busy ? "Saving..." : "Save review"}</button>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.message}>{message}</div>}
    {loading ? <div className={styles.state}>Loading today...</div> : <div className={styles.grid}>
      <section className={styles.card}>
        <div className={styles.cardTitle}><Sunrise /><div><span>MORNING SETUP</span><h2>Choose what deserves the day</h2></div></div>
        <label>What matters most today?<textarea value={review.morningNote} onChange={event => setReview({ ...review, morningNote: event.target.value })} placeholder="Define the outcome, not just the activity." /></label>
        <div className={styles.energy}><span>Energy today</span><div>{[1,2,3,4,5].map(value => <button key={value} className={review.energy === value ? styles.selected : ""} onClick={() => setReview({ ...review, energy: value })}>{value}</button>)}</div></div>
        <div className={styles.subhead}><div><RotateCcw size={16} /><strong>Unfinished from earlier days</strong></div><span>{carryForward.length}</span></div>
        <div className={styles.list}>{carryForward.map(task => <article key={task.id}><div><strong>{task.title}</strong><small>Due {task.dueOn} · {task.estimatedMinutes} min</small></div><button onClick={() => void carry(task.id)} disabled={busy}>Bring into today</button></article>)}{carryForward.length === 0 && <p className={styles.empty}>Nothing overdue. Start from a clean slate.</p>}</div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardTitle}><Sunset /><div><span>END-OF-DAY REVIEW</span><h2>Record progress while it is real</h2></div></div>
        <div className={styles.metrics}><div><CheckCircle2 /><strong>{completed.length}</strong><span>completed</span></div><div><Clock3 /><strong>{Math.round(completedMinutes / 15) / 4}h</strong><span>finished</span></div></div>
        <label>Wins<textarea value={review.wins} onChange={event => setReview({ ...review, wins: event.target.value })} placeholder="What moved forward?" /></label>
        <label>Blockers or lessons<textarea value={review.blockers} onChange={event => setReview({ ...review, blockers: event.target.value })} placeholder="What slowed you down or needs attention tomorrow?" /></label>
        <label>Closing note<textarea value={review.eveningNote} onChange={event => setReview({ ...review, eveningNote: event.target.value })} placeholder="One clear sentence about the day." /></label>
        <div className={styles.completedList}>{completed.map(task => <div key={task.id}><CheckCircle2 size={16} /><span>{task.title}</span><small>{task.estimatedMinutes} min</small></div>)}{completed.length === 0 && <p className={styles.empty}>Completed tasks will appear here as you close them.</p>}</div>
      </section>
    </div>}
  </main>;
}
