"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowRight, BriefcaseBusiness, CalendarDays, Check,
  CheckCircle2, ChevronRight, CircleDollarSign, Clock3, HeartPulse,
  ExternalLink, FileText, Home, Lightbulb, Link2, ListTodo, Menu, Plus,
  Sparkles, Target, Trash2, TrendingUp, X
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Category = "cash" | "build" | "health" | "life";
type TaskLink = { id: number; label: string; url: string };
type Task = {
  id: number;
  title: string;
  category: Category;
  points: number;
  done: boolean;
  today: boolean;
  week: number;
  notes?: string;
  links?: TaskLink[];
};

const starterTasks: Task[] = [
  { id: 1, title: "Write the three-sentence consultancy proposition", category: "cash", points: 3, done: false, today: true, week: 1 },
  { id: 2, title: "List 20 agency owners I already know", category: "cash", points: 3, done: false, today: true, week: 1 },
  { id: 3, title: "Complete a 30-minute strength session", category: "health", points: 3, done: false, today: true, week: 1 },
  { id: 4, title: "Draft the Growth Diagnostic outline", category: "build", points: 2, done: false, today: false, week: 1 },
  { id: 5, title: "Send five personal research messages", category: "cash", points: 5, done: false, today: false, week: 1 },
  { id: 6, title: "Calculate essential monthly household spending", category: "life", points: 2, done: false, today: false, week: 1 },
  { id: 7, title: "Define the Song Room founding-member offer", category: "build", points: 2, done: false, today: false, week: 1 },
  { id: 8, title: "Book two agency-owner research calls", category: "cash", points: 5, done: false, today: false, week: 1 }
];

const categoryMeta = {
  cash: { label: "Cash now", icon: CircleDollarSign, colour: "mint" },
  build: { label: "Build", icon: TrendingUp, colour: "blue" },
  health: { label: "Health", icon: HeartPulse, colour: "coral" },
  life: { label: "Life", icon: Home, colour: "gold" }
};

const plans = [
  { name: "Consultancy cash engine", detail: "Package, sell and deliver agency growth expertise.", status: "Active", progress: 24, colour: "mint" },
  { name: "Song Room paid validation", detail: "Find 10 active testers and convert 5 to payment.", status: "Active", progress: 12, colour: "blue" },
  { name: "Health and energy", detail: "Build a sustainable strength and movement rhythm.", status: "Active", progress: 33, colour: "coral" },
  { name: "Pulse Outreach", detail: "Use for your own lead generation only.", status: "Not now", progress: 0, colour: "neutral" }
];

function normaliseTask(task: Task): Task {
  return { ...task, notes: task.notes ?? "", links: task.links ?? [] };
}

