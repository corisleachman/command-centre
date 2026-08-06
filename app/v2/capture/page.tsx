"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, Plus, Search } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Workspace } from "../../../lib/v2-data";
import CreateTaskModal from "../components/CreateTaskModal";
import styles from "./capture.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

export default function CapturePage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [query, setQuery] = useState("");
  const [initialTitle, setInitialTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [capturedTaskId, setCapturedTaskId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const title = params.get("title") ?? "";
    const url = params.get("url") ?? "";
    setInitialTitle(title);
    setSourceUrl(url);
    if (title || url || params.get("create") === "1") setCreating(true);
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function reload() {
    if (!supabase || !user) return;
    try { setWorkspace(await loadV2Workspace(supabase, user.id)); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to load data."); }
  }

  useEffect(() => { if (user) void reload(); }, [user]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ranked = [...workspace.allTasks].sort((a, b) => b.position - a.position);
    if (!needle) return ranked.slice(0, 20);
    return ranked.filter(task => `${task.title} ${task.notes ?? ""} ${task.category}`.toLowerCase().includes(needle)).slice(0, 30);
  }, [query, workspace.allTasks]);

  if (!user) return <main className={styles.page}><section className={styles.card}><h1>Sign in first</h1><p>Open Command Centre V2 and sign in, then return to capture.</p><Link href="/v2">Open V2</Link></section></main>;

  return <main className={styles.page}>
    <header><span>COMMAND CENTRE V2</span><h1>Search and capture</h1><p>Find existing work or create a fully defined task, with the option to schedule it immediately.</p></header>
    <div className={styles.grid}>
      <section className={styles.card}>
        <div className={styles.heading}><Plus size={18} /><h2>Create a task</h2></div>
        <p>Use the same complete task form as the rest of Command Centre. Create it in the Inbox or turn it straight into protected calendar time.</p>
        {sourceUrl && <p className={styles.message}>Source ready to attach: {sourceUrl}</p>}
        <button className={styles.primary} onClick={() => setCreating(true)}>Open task form <Plus size={17} /></button>
        {message && <p className={styles.message}>{message}{capturedTaskId && <> · <Link href={`/v2/workspace?task=${capturedTaskId}`} target="_blank">Open captured task</Link></>}</p>}
      </section>

      <section className={styles.card}>
        <div className={styles.searchBox}><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks, notes or categories" /></div>
        <div className={styles.results}>{results.map(task => <article key={task.id}><div><strong>{task.title}</strong><span>{task.category} · priority {task.priority}{!task.initiativeId ? " · Inbox" : ""}</span></div><div className={styles.actions}><Link href={`/v2/workspace?task=${task.id}`}>Open <ArrowRight size={15} /></Link>{task.links[0] && <a href={task.links[0].url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}</div></article>)}</div>
      </section>
    </div>

    {creating && <CreateTaskModal
      userId={user.id}
      initiatives={workspace.initiatives}
      initialTitle={initialTitle}
      sourceUrl={sourceUrl}
      onClose={() => setCreating(false)}
      onCreated={async ({ taskId, scheduled }) => {
        setCreating(false);
        setCapturedTaskId(taskId);
        setMessage(scheduled ? "Task created and added to your calendar" : "Task created in Command Centre");
        setInitialTitle("");
        setSourceUrl("");
        await reload();
      }}
    />}
  </main>;
}
