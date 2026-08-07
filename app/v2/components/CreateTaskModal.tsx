"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, Plus, X } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import type { V2Initiative, V2TaskDraft } from "../../../lib/v2-data";
import { callCalendar, loadCalendarStatus, localDateInput, type GoogleCalendarEvent } from "../../../lib/v2-calendar";
import styles from "./create-task-modal.module.css";

type Proposal = {
  date: string;
  startsAt: string;
  endsAt: string;
  calendarId: string;
};

type Props = {
  userId: string;
  initiatives: V2Initiative[];
  initialTitle?: string;
  initialNotes?: string;
  initialCategory?: string;
  initialPriority?: number;
  initialEstimateMinutes?: number;
  sourceUrl?: string;
  sourceLabel?: string;
  onClose: () => void;
  onCreated: (result: { taskId: string; scheduled: boolean }) => Promise<void> | void;
};

function normaliseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function roundUp(date: Date, minutes: number) {
  const ms = minutes * 60_000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function findSlot(date: string, durationMinutes: number, events: GoogleCalendarEvent[]) {
  const dayStart = new Date(`${date}T09:00:00`);
  const dayEnd = new Date(`${date}T17:30:00`);
  let cursor = dayStart;
  if (date === localDateInput()) {
    const soon = roundUp(new Date(Date.now() + 15 * 60_000), 15);
    if (soon > cursor) cursor = soon;
  }

  const busy = events
    .filter(event => !event.allDay && event.status !== "cancelled")
    .map(event => ({ start: new Date(event.start), end: new Date(event.end) }))
    .filter(event => event.end > dayStart && event.start < dayEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const event of busy) {
    const proposedEnd = new Date(cursor.getTime() + durationMinutes * 60_000);
    if (proposedEnd <= event.start && proposedEnd <= dayEnd) return { start: cursor, end: proposedEnd };
    if (event.end > cursor) cursor = roundUp(event.end, 15);
  }

  const end = new Date(cursor.getTime() + durationMinutes * 60_000);
  return end <= dayEnd ? { start: cursor, end } : null;
}

function formatProposal(proposal: Proposal) {
  const start = new Date(proposal.startsAt);
  const end = new Date(proposal.endsAt);
  return `${start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}, ${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function CreateTaskModal({ userId, initiatives, initialTitle = "", initialNotes = "", initialCategory = "build", initialPriority = 3, initialEstimateMinutes = 30, sourceUrl = "", sourceLabel = "Source page", onClose, onCreated }: Props) {
  const [draft, setDraft] = useState<V2TaskDraft>({
    title: initialTitle,
    category: initialCategory,
    priority: initialPriority,
    estimatedMinutes: initialEstimateMinutes,
    dueOn: null,
    notes: initialNotes,
    initiativeId: null,
    milestoneId: null,
  });
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedInitiative = useMemo(() => initiatives.find(item => item.id === draft.initiativeId) ?? null, [initiatives, draft.initiativeId]);
  const milestones = selectedInitiative?.milestones ?? [];

  function update<K extends keyof V2TaskDraft>(key: K, value: V2TaskDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  async function createTask() {
    if (!supabase) throw new Error("Supabase is not configured.");
    if (!draft.title.trim()) throw new Error("Give the task a title.");
    const { data, error: insertError } = await supabase.from("tasks").insert({
      user_id: userId,
      title: draft.title.trim(),
      category: draft.category,
      points: Math.max(1, Math.min(5, draft.priority)),
      status: "ready",
      priority: draft.priority,
      estimated_minutes: draft.estimatedMinutes,
      due_on: draft.dueOn,
      notes: draft.notes.trim() || null,
      initiative_id: draft.initiativeId,
      milestone_id: draft.milestoneId,
      is_today: false,
      is_complete: false,
      week_number: 1,
      energy_required: "standard",
      work_type: "focus",
      preferred_time: "any",
      position: Date.now(),
    }).select("id").single();
    if (insertError) throw insertError;

    const url = normaliseUrl(sourceUrl);
    if (url) {
      const { error: linkError } = await supabase.from("task_links").insert({
        user_id: userId,
        task_id: data.id,
        label: sourceLabel,
        url,
        position: Date.now(),
      });
      if (linkError) throw linkError;
    }
    return data.id as string;
  }

  async function proposeSchedule() {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const status = await loadCalendarStatus(supabase, userId);
      if (!status?.connected || !status.selected_calendar_id) throw new Error("Connect and select a Google Calendar first.");
      const today = localDateInput();
      const targetDate = draft.dueOn && draft.dueOn >= today ? draft.dueOn : today;
      const dayStart = new Date(`${targetDate}T00:00:00`).toISOString();
      const dayEnd = new Date(`${targetDate}T23:59:59`).toISOString();
      const result = await callCalendar(supabase, "events", { calendarId: status.selected_calendar_id, timeMin: dayStart, timeMax: dayEnd });
      const slot = findSlot(targetDate, draft.estimatedMinutes || 30, result.events ?? []);
      if (!slot) throw new Error("No suitable free slot was found in the working day.");
      setProposal({ date: targetDate, startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString(), calendarId: status.selected_calendar_id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to propose a calendar slot.");
    } finally { setBusy(false); }
  }

  async function save(schedule: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const taskId = await createTask();
      if (schedule) {
        if (!proposal || !supabase) throw new Error("Choose a proposed calendar slot first.");
        try {
          await callCalendar(supabase, "createBlock", {
            calendarId: proposal.calendarId,
            taskId,
            title: draft.title.trim(),
            startsAt: proposal.startsAt,
            endsAt: proposal.endsAt,
            timezone: "Europe/London",
          });
        } catch (reason) {
          throw new Error(`Task was created, but scheduling failed: ${reason instanceof Error ? reason.message : "Unknown Calendar error"}`);
        }
      }
      await onCreated({ taskId, scheduled: schedule });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create task.");
    } finally { setBusy(false); }
  }

  return <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Create task">
      <header><div><span>NEW TASK</span><h2>Create and schedule</h2></div><button onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      {error && <div className={styles.error}>{error}</div>}
      {message && <div className={styles.message}>{message}</div>}
      <div className={styles.fields}>
        <label className={styles.full}><span>Title</span><input value={draft.title} onChange={event => update("title", event.target.value)} autoFocus /></label>
        <label><span>Category</span><select value={draft.category} onChange={event => update("category", event.target.value)}><option value="cash">Cash</option><option value="build">Build</option><option value="health">Health / Life</option><option value="admin">Admin</option></select></label>
        <label><span>Priority</span><select value={draft.priority} onChange={event => update("priority", Number(event.target.value))}>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>Estimate</span><select value={draft.estimatedMinutes} onChange={event => update("estimatedMinutes", Number(event.target.value))}>{[15,30,45,60,90,120].map(value => <option key={value} value={value}>{value} min</option>)}</select></label>
        <label><span>Due date</span><input type="date" value={draft.dueOn ?? ""} onChange={event => update("dueOn", event.target.value || null)} /></label>
        <label><span>Initiative</span><select value={draft.initiativeId ?? ""} onChange={event => setDraft(current => ({ ...current, initiativeId: event.target.value || null, milestoneId: null }))}><option value="">None</option>{initiatives.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label><span>Milestone</span><select disabled={!draft.initiativeId} value={draft.milestoneId ?? ""} onChange={event => update("milestoneId", event.target.value || null)}><option value="">None</option>{milestones.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className={styles.full}><span>Notes</span><textarea value={draft.notes} onChange={event => update("notes", event.target.value)} rows={5} /></label>
      </div>
      {proposal && <div className={styles.proposal}><CalendarDays size={18} /><div><span>PROPOSED SLOT</span><strong>{formatProposal(proposal)}</strong></div><button onClick={() => setProposal(null)}>Change</button></div>}
      <footer>
        <button className={styles.cancel} onClick={onClose} disabled={busy}>Cancel</button>
        <div>
          <button className={styles.secondary} onClick={() => void save(false)} disabled={busy}><Plus size={16} /> Create task</button>
          {!proposal ? <button className={styles.primary} onClick={() => void proposeSchedule()} disabled={busy}><Clock3 size={16} /> {busy ? "Checking…" : "Create & schedule"}</button> : <button className={styles.primary} onClick={() => void save(true)} disabled={busy}><Check size={16} /> {busy ? "Scheduling…" : "Confirm schedule"}</button>}
        </div>
      </footer>
    </section>
  </div>;
}
