"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, CalendarDays, Check, CheckCircle2, CircleDot, Clock3, ExternalLink,
  FileText, FolderKanban, Home, Inbox, Layers3, Link2, ListTodo, LogOut, Menu,
  Plus, Save, Target, Trash2, X
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import {
  addV2TaskLink, deleteV2TaskLink, loadV2Workspace, setV2TaskComplete,
  updateV2Task, type V2Initiative, type V2Task, type V2TaskDraft, type V2Workspace
} from "../../lib/v2-data";
import CreateTaskModal from "./components/CreateTaskModal";
import styles from "./v2.module.css";

type View = "Today" | "Week" | "Initiatives" | "Inbox";
const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

function taskMeta(task: V2Task) {
  const label = task.category === "cash" ? "Revenue" : task.category === "build" ? "Build" : task.category === "health" ? "Health" : "Life";
  return `${label} · ${task.estimatedMinutes} min${task.dueOn ? ` · due ${task.dueOn}` : ""}`;
}

function progressFor(initiative: V2Initiative) {
  const tasks = [...initiative.looseTasks, ...initiative.workstreams.flatMap(workstream => workstream.milestones.flatMap(milestone => milestone.tasks))];
  if (tasks.length === 0) return 0;
  return Math.round(tasks.filter(task => task.status === "complete").length / tasks.length * 100);
}

