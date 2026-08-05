"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ExternalLink, Plus, Search } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Workspace } from "../../../lib/v2-data";
import styles from "./capture.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

export default function CapturePage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("build");
  const [priority, setPriority] = useState(3);
  const [initiativeId, setInitiativeId] = useState("");
  const [addToday, setAddToday] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTitle(params.get("title") ?? "");
    setUrl(params.get("url") ?? "");
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) return;
    loadV2Workspace(supabase, user.id).then(setWorkspace).catch(reason => setMessage(reason instanceof Error ? reason.message : "Unable to load data."));
  }, [user]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspace.allTasks.slice(0, 20);
    return workspace.allTasks.filter(task => `${task.title} ${task.notes ?? ""} ${task.category}`.toLowerCase().includes(needle)).slice(0, 30);
  }, [query, workspace.allTasks]);

  async function capture() {
    if (!supabase || !user || !title.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const notes = url.trim() ? `Captured from: ${url.trim()}` : null;
      const { data, error } = await supabase.from("tasks").insert({
        user_id: user.id,
        title: title.trim(),
        category,
        points: priority,
        status: "ready",
        priority,
        estimated_minutes: 30,
        notes,
        initiative_id: initiativeId || null,
        is_today: addToday,
        is_complete: false,
        week_number: 1,
        energy_required: "standard",
        work_type: category === "cash" ? "communication" : category === "health" ? "health" : category === "life" ? "life" : "deep_work",
        preferred_time: "any",
        position: Date.now()
      }).select("id").single();
      if (error) throw error;
      if (url.trim()) {
        const { error: linkError } = await supabase.from("task_links").insert({ user_id: user.id, task_id: data.id, label: "Source page", url: url.trim(), position: 0 });
        if (linkError) throw linkError;
      }
      setTitle("");
      setUrl("");
      setMessage("Task captured");
      setWorkspace(await loadV2Workspace(supabase, user.id));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to capture task.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <main className={styles.page}><section className={styles.card}><h1>Sign in first</h1><p>Open Command Centre V2 and sign in, then return to capture.</p><Link href="/v2">Open V2</Link></section></main>;

  return <main className={styles.page}>
    <header><span>COMMAND CENTRE V2</span><h1>Search and capture</h1><p>Find existing work or capture what is in front of you.</p></header>
    <div className={styles.grid}>
      <section className={styles.card}>
        <div className={styles.heading}><Plus size={18} /><h2>Quick capture</h2></div>
        <label>Task<input value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" /></label>
        <label>Source URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://..." /></label>
        <div className={styles.twoCols}>
          <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="cash">Revenue</option><option value="build">Build</option><option value="health">Health</option><option value="life">Life</option></select></label>
          <label>Priority<select value={priority} onChange={event => setPriority(Number(event.target.value))}><option value={5}>Critical</option><option value={4}>High</option><option value={3}>Normal</option><option value={2}>Low</option></select></label>
        </div>
        <label>Initiative<select value={initiativeId} onChange={event => setInitiativeId(event.target.value)}><option value="">Unassigned</option>{workspace.initiatives.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className={styles.checkbox}><input type="checkbox" checked={addToday} onChange={event => setAddToday(event.target.checked)} /> Add to Today</label>
        <button className={styles.primary} disabled={saving || !title.trim()} onClick={() => void capture()}>{saving ? "Saving..." : "Capture task"}<Check size={17} /></button>
        {message && <p className={styles.message}>{message}</p>}
      </section>

      <section className={styles.card}>
        <div className={styles.searchBox}><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks, notes or categories" /></div>
        <div className={styles.results}>{results.map(task => <article key={task.id}><div><strong>{task.title}</strong><span>{task.category} · priority {task.priority}</span></div><div className={styles.actions}><Link href={`/v2/workspace?task=${task.id}`}>Open <ArrowRight size={15} /></Link>{task.links[0] && <a href={task.links[0].url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}</div></article>)}</div>
      </section>
    </div>
  </main>;
}
