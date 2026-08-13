"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, CheckCircle2, ExternalLink, Inbox, Link2, Mail, MessageSquareText,
  Plus, RefreshCcw, Search, Send, ShieldCheck, Sparkles, X,
} from "lucide-react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { loadV2Workspace, type V2Workspace } from "../../../lib/v2-data";
import { callCalendar, loadCalendarStatus } from "../../../lib/v2-calendar";
import {
  callGmail, GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, GOOGLE_COMMAND_CENTRE_SCOPES,
  type GmailActionMessage, type GmailInboxResult, type GmailReplySuggestion,
  type GmailSendResult, type GmailThreadResult,
} from "../../../lib/v2-gmail";
import CreateTaskModal from "../components/CreateTaskModal";
import { prepareExecutiveThread } from "../../../lib/v2-executive-agent";
import styles from "./gmail.module.css";

const emptyWorkspace: V2Workspace = { initiatives: [], unassignedTasks: [], todayTasks: [], allTasks: [] };
type FilterMode = "action" | "all";
type Tone = "" | "warmer" | "shorter" | "direct" | "formal";

function suggestedCategory(email: GmailActionMessage) {
  const text = `${email.subject} ${email.snippet}`.toLowerCase();
  return /\b(proposal|prospect|client|pitch|opportunity|contract|cv|resume|interview|job|business|invoice|fee|budget)\b/.test(text) ? "cash" : "build";
}

function emailNotes(email: GmailActionMessage) {
  return `Captured from Gmail\nFrom: ${email.from}\nSubject: ${email.subject}\nReceived: ${email.date}\n\n${email.snippet}`;
}

function extractEmail(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.trim() || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || value.trim();
}

function senderName(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/^\"|\"$/g, "").trim() || extractEmail(value).split("@")[0] || "contact";
}

function cleanSubject(value: string) {
  return value.replace(/^(re|fw|fwd):\s*/i, "").trim();
}

