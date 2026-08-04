"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Layers3, Plus, Save, Target, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import {
  createV2Initiative, createV2Milestone, createV2Workstream, deleteV2Milestone,
  deleteV2Workstream, loadV2Workspace, updateV2Initiative, updateV2Milestone,
  updateV2Workstream, type V2Initiative, type V2Workspace
} from "../../../lib/v2-data";
import styles from "./initiatives.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };

type Draft = { title: string; purpose: string; desiredOutcome: string; status: string; priority: number; targetDate: string };

export default function InitiativesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function reload(preferredId?: string) {
    if (!supabase || !user) return;
    setLoading(true);
    try {
      const data = await loadV2Workspace(supabase, user.id);
      setWorkspace(data);
      setSelectedId(current => preferredId ?? current ?? data.initiatives[0]?.id ?? null);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load initiatives."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, [user]);
  const selected = useMemo(() => workspace.initiatives.find(item => item.id === selectedId) ?? null, [workspace, selectedId]);

  if (!user && !loading) return <main className={styles.auth}><div><h1>Sign in first</h1><Link href="/v2">Back to V2</Link></div></main>;

  return <main className={styles.page}>
    <aside className={styles.sidebar}>
      <Link href="/v2" className={styles.back}><ArrowLeft size={17} /> Back to V2</Link>
      <div className={styles.brand}><Layers3 /><div><span>INITIATIVE ENGINE</span><strong>Command Centre V2</strong></div></div>
      <button className={styles.primary} onClick={() => setShowCreate(true)}><Plus size={17} /> New initiative</button>
      <div className={styles.list}>{workspace.initiatives.map(item => <button key={item.id} className={item.id === selectedId ? styles.active : ""} onClick={() => setSelectedId(item.id)}><strong>{item.title}</strong><span>{item.status} · priority {item.priority}</span></button>)}</div>
    </aside>

    <section className={styles.content}>
      {loading && <div className={styles.state}>Loading initiative workspace...</div>}
      {error && <div className={styles.error}>{error}</div>}
      {!loading && !error && selected && <Editor initiative={selected} userId={user.id} onChanged={() => reload(selected.id)} />}
      {!loading && !error && !selected && <div className={styles.empty}><Layers3 size={34} /><h1>Create your first initiative</h1><p>Use initiatives for outcomes that need multiple milestones and actions.</p><button className={styles.primary} onClick={() => setShowCreate(true)}><Plus size={17} /> New initiative</button></div>}
    </section>

    {showCreate && <CreateModal userId={user.id} onClose={() => setShowCreate(false)} onCreated={async id => { setShowCreate(false); await reload(id); }} />}
  </main>;
}

function Editor({ initiative, userId, onChanged }: { initiative: V2Initiative; userId: string; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>({ title: initiative.title, purpose: initiative.purpose ?? "", desiredOutcome: initiative.desiredOutcome ?? "", status: initiative.status, priority: initiative.priority, targetDate: initiative.targetDate ?? "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft({ title: initiative.title, purpose: initiative.purpose ?? "", desiredOutcome: initiative.desiredOutcome ?? "", status: initiative.status, priority: initiative.priority, targetDate: initiative.targetDate ?? "" }), [initiative]);

  async function save() { if (!supabase || !draft.title.trim()) return; setBusy(true); try { await updateV2Initiative(supabase, userId, initiative.id, { ...draft, title: draft.title.trim() }); await onChanged(); } finally { setBusy(false); } }
  async function addStream() { if (!supabase) return; const title = window.prompt("Workstream name"); if (!title?.trim()) return; await createV2Workstream(supabase, userId, initiative.id, title.trim()); await onChanged(); }

  return <div className={styles.editor}>
    <header className={styles.header}><div><span>INITIATIVE WORKSPACE</span><h1>{initiative.title}</h1><p>Define the outcome, structure the work, then attach actions.</p></div><button className={styles.primary} onClick={save} disabled={busy}><Save size={17} /> {busy ? "Saving..." : "Save"}</button></header>
    <section className={styles.card}><div className={styles.grid}><label>Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="active">Active</option><option value="paused">Paused</option><option value="complete">Complete</option><option value="archived">Archived</option></select></label><label>Priority<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}>{[5,4,3,2,1].map(v => <option key={v}>{v}</option>)}</select></label><label>Target date<input type="date" value={draft.targetDate} onChange={e => setDraft({ ...draft, targetDate: e.target.value })} /></label></div><label>Purpose<textarea rows={3} value={draft.purpose} onChange={e => setDraft({ ...draft, purpose: e.target.value })} /></label><label>Desired outcome<textarea rows={3} value={draft.desiredOutcome} onChange={e => setDraft({ ...draft, desiredOutcome: e.target.value })} /></label></section>
    <section><div className={styles.sectionHead}><div><span>DELIVERY STRUCTURE</span><h2>Workstreams and milestones</h2></div><button onClick={addStream}><Plus size={16} /> Add workstream</button></div>{initiative.workstreams.map(stream => <Workstream key={stream.id} initiativeId={initiative.id} stream={stream} userId={userId} onChanged={onChanged} />)}{initiative.workstreams.length === 0 && <div className={styles.emptyInline}>No workstreams yet.</div>}</section>
  </div>;
}

function Workstream({ initiativeId, stream, userId, onChanged }: { initiativeId: string; stream: V2Initiative["workstreams"][number]; userId: string; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(stream.title);
  async function save() { if (!supabase || !title.trim()) return; await updateV2Workstream(supabase, userId, stream.id, title.trim()); await onChanged(); }
  async function addMilestone() { if (!supabase) return; const name = window.prompt("Milestone name"); if (!name?.trim()) return; await createV2Milestone(supabase, userId, initiativeId, stream.id, name.trim()); await onChanged(); }
  async function remove() { if (!supabase || !window.confirm(`Delete workstream “${stream.title}”?`)) return; await deleteV2Workstream(supabase, userId, stream.id); await onChanged(); }
  return <article className={styles.workstream}><div className={styles.streamHead}><input value={title} onChange={e => setTitle(e.target.value)} /><button onClick={save}><Check size={16} /></button><button onClick={addMilestone}><Plus size={16} /> Milestone</button><button className={styles.danger} onClick={remove}><Trash2 size={16} /></button></div><div className={styles.milestones}>{stream.milestones.map(m => <Milestone key={m.id} milestone={m} userId={userId} onChanged={onChanged} />)}{stream.milestones.length === 0 && <div className={styles.emptyInline}>No milestones.</div>}</div></article>;
}

function Milestone({ milestone, userId, onChanged }: { milestone: V2Initiative["workstreams"][number]["milestones"][number]; userId: string; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(milestone.title);
  const [status, setStatus] = useState(milestone.status);
  async function save() { if (!supabase || !title.trim()) return; await updateV2Milestone(supabase, userId, milestone.id, { title: title.trim(), status }); await onChanged(); }
  async function remove() { if (!supabase || !window.confirm(`Delete milestone “${milestone.title}”?`)) return; await deleteV2Milestone(supabase, userId, milestone.id); await onChanged(); }
  return <div className={styles.milestone}><Target size={17} /><input value={title} onChange={e => setTitle(e.target.value)} /><select value={status} onChange={e => setStatus(e.target.value)}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select><span>{milestone.tasks.length} tasks</span><button onClick={save}><Check size={16} /></button><button className={styles.danger} onClick={remove}><Trash2 size={16} /></button></div>;
}

function CreateModal({ userId, onClose, onCreated }: { userId: string; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>({ title: "", purpose: "", desiredOutcome: "", status: "active", priority: 4, targetDate: "" });
  async function create() { if (!supabase || !draft.title.trim()) return; const id = await createV2Initiative(supabase, userId, { ...draft, title: draft.title.trim() }); await onCreated(id); }
  return <div className={styles.modal} onClick={onClose}><div onClick={e => e.stopPropagation()}><h2>New initiative</h2><label>Title<input autoFocus value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Purpose<textarea rows={3} value={draft.purpose} onChange={e => setDraft({ ...draft, purpose: e.target.value })} /></label><label>Desired outcome<textarea rows={3} value={draft.desiredOutcome} onChange={e => setDraft({ ...draft, desiredOutcome: e.target.value })} /></label><div className={styles.actions}><button onClick={onClose}>Cancel</button><button className={styles.primary} onClick={create} disabled={!draft.title.trim()}><Plus size={16} /> Create</button></div></div></div>;
}
