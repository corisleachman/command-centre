"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, CalendarClock, CheckCircle2, ExternalLink, Mail, Plus, RefreshCcw, Search, UserRoundCheck } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Workspace } from "../../../lib/v2-data";
import { loadCrmOpportunities, type CrmOpportunity } from "../../../lib/v2-crm";
import CreateTaskModal from "../components/CreateTaskModal";
import styles from "./opportunities.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };
type View = "all" | "due" | "engaged" | "waiting";

function taskNotes(item: CrmOpportunity) {
  return `CRM opportunity\nContact: ${item.name}\nCompany: ${item.company || "—"}\nEmail: ${item.email || "—"}\nStage: ${item.stage}\nReason: ${item.reason}\n\nRecommended next action: ${item.nextAction}`;
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function OpportunitiesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [items, setItems] = useState<CrmOpportunity[]>([]);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CrmOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(userId: string, refresh = false) {
    if (!supabase) return;
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const [crm, nextWorkspace] = await Promise.all([
        loadCrmOpportunities(supabase),
        loadV2Workspace(supabase, userId),
      ]);
      setItems(crm.opportunities);
      setWorkspace(nextWorkspace);
      setNotConfigured(false);
      setError("");
    } catch (reason) {
      const typed = reason as Error & { code?: string };
      if (typed.code === "crm_not_configured") {
        setNotConfigured(true);
        setError("");
      } else {
        setError(typed.message || "Unable to load CRM opportunities.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) { setError(sessionError.message); setLoading(false); return; }
      const nextUser = data.session?.user ?? null;
      setUser(nextUser);
      if (nextUser) void load(nextUser.id);
      else setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(item => {
      if (view === "due" && item.stage !== "Follow-up due") return false;
      if (view === "engaged" && item.stage !== "Engaged") return false;
      if (view === "waiting" && item.stage !== "Waiting on them") return false;
      if (needle && !`${item.name} ${item.company} ${item.email} ${item.stage} ${item.nextAction}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, query, view]);

  const due = items.filter(item => item.stage === "Follow-up due").length;
  const engaged = items.filter(item => item.stage === "Engaged").length;
  const waiting = items.filter(item => item.stage === "Waiting on them").length;

  if (!user && !loading) return <main className={styles.state}><div><BriefcaseBusiness size={30} /><h1>Sign in first</h1><Link href="/v2">Back to Command Centre</Link></div></main>;

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><span>ACTIVE CRM OPPORTUNITIES</span><h1>Only the relationships that need attention.</h1><p>Prospects stays the source of truth. Command Centre turns active commercial relationships into clear next actions, tasks and follow-ups.</p></div>
      <a href="https://corisleachman.github.io/prospects/" target="_blank" rel="noreferrer">Open full Prospects CRM <ExternalLink size={15} /></a>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={17} /> {message}</div>}

    {notConfigured ? <section className={styles.connectCard}>
      <BriefcaseBusiness size={34} /><h2>CRM adapter ready</h2><p>The Command Centre side is built and protected behind your signed-in session. It now needs one server-side read credential for the existing Prospects Supabase project before live opportunity data can appear here.</p><small>No Prospects records are copied into Command Centre.</small>
    </section> : loading ? <section className={styles.loading}>Loading active opportunities…</section> : <>
      <section className={styles.summaryGrid}>
        <button onClick={() => setView("due")}><span>FOLLOW-UP DUE</span><strong>{due}</strong><small>Commercial conversations needing action now</small></button>
        <button onClick={() => setView("engaged")}><span>ENGAGED</span><strong>{engaged}</strong><small>Contacts who have replied</small></button>
        <button onClick={() => setView("waiting")}><span>WAITING ON THEM</span><strong>{waiting}</strong><small>Outbound sent, response still pending</small></button>
        <button onClick={() => setView("all")}><span>ACTIVE TOTAL</span><strong>{items.length}</strong><small>Filtered from the full Prospects database</small></button>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.tabs}>{(["all", "due", "engaged", "waiting"] as View[]).map(option => <button key={option} className={view === option ? styles.activeTab : ""} onClick={() => setView(option)}>{option === "all" ? "All active" : option === "due" ? "Needs action" : option === "engaged" ? "Engaged" : "Waiting"}</button>)}</div>
        <label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search contact or company" /></label>
        <button className={styles.refresh} onClick={() => user && void load(user.id, true)} disabled={refreshing}><RefreshCcw size={16} /> {refreshing ? "Checking…" : "Refresh"}</button>
      </section>

      <section className={styles.list}>
        {visible.map(item => <article key={item.id}>
          <div className={styles.top}><div><span className={styles.stage}>{item.stage}</span>{item.rawStatus && <span className={styles.raw}>{item.rawStatus}</span>}</div><strong className={item.urgency >= 5 ? styles.urgent : ""}>{item.urgency >= 5 ? "ACTION NOW" : item.urgency >= 4 ? "PRIORITY" : "ACTIVE"}</strong></div>
          <div className={styles.identity}><div><h2>{item.name}</h2><p>{[item.title, item.company].filter(Boolean).join(" · ") || item.email}</p></div>{item.company && <span>{item.company}</span>}</div>
          <div className={styles.recommendation}><UserRoundCheck size={19} /><div><span>RECOMMENDED NEXT ACTION</span><strong>{item.nextAction}</strong><small>{item.reason}</small></div></div>
          <div className={styles.meta}><span><Mail size={14} /> {item.email || "No email"}</span><span><CalendarClock size={14} /> Follow-up {fmtDate(item.followUpOn)}</span>{item.daysSinceContact != null && <span>{item.daysSinceContact}d since last contact</span>}</div>
          <footer>
            {item.email && <Link href={`/v2/gmail/?q=${encodeURIComponent(item.email)}`}><Mail size={15} /> Email actions</Link>}
            {item.linkedinUrl && <a href={item.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={14} /></a>}
            {item.website && <a href={item.website} target="_blank" rel="noreferrer">Website <ExternalLink size={14} /></a>}
            <button onClick={() => setSelected(item)}><Plus size={15} /> Create next action</button>
          </footer>
        </article>)}
        {!visible.length && <div className={styles.empty}><CheckCircle2 size={24} /><strong>No active opportunities match this view.</strong></div>}
      </section>
    </>}

    {selected && user && <CreateTaskModal
      userId={user.id}
      initiatives={workspace.initiatives}
      initialTitle={`${selected.nextAction}: ${selected.name}${selected.company ? ` at ${selected.company}` : ""}`}
      initialNotes={taskNotes(selected)}
      initialCategory="cash"
      initialPriority={selected.urgency >= 5 ? 4 : 3}
      initialEstimateMinutes={selected.stage === "Engaged" ? 30 : 15}
      sourceUrl="https://corisleachman.github.io/prospects/"
      sourceLabel="Prospects CRM"
      onClose={() => setSelected(null)}
      onCreated={async ({ scheduled }) => {
        setSelected(null);
        setMessage(scheduled ? "CRM next action created and scheduled." : "CRM next action added to Command Centre.");
        if (supabase && user) setWorkspace(await loadV2Workspace(supabase, user.id));
      }}
    />}
  </main>;
}
