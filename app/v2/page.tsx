"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, CalendarDays, CheckCircle2, CircleDot, Clock3, FolderKanban,
  Home, Inbox, Layers3, ListTodo, LogOut, Menu, Plus, Sparkles, Target, X
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { loadV2Workspace, type V2Initiative, type V2Task, type V2Workspace } from "../../lib/v2-data";
import styles from "./v2.module.css";

type View = "Today" | "Week" | "Initiatives" | "Inbox";

const emptyWorkspace: V2Workspace = {
  initiatives: [],
  unassignedTasks: [],
  todayTasks: [],
  allTasks: []
};

function taskMeta(task: V2Task) {
  const label = task.category === "cash" ? "Revenue" : task.category === "build" ? "Build" : task.category === "health" ? "Health" : "Life";
  return `${label} · ${task.estimatedMinutes} min`;
}

function progressFor(initiative: V2Initiative) {
  const tasks = [
    ...initiative.looseTasks,
    ...initiative.workstreams.flatMap(workstream => workstream.milestones.flatMap(milestone => milestone.tasks))
  ];
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

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadV2Workspace(supabase, user.id)
      .then(data => {
        setWorkspace(data);
        setError("");
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load V2 data."))
      .finally(() => setLoading(false));
  }, [user]);

  const nextTasks = useMemo(() => {
    const incomplete = workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled");
    return [...incomplete].sort((a, b) => b.priority - a.priority || a.position - b.position).slice(0, 3);
  }, [workspace.allTasks]);

  const todayTasks = workspace.todayTasks.length > 0 ? workspace.todayTasks.slice(0, 3) : nextTasks;
  const completedCount = workspace.allTasks.filter(task => task.status === "complete").length;
  const nav: Array<[View, typeof Home]> = [
    ["Today", Home], ["Week", CalendarDays], ["Initiatives", Layers3], ["Inbox", Inbox]
  ];

  if (!user && !loading) {
    return <main className={styles.authPage}>
      <div className={styles.authCard}>
        <span className={styles.kicker}>COMMAND CENTRE V2</span>
        <h1>Sign in through V1 first</h1>
        <p>V2 uses the same secure Supabase session. Sign in on the current Command Centre, then return here.</p>
        <Link className={styles.primaryLink} href="/">Open Command Centre V1 <ArrowRight size={18} /></Link>
      </div>
    </main>;
  }

  return <main className={styles.shell}>
    <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
      <div className={styles.brand}><span>CC</span><strong>Command<br />Centre <small>V2</small></strong></div>
      <button className={styles.closeMenu} onClick={() => setMenuOpen(false)}><X /></button>
      <nav>
        {nav.map(([name, Icon]) => <button key={name} className={view === name ? styles.activeNav : ""} onClick={() => { setView(name); setMenuOpen(false); }}><Icon size={19} />{name}</button>)}
      </nav>
      <div className={styles.focusCard}>
        <span>Current focus</span>
        <strong>Build dependable income</strong>
        <small>{workspace.initiatives.length} active initiatives</small>
      </div>
      <Link className={styles.v1Link} href="/">Return to V1</Link>
    </aside>

    <section className={styles.content}>
      <header className={styles.header}>
        <button className={styles.menuButton} onClick={() => setMenuOpen(true)}><Menu /></button>
        <div>
          <span className={styles.kicker}>PRIVATE BETA</span>
          <h1>{view === "Today" ? "Good evening, Coris." : view}</h1>
          <p>{view === "Today" ? "A clear plan, with the detail ready when you need it." : "Built directly on the new relational Command Centre."}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.readOnly}><CircleDot size={15} /> Read-only</span>
          <button onClick={() => supabase?.auth.signOut()}><LogOut size={17} /> Sign out</button>
        </div>
      </header>

      {loading && <div className={styles.stateCard}>Loading your Command Centre...</div>}
      {error && <div className={styles.errorCard}>{error}</div>}

      {!loading && !error && view === "Today" && <>
        <section className={styles.heroGrid}>
          <article className={styles.mainCard}>
            <div className={styles.cardHeading}>
              <div><span className={styles.kicker}>TODAY'S FOCUS</span><h2>{todayTasks.length > 0 ? "Only these matter now" : "Your day is clear"}</h2></div>
              <span>{todayTasks.length}/3</span>
            </div>
            <div className={styles.taskList}>
              {todayTasks.map((task, index) => <div className={styles.taskRow} key={task.id}>
                <span className={styles.taskNumber}>{index + 1}</span>
                <div><strong>{task.title}</strong><small>{taskMeta(task)}</small></div>
                <ArrowRight size={18} />
              </div>)}
              {todayTasks.length === 0 && <div className={styles.empty}><CheckCircle2 /><strong>No active tasks found</strong><p>Once tasks are assigned in V2, your Top 3 will appear here.</p></div>}
            </div>
          </article>

          <article className={styles.summaryCard}>
            <span className={styles.kicker}>EXECUTION SNAPSHOT</span>
            <div className={styles.bigMetric}>{completedCount}<small> completed</small></div>
            <div className={styles.summaryRow}><span><ListTodo size={17} /> Total tasks</span><strong>{workspace.allTasks.length}</strong></div>
            <div className={styles.summaryRow}><span><Layers3 size={17} /> Initiatives</span><strong>{workspace.initiatives.length}</strong></div>
            <div className={styles.summaryRow}><span><Clock3 size={17} /> Planned today</span><strong>{workspace.todayTasks.length}</strong></div>
          </article>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><span className={styles.kicker}>ACTIVE INITIATIVES</span><h2>Where your work is heading</h2></div><button onClick={() => setView("Initiatives")}>View all <ArrowRight size={16} /></button></div>
          {workspace.initiatives.length > 0 ? <div className={styles.initiativeGrid}>{workspace.initiatives.slice(0, 3).map(initiative => <InitiativeCard key={initiative.id} initiative={initiative} />)}</div> : <article className={styles.emptyInitiatives}>
            <Layers3 size={28} />
            <div><h3>No initiatives yet</h3><p>Your relational tasks are safe. The first V2 setup step will attach them to reusable initiatives.</p></div>
          </article>}
        </section>

        {workspace.unassignedTasks.length > 0 && <section className={styles.section}>
          <div className={styles.sectionHeading}><div><span className={styles.kicker}>MIGRATED WORK</span><h2>Unassigned tasks</h2></div><span>{workspace.unassignedTasks.length}</span></div>
          <div className={styles.compactList}>{workspace.unassignedTasks.slice(0, 8).map(task => <div key={task.id}><strong>{task.title}</strong><span>{taskMeta(task)}</span></div>)}</div>
        </section>}
      </>}

      {!loading && !error && view === "Week" && <section className={styles.pageCard}>
        <span className={styles.kicker}>THIS WEEK</span><h2>All active work</h2>
        <div className={styles.compactList}>{workspace.allTasks.filter(task => task.status !== "complete").map(task => <div key={task.id}><strong>{task.title}</strong><span>{taskMeta(task)}</span></div>)}</div>
      </section>}

      {!loading && !error && view === "Initiatives" && <section className={styles.pageCard}>
        <div className={styles.sectionHeading}><div><span className={styles.kicker}>INITIATIVE ENGINE</span><h2>Strategy underneath, execution on the surface</h2></div><button disabled><Plus size={16} /> New initiative</button></div>
        {workspace.initiatives.length > 0 ? <div className={styles.initiativeGrid}>{workspace.initiatives.map(initiative => <InitiativeCard key={initiative.id} initiative={initiative} />)}</div> : <div className={styles.empty}><FolderKanban /><strong>No relational initiatives found</strong><p>The next migration will create the first initiative from your current Song Room roadmap.</p></div>}
      </section>}

      {!loading && !error && view === "Inbox" && <section className={styles.pageCard}>
        <span className={styles.kicker}>CAPTURE</span><h2>Inbox comes next</h2><p>This will become the safe landing place for tasks, ideas, emails and follow-ups before they are assigned to an initiative or day.</p>
      </section>}
    </section>
  </main>;
}

function InitiativeCard({ initiative }: { initiative: V2Initiative }) {
  const progress = progressFor(initiative);
  return <article className={styles.initiativeCard}>
    <div className={styles.initiativeTop}><span className={styles.status}>{initiative.status}</span><strong>{progress}%</strong></div>
    <h3>{initiative.title}</h3>
    <p>{initiative.desiredOutcome ?? initiative.purpose ?? "Outcome to be defined."}</p>
    <div className={styles.progress}><i style={{ width: `${progress}%` }} /></div>
    <div className={styles.initiativeFoot}><span><Target size={15} /> {initiative.targetDate ?? "No target date"}</span><span>{initiative.workstreams.length} workstreams</span></div>
  </article>;
}
