"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, ChevronRight, Circle,
  Clock3, ExternalLink, Flag, Link2, ListChecks, PartyPopper, Plus,
  Rocket, Sparkles, Target, X
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import styles from "./launch.module.css";

type Status = "not_started" | "in_progress" | "blocked" | "review" | "complete";
type Stage = "Define" | "Build" | "Create" | "Configure" | "Test" | "Ready" | "Launch" | "Optimise";
type Priority = "critical" | "important" | "supporting";

type LaunchAction = {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  notes?: string;
  link?: string;
  dueDate?: string;
};

type Milestone = {
  id: string;
  workstream: string;
  stage: Stage;
  title: string;
  actions: LaunchAction[];
};

type LaunchState = {
  targetDate: string;
  milestones: Milestone[];
};

const stages: Stage[] = ["Define", "Build", "Create", "Configure", "Test", "Ready", "Launch", "Optimise"];
const weights: Record<Priority, number> = { critical: 5, important: 3, supporting: 1 };

function actions(prefix: string, titles: Array<[string, Priority]>): LaunchAction[] {
  return titles.map(([title, priority], index) => ({
    id: `${prefix}-${index + 1}`,
    title,
    priority,
    status: "not_started",
    notes: "",
    link: "",
    dueDate: ""
  }));
}

