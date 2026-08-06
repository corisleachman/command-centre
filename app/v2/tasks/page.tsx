"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Circle, ExternalLink, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, setV2TaskComplete, updateV2Task, type V2Task, type V2TaskDraft, type V2Workspace } from "../../../lib/v2-data";
import CreateTaskModal from "../components/CreateTaskModal";
import styles from "./tasks.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };
type Filter = "active" | "complete" | "all";

export default function TasksPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [selected, setSelected] = useState<V2Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") === "1") setCreating(true);
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); if (!data.session?.user) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function reload() {
    if (!supabase || !user) return;
    setLoading(true);
    try { setWorkspace(await loadV2Workspace(supabase, user.id)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load tasks."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (user) void reload(); }, [user]);

  const tasks = useMemo(() => workspace.allTasks.filter(task => {
    const matchesSearch = `${task.title} ${task.notes ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const isComplete = task.status === "complete";
    const matchesFilter = filter === "all" || (filter === "complete" ? isComplete : !isComplete);
    return matchesSearch && matchesFilter;
  }).sort((a, b) => b.position - a.position), [workspace.allTasks, query, filter]);

  async function toggle(task: V2Task) {
    if (!supabase || !user) return;
    setBusy(true);
    try { await setV2TaskComplete(supabase, user.id, task, task.status !== "complete"); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update task."); }
    finally { setBusy(false); }
  }

  async function remove(task: V2Task) {
    if (!supabase || !user || !window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { error: deleteError } = await supabase.from("tasks").delete().eq("id", task.id).eq("user_id", user.id);
      if (deleteError) throw deleteError;
      if (selected?.id === task.id) setSelected(null);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete task."); }
    finally { setBusy(false); }
  }

  if (!user) return <main className={styles.auth}><div><h1>{loading ? "Checking your session..." : "Sign in first"}</h1>{!loading && <Link href="/v2">Back to V2</Link>}</div></main>;

  return <main className={styles.page}>
    <header className={styles.header}><div><span>COMMAND CENTRE V2</span><h1>Tasks</h1><p>One place to find, create, edit, complete and delete every task.</p></div><button className={styles.primary} onClick={() => setCreating(true)}><Plus size={17} /> Add task</button></header>
    {error && <div className={styles.error}>{error}</div>}
    <section className={styles.toolbar}><div className={styles.search}><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search all tasks" /></div><div className={styles.filters}>{(["active", "complete", "all"] as Filter[]).map(item => <button key={item} className={filter === item ? styles.activeFilter : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></section>
    {loading ? <div className={styles.state}>Loading tasks...</div> : <section className={styles.list}>{tasks.map(task => <article key={task.id} className={task.status === "complete" ? styles.done : ""}><button className={styles.check} disabled={busy} onClick={() => void toggle(task)}>{task.status === "complete" ? <Check size={17} /> : <Circle size={17} />}</button><button className={styles.copy} onClick={() => setSelected(task)}><strong>{task.title}</strong><small>{task.category} · priority {task.priority} · {task.estimatedMinutes} min{task.dueOn ? ` · due ${task.dueOn}` : ""}</small></button><div className={styles.actions}><Link href={`/v2/workspace?task=${task.id}`} title="Open workspace"><ExternalLink size={16} /></Link><button onClick={() => setSelected(task)} title="Edit task"><Pencil size={16} /></button><button className={styles.danger} onClick={() => void remove(task)} title="Delete task"><Trash2 size={16} /></button></div></article>)}{tasks.length === 0 && <div className={styles.state}><h2>No tasks found</h2><p>Change the filter or add a new task.</p></div>}</section>}
    {creating && <CreateTaskModal userId={user.id} initiatives={workspace.initiatives} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />}
    {selected && <EditTaskModal task={selected} initiatives={workspace.initiatives} userId={user.id} onClose={() => setSelected(null)} onSaved={async () => { setSelected(null); await reload(); }} />}
  </main>;
}

function EditTaskModal({ task, initiatives, userId, onClose, onSaved }: { task: V2Task; initiatives: V2Workspace["initiatives"]; userId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<V2TaskDraft>({ title: task.title, category: task.category, priority: task.priority, estimatedMinutes: task.estimatedMinutes, dueOn: task.dueOn, notes: task.notes, initiativeId: task.initiativeId, milestoneId: task.milestoneId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedInitiative = initiatives.find(item => item.id === draft.initiativeId);
  const milestones = selectedInitiative?.workstreams.flatMap(item => item.milestones) ?? [];

  async function save() {
    if (!supabase || !draft.title.trim()) { setError("Add a task title before saving."); return; }
    setBusy(true); setError("");
    try { await updateV2Task(supabase, userId, task.id, { ...draft, title: draft.title.trim() }); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save task."); }
    finally { setBusy(false); }
  }

  return <div className={styles.modal} onClick={onClose}><div className={styles.modalCard} onClick={event => event.stopPropagation()}><header><div><span>EDIT TASK</span><h2>Update task</h2></div><button onClick={onClose}><X /></button></header><label>Title<input autoFocus value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><div className={styles.grid}><label>Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="cash">Revenue</option><option value="build">Build</option><option value="health">Health</option><option value="life">Life</option></select></label><label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: Number(event.target.value) })}>{[5,4,3,2,1].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Estimate<input type="number" min={5} step={5} value={draft.estimatedMinutes} onChange={event => setDraft({ ...draft, estimatedMinutes: Number(event.target.value) })} /></label><label>Due date<input type="date" value={draft.dueOn ?? ""} onChange={event => setDraft({ ...draft, dueOn: event.target.value || null })} /></label></div><div className={styles.grid}><label>Initiative<select value={draft.initiativeId ?? ""} onChange={event => setDraft({ ...draft, initiativeId: event.target.value || null, milestoneId: null })}><option value="">Inbox / unassigned</option>{initiatives.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Milestone<select value={draft.milestoneId ?? ""} disabled={!selectedInitiative || milestones.length === 0} onChange={event => setDraft({ ...draft, milestoneId: event.target.value || null })}><option value="">{!selectedInitiative ? "Select an initiative first" : milestones.length === 0 ? "No milestones in this initiative" : "No milestone"}</option>{milestones.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div><label>Notes<textarea rows={5} value={draft.notes ?? ""} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>{error && <div className={styles.error}>{error}</div>}<footer><button onClick={onClose}>Cancel</button><button className={styles.primary} onClick={() => void save()} disabled={busy || !draft.title.trim()}>{busy ? "Saving..." : "Save changes"}</button></footer></div></div>;
}
