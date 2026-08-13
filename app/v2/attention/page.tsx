"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BellRing,
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
  if (item.actionType === "notification") return BellRing;
  return Sparkles;
}

function proposedDetails(item: ExecutiveActionItem) {
  const ignored = new Set(["body", "markdown", "text", "description"]);
  return Object.entries(item.content).filter(([key, value]) => !ignored.has(key) && value != null && value !== "");
}

function isActivePack(pack: ExecutiveActionPack) {
  return ["ready_for_review", "executing", "failed"].includes(pack.status);
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

  async function load() {
    if (!supabase || !user) return;
    setLoading(true);
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
    } catch (reason) {
      if (executiveAgentUnavailable(reason)) {
        setNotDeployed(true);
        setPacks([]);
      } else {
        setError(reason instanceof Error ? reason.message : "Unable to load prepared actions.");
      }
    } finally {
      setLoading(false);
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

  async function selectPack(pack: ExecutiveActionPack) {
    setSelectedId(pack.id);
    setMessage("");
    if (!supabase || !user || pack.readAt) return;
    try {
      await markExecutivePackRead(supabase, user.id, pack.id);
      setPacks(current => current.map(item => item.id === pack.id ? { ...item, readAt: new Date().toISOString() } : item));
    } catch { /* Reading an item must not block review. */ }
  }

  async function approve(item: ExecutiveActionItem) {
    if (!supabase || busy) return;
    setBusy(item.id);
    setError("");
    setMessage("");
    setItemErrors(current => ({ ...current, [item.id]: "" }));
    try {
      const original = preparedText(item);
      const amended = drafts[item.id] ?? original;
      await approveExecutiveActionItem(supabase, item, amended !== original ? { prepared_text: amended } : {});
      setPacks(current => current.map(pack => ({ ...pack, items: pack.items.map(currentItem => currentItem.id === item.id ? { ...currentItem, approvalStatus: "approved" } : currentItem) })));
      setMessage("Approved. The exact reviewed version has been recorded; no external action has been sent automatically.");
      await load();
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Unable to approve this action.";
      setItemErrors(current => ({ ...current, [item.id]: detail }));
      setError(`Approval failed: ${detail}`);
    } finally {
      setBusy("");
    }
  }

  async function recheckGmail() {
    if (!supabase || !user || busy) return;
    setBusy("recheck");
    setError("");
    setMessage("");
    try {
      const result = await syncExecutiveInbox(supabase, 15);
      await load();
      const recovered = result.retained ? ` ${result.retained} replied conversation${result.retained === 1 ? " was" : "s were"} retained in history.` : "";
      setMessage(`Gmail rechecked. ${result.checked} recent conversation${result.checked === 1 ? "" : "s"} assessed.${recovered}`);
    } catch (reason) {
      setError(reason instanceof Error ? `Gmail recheck failed: ${reason.message}` : "Gmail recheck failed.");
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
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to snooze this action.");
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
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to dismiss this action.");
    } finally { setBusy(""); }
  }

  async function feedback(pack: ExecutiveActionPack, feedbackType: ExecutiveFeedbackType) {
    if (!supabase || !user || busy) return;
    setBusy(`feedback:${feedbackType}`);
    try {
      await submitExecutiveFeedback(supabase, user.id, pack, feedbackType);
      setMessage("Feedback recorded. It will inform tuning, but it will not silently rewrite your operating rules.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to record feedback.");
    } finally { setBusy(""); }
  }

  if (!user && !loading) return <main className={styles.authPage}><div className={styles.authCard}><BellRing /><h1>Sign in first</h1><p>The Attention Centre uses your existing private Command Centre session.</p><Link href="/">Open Command Centre</Link></div></main>;

  return <main className={styles.page}>
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

          {selected.assessment?.evidence.length ? <section className={styles.evidence}><h3>What this is based on</h3>{selected.assessment.evidence.map((item, index) => <blockquote key={`${item.quote}-${index}`}>{item.quote || item.label}<small>{item.label && item.quote ? item.label : item.source}</small></blockquote>)}</section> : null}

          {selected.missingFacts.length > 0 && <section className={styles.missing}><strong>{selectedIsActive ? "Still needs your judgement" : "Judgement notes at the time"}</strong>{selected.missingFacts.map(fact => <span key={fact}>{fact}</span>)}</section>}

          <section className={styles.items}><div className={styles.sectionHeading}><div><span>{selectedIsActive ? "PREPARED FOR APPROVAL" : "HISTORICAL PREPARED WORK"}</span><h3>{selected.items.length} action{selected.items.length === 1 ? "" : "s"} {selectedIsActive ? "ready" : "retained"}</h3></div>{selectedIsActive && <small>Approve items separately</small>}</div>
            {selected.items.map(item => { const Icon = itemIcon(item); const text = drafts[item.id] ?? preparedText(item); const metadata = proposedDetails(item); return <article key={item.id} className={styles.itemCard}><div className={styles.itemHeading}><span><Icon size={17} /></span><div><small>{actionTypeLabel(item.actionType)}</small><strong>{item.title}</strong></div><em className={item.approvalStatus === "approved" ? styles.approved : ""}>{item.approvalStatus.replaceAll("_", " ")}</em></div>
              {text && <textarea value={text} onChange={event => setDrafts(current => ({ ...current, [item.id]: event.target.value }))} disabled={!selectedIsActive || item.approvalStatus === "approved"} />}
              {metadata.length > 0 && <dl>{metadata.map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl>}
              {itemErrors[item.id] && <p className={styles.error} role="alert">Approval failed: {itemErrors[item.id]}</p>}
              <div className={styles.itemFooter}><span>{selectedIsActive ? item.approvalRequired ? "Nothing external happens until approval." : "Internal preparation only." : "Retained for reference. This version can no longer be approved."}</span>{selectedIsActive && <button onClick={() => void approve(item)} disabled={Boolean(busy) || item.approvalStatus === "approved"}><Check size={16} /> {item.approvalStatus === "approved" ? "Approved" : busy === item.id ? "Approving…" : "Approve exact version"}</button>}</div>
            </article>; })}
          </section>

          {selected.sourceUrl && <a className={styles.sourceLink} href={selected.sourceUrl} target="_blank" rel="noreferrer">Open source conversation <ExternalLink size={15} /></a>}

          <section className={styles.feedback}><strong>Was the judgement right?</strong><div><button onClick={() => void feedback(selected, "correct_useful")} disabled={Boolean(busy)}>Correct and useful</button><button onClick={() => void feedback(selected, "important_no_interrupt")} disabled={Boolean(busy)}>Important, but don&apos;t interrupt</button><button onClick={() => void feedback(selected, "wrong_interpretation")} disabled={Boolean(busy)}>Wrong interpretation</button><button onClick={() => void feedback(selected, "not_important")} disabled={Boolean(busy)}>Not important</button></div></section>
        </>}
      </section>
    </div>}
  </main>;
}
