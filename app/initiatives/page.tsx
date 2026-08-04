"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, CircleDot, Clock3, Layers3, Target } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { initiativeProgress, loadInitiatives, type RelationalInitiative } from "../../lib/relational";
import styles from "./initiatives.module.css";

function formatDate(value: string | null) {
  if (!value) return "No target date";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export default function InitiativesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [initiatives, setInitiatives] = useState<RelationalInitiative[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) {
      setMessage("Supabase is not configured for this environment.");
      setLoading(false);
      return;
    }

    const client = supabase;
    client.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    loadInitiatives(supabase)
      .then(data => {
        setInitiatives(data);
        setSelectedId(current => current ?? data[0]?.id ?? null);
        setMessage("");
      })
      .catch(error => setMessage(error instanceof Error ? error.message : "The relational initiative data could not be loaded."))
      .finally(() => setLoading(false));
  }, [user]);

  const selected = useMemo(
    () => initiatives.find(initiative => initiative.id === selectedId) ?? initiatives[0] ?? null,
    [initiatives, selectedId]
  );

  const milestoneGroups = useMemo(() => {
    if (!selected) return [];
    return selected.workstreams.map(workstream => ({
      ...workstream,
      milestones: selected.milestones.filter(milestone => milestone.workstream_id === workstream.id)
    }));
  }, [selected]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.back}><ArrowLeft size={16} /> Command Centre</Link>
          <span className={styles.eyebrow}>RELATIONAL BETA</span>
          <h1>Initiatives</h1>
          <p>Strategy underneath. Clear execution on the surface.</p>
        </div>
        <div className={styles.status}><CircleDot size={16} /> Read-only test view</div>
      </header>

      {!user && !loading && (
        <section className={styles.empty}>
          <Target size={28} />
          <h2>Sign in from the Command Centre</h2>
          <p>This view uses your authenticated Supabase session and only reads your relational initiative data.</p>
          <Link href="/" className={styles.primary}>Return to sign in</Link>
        </section>
      )}

      {loading && <section className={styles.empty}><p>Loading relational initiative data…</p></section>}
      {message && <section className={styles.error}>{message}</section>}

      {user && !loading && !message && initiatives.length === 0 && (
        <section className={styles.empty}>
          <Layers3 size={28} />
          <h2>No initiatives found</h2>
          <p>The migration completed, but this account does not currently have any relational initiatives.</p>
        </section>
      )}

      {user && selected && (
        <div className={styles.layout}>
          <aside className={styles.listPanel}>
            <span className={styles.eyebrow}>ACTIVE WORK</span>
            <div className={styles.initiativeList}>
              {initiatives.map(initiative => {
                const progress = initiativeProgress(initiative);
                return (
                  <button key={initiative.id} className={initiative.id === selected.id ? styles.activeCard : styles.card} onClick={() => setSelectedId(initiative.id)}>
                    <div className={styles.cardTop}><strong>{initiative.title}</strong><span>{progress}%</span></div>
                    <p>{initiative.desired_outcome || initiative.purpose || "No outcome statement yet."}</p>
                    <div className={styles.progress}><i style={{ width: `${progress}%` }} /></div>
                    <small>{initiative.tasks.filter(task => task.status === "complete").length}/{initiative.tasks.length} actions complete</small>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className={styles.detail}>
            <div className={styles.hero}>
              <div>
                <span className={styles.eyebrow}>{selected.status.toUpperCase()}</span>
                <h2>{selected.title}</h2>
                <p>{selected.desired_outcome || selected.purpose}</p>
              </div>
              <div className={styles.metric}><strong>{initiativeProgress(selected)}%</strong><span>complete</span></div>
            </div>

            <div className={styles.summaryGrid}>
              <article><CalendarDays size={19} /><span>Target</span><strong>{formatDate(selected.target_date)}</strong></article>
              <article><Layers3 size={19} /><span>Workstreams</span><strong>{selected.workstreams.length}</strong></article>
              <article><Target size={19} /><span>Milestones</span><strong>{selected.milestones.length}</strong></article>
              <article><CheckCircle2 size={19} /><span>Actions</span><strong>{selected.tasks.length}</strong></article>
            </div>

            <section className={styles.roadmap}>
              <div className={styles.sectionHeading}>
                <div><span className={styles.eyebrow}>ROADMAP</span><h3>Workstreams and milestones</h3></div>
                <span>{selected.tasks.filter(task => task.status !== "complete").length} open actions</span>
              </div>

              {milestoneGroups.map(group => (
                <article key={group.id} className={styles.workstream}>
                  <div className={styles.workstreamTitle}><h4>{group.title}</h4><span>{group.milestones.length} milestones</span></div>
                  {group.milestones.length === 0 ? <p className={styles.muted}>No milestones yet.</p> : (
                    <div className={styles.milestones}>
                      {group.milestones.map(milestone => {
                        const tasks = selected.tasks.filter(task => task.milestone_id === milestone.id);
                        const complete = tasks.filter(task => task.status === "complete").length;
                        return (
                          <div key={milestone.id} className={styles.milestone}>
                            <div className={styles.milestoneHeader}>
                              <div><strong>{milestone.title}</strong><small>{milestone.outcome_statement || milestone.status.replaceAll("_", " ")}</small></div>
                              <span>{complete}/{tasks.length}</span>
                            </div>
                            <div className={styles.taskRows}>
                              {tasks.slice(0, 6).map(task => (
                                <div key={task.id} className={styles.taskRow}>
                                  <span className={task.status === "complete" ? styles.completeDot : styles.openDot} />
                                  <strong>{task.title}</strong>
                                  <span><Clock3 size={13} /> {task.estimated_minutes}m</span>
                                </div>
                              ))}
                              {tasks.length > 6 && <small className={styles.more}>+ {tasks.length - 6} more actions</small>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              ))}
            </section>
          </section>
        </div>
      )}
    </main>
  );
}
