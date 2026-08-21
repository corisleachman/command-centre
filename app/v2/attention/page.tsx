"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  BellRing,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import {
  actionTypeLabel,
  approveExecutiveActionItem,
  attentionLabel,
  dismissExecutivePack,
  executeApprovedExecutiveActionItem,
  executiveAgentUnavailable,
  loadExecutiveActionPacks,
  markExecutivePackRead,
  snoozeExecutivePack,
  submitExecutiveFeedback,
  syncExecutiveInbox,
  type ExecutiveActionItem,
  type ExecutiveActionPack,
  type ExecutiveFeedbackType,
} from "../../../lib/v2-executive-agent";
import styles from "./attention.module.css";
import intelligenceStyles from "./attention-intelligence.module.css";
import noticeStyles from "./attention-notice.module.css";

type ActionNotice = {
  tone: "error" | "success";
  title: string;
  message: string;
  itemId?: string;
  href?: string;
  hrefLabel?: string;
};

function formattedDate(value: string | null) {
  if (!value) return "No fixed deadline";
  return new Date(value).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function preparedText(item: ExecutiveActionItem) {
  const value = item.content.body ?? item.content.markdown ?? item.content.text ?? item.content.description;
  return typeof value === "string" ? value : "";
}

function itemIcon(item: ExecutiveActionItem) {
  if (item.actionType === "reply_draft") return Mail;
  if (item.actionType === "document_draft" || item.actionType === "meeting_brief") return FileText;
  if (item.actionType === "calendar_proposal") return CalendarPlus;
  if (item.actionType === "notification") return BellRing;
  return Sparkles;
}

function proposedDetails(item: ExecutiveActionItem) {
  const ignored = new Set(["body", "markdown", "text"]);
  if (item.actionType !== "calendar_proposal") ignored.add("description");
  return Object.entries(item.content).filter(([key, value]) => !ignored.has(key) && value != null && value !== "");
}

function proposedDetailValue(key: string, value: unknown) {
  if ((key === "starts_at" || key === "ends_at") && typeof value === "string") {
    return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function executesOnApproval(item: ExecutiveActionItem) {
  return ["reply_draft", "document_draft", "calendar_proposal", "task_create"].includes(item.actionType);
}

function actionButtonLabel(item: ExecutiveActionItem, isBusy: boolean) {
  if (item.executionStatus === "cancelled") return item.actionType === "reply_draft" ? "Reply already handled" : "No longer needed";
  if (item.executionStatus === "completed") {
    if (item.actionType === "reply_draft") return "Email sent";
    if (item.actionType === "document_draft") return "Document created";
    if (item.actionType === "calendar_proposal") return "Diary invite created";
    if (item.actionType === "task_create") return "Task created";
  }
  const retry = item.approvalStatus === "approved" && item.executionStatus === "failed";
  if (isBusy) {
    if (item.actionType === "reply_draft") return "Sending…";
    if (item.actionType === "document_draft") return "Creating document…";
    if (item.actionType === "calendar_proposal") return "Creating diary invite…";
    if (item.actionType === "task_create") return "Creating task…";
    return "Approving…";
  }
  if (item.actionType === "reply_draft") return retry ? "Retry approved email" : item.approvalStatus === "approved" ? "Send approved email" : "Approve and send email";
  if (item.actionType === "document_draft") return retry ? "Retry document creation" : item.approvalStatus === "approved" ? "Create approved document" : "Approve and create document";
  if (item.actionType === "calendar_proposal") return retry ? "Retry diary invite" : item.approvalStatus === "approved" ? "Create approved diary invite" : "Approve and create diary invite";
  if (item.actionType === "task_create") return retry ? "Retry task creation" : item.approvalStatus === "approved" ? "Create approved task" : "Approve and create task";
  return item.approvalStatus === "approved" ? "Approved" : "Approve proposed update";
}

function approvalBoundary(item: ExecutiveActionItem) {
  if (item.executionStatus === "cancelled") return "The source conversation changed, so this prepared action is no longer needed.";
  if (item.executionStatus === "completed") return "The approved version has been completed and recorded.";
  if (item.actionType === "reply_draft") return "Nothing will be sent until you approve this exact version.";
  if (item.actionType === "document_draft") return "No Google Drive file exists until you approve its creation.";
  if (item.actionType === "calendar_proposal") return "No diary event or invitation exists until you approve these exact details.";
  if (item.actionType === "task_create") return "No task will be created until you approve it.";
  return "Approval records your decision. Execution for this action is not enabled yet.";
}

function resultLink(item: ExecutiveActionItem) {
  if (!item.externalResultReference) return null;
  if (item.actionType === "document_draft" && item.externalResultReference.startsWith("http")) return { href: item.externalResultReference, label: "Open document", external: true };
  if (item.actionType === "calendar_proposal" && item.externalResultReference.startsWith("http")) return { href: item.externalResultReference, label: "Open diary invite", external: true };
  if (item.actionType === "task_create" && item.externalResultReference.startsWith("task:")) return { href: "/v2/tasks", label: "Open tasks", external: false };
  return null;
}

function failureTitle(item: ExecutiveActionItem) {
  if (item.actionType === "document_draft") return "Document wasn't created";
  if (item.actionType === "calendar_proposal") return "Diary invite wasn't created";
  if (item.actionType === "reply_draft") return "Email wasn't sent";
  if (item.actionType === "task_create") return "Task wasn't created";
  return "The action couldn't be completed";
}

function successTitle(item: ExecutiveActionItem) {
  if (item.actionType === "document_draft") return "Document created";
  if (item.actionType === "calendar_proposal") return "Diary invite created";
  if (item.actionType === "reply_draft") return "Email sent";
  if (item.actionType === "task_create") return "Task created";
  return "Action completed";
}

function reconnectNeeded(message: string) {
  return /reconnect Google|Google Drive permission is incomplete|connection has expired|connection has been revoked/i.test(message);
}

function isActivePack(pack: ExecutiveActionPack) {
  if (["ready_for_review", "executing", "failed"].includes(pack.status)) return true;
  return pack.status === "approved" && pack.items.some(item => executesOnApproval(item) && item.executionStatus !== "completed");
}

export default function AttentionCentrePage() {
  const [user, setUser] = useState<User | null>(null);
  const [packs, setPacks] = useState<ExecutiveActionPack[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notDeployed, setNotDeployed] = useState(false);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const noticeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!actionNotice) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    noticeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setActionNotice(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); previous?.focus(); };
  }, [actionNotice]);

  useEffect(() => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
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
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  async function load(showLoading = true): Promise<ExecutiveActionPack[]> {
    if (!supabase || !user) return [];
    if (showLoading) setLoading(true);
    setError("");
    try {
      await supabase.rpc("seed_executive_agent_rules", { p_user_id: user.id });
      const next = await loadExecutiveActionPacks(supabase, user.id, { limit: 60, includeCompleted: true });
      setPacks(next);
      setNotDeployed(false);
      const requested = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("pack") : null;
      if (requested) {
        const url = new URL(window.location.href);
        url.searchParams.delete("pack");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
      const nextActive = next.filter(isActivePack);
      setSelectedId(current => (requested && next.some(pack => pack.id === requested) ? requested : current && nextActive.some(pack => pack.id === current) ? current : nextActive[0]?.id ?? ""));
      const prepared: Record<string, string> = {};
      next.forEach(pack => pack.items.forEach(item => { prepared[item.id] = preparedText(item); }));
      setDrafts(prepared);
      return next;
    } catch (reason) {
      if (executiveAgentUnavailable(reason)) {
        setNotDeployed(true);
        setPacks([]);
      } else {
        setError(reason instanceof Error ? reason.message : "Unable to load prepared actions.");
      }
      return [];
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => { if (user) void load(); }, [user]);

  const selected = useMemo(() => packs.find(pack => pack.id === selectedId) ?? null, [packs, selectedId]);
  const activePacks = packs.filter(isActivePack);
  const historyPacks = packs
    .filter(pack => !activePacks.includes(pack))
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt));
  const recentHistory = historyPacks.slice(0, 5);
  const selectedIsActive = selected ? isActivePack(selected) : false;

  function showAction(itemId: string) {
    setActionNotice(null);
    window.setTimeout(() => {
      const target = document.getElementById(`executive-action-${itemId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }, 80);
  }

  async function selectPack(pack: ExecutiveActionPack) {
    setSelectedId(pack.id);
    setMessage("");
    if (!supabase || !user || pack.readAt) return;
    try {
      await markExecutivePackRead(supabase, user.id, pack.id);
      setPacks(current => current.map(item => item.id === pack.id ? { ...item, readAt: new Date().toISOString() } : item));
    } catch { /* Reading an item must not block review. */ }
  }

  async function approveAndExecute(item: ExecutiveActionItem) {
    if (!supabase || busy) return;
    if (item.actionType === "reply_draft") {
      const recipient = String(item.content.to || "the recipient");
      const prompt = item.approvalStatus === "approved"
        ? `Send the already approved email to ${recipient}?`
        : `Approve and send this exact email to ${recipient}?`;
      if (!window.confirm(prompt)) return;
    }
    if (item.actionType === "calendar_proposal") {
      const attendee = String(item.content.attendee_email || "the attendee");
      const start = typeof item.content.starts_at === "string" ? proposedDetailValue("starts_at", item.content.starts_at) : "the proposed time";
      const prompt = item.approvalStatus === "approved"
        ? `Create the already approved diary invite for ${attendee} at ${start}?`
        : `Approve these exact details, create the diary event and send the invitation to ${attendee} for ${start}?`;
      if (!window.confirm(prompt)) return;
    }
    setBusy(item.id);
    setError("");
    setMessage("");
    setActionNotice(null);
    setItemErrors(current => ({ ...current, [item.id]: "" }));
    let approved = item.approvalStatus === "approved";
    try {
      const original = preparedText(item);
      const amended = drafts[item.id] ?? original;
      if (!approved) {
        await approveExecutiveActionItem(supabase, item, amended !== original ? { prepared_text: amended } : {});
        approved = true;
        setPacks(current => current.map(pack => ({ ...pack, items: pack.items.map(currentItem => currentItem.id === item.id ? { ...currentItem, approvalStatus: "approved" } : currentItem) })));
      }
      if (executesOnApproval(item)) {
        const result = await executeApprovedExecutiveActionItem(supabase, item.id);
        await load(false);
        setActionNotice({
          tone: "success",
          title: successTitle(item),
          message: result.message,
          itemId: item.id,
          href: ["document_draft", "calendar_proposal"].includes(item.actionType) && result.externalReference?.startsWith("http") ? result.externalReference : undefined,
          hrefLabel: item.actionType === "document_draft" ? "Open document" : item.actionType === "calendar_proposal" ? "Open diary invite" : undefined,
        });
      } else {
        setMessage("Approved. Your decision and the exact reviewed version have been recorded. This action has not changed an external system.");
        await load(false);
      }
    } catch (reason) {
      const initialDetail = reason instanceof Error ? reason.message : "Unable to complete this action.";
      const refreshed = await load(false);
      const persistedDetail = refreshed.flatMap(pack => pack.items).find(current => current.id === item.id)?.lastError;
      const detail = persistedDetail || initialDetail;
      setItemErrors(current => ({ ...current, [item.id]: detail }));
      setActionNotice({
        tone: "error",
        title: approved ? failureTitle(item) : "Approval wasn't recorded",
        message: detail,
        itemId: item.id,
        href: reconnectNeeded(detail) ? "/v2/gmail" : undefined,
        hrefLabel: reconnectNeeded(detail) ? "Update Google connection" : undefined,
      });
    } finally {
      setBusy("");
    }
  }

  async function recheckGmail() {
    if (!supabase || !user || busy) return;
    setBusy("recheck");
    setError("");
    setMessage("");
    setActionNotice(null);
    try {
      const result = await syncExecutiveInbox(supabase, 15);
      await load(false);
      const recovered = result.retained ? ` ${result.retained} replied conversation${result.retained === 1 ? " was" : "s were"} updated so the remaining follow-on work stays available.` : "";
      const revisited = result.revisited ? ` ${result.revisited} existing review item${result.revisited === 1 ? " was" : "s were"} reassessed against the latest email and diary context.` : "";
      const summary = `Gmail rechecked. ${result.checked} recent conversation${result.checked === 1 ? "" : "s"} assessed.${revisited}${recovered}`;
      if (!result.intelligence.gatewayConfigured || result.intelligence.gatewayNotConfigured) {
        setActionNotice({
          tone: "error",
          title: "Gmail was checked, but AI judgement wasn't connected",
          message: `${summary} Supabase couldn't see AI_GATEWAY_API_KEY, so the safe pattern-based assessment was used.`,
        });
      } else if (result.intelligence.gatewayErrors) {
        setActionNotice({
          tone: "error",
          title: "Gmail was checked, but AI Gateway couldn't assess it",
          message: `${summary} ${result.intelligence.gatewayErrors} conversation${result.intelligence.gatewayErrors === 1 ? "" : "s"} fell back to safe rules. Check the Gateway request log, key and credit balance.`,
        });
      } else {
        const modelUse = result.intelligence.gatewayUsed ? ` Full-thread AI assessed ${result.intelligence.gatewayUsed} conversation${result.intelligence.gatewayUsed === 1 ? "" : "s"}.` : "";
        setMessage(`${summary}${modelUse}`);
      }
    } catch (reason) {
      setActionNotice({ tone: "error", title: "Gmail recheck failed", message: reason instanceof Error ? reason.message : "The inbox couldn't be rechecked." });
    } finally {
      setBusy("");
    }
  }

  async function snooze(pack: ExecutiveActionPack) {
    if (!supabase || !user || busy) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 30, 0, 0);
    setBusy(pack.id);
    try {
      await snoozeExecutivePack(supabase, user.id, pack.id, tomorrow.toISOString());
      setMessage("Snoozed until tomorrow morning.");
      await load(false);
    } catch (reason) {
      setActionNotice({ tone: "error", title: "This couldn't be snoozed", message: reason instanceof Error ? reason.message : "Unable to snooze this action." });
    } finally { setBusy(""); }
  }

  async function dismiss(pack: ExecutiveActionPack) {
    if (!supabase || !user || busy) return;
    const reason = window.prompt("Why should the Command Centre dismiss this? This helps improve future judgement.", "Not important enough to act on");
    if (reason == null) return;
    setBusy(pack.id);
    try {
      await dismissExecutivePack(supabase, user.id, pack.id, reason);
      setMessage("Dismissed and retained as feedback.");
      await load(false);
    } catch (caught) {
      setActionNotice({ tone: "error", title: "This couldn't be dismissed", message: caught instanceof Error ? caught.message : "Unable to dismiss this action." });
    } finally { setBusy(""); }
  }

  async function feedback(pack: ExecutiveActionPack, feedbackType: ExecutiveFeedbackType) {
    if (!supabase || !user || busy) return;
    setBusy(`feedback:${feedbackType}`);
    try {
      await submitExecutiveFeedback(supabase, user.id, pack, feedbackType);
      setMessage("Feedback recorded. It will inform tuning, but it will not silently rewrite your operating rules.");
    } catch (reason) {
      setActionNotice({ tone: "error", title: "Feedback wasn't recorded", message: reason instanceof Error ? reason.message : "Unable to record feedback." });
    } finally { setBusy(""); }
  }

  if (!user && !loading) return <main className={styles.authPage}><div className={styles.authCard}><BellRing /><h1>Sign in first</h1><p>The Attention Centre uses your existing private Command Centre session.</p><Link href="/">Open Command Centre</Link></div></main>;

  return <main className={styles.page}>
    {actionNotice && <div className={noticeStyles.noticeBackdrop} onMouseDown={event => { if (event.currentTarget === event.target) setActionNotice(null); }}>
      <section ref={noticeRef} className={`${noticeStyles.actionNotice} ${actionNotice.tone === "error" ? noticeStyles.errorNotice : noticeStyles.successNotice}`} role="alertdialog" aria-modal="true" aria-labelledby="action-notice-title" tabIndex={-1}>
        <button className={noticeStyles.noticeClose} onClick={() => setActionNotice(null)} aria-label="Close message"><X size={18} /></button>
        <span className={noticeStyles.noticeIcon}>{actionNotice.tone === "error" ? <AlertTriangle size={24} /> : <CheckCircle2 size={24} />}</span>
        <div><small>{actionNotice.tone === "error" ? "ACTION NOT COMPLETED" : "ACTION COMPLETED"}</small><h2 id="action-notice-title">{actionNotice.title}</h2><p>{actionNotice.message}</p></div>
        <footer>
          {actionNotice.itemId && <button onClick={() => showAction(actionNotice.itemId!)}>Show action</button>}
          {actionNotice.href && (actionNotice.href.startsWith("http") ? <a href={actionNotice.href} target="_blank" rel="noreferrer">{actionNotice.hrefLabel || "Open"} <ExternalLink size={15} /></a> : <Link href={actionNotice.href}>{actionNotice.hrefLabel || "Open"}</Link>)}
          <button className={noticeStyles.noticeSecondary} onClick={() => setActionNotice(null)}>Close</button>
        </footer>
      </section>
    </div>}
    <header className={styles.header}><div><Link href="/v2"><ArrowLeft size={16} /> Today</Link><span>EXECUTIVE AGENT</span><h1>Attention Centre</h1><p>Important changes, interpreted and prepared before they reach you.</p></div><div className={styles.headerActions}><button onClick={() => void recheckGmail()} disabled={Boolean(busy)}><RefreshCw size={15} /> {busy === "recheck" ? "Checking…" : "Recheck Gmail"}</button><div className={styles.trust}><ShieldCheck size={18} /><span><strong>Prepare by default</strong><small>External action requires approval</small></span></div></div></header>

    {loading && <div className={styles.state}>Loading prepared work...</div>}
    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={17} /> {message}</div>}
    {notDeployed && <div className={styles.state}><Sparkles size={23} /><strong>The review experience is ready.</strong><p>The new database migration must deploy before action packs can appear here.</p></div>}

    {!loading && !notDeployed && <div className={styles.layout}>
      <aside className={styles.queue}>
        <div className={styles.queueHeading}><span>NEEDS REVIEW</span><strong>{activePacks.length}</strong></div>
        <div className={styles.packList}>{activePacks.map(pack => <button key={pack.id} className={`${styles.packButton} ${selectedId === pack.id ? styles.selected : ""} ${!pack.readAt ? styles.unread : ""}`} onClick={() => void selectPack(pack)}><span>{attentionLabel(pack.attentionLevel)}</span><strong>{pack.title}</strong><small>{pack.contactName || pack.organisationName || "Command Centre"} · {pack.items.length} prepared</small></button>)}{!activePacks.length && <div className={styles.emptyQueue}><CheckCircle2 size={21} /><strong>Nothing awaiting review</strong><p>The agent has not found a change that needs your decision.</p></div>}</div>
        {recentHistory.length > 0 && <details className={styles.history}><summary>Recent history ({recentHistory.length})</summary>{recentHistory.map(pack => <button key={pack.id} onClick={() => void selectPack(pack)}><strong>{pack.title}</strong><small>{pack.status.replaceAll("_", " ")}</small></button>)}</details>}
      </aside>

      <section className={styles.review}>
        {!selected && <div className={styles.emptyReview}><CheckCircle2 size={32} /><h2>Nothing needs your attention</h2><p>Completed and superseded items are retained under Recent history.</p></div>}
        {selected && <>
          <div className={styles.reviewHeader}><div><span className={styles.level}>{selectedIsActive ? `${attentionLabel(selected.attentionLevel)} · score ${selected.assessment?.attentionScore ?? "-"}` : `Recent history · ${selected.status.replaceAll("_", " ")}`}</span><h2>{selected.title}</h2><p>{selected.executiveSummary}</p></div>{selectedIsActive && <div className={styles.headerActions}><button onClick={() => void snooze(selected)} disabled={Boolean(busy)}><Clock3 size={15} /> Tomorrow</button><button onClick={() => void dismiss(selected)} disabled={Boolean(busy)}><X size={15} /> Dismiss</button></div>}</div>

          <div className={styles.contextGrid}><div><span>{selectedIsActive ? "WHY NOW" : "WHY IT WAS RAISED"}</span><p>{selected.whyNow || selected.assessment?.consequenceOfDelay || "Prepared for your next review."}</p></div><div><span>{selectedIsActive ? "REVIEW BY" : "ORIGINAL REVIEW BY"}</span><p>{formattedDate(selected.reviewBy)}</p></div><div><span>STATE CHANGE</span><p>{selected.assessment?.previousState || "Unknown"} → {selected.assessment?.newState || "No stage change proposed"}</p></div></div>

          {selectedIsActive && selected.assessment?.modelProvider === "rules" && selected.assessment.newState !== "meeting_agreed_invite_pending" && <section className={intelligenceStyles.intelligenceWarning}><AlertTriangle size={19} /><div><strong>Pattern-based assessment</strong><p>Full-thread model judgement was not used for this item. The agent has limited itself to a verified pattern, so review the interpretation before approving anything.</p></div></section>}

          {selected.assessment?.evidence.length ? <section className={styles.evidence}><h3>What this is based on</h3>{selected.assessment.evidence.map((item, index) => <blockquote key={`${item.quote}-${index}`}>{item.quote || item.label}<small>{item.label && item.quote ? item.label : item.source}</small></blockquote>)}</section> : null}

          {selected.missingFacts.length > 0 && <section className={styles.missing}><strong>{selectedIsActive ? "Still needs your judgement" : "Judgement notes at the time"}</strong>{selected.missingFacts.map(fact => <span key={fact}>{fact}</span>)}</section>}

          <section className={styles.items}><div className={styles.sectionHeading}><div><span>{selectedIsActive ? "PREPARED FOR APPROVAL" : "HISTORICAL PREPARED WORK"}</span><h3>{selected.items.length} action{selected.items.length === 1 ? "" : "s"} {selectedIsActive ? "ready" : "retained"}</h3></div>{selectedIsActive && <small>Approve items separately</small>}</div>
            {selected.items.map(item => { const Icon = itemIcon(item); const text = drafts[item.id] ?? preparedText(item); const metadata = proposedDetails(item); const link = resultLink(item); const inlineError = itemErrors[item.id] || item.lastError; const status = item.executionStatus === "completed" ? "completed" : item.executionStatus === "failed" ? "execution failed" : item.executionStatus === "cancelled" ? "no longer needed" : item.approvalStatus.replaceAll("_", " "); const positiveStatus = item.executionStatus === "completed" || item.executionStatus === "cancelled" || (item.approvalStatus === "approved" && item.executionStatus !== "failed"); return <article id={`executive-action-${item.id}`} key={item.id} className={`${styles.itemCard} ${noticeStyles.actionAnchor}`} tabIndex={-1}><div className={styles.itemHeading}><span><Icon size={17} /></span><div><small>{actionTypeLabel(item.actionType)}</small><strong>{item.title}</strong></div><em className={positiveStatus ? styles.approved : ""}>{status}</em></div>
              {text && item.actionType !== "calendar_proposal" && <textarea value={text} onChange={event => setDrafts(current => ({ ...current, [item.id]: event.target.value }))} disabled={!selectedIsActive || item.approvalStatus === "approved" || item.executionStatus === "cancelled"} />}
              {metadata.length > 0 && <dl>{metadata.map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{proposedDetailValue(key, value)}</dd></div>)}</dl>}
              {inlineError && <p className={styles.error} role="alert">{inlineError}</p>}
              <div className={styles.itemFooter}><span>{selectedIsActive ? approvalBoundary(item) : "Retained for reference. This version can no longer be approved."}</span><div>{link && <Link href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined}>{link.label} <ExternalLink size={15} /></Link>}{selectedIsActive && <button onClick={() => void approveAndExecute(item)} disabled={Boolean(busy) || item.executionStatus === "completed" || item.executionStatus === "executing" || item.executionStatus === "cancelled" || (!executesOnApproval(item) && item.approvalStatus === "approved")}><Check size={16} /> {actionButtonLabel(item, busy === item.id)}</button>}</div></div>
            </article>; })}
          </section>

          {selected.sourceUrl && <a className={styles.sourceLink} href={selected.sourceUrl} target="_blank" rel="noreferrer">Open source conversation <ExternalLink size={15} /></a>}

          <section className={styles.feedback}><strong>Was the judgement right?</strong><div><button onClick={() => void feedback(selected, "correct_useful")} disabled={Boolean(busy)}>Correct and useful</button><button onClick={() => void feedback(selected, "important_no_interrupt")} disabled={Boolean(busy)}>Important, but don&apos;t interrupt</button><button onClick={() => void feedback(selected, "wrong_interpretation")} disabled={Boolean(busy)}>Wrong interpretation</button><button onClick={() => void feedback(selected, "not_important")} disabled={Boolean(busy)}>Not important</button></div></section>
        </>}
      </section>
    </div>}
  </main>;
}
