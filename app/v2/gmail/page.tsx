"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, Inbox, Link2, Mail, RefreshCcw, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Workspace } from "../../../lib/v2-data";
import { callCalendar, loadCalendarStatus } from "../../../lib/v2-calendar";
import { callGmail, GMAIL_READONLY_SCOPE, GOOGLE_COMMAND_CENTRE_SCOPES, type GmailActionMessage, type GmailInboxResult } from "../../../lib/v2-gmail";
import CreateTaskModal from "../components/CreateTaskModal";
import styles from "./gmail.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };
type FilterMode = "action" | "all";

function suggestedCategory(email: GmailActionMessage) {
  const text = `${email.subject} ${email.snippet}`.toLowerCase();
  return /\b(proposal|prospect|client|pitch|opportunity|contract|cv|resume|interview|job|business|invoice|fee|budget)\b/.test(text) ? "cash" : "build";
}

function emailNotes(email: GmailActionMessage) {
  return `Captured from Gmail\nFrom: ${email.from}\nSubject: ${email.subject}\nReceived: ${email.date}\n\n${email.snippet}`;
}

export default function GmailActionCapturePage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [messages, setMessages] = useState<GmailActionMessage[]>([]);
  const [accountEmail, setAccountEmail] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("action");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GmailActionMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function persistGoogleSession(session: Session) {
    if (!supabase || !session.provider_refresh_token) return;
    await callCalendar(supabase, "connect", {
      refreshToken: session.provider_refresh_token,
      accessToken: session.provider_token,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      scopes: GOOGLE_COMMAND_CENTRE_SCOPES,
    });
  }

  async function loadBase(session: Session) {
    if (!supabase) return;
    setLoading(true);
    try {
      await persistGoogleSession(session);
      const [nextWorkspace, status] = await Promise.all([
        loadV2Workspace(supabase, session.user.id),
        loadCalendarStatus(supabase, session.user.id),
      ]);
      setWorkspace(nextWorkspace);
      const hasGmail = Boolean(status?.granted_scopes?.includes(GMAIL_READONLY_SCOPE));
      setGmailConnected(hasGmail);
      setError("");
      if (hasGmail) await loadInbox();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Gmail capture.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) { setError(sessionError.message); setLoading(false); return; }
      const session = data.session;
      setUser(session?.user ?? null);
      if (!session) { setLoading(false); return; }
      void loadBase(session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  async function reloadWorkspace() {
    if (!supabase || !user) return;
    setWorkspace(await loadV2Workspace(supabase, user.id));
  }

  async function loadInbox() {
    if (!supabase) return;
    setGmailLoading(true);
    setError("");
    try {
      const result = await callGmail<GmailInboxResult>(supabase, "actionInbox", { maxResults: 40 });
      setMessages(result.messages);
      setAccountEmail(result.accountEmail);
      setGmailConnected(true);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Unable to read Gmail.";
      setError(detail.includes("403") ? "Gmail access is not active yet. Reconnect Google and approve the Gmail read-only permission." : detail);
    } finally {
      setGmailLoading(false);
    }
  }

  async function connectGmail() {
    if (!supabase) return;
    setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/v2/gmail/`,
        scopes: GOOGLE_COMMAND_CENTRE_SCOPES.join(" "),
        queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      },
    });
    if (authError) setError(authError.message);
  }

  const capturedThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of workspace.allTasks) {
      for (const link of task.links) {
        const match = link.url.match(/#all\/([^/?#]+)/);
        if (match?.[1]) ids.add(match[1]);
      }
    }
    return ids;
  }, [workspace.allTasks]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages
      .filter(email => filter === "all" || email.score >= 3)
      .filter(email => !needle || `${email.subject} ${email.from} ${email.snippet}`.toLowerCase().includes(needle));
  }, [messages, filter, query]);

  const actionCount = messages.filter(email => email.score >= 3).length;
  const capturedCount = messages.filter(email => capturedThreadIds.has(email.threadId)).length;

  if (!user && !loading) return <main className={styles.state}><div><Mail size={30} /><h1>Sign in first</h1><Link href="/v2">Back to Command Centre</Link></div></main>;

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><span>GMAIL ACTION CAPTURE</span><h1>Turn email into work without living in your inbox.</h1><p>Command Centre scans recent inbox messages for likely actions. Gmail stays read-only; you decide what becomes a task.</p></div>
      <div className={styles.trust}><ShieldCheck size={18} /><div><strong>Read-only Gmail</strong><small>No sending, deleting, archiving or marking messages.</small></div></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={17} /> {message}</div>}

    {loading ? <section className={styles.loading}>Loading Gmail action capture…</section> : !gmailConnected ?
      <section className={styles.connectCard}><Mail size={34} /><h2>Add Gmail read-only access</h2><p>Google will ask for permission to read your Gmail messages. Command Centre uses this only to identify possible actions and link an email back to a task.</p><button onClick={() => void connectGmail()}><Link2 size={17} /> Connect Gmail</button></section>
      : <>
        <section className={styles.summaryGrid}>
          <article><span>LIKELY ACTIONS</span><strong>{actionCount}</strong><small>Recent emails that contain stronger action signals</small></article>
          <article><span>CAPTURED</span><strong>{capturedCount}</strong><small>Recent email threads already linked to tasks</small></article>
          <article><span>ACCOUNT</span><strong className={styles.account}>{accountEmail || "Connected Gmail"}</strong><small>Read-only connection</small></article>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.tabs}><button className={filter === "action" ? styles.activeTab : ""} onClick={() => setFilter("action")}><Sparkles size={15} /> Needs action</button><button className={filter === "all" ? styles.activeTab : ""} onClick={() => setFilter("all")}><Inbox size={15} /> All recent</button></div>
          <label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sender, subject or snippet" /></label>
          <button className={styles.refresh} onClick={() => void loadInbox()} disabled={gmailLoading}><RefreshCcw size={16} /> {gmailLoading ? "Checking…" : "Refresh"}</button>
        </section>

        <section className={styles.emailList}>
          {visible.map(email => {
            const captured = capturedThreadIds.has(email.threadId);
            return <article key={email.id} className={captured ? styles.capturedCard : ""}>
              <div className={styles.emailTop}><div><span className={email.unread ? styles.unread : styles.read}>{email.unread ? "UNREAD" : "READ"}</span>{email.important && <span className={styles.important}>IMPORTANT</span>}{captured && <span className={styles.captured}>TASK CREATED</span>}</div><time>{email.date}</time></div>
              <h2>{email.subject}</h2>
              <p className={styles.sender}>{email.from}</p>
              <p className={styles.snippet}>{email.snippet}</p>
              <div className={styles.reasons}>{email.reasons.map(reason => <span key={reason}>{reason}</span>)}</div>
              <footer><a href={email.gmailUrl} target="_blank" rel="noreferrer">Open in Gmail <ExternalLink size={15} /></a><button onClick={() => setSelected(email)} disabled={captured}>{captured ? "Already captured" : "Create task"} <ArrowRight size={15} /></button></footer>
            </article>;
          })}
          {!gmailLoading && visible.length === 0 && <div className={styles.empty}><CheckCircle2 size={24} /><strong>No matching email actions</strong><p>Switch to All recent or refresh Gmail.</p></div>}
        </section>
      </>}

    {selected && user && <CreateTaskModal
      userId={user.id}
      initiatives={workspace.initiatives}
      initialTitle={selected.suggestedTaskTitle}
      initialNotes={emailNotes(selected)}
      initialCategory={suggestedCategory(selected)}
      initialPriority={selected.score >= 6 ? 4 : 3}
      sourceUrl={selected.gmailUrl}
      sourceLabel="Gmail thread"
      onClose={() => setSelected(null)}
      onCreated={async ({ scheduled }) => {
        setSelected(null);
        setMessage(scheduled ? "Email captured as a task and scheduled in Calendar." : "Email captured as a linked Command Centre task.");
        await reloadWorkspace();
      }}
    />}
  </main>;
}