function followUpDate(days = 4) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function GmailActionCapturePage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<V2Workspace>(emptyWorkspace);
  const [messages, setMessages] = useState<GmailActionMessage[]>([]);
  const [accountEmail, setAccountEmail] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailSendConnected, setGmailSendConnected] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("action");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GmailActionMessage | null>(null);
  const [conversationEmail, setConversationEmail] = useState<GmailActionMessage | null>(null);
  const [thread, setThread] = useState<GmailThreadResult | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [preparingPack, setPreparingPack] = useState(false);
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [followUpOn, setFollowUpOn] = useState(followUpDate());
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFollowUp, setComposeFollowUp] = useState(true);
  const [composeFollowUpOn, setComposeFollowUpOn] = useState(followUpDate());
  const [loading, setLoading] = useState(true);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
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
      const scopes = status?.granted_scopes ?? [];
      const hasGmail = scopes.includes(GMAIL_READONLY_SCOPE);
      setGmailConnected(hasGmail);
      setGmailSendConnected(scopes.includes(GMAIL_SEND_SCOPE));
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
      setError(detail.includes("403") ? "Gmail access is not active yet. Reconnect Google and approve the requested Gmail permissions." : detail);
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

  async function openConversation(email: GmailActionMessage) {
    if (!supabase) return;
    setConversationEmail(email);
    setThread(null);
    setReplyBody("");
    setFollowUpEnabled(true);
    setFollowUpOn(followUpDate());
    setThreadLoading(true);
    setError("");
    try {
      const result = await callGmail<GmailThreadResult>(supabase, "thread", { threadId: email.threadId });
      setThread(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load this conversation.");
    } finally {
      setThreadLoading(false);
    }
  }

  async function suggestReply(tone: Tone = "") {
    if (!supabase || !conversationEmail) return;
    setReplyLoading(true);
    setError("");
    try {
      const result = await callGmail<GmailReplySuggestion>(supabase, "suggestReply", { threadId: conversationEmail.threadId, angle: tone });
      setReplyBody(result.reply);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to suggest a reply.");
    } finally {
      setReplyLoading(false);
    }
  }

  async function prepareActionPack() {
    if (!supabase || !conversationEmail) return;
    setPreparingPack(true);
    setError("");
    setMessage("");
    try {
      const result = await prepareExecutiveThread(supabase, conversationEmail.threadId);
      setMessage(result.packId ? "Executive action pack prepared. Open Attention to review the interpretation, reply and next steps." : "Conversation assessed. It did not meet the threshold for a prepared action pack.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to prepare an executive action pack.");
    } finally {
      setPreparingPack(false);
    }
  }

  async function createFollowUpTask(email: GmailActionMessage, dueOn: string) {
    if (!supabase || !user) return;
    const title = `Follow up with ${senderName(email.from)} about ${cleanSubject(email.subject)}`;
    const { data, error: insertError } = await supabase.from("tasks").insert({
      user_id: user.id,
      title,
      category: suggestedCategory(email),
      points: 3,
      status: "ready",
      priority: 3,
      estimated_minutes: 15,
      due_on: dueOn,
      notes: `Created after sending an email from Command Centre.\nThread: ${email.subject}`,
      initiative_id: null,
      milestone_id: null,
      is_today: false,
      is_complete: false,
      week_number: 1,
      energy_required: "standard",
      work_type: "communication",
      preferred_time: "any",
      position: Date.now(),
    }).select("id").single();
    if (insertError) throw insertError;
    const { error: linkError } = await supabase.from("task_links").insert({
      user_id: user.id,
      task_id: data.id,
      label: "Gmail thread",
      url: email.gmailUrl,
      position: Date.now(),
    });
    if (linkError) throw linkError;
  }

  async function createComposeFollowUpTask(to: string, subject: string, dueOn: string, gmailUrl?: string) {
    if (!supabase || !user) return;
    const { data, error: insertError } = await supabase.from("tasks").insert({
      user_id: user.id,
      title: `Follow up with ${to} about ${cleanSubject(subject)}`,
      category: "cash",
      points: 3,
      status: "ready",
      priority: 3,
      estimated_minutes: 15,
      due_on: dueOn,
      notes: `Created after sending an email from Command Centre.\nSubject: ${subject}`,
      initiative_id: null,
      milestone_id: null,
      is_today: false,
      is_complete: false,
      week_number: 1,
      energy_required: "standard",
      work_type: "communication",
      preferred_time: "any",
      position: Date.now(),
    }).select("id").single();
    if (insertError) throw insertError;
    if (gmailUrl) {
      const { error: linkError } = await supabase.from("task_links").insert({ user_id: user.id, task_id: data.id, label: "Gmail thread", url: gmailUrl, position: Date.now() });
      if (linkError) throw linkError;
    }
  }

  async function sendReply() {
    if (!supabase || !conversationEmail || !thread || !replyBody.trim()) return;
    if (!gmailSendConnected) { await connectGmail(); return; }
    const to = extractEmail(conversationEmail.from);
    const subject = thread.subject || conversationEmail.subject;
    if (!window.confirm(`Send this reply to ${to}?`)) return;
    setSendBusy(true);
    setError("");
    try {
      await callGmail<GmailSendResult>(supabase, "send", { to, subject, body: replyBody.trim(), threadId: conversationEmail.threadId });
      if (followUpEnabled) await createFollowUpTask(conversationEmail, followUpOn);
      setMessage(followUpEnabled ? `Reply sent. Follow-up task created for ${followUpOn}.` : "Reply sent from Command Centre.");
      setReplyBody("");
      await Promise.all([loadInbox(), reloadWorkspace(), openConversation(conversationEmail)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send the reply.");
    } finally {
      setSendBusy(false);
    }
  }

  async function sendNewEmail() {
    if (!supabase || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) return;
    if (!gmailSendConnected) { await connectGmail(); return; }
    if (!window.confirm(`Send this email to ${composeTo.trim()}?`)) return;
    setSendBusy(true);
    setError("");
    try {
      const result = await callGmail<GmailSendResult>(supabase, "send", { to: composeTo.trim(), subject: composeSubject.trim(), body: composeBody.trim() });
      const gmailUrl = result.threadId ? `https://mail.google.com/mail/u/0/#all/${result.threadId}` : undefined;
      if (composeFollowUp) await createComposeFollowUpTask(composeTo.trim(), composeSubject.trim(), composeFollowUpOn, gmailUrl);
      setMessage(composeFollowUp ? `Email sent. Follow-up task created for ${composeFollowUpOn}.` : "Email sent from Command Centre.");
      setComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      await Promise.all([loadInbox(), reloadWorkspace()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send the email.");
    } finally {
      setSendBusy(false);
    }
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
      <div><span>GMAIL ACTION CAPTURE</span><h1>Read, reply and turn email into action.</h1><p>Keep the conversation, the task and the follow-up together. Command Centre can read Gmail and send only when you explicitly approve a message.</p></div>
      <div className={styles.heroActions}><button className={styles.composeButton} onClick={() => setComposeOpen(true)} disabled={!gmailConnected}><Plus size={17} /> New email</button><div className={styles.trust}><ShieldCheck size={18} /><div><strong>Controlled Gmail access</strong><small>Read + send only. No delete, archive or label modification.</small></div></div></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={17} /> {message}</div>}

    {loading ? <section className={styles.loading}>Loading Gmail action capture…</section> : !gmailConnected ?
      <section className={styles.connectCard}><Mail size={34} /><h2>Connect Gmail</h2><p>Google will ask for permission to read Gmail and send messages you explicitly approve in Command Centre. It does not grant delete, archive or mailbox-management access.</p><button onClick={() => void connectGmail()}><Link2 size={17} /> Connect Gmail</button></section>
      : <>
        {!gmailSendConnected && <section className={styles.permissionBanner}><div><strong>Reply and send are not enabled yet.</strong><span>Your current connection is read-only. Add Gmail send permission to work entirely from this dashboard.</span></div><button onClick={() => void connectGmail()}><Send size={16} /> Enable sending</button></section>}

        <section className={styles.summaryGrid}>
          <article><span>LIKELY ACTIONS</span><strong>{actionCount}</strong><small>Recent emails with stronger action signals</small></article>
          <article><span>CAPTURED</span><strong>{capturedCount}</strong><small>Email threads already linked to tasks</small></article>
          <article><span>ACCOUNT</span><strong className={styles.account}>{accountEmail || "Connected Gmail"}</strong><small>{gmailSendConnected ? "Read + send enabled" : "Read-only connection"}</small></article>
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
              <footer><a href={email.gmailUrl} target="_blank" rel="noreferrer">Open in Gmail <ExternalLink size={15} /></a><button className={styles.conversationButton} onClick={() => void openConversation(email)}><MessageSquareText size={15} /> Conversation</button><button onClick={() => setSelected(email)} disabled={captured}>{captured ? "Already captured" : "Create task"} <ArrowRight size={15} /></button></footer>
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

    {conversationEmail && <div className={styles.drawerBackdrop} onClick={() => setConversationEmail(null)}><aside className={styles.conversationDrawer} onClick={event => event.stopPropagation()}>
      <header><div><span>CONVERSATION</span><h2>{thread?.subject || conversationEmail.subject}</h2><p>{conversationEmail.from}</p></div><button onClick={() => setConversationEmail(null)} aria-label="Close conversation"><X size={19} /></button></header>
      {threadLoading ? <div className={styles.drawerState}>Loading conversation…</div> : thread ? <>
        <section className={styles.threadMessages}>{thread.messages.map(item => <article key={item.id} className={item.mine ? styles.mine : styles.theirs}><div><strong>{item.mine ? "You" : senderName(item.from)}</strong><time>{item.date}</time></div><p>{item.body || "(No readable message body)"}</p></article>)}</section>
        <section className={styles.replyComposer}>
          <div className={styles.replyHeading}><div><span>REPLY</span><strong>Draft in context</strong></div><div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}><button onClick={() => void prepareActionPack()} disabled={preparingPack}><ShieldCheck size={15} /> {preparingPack ? "Preparing…" : "Prepare next steps"}</button><button onClick={() => void suggestReply()} disabled={replyLoading}><Sparkles size={15} /> {replyLoading ? "Drafting…" : "Suggest reply"}</button></div></div>
          {replyBody && <div className={styles.toneRow}><span>Adjust</span><button onClick={() => void suggestReply("warmer")}>Warmer</button><button onClick={() => void suggestReply("shorter")}>Shorter</button><button onClick={() => void suggestReply("direct")}>More direct</button><button onClick={() => void suggestReply("formal")}>More formal</button></div>}
          <textarea value={replyBody} onChange={event => setReplyBody(event.target.value)} rows={9} placeholder="Write a reply or use Suggest reply…" />
          <label className={styles.followUpRow}><input type="checkbox" checked={followUpEnabled} onChange={event => setFollowUpEnabled(event.target.checked)} /><span>Create a follow-up task if there is no response by</span><input type="date" value={followUpOn} onChange={event => setFollowUpOn(event.target.value)} disabled={!followUpEnabled} /></label>
          <div className={styles.replyActions}><a href={conversationEmail.gmailUrl} target="_blank" rel="noreferrer">Open in Gmail <ExternalLink size={14} /></a>{!gmailSendConnected && <button className={styles.secondarySend} onClick={() => void connectGmail()}>Enable sending</button>}<button className={styles.sendButton} onClick={() => void sendReply()} disabled={sendBusy || !replyBody.trim()}><Send size={16} /> {sendBusy ? "Sending…" : "Review & send"}</button></div>
        </section>
      </> : <div className={styles.drawerState}>Conversation unavailable.</div>}
    </aside></div>}

    {composeOpen && <div className={styles.drawerBackdrop} onClick={() => setComposeOpen(false)}><aside className={styles.composeDrawer} onClick={event => event.stopPropagation()}>
      <header><div><span>NEW EMAIL</span><h2>Compose without leaving Command Centre</h2></div><button onClick={() => setComposeOpen(false)} aria-label="Close compose"><X size={19} /></button></header>
      <label>To<input type="email" value={composeTo} onChange={event => setComposeTo(event.target.value)} placeholder="name@example.com" /></label>
      <label>Subject<input value={composeSubject} onChange={event => setComposeSubject(event.target.value)} /></label>
      <label>Message<textarea rows={13} value={composeBody} onChange={event => setComposeBody(event.target.value)} /></label>
      <label className={styles.followUpRow}><input type="checkbox" checked={composeFollowUp} onChange={event => setComposeFollowUp(event.target.checked)} /><span>Create a follow-up task for</span><input type="date" value={composeFollowUpOn} onChange={event => setComposeFollowUpOn(event.target.value)} disabled={!composeFollowUp} /></label>
      <div className={styles.composeActions}>{!gmailSendConnected && <button className={styles.secondarySend} onClick={() => void connectGmail()}>Enable sending</button>}<button className={styles.sendButton} onClick={() => void sendNewEmail()} disabled={sendBusy || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()}><Send size={16} /> {sendBusy ? "Sending…" : "Review & send"}</button></div>
    </aside></div>}
  </main>;
}