function ProgressRing({ value, size = 70 }: { value: number; size?: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64">
        <circle className="ring-track" cx="32" cy="32" r={r} />
        <circle className="ring-fill" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <strong>{value}%</strong>
    </div>
  );
}

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>(starterTasks);
  const [view, setView] = useState("Today");
  const [menu, setMenu] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [idea, setIdea] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [cloudReady, setCloudReady] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showCompletedBigThree, setShowCompletedBigThree] = useState(false);
  const [momentumLimit, setMomentumLimit] = useState(3);
  const [dayFinished, setDayFinished] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("command-centre");
    if (saved) {
      const data = JSON.parse(saved);
      setTasks((data.tasks ?? starterTasks).map(normaliseTask));
      setIdeas(data.ideas ?? []);
    }
    setReady(true);
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem("command-centre", JSON.stringify({ tasks, ideas }));
  }, [tasks, ideas, ready]);

  useEffect(() => {
    if (!supabase || !user || !ready) {
      setCloudReady(false);
      return;
    }
    supabase.from("command_centre_state").select("state").eq("user_id", user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setAuthMessage("Cloud storage needs the Supabase schema applied.");
          return;
        }
        const state = data?.state as { tasks?: Task[]; ideas?: string[] } | undefined;
        if (state) {
          setTasks((state.tasks ?? starterTasks).map(normaliseTask));
          setIdeas(state.ideas ?? []);
        }
        setCloudReady(true);
      });
  }, [user, ready]);

  useEffect(() => {
    if (!supabase || !user || !cloudReady) return;
    const client = supabase;
    const timer = window.setTimeout(() => {
      client.from("command_centre_state").upsert({
        user_id: user.id,
        state: { tasks, ideas },
        updated_at: new Date().toISOString()
      }).then(({ error }) => setAuthMessage(error ? "Cloud save failed. Your browser copy is still safe." : ""));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [tasks, ideas, user, cloudReady]);

  async function signIn() {
    if (!supabase || !email.trim()) return;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href.split("#")[0] }
    });
    setAuthMessage(error ? error.message : "Check your email for the secure sign-in link.");
  }

  async function signOut() {
    await supabase?.auth.signOut();
  }

  const score = useMemo(() => tasks.filter(t => t.done).reduce((a, t) => a + t.points, 0), [tasks]);
  const today = tasks.filter(t => t.today).slice(0, 3);
  const bigThreeComplete = today.length > 0 && today.every(t => t.done);
  const upNext = useMemo(() => {
    const categoryRank: Record<Category, number> = { cash: 0, build: 1, health: 2, life: 2 };
    return tasks
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => !task.done && !task.today && task.week === 1)
      .sort((a, b) => categoryRank[a.task.category] - categoryRank[b.task.category] || b.task.points - a.task.points || a.index - b.index)
      .map(({ task }) => task);
  }, [tasks]);
  const completed = tasks.filter(t => t.done).length;

  function toggle(id: number) {
    setTasks(list => list.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }

  function updateTask(id: number, updates: Partial<Task>) {
    setTasks(list => list.map(task => task.id === id ? { ...task, ...updates } : task));
  }

  function addIdea() {
    if (!idea.trim()) return;
    setIdeas(v => [idea.trim(), ...v]);
    setIdea("");
  }

  const nav = [
    ["Today", Home], ["This week", CalendarDays], ["Objectives", Target],
    ["Plans", ListTodo], ["Scorecard", Activity], ["Ideas", Lightbulb]
  ] as const;
  const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? null;

  return (
    <main className="app-shell">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="brand"><span className="brand-mark">C</span><span>Command<br />Centre</span></div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button key={name} className={view === name ? "active" : ""} onClick={() => { setView(name); setMenu(false); }}>
              <Icon size={19} /><span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-focus">
          <span>90-day focus</span>
          <strong>Build dependable income</strong>
          <div className="mini-progress"><i style={{ width: "18%" }} /></div>
          <small>Week 1 of 13</small>
        </div>
      </aside>

      <section className="content">
        <header>
          <button className="menu-btn" onClick={() => setMenu(!menu)}><Menu /></button>
          <div>
            <span className="eyebrow">THURSDAY, 30 JULY</span>
            <h1>{view === "Today" ? "Good afternoon, Coris." : view}</h1>
            <p>{view === "Today" ? "Keep it simple. Do the first important thing." : "Your plan, with the detail available when you need it."}</p>
          </div>
          <div className="header-actions">
            {supabase && (user
              ? <button className="text-btn" onClick={signOut}>Cloud synced · Sign out</button>
              : <button className="text-btn" onClick={() => setView("Account")}>Enable cloud sync</button>)}
            <button className="primary-btn" onClick={() => setNewTask(true)}><Plus size={18} /> Add task</button>
          </div>
        </header>

        {view === "Today" && (
          <>
            <section className="today-grid">
              <article className="panel big-three">
                <div className="panel-title"><div><span className="eyebrow">TODAY'S BIG THREE</span><h2>{bigThreeComplete ? "Your commitments are complete" : "Only these matter now"}</h2></div><span className="count">{today.filter(t => t.done).length}/3</span></div>
                {bigThreeComplete && <button className="completed-summary" onClick={() => setShowCompletedBigThree(value => !value)}>
                  <span><CheckCircle2 size={18} /> 3/3 complete</span>
                  <span>{showCompletedBigThree ? "Hide" : "Review"} <ChevronRight size={16} /></span>
                </button>}
                {(!bigThreeComplete || showCompletedBigThree) && <div className="task-list">
                  {today.map((task, index) => {
                    const meta = categoryMeta[task.category];
                    const Icon = meta.icon;
                    return <div key={task.id} className={`task ${task.done ? "done" : ""}`}>
                      <button className="task-number" onClick={() => toggle(task.id)} aria-label={task.done ? "Mark incomplete" : "Mark complete"}>{task.done ? <Check size={18} /> : index + 1}</button>
                      <span className={`category-icon ${meta.colour}`}><Icon size={18} /></span>
                      <button className="task-copy" onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><small>{meta.label} · {task.points} points · 30–60 min</small></button>
                      <button className="task-detail-button" onClick={() => setSelectedTaskId(task.id)} aria-label="Open action workspace">
                        {(task.notes || task.links?.length) && <span className="has-detail"><FileText size={13} /> Details</span>}
                        <ChevronRight size={18} />
                      </button>
                    </div>;
                  })}
                </div>}
                {!bigThreeComplete && <div className="start-callout"><Sparkles size={20} /><span><small>START HERE</small><strong>{today.find(t => !t.done)?.title}</strong></span><ArrowRight size={20} /></div>}

                {bigThreeComplete && !dayFinished && <section className="momentum">
                  <div className="momentum-heading"><div><span className="eyebrow">KEEP THE MOMENTUM GOING</span><h3>Want to keep going?</h3><p>These are optional. Your day is already a success.</p></div><Sparkles size={22} /></div>
                  {upNext.length > 0 ? <>
                    <div className="task-list momentum-list">
                      {upNext.slice(0, momentumLimit).map(task => {
                        const meta = categoryMeta[task.category];
                        const Icon = meta.icon;
                        return <div key={task.id} className="task">
                          <button className="task-number" onClick={() => toggle(task.id)} aria-label="Mark complete"><Check size={16} /></button>
                          <span className={`category-icon ${meta.colour}`}><Icon size={18} /></span>
                          <button className="task-copy" onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><small>{meta.label} · {task.points} points · Optional extra</small></button>
                          <button className="task-detail-button" onClick={() => setSelectedTaskId(task.id)} aria-label="Open action workspace"><ChevronRight size={18} /></button>
                        </div>;
                      })}
                    </div>
                    <div className="momentum-actions">
                      {momentumLimit < upNext.length && <button className="secondary-btn" onClick={() => setMomentumLimit(limit => limit + 3)}>Show three more</button>}
                      <button className="secondary-btn" onClick={() => setView("This week")}>View full week</button>
                      <button className="finish-btn" onClick={() => setDayFinished(true)}>Finish for today</button>
                    </div>
                  </> : <div className="all-done"><CheckCircle2 size={24} /><div><strong>Everything for this week is complete</strong><p>You can finish for today with a clear head.</p></div></div>}
                </section>}

                {bigThreeComplete && dayFinished && <div className="day-finished"><CheckCircle2 size={22} /><div><strong>You're finished for today</strong><p>Your Big Three are complete. Come back tomorrow with a clear starting point.</p></div><button className="text-btn" onClick={() => setDayFinished(false)}>Show optional actions</button></div>}
              </article>

              <article className="panel score">
                <span className="eyebrow">WEEKLY SCORE</span>
                <div className="score-head"><ProgressRing value={Math.min(100, Math.round(score / 50 * 100))} /><div><h2>{score} <small>/ 50 pts</small></h2><p>{score < 25 ? "A steady start" : "Strong momentum"}</p></div></div>
                <div className="metric-row"><span><CircleDollarSign size={17} /> Contracted</span><strong>£0</strong></div>
                <div className="metric-row"><span><TrendingUp size={17} /> Pipeline</span><strong>£0</strong></div>
                <div className="metric-row"><span><CheckCircle2 size={17} /> Tasks done</span><strong>{completed} / {tasks.length}</strong></div>
                <button className="text-btn" onClick={() => setView("Scorecard")}>Open scorecard <ArrowRight size={16} /></button>
              </article>
            </section>

            <section className="progress-section">
              <div className="section-heading"><div><span className="eyebrow">YOUR THREE ACTIVE OBJECTIVES</span><h2>90-day progress</h2></div><button onClick={() => setView("Objectives")}>View all <ArrowRight size={16} /></button></div>
              <div className="objective-grid">
                <article className="objective mint"><div className="objective-icon"><BriefcaseBusiness /></div><span className="status">CASH OBJECTIVE</span><h3>Win consultancy work</h3><p>Secure £5k contracted and build a £20k qualified pipeline.</p><div className="objective-foot"><div><strong>£0</strong><span>of £5k</span></div><ProgressRing value={0} size={58} /></div></article>
                <article className="objective blue"><div className="objective-icon"><Sparkles /></div><span className="status">PRODUCT EXPERIMENT</span><h3>Validate Song Room</h3><p>Recruit 10 active testers and convert 5 paying founders.</p><div className="objective-foot"><div><strong>0</strong><span>of 10 testers</span></div><ProgressRing value={0} size={58} /></div></article>
                <article className="objective coral"><div className="objective-icon"><HeartPulse /></div><span className="status">HEALTH FOCUS</span><h3>Build energy consistency</h3><p>Complete three safe movement or strength sessions each week.</p><div className="objective-foot"><div><strong>{tasks.filter(t => t.category === "health" && t.done).length}</strong><span>of 3 sessions</span></div><ProgressRing value={tasks.some(t => t.category === "health" && t.done) ? 33 : 0} size={58} /></div></article>
              </div>
            </section>

            <section className="bottom-grid">
              <article className="panel week-glance"><div className="panel-title"><div><span className="eyebrow">THIS WEEK</span><h2>Commitments at a glance</h2></div><span className="count">{completed}/{tasks.length}</span></div>
                <div className="bar"><i style={{ width: `${completed / tasks.length * 100}%` }} /></div>
                {Object.entries(categoryMeta).map(([key, meta]) => {
                  const total = tasks.filter(t => t.category === key).length;
                  const done = tasks.filter(t => t.category === key && t.done).length;
                  const Icon = meta.icon;
                  return <div className="week-row" key={key}><span className={`category-icon ${meta.colour}`}><Icon size={17} /></span><strong>{meta.label}</strong><span>{done} / {total}</span></div>;
                })}
              </article>
              <article className="panel idea-card"><div className="idea-icon"><Lightbulb /></div><div><span className="eyebrow">IDEA CAR PARK</span><h2>Capture it. Don't chase it.</h2><p>New ideas stay safely out of today's plan until your monthly review.</p></div><div className="idea-input"><input value={idea} onChange={e => setIdea(e.target.value)} onKeyDown={e => e.key === "Enter" && addIdea()} placeholder="What's on your mind?" /><button onClick={addIdea}><Plus /></button></div><small>{ideas.length} ideas parked</small></article>
            </section>
          </>
        )}

        {view === "This week" && (
          <section className="panel page-panel"><div className="panel-title"><div><span className="eyebrow">WEEK 1 OF 13</span><h2>Your controlled commitment list</h2></div><span className="count">{completed}/{tasks.length}</span></div>
            <div className="weekly-columns">
              {(["cash", "build", "health", "life"] as Category[]).map(cat => {
                const meta = categoryMeta[cat]; const Icon = meta.icon;
                return <div className="week-column" key={cat}><h3><span className={`category-icon ${meta.colour}`}><Icon size={17} /></span>{meta.label}</h3>{tasks.filter(t => t.category === cat).map(t => <div className={`mini-task ${t.done ? "done" : ""}`} key={t.id}><button onClick={() => toggle(t.id)} aria-label={t.done ? "Mark incomplete" : "Mark complete"}>{t.done ? <Check size={14} /> : ""}</button><button className="mini-task-title" onClick={() => setSelectedTaskId(t.id)}>{t.title}</button><small>{(t.notes || t.links?.length) ? <FileText size={13} /> : `${t.points} pts`}</small></div>)}</div>;
              })}
            </div>
          </section>
        )}

        {view === "Objectives" && <section className="objective-grid page-grid">{plans.slice(0,3).map(p => <article className={`objective ${p.colour}`} key={p.name}><span className="status">{p.status}</span><h3>{p.name}</h3><p>{p.detail}</p><div className="bar"><i style={{width:`${p.progress}%`}} /></div><small>{p.progress}% complete</small></article>)}</section>}
        {view === "Plans" && <section className="panel page-panel">{plans.map(p => <article className="plan-row" key={p.name}><span className={`plan-dot ${p.colour}`} /><div><h3>{p.name}</h3><p>{p.detail}</p></div><span className={`pill ${p.status === "Active" ? "live" : ""}`}>{p.status}</span><ChevronRight /></article>)}</section>}
        {view === "Scorecard" && <section className="metric-grid page-grid">{[["Weekly points", `${score}/50`, "Actions completed"],["Contracted revenue","£0","Target £5,000"],["Qualified pipeline","£0","Target £20,000"],["Paying users","0","Target 5"],["Health sessions",`${tasks.filter(t=>t.category==="health"&&t.done).length}/3`,"This week"],["Household runway","Set value","Review this week"]].map(([a,b,c])=><article className="panel metric-card" key={a}><span className="eyebrow">{a}</span><strong>{b}</strong><p>{c}</p></article>)}</section>}
        {view === "Ideas" && <section className="panel page-panel"><div className="panel-title"><div><span className="eyebrow">NOT NOW</span><h2>Idea car park</h2></div><span className="count">{ideas.length}</span></div><div className="idea-input large"><input value={idea} onChange={e=>setIdea(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addIdea()} placeholder="Capture a thought without changing the plan" /><button onClick={addIdea}><Plus /></button></div>{ideas.length === 0 ? <div className="empty"><Lightbulb/><h3>No ideas parked yet</h3><p>Good. Stay with the plan.</p></div> : ideas.map((item,i)=><div className="parked" key={`${item}-${i}`}><Lightbulb size={17}/><span>{item}</span><button onClick={()=>setIdeas(v=>v.filter((_,n)=>n!==i))}><X size={16}/></button></div>)}</section>}
        {view === "Account" && <section className="panel page-panel auth-panel"><span className="eyebrow">PRIVATE CLOUD SYNC</span><h2>Sign in to save across devices</h2><p>Enter your email and Supabase will send you a secure sign-in link. There’s no password to remember.</p><div className="idea-input large"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&signIn()} placeholder="Your email address" /><button onClick={signIn}><ArrowRight /></button></div>{authMessage && <p>{authMessage}</p>}</section>}
      </section>

      {newTask && <div className="modal-backdrop" onClick={() => setNewTask(false)}><div className="modal" onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setNewTask(false)}><X/></button><span className="eyebrow">NEW MICRO-TASK</span><h2>Keep it finishable</h2><p>Tasks should fit inside one focused 30 to 60 minute session.</p><NewTaskForm onAdd={task=>{setTasks(v=>[...v,{...task,id:Date.now(),done:false,today:false,week:1}]);setNewTask(false)}} /></div></div>}
      {selectedTask && <TaskWorkspace task={selectedTask} onClose={() => setSelectedTaskId(null)} onUpdate={updates => updateTask(selectedTask.id, updates)} onToggle={() => toggle(selectedTask.id)} />}
    </main>
  );
}