const initialMilestones: Milestone[] = [
  {
    id: "product-define", workstream: "Product readiness", stage: "Define", title: "Lock the launch product",
    actions: actions("pd", [
      ["Confirm the minimum viable launch feature set", "critical"],
      ["Separate launch-critical work from post-launch ideas", "critical"],
      ["Confirm Free, Pro and Studio feature entitlements", "important"],
      ["Write launch acceptance criteria", "important"]
    ])
  },
  {
    id: "product-build", workstream: "Product readiness", stage: "Build", title: "Complete launch-critical flows",
    actions: actions("pb", [
      ["Complete Stripe upgrade and downgrade flows", "critical"],
      ["Confirm storage limits are enforced", "critical"],
      ["Confirm collaborator invitations", "critical"],
      ["Confirm public sharing behaviour", "important"],
      ["Confirm notification behaviour", "important"]
    ])
  },
  {
    id: "product-test", workstream: "Product readiness", stage: "Test", title: "End-to-end product QA",
    actions: actions("pt", [
      ["Test signup through first song upload", "critical"],
      ["Test invite through collaborator feedback", "critical"],
      ["Test mobile playback and comments", "critical"],
      ["Test public shares without authentication", "important"],
      ["Test subscription cancellation and failed payments", "important"],
      ["Complete browser and device QA", "important"]
    ])
  },
  {
    id: "product-ready", workstream: "Product readiness", stage: "Ready", title: "Release readiness",
    actions: actions("pr", [
      ["Resolve all launch-blocking defects", "critical"],
      ["Document known non-blocking issues", "important"],
      ["Create support and rollback plan", "critical"]
    ])
  },
  {
    id: "website-define", workstream: "Marketing website", stage: "Define", title: "Lock proposition and journey",
    actions: actions("wd", [
      ["Confirm final proposition", "critical"],
      ["Confirm primary and secondary calls to action", "important"],
      ["Confirm target audiences and page hierarchy", "important"]
    ])
  },
  {
    id: "website-create", workstream: "Marketing website", stage: "Create", title: "Finish launch content",
    actions: actions("wc", [
      ["Finalise homepage copy", "critical"],
      ["Finalise screenshots and product video", "important"],
      ["Add Guides navigation", "important"],
      ["Add product FAQ content", "supporting"],
      ["Complete Privacy, Terms and Contact pages", "critical"]
    ])
  },
  {
    id: "website-test", workstream: "Marketing website", stage: "Test", title: "Website quality assurance",
    actions: actions("wt", [
      ["Check every navigation and CTA link", "critical"],
      ["Test mobile and tablet layouts", "critical"],
      ["Check speed and image loading", "important"],
      ["Validate social sharing cards", "supporting"],
      ["Test signup conversion from every CTA", "critical"]
    ])
  },
  {
    id: "website-ready", workstream: "Marketing website", stage: "Ready", title: "Search and domain readiness",
    actions: actions("wr", [
      ["Resolve apex versus www direction", "important"],
      ["Confirm canonical URLs", "critical"],
      ["Submit sitemap to Google Search Console", "important"]
    ])
  },
  {
    id: "pricing-define", workstream: "Pricing and payments", stage: "Define", title: "Lock commercial model",
    actions: actions("cd", [
      ["Confirm monthly and annual prices", "critical"],
      ["Confirm tier separation", "critical"],
      ["Define founding-member offer", "important"],
      ["Confirm refund and cancellation policy", "important"]
    ])
  },
  {
    id: "pricing-configure", workstream: "Pricing and payments", stage: "Configure", title: "Configure billing",
    actions: actions("cc", [
      ["Confirm Stripe products and price IDs", "critical"],
      ["Confirm VAT and invoice wording", "important"],
      ["Add pricing FAQs", "supporting"]
    ])
  },
  {
    id: "pricing-test", workstream: "Pricing and payments", stage: "Test", title: "Test payment lifecycle",
    actions: actions("ct", [
      ["Test monthly checkout", "critical"],
      ["Test annual checkout", "critical"],
      ["Test upgrade and downgrade", "critical"],
      ["Test cancellation and failed payment", "critical"]
    ])
  },
  {
    id: "analytics-configure", workstream: "Analytics and compliance", stage: "Configure", title: "Measurement and consent",
    actions: actions("ac", [
      ["Verify GA4 only loads after consent", "critical"],
      ["Verify marketing, app and blog analytics", "critical"],
      ["Define signup, activation and payment events", "important"],
      ["Create launch analytics dashboard", "important"],
      ["Finalise cookie and privacy wording", "critical"]
    ])
  },
  {
    id: "beta-define", workstream: "Founding members", stage: "Define", title: "Define the validation cohort",
    actions: actions("bd", [
      ["Define ideal founding-member profile", "important"],
      ["Confirm active tester target", "critical"],
      ["Confirm paying founder target", "critical"],
      ["Define feedback required from testers", "important"]
    ])
  },
  {
    id: "beta-create", workstream: "Founding members", stage: "Create", title: "Prepare recruitment",
    actions: actions("bc", [
      ["Build personal outreach list", "critical"],
      ["Create onboarding message", "important"],
      ["Create feedback interview guide", "important"],
      ["Create founding-member upgrade message", "important"]
    ])
  },
  {
    id: "beta-launch", workstream: "Founding members", stage: "Launch", title: "Recruit and activate testers",
    actions: actions("bl", [
      ["Invite first 10 artists", "critical"],
      ["Invite first 10 producers", "critical"],
      ["Invite first five bands", "important"],
      ["Schedule weekly tester check-ins", "important"],
      ["Capture feedback, bugs and customer language", "critical"],
      ["Ask permission to use strong testimonials", "supporting"]
    ])
  },
  {
    id: "seo-define", workstream: "SEO and content", stage: "Define", title: "Approve content strategy",
    actions: actions("sd", [
      ["Approve initial SEO topic cluster", "important"],
      ["Confirm article review standards", "important"],
      ["Define conversion CTA for guides", "important"]
    ])
  },
  {
    id: "seo-create", workstream: "SEO and content", stage: "Create", title: "Build launch content library",
    actions: actions("sc", [
      ["Review and publish first three articles", "critical"],
      ["Publish five launch-supporting guides", "important"],
      ["Add internal links between articles", "important"],
      ["Add relevant product CTAs", "important"]
    ])
  },
  {
    id: "seo-configure", workstream: "SEO and content", stage: "Configure", title: "Configure search foundations",
    actions: actions("sg", [
      ["Validate sitemap", "important"],
      ["Validate Article and FAQ schema", "important"],
      ["Submit site to Search Console", "critical"],
      ["Add direct preview links to article PRs", "supporting"]
    ])
  },
  {
    id: "email-configure", workstream: "Email and lifecycle", stage: "Configure", title: "Prepare email infrastructure",
    actions: actions("ec", [
      ["Confirm Resend sending domain", "critical"],
      ["Confirm sender address", "important"],
      ["Confirm unsubscribe handling", "critical"],
      ["Define email preference rules", "important"]
    ])
  },
  {
    id: "email-create", workstream: "Email and lifecycle", stage: "Create", title: "Create activation lifecycle",
    actions: actions("ee", [
      ["Create welcome email", "critical"],
      ["Create first-song reminder", "important"],
      ["Create invite-a-collaborator prompt", "important"],
      ["Create inactivity reminder", "supporting"],
      ["Create founding-member conversion email", "important"],
      ["Create launch announcement email", "important"]
    ])
  },
  {
    id: "email-test", workstream: "Email and lifecycle", stage: "Test", title: "Test every lifecycle message",
    actions: actions("et", [
      ["Test emails on desktop and mobile", "important"],
      ["Test all deep links", "critical"],
      ["Test suppressed and failed sends", "important"],
      ["Verify email analytics", "supporting"]
    ])
  },
  {
    id: "social-define", workstream: "Social launch", stage: "Define", title: "Set social launch system",
    actions: actions("sod", [
      ["Select launch channels", "important"],
      ["Confirm content pillars", "important"],
      ["Define posting frequency", "supporting"],
      ["Create visual templates", "important"]
    ])
  },
  {
    id: "social-create", workstream: "Social launch", stage: "Create", title: "Create launch campaign",
    actions: actions("soc", [
      ["Create founder story post", "important"],
      ["Create problem and solution carousel", "important"],
      ["Create product walkthrough", "critical"],
      ["Create feedback demonstration", "important"],
      ["Create founding-member invitation", "critical"],
      ["Create launch announcement", "critical"]
    ])
  },
  {
    id: "social-launch", workstream: "Social launch", stage: "Launch", title: "Schedule and publish",
    actions: actions("sol", [
      ["Complete profile bios and tracked links", "important"],
      ["Schedule launch-week posts", "critical"],
      ["Prepare replies and conversation prompts", "supporting"],
      ["Track clicks and signup conversion", "important"]
    ])
  },
  {
    id: "partners-create", workstream: "Partnerships and outreach", stage: "Create", title: "Build partner pipeline",
    actions: actions("pc", [
      ["Build producer outreach list", "important"],
      ["Build recording and rehearsal studio list", "important"],
      ["Build music-college list", "important"],
      ["Identify relevant music creators", "supporting"],
      ["Draft partnership proposition", "critical"],
      ["Create concise product demo", "critical"]
    ])
  },
  {
    id: "partners-launch", workstream: "Partnerships and outreach", stage: "Launch", title: "Start partner outreach",
    actions: actions("pl", [
      ["Contact first 20 prospects", "critical"],
      ["Book five demos", "important"],
      ["Offer partner or affiliate access", "supporting"],
      ["Track introductions, trials and conversions", "important"]
    ])
  },
  {
    id: "ops-ready", workstream: "Launch operations", stage: "Ready", title: "Prepare launch operations",
    actions: actions("or", [
      ["Select public launch date", "critical"],
      ["Create launch-week calendar", "critical"],
      ["Prepare support response templates", "important"],
      ["Create bug triage process", "critical"],
      ["Create backup and rollback checklist", "critical"],
      ["Freeze non-critical feature work", "important"]
    ])
  },
  {
    id: "ops-launch", workstream: "Launch operations", stage: "Launch", title: "Run launch day",
    actions: actions("ol", [
      ["Check production health", "critical"],
      ["Test signup and payment", "critical"],
      ["Publish launch communications", "critical"],
      ["Email founding members", "important"],
      ["Monitor errors, analytics and support", "critical"],
      ["Record launch-day results", "important"]
    ])
  },
  {
    id: "optimise", workstream: "Post-launch optimisation", stage: "Optimise", title: "Improve the first 30 days",
    actions: actions("po", [
      ["Run seven-day launch review", "critical"],
      ["Run 30-day review", "important"],
      ["Analyse signup and activation conversion", "critical"],
      ["Analyse retention and paid conversion", "critical"],
      ["Interview activated and dropped-out users", "important"],
      ["Prioritise first post-launch sprint", "critical"],
      ["Update positioning from customer language", "important"]
    ])
  }
];

