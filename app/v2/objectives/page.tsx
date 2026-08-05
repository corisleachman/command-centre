"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Link2, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { assignInitiativeObjective, deleteObjective, loadObjectivesWorkspace, saveObjective, seedRecommendedObjectives, type LifeArea, type Objective, type ObjectiveInitiative } from "../../../lib/v2-objectives";
import styles from "./objectives.module.css";

const blank = { title: "", outcomeStatement: "", lifeAreaId: "", status: "active", priority: 3, targetDate: "" };

export default function ObjectivesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [areas, setAreas] = useState<LifeArea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [initiatives, setInitiatives] = useState<ObjectiveInitiative[]>([]);
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
      const data = await loadObjectivesWorkspace(supabase, user.id);
      setAreas(data.areas); setObjectives(data.objectives); setInitiatives(data.initiatives); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load objectives."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, [user]);

  const grouped = useMemo(() => areas.map(area => ({ area, objectives: objectives.filter(objective => objective.lifeAreaId === area.id) })), [areas, objectives]);
  const ungrouped = objectives.filter(objective => !objective.lifeAreaId);

  function startEdit(objective: Objective) {
    setEditing(objective.id);
    setDraft({ title: objective.title, outcomeStatement: objective.outcomeStatement, lifeAreaId: objective.lifeAreaId ?? "", status: objective.status, priority: objective.priority, targetDate: objective.targetDate ?? "" });
  }

  function reset() { setEditing(null); setDraft(blank); }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); await reload(); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update objectives."); }
    finally { setBusy(false); }
  }

  if (!user) return <main className={styles.auth}><div><h1>{loading ? "Checking your session..." : "Sign in first"}</h1>{!loading && <Link href="/v2">Back to V2</Link>}</div></main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/v2" className={styles.back}><ArrowLeft size={17} /> Back to dashboard</Link><span>OBJECTIVES</span><h1>Connect daily work to what matters</h1><p>Objectives sit above initiatives, giving the system a clear reason for the work you choose to prioritise.</p></div>
      {objectives.length === 0 && <button disabled={busy} onClick={() => void run(() => seedRecommendedObjectives(supabase!, user.id))}><Sparkles size={17} /> Create recommended objectives</button>}
    </header>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Loading objectives...</div> : <>
      <section className={styles.composer}>
        <div><Target size={19} /><h2>{editing ? "Edit objective" : "Add objective"}</h2></div>
        <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Objective title" />
        <textarea value={draft.outcomeStatement} onChange={event => setDraft({ ...draft, outcomeStatement: event.target.value })} placeholder="What will be true when this objective is achieved?" />
        <div className={styles.fields}>
          <select value={draft.lifeAreaId} onChange={event => setDraft({ ...draft, lifeAreaId: event.target.value })}><option value="">No area</option>{areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
          <select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="planned">Planned</option><option value="active">Active</option><option value="paused">Paused</option><option value="complete">Complete</option><option value="stopped">Stopped</option></select>
          <select value={draft.priority} onChange={event => setDraft({ ...draft, priority: Number(event.target.value) })}><option value={1}>Priority 1</option><option value={2}>Priority 2</option><option value={3}>Priority 3</option><option value={4}>Priority 4</option><option value={5}>Priority 5</option></select>
          <input type="date" value={draft.targetDate} onChange={event => setDraft({ ...draft, targetDate: event.target.value })} />
        </div>
        <div className={styles.actions}><button disabled={busy || !draft.title.trim()} onClick={() => void run(async () => { await saveObjective(supabase!, user.id, { id: editing ?? undefined, ...draft }); reset(); })}><Plus size={16} /> {editing ? "Save changes" : "Add objective"}</button>{editing && <button className={styles.secondary} onClick={reset}>Cancel</button>}</div>
      </section>

      <section className={styles.groups}>
        {grouped.map(({ area, objectives: areaObjectives }) => <section className={styles.group} key={area.id}>
          <header><div><span>{area.position + 1}</span><div><h2>{area.name}</h2><p>{area.description}</p></div></div><strong>{areaObjectives.length}</strong></header>
          <div className={styles.cards}>{areaObjectives.map(objective => <article key={objective.id}><div className={styles.meta}><span>P{objective.priority}</span><span>{objective.status.replaceAll("_", " ")}</span>{objective.targetDate && <span>{new Date(`${objective.targetDate}T12:00:00`).toLocaleDateString("en-GB")}</span>}</div><h3>{objective.title}</h3><p>{objective.outcomeStatement || "No outcome statement yet."}</p><footer><button onClick={() => startEdit(objective)}>Edit</button><button className={styles.danger} onClick={() => { if (window.confirm("Delete this objective? Linked initiatives will remain but become unassigned.")) void run(() => deleteObjective(supabase!, user.id, objective.id)); }}><Trash2 size={14} /> Delete</button></footer></article>)}{areaObjectives.length === 0 && <p className={styles.empty}>No objectives in this area yet.</p>}</div>
        </section>)}
        {ungrouped.length > 0 && <section className={styles.group}><header><div><span>—</span><div><h2>Unassigned</h2><p>Objectives that have not yet been placed in an area.</p></div></div><strong>{ungrouped.length}</strong></header><div className={styles.cards}>{ungrouped.map(objective => <article key={objective.id}><h3>{objective.title}</h3><p>{objective.outcomeStatement}</p><footer><button onClick={() => startEdit(objective)}>Edit</button></footer></article>)}</div></section>}
      </section>

      <section className={styles.linker}>
        <div className={styles.linkerTitle}><Link2 size={18} /><div><h2>Link initiatives to objectives</h2><p>This is what lets the dashboard explain why a task matters.</p></div></div>
        {initiatives.length === 0 ? <p className={styles.empty}>No initiatives exist yet.</p> : <div className={styles.initiatives}>{initiatives.map(initiative => <article key={initiative.id}><div><strong>{initiative.title}</strong><small>{initiative.status.replaceAll("_", " ")}</small></div><select value={initiative.objectiveId ?? ""} disabled={busy} onChange={event => void run(() => assignInitiativeObjective(supabase!, user.id, initiative.id, event.target.value || null))}><option value="">No objective</option>{objectives.map(objective => <option key={objective.id} value={objective.id}>{objective.title}</option>)}</select></article>)}</div>}
      </section>
    </>}
  </main>;
}