function NewTaskForm({onAdd}:{onAdd:(task:Omit<Task,"id"|"done"|"today"|"week">)=>void}) {
  const [title,setTitle]=useState(""); const [category,setCategory]=useState<Category>("cash");
  return <div className="form"><label>Task<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="Start with a verb..." /></label><label>Impact<select value={category} onChange={e=>setCategory(e.target.value as Category)}><option value="cash">Cash now</option><option value="build">Build</option><option value="health">Health</option><option value="life">Life</option></select></label><button className="primary-btn" disabled={!title.trim()} onClick={()=>onAdd({title:title.trim(),category,points:category==="cash"?3:2})}>Add to this week</button></div>;
}

function TaskWorkspace({ task, onClose, onUpdate, onToggle }: {
  task: Task;
  onClose: () => void;
  onUpdate: (updates: Partial<Task>) => void;
  onToggle: () => void;
}) {
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const links = task.links ?? [];

  function addLink() {
    const rawUrl = linkUrl.trim();
    if (!rawUrl) return;
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    onUpdate({ links: [...links, { id: Date.now(), label: linkLabel.trim() || "Supporting document", url }] });
    setLinkLabel("");
    setLinkUrl("");
  }

  return <div className="modal-backdrop workspace-backdrop" onClick={onClose}>
    <div className="modal task-workspace" onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose}><X /></button>
      <span className="eyebrow">ACTION WORKSPACE</span>
      <input className="workspace-title" value={task.title} onChange={event => onUpdate({ title: event.target.value })} />
      <div className="workspace-meta">
        <span className={`category-badge ${categoryMeta[task.category].colour}`}>{categoryMeta[task.category].label}</span>
        <span>{task.points} points</span>
        <button className={task.done ? "complete-button complete" : "complete-button"} onClick={onToggle}>
          <Check size={15} /> {task.done ? "Completed" : "Mark complete"}
        </button>
      </div>

      <section className="workspace-section">
        <div className="workspace-section-title"><FileText size={19} /><div><h3>Working document</h3><p>Draft, plan or compile the work here. It saves automatically.</p></div></div>
        <textarea
          value={task.notes ?? ""}
          onChange={event => onUpdate({ notes: event.target.value })}
          placeholder={"Start writing here...\n\nUse this space for the detailed work behind the action, including lists, drafts, notes and decisions."}
        />
        <small className="save-state">Saved automatically to your Command Centre</small>
      </section>

      <section className="workspace-section">
        <div className="workspace-section-title"><Link2 size={19} /><div><h3>Linked resources</h3><p>Add Google Docs, Apple Notes links, decks or any useful webpage.</p></div></div>
        {links.length > 0 && <div className="resource-list">
          {links.map(link => <div className="resource" key={link.id}>
            <Link2 size={16} />
            <a href={link.url} target="_blank" rel="noreferrer"><strong>{link.label}</strong><small>{link.url}</small></a>
            <a className="open-resource" href={link.url} target="_blank" rel="noreferrer" aria-label={`Open ${link.label}`}><ExternalLink size={16} /></a>
            <button onClick={() => onUpdate({ links: links.filter(item => item.id !== link.id) })} aria-label={`Remove ${link.label}`}><Trash2 size={16} /></button>
          </div>)}
        </div>}
        <div className="link-form">
          <input value={linkLabel} onChange={event => setLinkLabel(event.target.value)} placeholder="Link name, for example Prospect list" />
          <input value={linkUrl} onChange={event => setLinkUrl(event.target.value)} onKeyDown={event => event.key === "Enter" && addLink()} placeholder="Paste URL" />
          <button className="primary-btn" disabled={!linkUrl.trim()} onClick={addLink}><Plus size={17} /> Add link</button>
        </div>
      </section>
    </div>
  </div>;
}
