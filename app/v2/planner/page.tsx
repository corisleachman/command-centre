"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Plus, Save, Search, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadPlannerTasks, saveTodayPlan, type PlannerTask } from "../../../lib/v2-planner";
import styles from "./planner.module.css";

function meta(task: PlannerTask) {
  const category = task.category === "cash" ? "Revenue" : task.category === "build" ? "Build" : task.category === "health" ? "Health" : "Life";
  return `${category} · ${task.estimatedMinutes} min${task.initiativeTitle ? ` · ${task.initiativeTitle}` : ""}`;
}

export default function PlannerPage() {
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); if (!data.session?.user) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) return;
    setLoading(true);
    loadPlannerTasks(supabase, user.id).then(data => {
      setTasks(data);
      setSelectedIds(data.filter(task => task.isToday).slice(0, 3).map(task => task.id));
      setError("");
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load tasks.")).finally(() => setLoading(false));
  }, [user]);

  const selected = selectedIds.map(id => tasks.find(task => task.id === id)).filter((task): task is PlannerTask => Boolean(task));
  const available = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tasks.filter(task => !selectedIds.includes(task.id) && (!term || `${task.title} ${task.initiativeTitle ?? ""} ${task.category}`.toLowerCase().includes(term)));
  }, [tasks, selectedIds, query]);

  function add(id: string) { if (selectedIds.length < 3) setSelectedIds(current => [...current, id]); }
  function remove(id: string) { setSelectedIds(current => current.filter(item => item !== id)); }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selectedIds.length) return;
    setSelectedIds(current => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }

  async function save() {
    if (!supabase || !user) return;
    setSaving(true); setMessage("");
    try { await saveTodayPlan(supabase, user.id, selectedIds); setMessage("Today plan saved."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save today plan."); }
    finally { setSaving(false); }
  }

  if (!user && !loading) return <main className={styles.auth}><div><h1>Sign in first</h1><Link href="/">Open Command Centre</Link></div></main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/v2"><ArrowLeft size={17} /> Back to dashboard</Link><span>TODAY PLANNER</span><h1>Choose the three things that matter.</h1><p>Set the order deliberately. Completing one removes it from Today without changing the rest.</p></div>
      <button className={styles.save} onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? "Saving..." : "Save today"}</button>
    </header>

    {loading && <div className={styles.state}>Loading your tasks...</div>}
    {error && <div className={styles.error}>{error}</div>}
    {!loading && !error && <section className={styles.grid}>
      <article className={styles.todayCard}>
        <div className={styles.cardHead}><div><span>YOUR TOP 3</span><h2>Today</h2></div><strong>{selected.length}/3</strong></div>
        <div className={styles.selectedList}>{selected.map((task, index) => <div className={styles.selectedRow} key={task.id}>
          <span className={styles.rank}>{index + 1}</span>
          <div><strong>{task.title}</strong><small>{meta(task)}</small></div>
          <div className={styles.rowActions}><button onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp size={16} /></button><button onClick={() => move(index, 1)} disabled={index === selected.length - 1}><ArrowDown size={16} /></button><button onClick={() => remove(task.id)}><X size={16} /></button></div>
        </div>)}</div>
        {selected.length === 0 && <div className={styles.empty}>Nothing selected yet. Choose up to three tasks from the list.</div>}
        {message && <div className={styles.success}><Check size={16} /> {message}</div>}
      </article>

      <article className={styles.poolCard}>
        <div className={styles.cardHead}><div><span>AVAILABLE WORK</span><h2>Pick the best next actions</h2></div></div>
        <label className={styles.search}><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks or initiatives" /></label>
        <div className={styles.poolList}>{available.map(task => <button key={task.id} onClick={() => add(task.id)} disabled={selectedIds.length >= 3}><div><strong>{task.title}</strong><small>{meta(task)}</small></div><Plus size={17} /></button>)}</div>
        {available.length === 0 && <div className={styles.empty}>No matching tasks.</div>}
      </article>
    </section>}
  </main>;
}