export default function V2Page() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [view, setView] = useState<View>("Today");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [saving, setSaving] = useState(false);

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

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function reload() {
    if (!supabase || !user) return;
    setLoading(true);
    try { setWorkspace(await loadV2Workspace(supabase, user.id)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load V2 data."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, [user]);

  const nextTasks = useMemo(() => {
    const incomplete = workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled");
    return [...incomplete].sort((a, b) => b.priority - a.priority || a.position - b.position).slice(0, 3);
  }, [workspace.allTasks]);

  const todayTasks = workspace.todayTasks.length > 0 ? workspace.todayTasks.slice(0, 3) : nextTasks;
  const completedCount = workspace.allTasks.filter(task => task.status === "complete").length;
  const selectedTask = workspace.allTasks.find(task => task.id === selectedTaskId) ?? null;
  const nav: Array<[View, typeof Home]> = [["Today", Home], ["Week", CalendarDays], ["Initiatives", Layers3], ["Inbox", Inbox]];

  async function toggleComplete(task: V2Task) {
    if (!supabase || !user) return;
    setSaving(true);
    try { await setV2TaskComplete(supabase, user.id, task, task.status !== "complete"); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update task."); }
    finally { setSaving(false); }
  }

  if (!user && !loading) {
    return <main className={styles.authPage}><div className={styles.authCard}><span className={styles.kicker}>COMMAND CENTRE V2</span><h1>Sign in through V1 first</h1><p>V2 uses the same secure Supabase session. Sign in on the current Command Centre, then return here.</p><Link className={styles.primaryLink} href="/">Open Command Centre V1 <ArrowRight size={18} /></Link></div></main>;
  }

  return <main className={styles.shell}>
    <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
      <div className={styles.brand}><span>CC</span><strong>Command<br />Centre <small>V2</small></strong></div>
      <button className={styles.closeMenu} onClick={() => setMenuOpen(false)}><X /></button>
      <nav>{nav.map(([name, Icon]) => <button key={name} className={view === name ? styles.activeNav : ""} onClick={() => { setView(name); setMenuOpen(false); }}><Icon size={19} />{name}</button>)}</nav>
      <div className={styles.focusCard}><span>Current focus</span><strong>Build dependable income</strong><small>{workspace.initiatives.length} active initiatives</small></div>
      <Link className={styles.v1Link} href="/">Return to V1</Link>
    </aside>

    <section className={styles.content}>
      <header className={styles.header}>
        <button className={styles.menuButton} onClick={() => setMenuOpen(true)}><Menu /></button>
        <div><span className={styles.kicker}>PRIVATE BETA</span><h1>{view === "Today" ? "Good evening, Coris." : view}</h1><p>{view === "Today" ? "A clear plan, with the detail ready when you need it." : "Built directly on the new relational Command Centre."}</p></div>
        <div className={styles.headerActions}><span className={styles.liveBadge}><CircleDot size={15} /> Live data</span><button className={styles.addButton} onClick={() => setShowNewTask(true)} disabled={!user || loading}><Plus size={17} /> Add task</button><button onClick={() => supabase?.auth.signOut()}><LogOut size={17} /> Sign out</button></div>
      </header>

      {loading && <div className={styles.stateCard}>Loading your Command Centre...</div>}
      {error && <div className={styles.errorCard}>{error}</div>}

      {!loading && !error && view === "Today" && <>
        <section className={styles.heroGrid}>
          <article className={styles.mainCard}><div className={styles.cardHeading}><div><span className={styles.kicker}>TODAY'S FOCUS</span><h2>{todayTasks.length > 0 ? "Only these matter now" : "Your day is clear"}</h2></div><span>{todayTasks.length}/3</span></div><div className={styles.taskList}>{todayTasks.map((task, index) => <TaskRow key={task.id} task={task} index={index} onOpen={() => setSelectedTaskId(task.id)} onToggle={() => void toggleComplete(task)} disabled={saving} />)}{todayTasks.length === 0 && <div className={styles.empty}><CheckCircle2 /><strong>No active tasks found</strong><p>Add a task or wait for the planner to create your next Top 3.</p></div>}</div></article>
          <article className={styles.summaryCard}><span className={styles.kicker}>EXECUTION SNAPSHOT</span><div className={styles.bigMetric}>{completedCount}<small> completed</small></div><div className={styles.summaryRow}><span><ListTodo size={17} /> Total tasks</span><strong>{workspace.allTasks.length}</strong></div><div className={styles.summaryRow}><span><Layers3 size={17} /> Initiatives</span><strong>{workspace.initiatives.length}</strong></div><div className={styles.summaryRow}><span><Clock3 size={17} /> Planned today</span><strong>{workspace.todayTasks.length}</strong></div></article>
        </section>
        <section className={styles.section}><div className={styles.sectionHeading}><div><span className={styles.kicker}>ACTIVE INITIATIVES</span><h2>Where your work is heading</h2></div><button onClick={() => setView("Initiatives")}>View all <ArrowRight size={16} /></button></div>{workspace.initiatives.length > 0 ? <div className={styles.initiativeGrid}>{workspace.initiatives.slice(0, 3).map(initiative => <InitiativeCard key={initiative.id} initiative={initiative} />)}</div> : <article className={styles.emptyInitiatives}><Layers3 size={28} /><div><h3>No initiatives yet</h3><p>Your tasks are safe and can be assigned as initiatives are created.</p></div></article>}</section>
        {workspace.unassignedTasks.length > 0 && <section className={styles.section}><div className={styles.sectionHeading}><div><span className={styles.kicker}>MIGRATED WORK</span><h2>Unassigned tasks</h2></div><span>{workspace.unassignedTasks.length}</span></div><div className={styles.compactList}>{workspace.unassignedTasks.slice(0, 8).map(task => <button key={task.id} onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><span>{taskMeta(task)}</span></button>)}</div></section>}
      </>}

      {!loading && !error && view === "Week" && <section className={styles.pageCard}><span className={styles.kicker}>THIS WEEK</span><h2>All active work</h2><div className={styles.compactList}>{workspace.allTasks.filter(task => task.status !== "complete").map(task => <button key={task.id} onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><span>{taskMeta(task)}</span></button>)}</div></section>}
      {!loading && !error && view === "Initiatives" && <section className={styles.pageCard}><div className={styles.sectionHeading}><div><span className={styles.kicker}>INITIATIVE ENGINE</span><h2>Strategy underneath, execution on the surface</h2></div></div>{workspace.initiatives.length > 0 ? <div className={styles.initiativeGrid}>{workspace.initiatives.map(initiative => <InitiativeCard key={initiative.id} initiative={initiative} />)}</div> : <div className={styles.empty}><FolderKanban /><strong>No relational initiatives found</strong><p>The Song Room backfill will create the first initiative when source data is available.</p></div>}</section>}
      {!loading && !error && view === "Inbox" && <section className={styles.pageCard}><span className={styles.kicker}>CAPTURE</span><h2>Unassigned work inbox</h2><p>Tasks land here before being organised into an initiative or plan.</p><div className={styles.compactList}>{workspace.unassignedTasks.map(task => <button key={task.id} onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><span>{taskMeta(task)}</span></button>)}</div></section>}
    </section>

    {selectedTask && user && supabase && <TaskWorkspace task={selectedTask} initiatives={workspace.initiatives} userId={user.id} onClose={() => setSelectedTaskId(null)} onChanged={reload} />}
    {showNewTask && user && <CreateTaskModal userId={user.id} initiatives={workspace.initiatives} onClose={() => setShowNewTask(false)} onCreated={async () => { setShowNewTask(false); await reload(); }} />}
  </main>;
}

function TaskRow({ task, index, onOpen, onToggle, disabled }: { task: V2Task; index: number; onOpen: () => void; onToggle: () => void; disabled: boolean }) {
  return <div className={`${styles.taskRow} ${task.status === "complete" ? styles.taskDone : ""}`}><button className={styles.taskNumber} onClick={onToggle} disabled={disabled} aria-label={task.status === "complete" ? "Reopen task" : "Complete task"}>{task.status === "complete" ? <Check size={18} /> : index + 1}</button><button className={styles.taskCopy} onClick={onOpen}><strong>{task.title}</strong><small>{taskMeta(task)}</small></button><button className={styles.openTask} onClick={onOpen} aria-label="Open task workspace"><ArrowRight size={18} /></button></div>;
}

function InitiativeCard({ initiative }: { initiative: V2Initiative }) {
  const progress = progressFor(initiative);
  return <article className={styles.initiativeCard}><div className={styles.initiativeTop}><span className={styles.status}>{initiative.status}</span><strong>{progress}%</strong></div><h3>{initiative.title}</h3><p>{initiative.desiredOutcome ?? initiative.purpose ?? "Outcome to be defined."}</p><div className={styles.progress}><i style={{ width: `${progress}%` }} /></div><div className={styles.initiativeFoot}><span><Target size={15} /> {initiative.targetDate ?? "No target date"}</span><span>{initiative.workstreams.length} workstreams</span></div></article>;
}

function TaskWorkspace({ task, initiatives, userId, onClose, onChanged }: { task: V2Task; initiatives: V2Initiative[]; userId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<V2TaskDraft>({ title: task.title, category: task.category, priority: task.priority, estimatedMinutes: task.estimatedMinutes, dueOn: task.dueOn, notes: task.notes, initiativeId: task.initiativeId, milestoneId: task.milestoneId });
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedInitiative = initiatives.find(item => item.id === draft.initiativeId);
  const milestones = selectedInitiative?.workstreams.flatMap(workstream => workstream.milestones) ?? [];

  async function save() {
    if (!supabase || !draft.title.trim()) return;
    setBusy(true);
    try { await updateV2Task(supabase, userId, task.id, { ...draft, title: draft.title.trim() }); setMessage("Saved"); await onChanged(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to save."); }
    finally { setBusy(false); }
  }

  async function addLink() {
    if (!supabase || !linkUrl.trim()) return;
    const url = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    setBusy(true);
    try { await addV2TaskLink(supabase, userId, task.id, linkLabel.trim() || "Supporting resource", url); setLinkLabel(""); setLinkUrl(""); await onChanged(); }
    finally { setBusy(false); }
  }

  return <div className={styles.modalBackdrop} onClick={onClose}><div className={styles.workspaceModal} onClick={event => event.stopPropagation()}>
    <div className={styles.modalHeader}><div><span className={styles.kicker}>ACTION WORKSPACE</span><h2>Do the work here</h2></div><button onClick={onClose}><X /></button></div>
    <label>Task title<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <div className={styles.formGrid}><label>Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="cash">Revenue</option><option value="build">Build</option><option value="health">Health</option><option value="life">Life</option></select></label><label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: Number(event.target.value) })}><option value={5}>Highest</option><option value={4}>High</option><option value={3}>Normal</option><option value={2}>Low</option></select></label><label>Estimate<input type="number" min={5} step={5} value={draft.estimatedMinutes} onChange={event => setDraft({ ...draft, estimatedMinutes: Number(event.target.value) })} /></label><label>Due date<input type="date" value={draft.dueOn ?? ""} onChange={event => setDraft({ ...draft, dueOn: event.target.value || null })} /></label></div>
    <div className={styles.formGrid}><label>Initiative<select value={draft.initiativeId ?? ""} onChange={event => setDraft({ ...draft, initiativeId: event.target.value || null, milestoneId: null })}><option value="">Unassigned</option>{initiatives.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Milestone<select value={draft.milestoneId ?? ""} onChange={event => setDraft({ ...draft, milestoneId: event.target.value || null })} disabled={!selectedInitiative}><option value="">No milestone</option>{milestones.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
    <label><span className={styles.labelHeading}><FileText size={17} /> Working document</span><textarea value={draft.notes ?? ""} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="Draft, plan, compile notes or write the actual output here..." /></label>
    <section className={styles.resourceSection}><div><span className={styles.labelHeading}><Link2 size={17} /> Linked resources</span>{task.links.map(link => <div className={styles.resourceRow} key={link.id}><a href={link.url} target="_blank" rel="noreferrer"><strong>{link.label}</strong><small>{link.url}</small></a><a href={link.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /></a><button onClick={async () => { if (!supabase) return; await deleteV2TaskLink(supabase, userId, link.id); await onChanged(); }}><Trash2 size={16} /></button></div>)}</div><div className={styles.linkForm}><input placeholder="Link name" value={linkLabel} onChange={event => setLinkLabel(event.target.value)} /><input placeholder="Paste URL" value={linkUrl} onChange={event => setLinkUrl(event.target.value)} /><button onClick={() => void addLink()} disabled={busy || !linkUrl.trim()}><Plus size={16} /> Add</button></div></section>
    <div className={styles.modalActions}><span>{message}</span><button className={styles.secondaryAction} onClick={async () => { if (!supabase) return; setBusy(true); await setV2TaskComplete(supabase, userId, task, task.status !== "complete"); await onChanged(); setBusy(false); }}>{task.status === "complete" ? "Reopen task" : "Mark complete"}</button><button className={styles.primaryAction} onClick={() => void save()} disabled={busy || !draft.title.trim()}><Save size={17} /> Save changes</button></div>
  </div></div>;
}