const workstreams = Array.from(new Set(initialMilestones.map(item => item.workstream)));
const initialState: LaunchState = { targetDate: "2026-10-01", milestones: initialMilestones };

function milestoneStatus(milestone: Milestone): Status {
  const statuses = milestone.actions.map(action => action.status);
  if (statuses.every(status => status === "complete")) return "complete";
  if (statuses.some(status => status === "blocked")) return "blocked";
  if (statuses.some(status => status === "review")) return "review";
  if (statuses.some(status => status === "in_progress" || status === "complete")) return "in_progress";
  return "not_started";
}

function statusLabel(status: Status) {
  return {
    not_started: "Not started",
    in_progress: "In progress",
    blocked: "Blocked",
    review: "Ready for review",
    complete: "Complete"
  }[status];
}

export default function SongRoomLaunchPage() {
  const [state, setState] = useState<LaunchState>(initialState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("song-room-launch-v1");
    if (saved) setState(JSON.parse(saved));
    setReady(true);
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem("song-room-launch-v1", JSON.stringify(state));
  }, [state, ready]);

  useEffect(() => {
    if (!supabase || !user || !ready) return;
    supabase.from("command_centre_state").select("state").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        const cloudState = data?.state as Record<string, unknown> | undefined;
        if (cloudState?.songRoomLaunch) setState(cloudState.songRoomLaunch as LaunchState);
        setCloudReady(true);
      });
  }, [user, ready]);

  useEffect(() => {
    if (!supabase || !user || !cloudReady) return;
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.from("command_centre_state").select("state").eq("user_id", user.id).maybeSingle();
      const existing = (data?.state as Record<string, unknown> | undefined) ?? {};
      await supabase.from("command_centre_state").upsert({
        user_id: user.id,
        state: { ...existing, songRoomLaunch: state },
        updated_at: new Date().toISOString()
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state, user, cloudReady]);

  const allActions = useMemo(() => state.milestones.flatMap(item => item.actions), [state]);
  const totalWeight = allActions.reduce((sum, action) => sum + weights[action.priority], 0);
  const completeWeight = allActions.filter(action => action.status === "complete").reduce((sum, action) => sum + weights[action.priority], 0);
  const progress = Math.round((completeWeight / totalWeight) * 100);
  const completeCount = allActions.filter(action => action.status === "complete").length;
  const inProgressCount = allActions.filter(action => action.status === "in_progress" || action.status === "review").length;
  const blockedCount = allActions.filter(action => action.status === "blocked").length;
  const daysRemaining = Math.ceil((new Date(`${state.targetDate}T12:00:00`).getTime() - Date.now()) / 86400000);
  const selected = state.milestones.find(item => item.id === selectedId) ?? null;

  function updateAction(milestoneId: string, actionId: string, updates: Partial<LaunchAction>) {
    setState(current => ({
      ...current,
      milestones: current.milestones.map(milestone => milestone.id !== milestoneId ? milestone : {
        ...milestone,
        actions: milestone.actions.map(action => action.id === actionId ? { ...action, ...updates } : action)
      })
    }));
  }

  function cycleStatus(milestoneId: string, action: LaunchAction) {
    const order: Status[] = ["not_started", "in_progress", "review", "complete"];
    const next = order[(order.indexOf(action.status) + 1) % order.length];
    updateAction(milestoneId, action.id, { status: next });
    if (next === "complete") {
      setCelebration(action.title);
      window.setTimeout(() => setCelebration(null), 1800);
    }
  }

  function resetTracker() {
    if (window.confirm("Reset every Song Room launch action? This cannot be undone.")) setState(initialState);
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.back} href="/"><ArrowLeft size={17} /> Command Centre</Link>
        <div className={styles.sync}>{supabase && user ? (cloudReady ? "Cloud synced" : "Syncing…") : "Saved in this browser"}</div>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>THE SONG ROOM / LAUNCH CONTROL</span>
          <h1>Launch with confidence,<br />not crossed fingers.</h1>
          <p>A weighted, visual plan for moving from a working product to a properly tested, marketed and measurable launch.</p>
        </div>
        <div className={styles.dateCard}>
          <label htmlFor="launch-date">Target launch</label>
          <input id="launch-date" type="date" value={state.targetDate} onChange={event => setState(current => ({ ...current, targetDate: event.target.value }))} />
          <strong>{daysRemaining > 0 ? `${daysRemaining} days to go` : daysRemaining === 0 ? "Launch day" : `${Math.abs(daysRemaining)} days since target`}</strong>
        </div>
      </section>

      <section className={styles.scoreboard}>
        <div className={styles.scoreMain}>
          <strong>{completeCount}<span>/{allActions.length}</span></strong>
          <div className={styles.progressWrap}>
            <div className={styles.progressTrack}><i style={{ width: `${progress}%` }} /></div>
            <div className={styles.legend}>
              <span><b className={styles.green} /> {completeCount} done</span>
              <span><b className={styles.amber} /> {inProgressCount} in progress</span>
              <span><b className={styles.red} /> {blockedCount} blocked</span>
              <span><b className={styles.grey} /> {allActions.length - completeCount - inProgressCount - blockedCount} to go</span>
            </div>
          </div>
        </div>
        <div className={styles.readiness}><Rocket size={20} /><span>Launch readiness</span><strong>{progress}%</strong></div>
      </section>

      {blockedCount > 0 && (
        <section className={styles.blockerStrip}>
          <AlertTriangle size={18} />
          <strong>{blockedCount} blocker{blockedCount === 1 ? "" : "s"} need attention.</strong>
          <span>Open the red cells to record what is preventing progress.</span>
        </section>
      )}

      <section className={styles.matrixShell}>
        <div className={styles.matrix}>
          <div className={`${styles.corner} ${styles.stickyLeft}`}>WORKSTREAM</div>
          {stages.map(stage => <div className={styles.stageHead} key={stage}>{stage}</div>)}

          {workstreams.map(workstream => {
            const rowMilestones = state.milestones.filter(item => item.workstream === workstream);
            const rowActions = rowMilestones.flatMap(item => item.actions);
            const rowDone = rowActions.filter(action => action.status === "complete").length;
            return (
              <div className={styles.rowContents} key={workstream}>
                <div className={`${styles.workstream} ${styles.stickyLeft}`}>
                  <strong>{workstream}</strong>
                  <div><i style={{ width: `${rowActions.length ? rowDone / rowActions.length * 100 : 0}%` }} /><span>{rowDone}/{rowActions.length}</span></div>
                </div>
                {stages.map(stage => {
                  const milestone = rowMilestones.find(item => item.stage === stage);
                  if (!milestone) return <div className={styles.emptyCell} key={stage} />;
                  const status = milestoneStatus(milestone);
                  const done = milestone.actions.filter(action => action.status === "complete").length;
                  return (
                    <button key={stage} className={`${styles.cell} ${styles[status]}`} onClick={() => setSelectedId(milestone.id)}>
                      <span className={styles.cellIcon}>
                        {status === "complete" ? <Check size={24} /> : status === "blocked" ? <AlertTriangle size={20} /> : status === "review" ? <Sparkles size={19} /> : status === "in_progress" ? <Clock3 size={19} /> : <Circle size={15} />}
                      </span>
                      <strong>{done}/{milestone.actions.length}</strong>
                      <small>{milestone.title}</small>
                      <ChevronRight className={styles.openIcon} size={15} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.footerActions}>
        <div><ListChecks size={18} /><span><strong>How to use it:</strong> open a cell, update each action and attach notes, dates or working links.</span></div>
        <button onClick={resetTracker}>Reset tracker</button>
      </section>

      {selected && (
        <div className={styles.drawerBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) setSelectedId(null); }}>
          <aside className={styles.drawer}>
            <header>
              <div><span>{selected.workstream} / {selected.stage}</span><h2>{selected.title}</h2><p>{selected.actions.filter(action => action.status === "complete").length} of {selected.actions.length} actions complete</p></div>
              <button onClick={() => setSelectedId(null)} aria-label="Close"><X /></button>
            </header>
            <div className={styles.drawerProgress}><i style={{ width: `${selected.actions.filter(action => action.status === "complete").length / selected.actions.length * 100}%` }} /></div>
            <div className={styles.actionList}>
              {selected.actions.map(action => (
                <article className={`${styles.action} ${styles[action.status]}`} key={action.id}>
                  <button className={styles.actionToggle} onClick={() => cycleStatus(selected.id, action)} aria-label={`Change status: ${statusLabel(action.status)}`}>
                    {action.status === "complete" ? <Check /> : action.status === "blocked" ? <AlertTriangle /> : action.status === "review" ? <Sparkles /> : action.status === "in_progress" ? <Clock3 /> : <Circle />}
                  </button>
                  <div className={styles.actionBody}>
                    <div className={styles.actionTitle}><strong>{action.title}</strong><span className={styles[action.priority]}>{action.priority}</span></div>
                    <div className={styles.statusButtons}>
                      {(["not_started", "in_progress", "blocked", "review", "complete"] as Status[]).map(status => (
                        <button key={status} className={action.status === status ? styles.activeStatus : ""} onClick={() => updateAction(selected.id, action.id, { status })}>{statusLabel(status)}</button>
                      ))}
                    </div>
                    <textarea value={action.notes ?? ""} onChange={event => updateAction(selected.id, action.id, { notes: event.target.value })} placeholder="Notes, dependencies or definition of done…" />
                    <div className={styles.actionMeta}>
                      <label><CalendarDays size={15} /><input type="date" value={action.dueDate ?? ""} onChange={event => updateAction(selected.id, action.id, { dueDate: event.target.value })} /></label>
                      <label><Link2 size={15} /><input type="url" value={action.link ?? ""} onChange={event => updateAction(selected.id, action.id, { link: event.target.value })} placeholder="Add working link" /></label>
                      {action.link && <a href={action.link} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open</a>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}

      {celebration && <div className={styles.celebration}><PartyPopper /><strong>Action complete</strong><span>{celebration}</span></div>}
    </main>
  );
}
