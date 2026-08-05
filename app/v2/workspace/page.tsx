"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Circle, FileText, Lightbulb, Plus, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Task, type V2Workspace } from "../../../lib/v2-data";
import { addSubtask, addTaskEntry, deleteSubtask, deleteTaskEntry, loadTaskDetails, toggleEntryResolved, toggleSubtask, type TaskActivity, type TaskEntry, type TaskSubtask } from "../../../lib/v2-task-details";
import styles from "./workspace.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

export default function RichTaskWorkspacePage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>([]);
  const [entries, setEntries] = useState<TaskEntry[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [entryType, setEntryType] = useState<TaskEntry["type"]>("note");
  const [newEntry, setNewEntry] = useState("");
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

  useEffect(() => {
    if (!supabase || !user) return;
    setLoading(true);
    loadV2Workspace(supabase, user.id).then(data => {
      setWorkspace(data);
      setSelectedId(current => current ?? data.todayTasks[0]?.id ?? data.allTasks.find(task => task.status !== "complete")?.id ?? null);
      setError("");
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load tasks.")).finally(() => setLoading(false));
  }, [user]);

  const selectedTask = workspace.allTasks.find(task => task.id === selectedId) ?? null;
  const visibleTasks = useMemo(() => workspace.allTasks.filter(task => task.title.toLowerCase().includes(query.toLowerCase())), [workspace.allTasks, query]);

  async function reloadDetails(task = selectedTask) {
    if (!supabase || !user || !task) return;
    try {
      const details = await loadTaskDetails(supabase, user.id, task.id);
      setSubtasks(details.subtasks); setEntries(details.entries); setActivity(details.activity); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load task details."); }
  }

  useEffect(() => { void reloadDetails(); }, [selectedId, user]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); await reloadDetails(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update task."); }
    finally { setBusy(false); }
  }

  if (!user) return <main className={styles.auth}><div><h1>{loading ? "Checking your session..." : "Sign in first"}</h1>{!loading && <Link href="/v2">Back to V2</Link>}</div></main>;

  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/v2" className={styles.back}><ArrowLeft size={17} /> Back to dashboard</Link><span>RICH TASK WORKSPACE</span><h1>Turn actions into finished work</h1><p>Break the task down, capture blockers and decisions, and keep the working history in one place.</p></div></header>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Loading workspace...</div> : <section className={styles.layout}>
      <aside className={styles.taskRail}><input placeholder="Search tasks" value={query} onChange={event => setQuery(event.target.value)} />{visibleTasks.map(task => <button key={task.id} className={task.id === selectedId ? styles.selected : ""} onClick={() => setSelectedId(task.id)}><strong>{task.title}</strong><small>{task.status.replaceAll("_", " ")} · {task.estimatedMinutes} min</small></button>)}</aside>
      {selectedTask ? <div className={styles.workspace}>
        <section className={styles.taskIntro}><span>{selectedTask.category.toUpperCase()}</span><h2>{selectedTask.title}</h2><p>{selectedTask.notes || "No working notes yet. Use the existing task editor for the main document, and this workspace for execution detail."}</p></section>
        <div className={styles.columns}>
          <section className={styles.panel}><div className={styles.panelTitle}><div><CheckCircle2 size={18} /><h3>Subtasks</h3></div><span>{subtasks.filter(item => item.isComplete).length}/{subtasks.length}</span></div><div className={styles.addRow}><input value={newSubtask} onChange={event => setNewSubtask(event.target.value)} placeholder="Add a concrete next step" /><button disabled={busy || !newSubtask.trim()} onClick={() => void run(async () => { if (!supabase || !user || !selectedTask) return; await addSubtask(supabase, user.id, selectedTask.id, newSubtask.trim(), subtasks.length); setNewSubtask(""); })}><Plus size={16} /></button></div><div className={styles.list}>{subtasks.map(item => <article key={item.id} className={item.isComplete ? styles.done : ""}><button onClick={() => void run(() => toggleSubtask(supabase!, user.id, selectedTask.id, item.id, !item.isComplete, item.title))}>{item.isComplete ? <Check size={16} /> : <Circle size={16} />}</button><strong>{item.title}</strong><button onClick={() => void run(() => deleteSubtask(supabase!, user.id, selectedTask.id, item.id, item.title))}><Trash2 size={15} /></button></article>)}{subtasks.length === 0 && <p className={styles.empty}>No subtasks yet.</p>}</div></section>
          <section className={styles.panel}><div className={styles.panelTitle}><div><FileText size={18} /><h3>Decisions and blockers</h3></div></div><div className={styles.entryComposer}><select value={entryType} onChange={event => setEntryType(event.target.value as TaskEntry["type"])}><option value="note">Note</option><option value="decision">Decision</option><option value="blocker">Blocker</option></select><textarea value={newEntry} onChange={event => setNewEntry(event.target.value)} placeholder="Capture what matters..." /><button disabled={busy || !newEntry.trim()} onClick={() => void run(async () => { if (!supabase || !user || !selectedTask) return; await addTaskEntry(supabase, user.id, selectedTask.id, entryType, newEntry.trim()); setNewEntry(""); })}><Plus size={16} /> Add entry</button></div><div className={styles.entries}>{entries.map(entry => <article key={entry.id} className={`${styles.entry} ${entry.isResolved ? styles.resolved : ""}`}><div>{entry.type === "blocker" ? <AlertTriangle size={17} /> : entry.type === "decision" ? <Lightbulb size={17} /> : <FileText size={17} />}<span>{entry.type}</span></div><p>{entry.content}</p><footer><small>{new Date(entry.createdAt).toLocaleString("en-GB")}</small><button onClick={() => void run(() => toggleEntryResolved(supabase!, user.id, selectedTask.id, entry))}>{entry.isResolved ? "Reopen" : "Resolve"}</button><button onClick={() => void run(() => deleteTaskEntry(supabase!, user.id, selectedTask.id, entry))}><Trash2 size={14} /></button></footer></article>)}{entries.length === 0 && <p className={styles.empty}>No blockers, decisions or notes yet.</p>}</div></section>
        </div>
        <section className={styles.activity}><div className={styles.panelTitle}><div><FileText size={18} /><h3>Activity history</h3></div></div>{activity.map(item => <article key={item.id}><div><strong>{item.action}</strong>{item.detail && <p>{item.detail}</p>}</div><small>{new Date(item.createdAt).toLocaleString("en-GB")}</small></article>)}{activity.length === 0 && <p className={styles.empty}>Activity will appear as you work.</p>}</section>
      </div> : <div className={styles.state}>Select a task to open its workspace.</div>}
    </section>}
  </main>;
}
