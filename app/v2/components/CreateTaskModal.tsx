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

export default function CreateTaskModal({ userId, initiatives, initialTitle = "", initialNotes = "", initialCategory = "build", initialPriority = 3, sourceUrl = "", sourceLabel = "Source page", onClose, onCreated }: Props) {
  const [draft, setDraft] = useState<V2TaskDraft>({
    title: initialTitle,
    category: initialCategory,
    priority: initialPriority,
    estimatedMinutes: 30,
    dueOn: null,
    notes: initialNotes,
    initiativeId: null,
    milestoneId: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const selectedInitiative = initiatives.find(item => item.id === draft.initiativeId);
  const milestones = useMemo(() => selectedInitiative?.workstreams.flatMap(item => item.milestones) ?? [], [selectedInitiative]);

  function validate() {
    if (!draft.title.trim()) throw new Error("Add a task title before continuing.");
    if (!Number.isFinite(draft.estimatedMinutes) || draft.estimatedMinutes < 5) throw new Error("Estimate must be at least 5 minutes.");
  }

  async function createTask() {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data, error: insertError } = await supabase.from("tasks").insert({
      user_id: userId,
      title: draft.title.trim(),
      category: draft.category,
      points: Math.max(1, draft.priority),
      status: "ready",
      priority: draft.priority,
      estimated_minutes: draft.estimatedMinutes,
      due_on: draft.dueOn || null,
      notes: draft.notes?.trim() || null,
      initiative_id: draft.initiativeId || null,
      milestone_id: draft.milestoneId || null,
      is_today: false,
      is_complete: false,
      week_number: 1,
      energy_required: "standard",
      work_type: draft.category === "cash" ? "communication" : draft.category === "health" ? "health" : draft.category === "life" ? "life" : "deep_work",
      preferred_time: "any",
      position: Date.now(),
    }).select("id").single();
    if (insertError) throw insertError;

    const cleanUrl = normaliseUrl(sourceUrl);
    if (cleanUrl) {
      const { error: linkError } = await supabase.from("task_links").insert({ user_id: userId, task_id: data.id, label: sourceLabel, url: cleanUrl, position: Date.now() });
      if (linkError) throw linkError;
    }
    return data.id as string;
  }

  async function saveOnly() {
    setBusy(true);
    setError("");
    try {
      validate();
      const taskId = await createTask();
      await onCreated({ taskId, scheduled: false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create task.");
    } finally {
      setBusy(false);
    }
  }

  async function suggestSchedule() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      validate();
      const status = await loadCalendarStatus(supabase, userId);
      if (!status || status.status !== "connected" || !status.selected_calendar_id) {
        throw new Error("Connect and select a Google Calendar before using Create and schedule.");
      }
      const date = draft.dueOn && draft.dueOn >= localDateInput() ? draft.dueOn : localDateInput();
      const from = new Date(`${date}T00:00:00`).toISOString();
      const to = new Date(`${date}T23:59:59`).toISOString();
      const result = await callCalendar<{ events: GoogleCalendarEvent[] }>(supabase, "events", { calendarId: status.selected_calendar_id, timeMin: from, timeMax: to });
      const slot = findSlot(date, draft.estimatedMinutes, result.events);
      if (!slot) throw new Error(`No ${draft.estimatedMinutes}-minute space was found between 09:00 and 17:30 on ${date}. Choose another due date or create the task without scheduling.`);
      setProposal({ date, startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString(), calendarId: status.selected_calendar_id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to suggest a calendar time.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSchedule() {
    if (!supabase || !proposal) return;
    setBusy(true);
    setError("");
    let taskId = "";
    try {
      taskId = await createTask();
      await callCalendar(supabase, "createBlock", {
        taskId,
        title: draft.title.trim(),
        startsAt: proposal.startsAt,
        endsAt: proposal.endsAt,
        calendarId: proposal.calendarId,
        timeZone: "Europe/London",
      });
      await onCreated({ taskId, scheduled: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to schedule task.";
      setError(taskId ? `The task was created, but the calendar block failed: ${message}` : message);
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.backdrop} onClick={onClose}>
    <div className={styles.modal} onClick={event => event.stopPropagation()}>
      <header><div><span>NEW TASK</span><h2>Create a finishable task</h2></div><button onClick={onClose} aria-label="Close"><X /></button></header>

      <label>Title<input autoFocus value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); setProposal(null); }} placeholder="Start with a verb..." /></label>
      <div className={styles.grid}>
        <label>Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="cash">Revenue</option><option value="build">Build</option><option value="health">Health</option><option value="life">Life</option></select></label>
        <label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: Number(event.target.value) })}><option value={5}>Highest</option><option value={4}>High</option><option value={3}>Normal</option><option value={2}>Low</option><option value={1}>Lowest</option></select></label>
        <label>Estimate<input type="number" min={5} step={5} value={draft.estimatedMinutes} onChange={event => { setDraft({ ...draft, estimatedMinutes: Number(event.target.value) }); setProposal(null); }} /></label>
        <label>Due date<input type="date" value={draft.dueOn ?? ""} onChange={event => { setDraft({ ...draft, dueOn: event.target.value || null }); setProposal(null); }} /></label>
      </div>
      <div className={styles.grid}>
        <label>Initiative<select value={draft.initiativeId ?? ""} onChange={event => setDraft({ ...draft, initiativeId: event.target.value || null, milestoneId: null })}><option value="">Inbox / unassigned</option>{initiatives.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Milestone<select value={draft.milestoneId ?? ""} disabled={!selectedInitiative || milestones.length === 0} onChange={event => setDraft({ ...draft, milestoneId: event.target.value || null })}><option value="">{!selectedInitiative ? "Select an initiative first" : milestones.length === 0 ? "No milestones in this initiative" : "No milestone"}</option>{milestones.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      </div>
      <label>Notes<textarea rows={5} value={draft.notes ?? ""} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="Optional context, definition of done or starting notes" /></label>

      {proposal && <section className={styles.proposal}><CalendarDays size={19} /><div><span>Suggested calendar block</span><strong>{formatProposal(proposal)}</strong><small>Based on your selected calendar, existing events and the task estimate.</small></div></section>}
      {error && <div className={styles.error}>{error}</div>}

      <footer>
        <button onClick={proposal ? () => setProposal(null) : onClose}>{proposal ? "Back" : "Cancel"}</button>
        <button onClick={() => void saveOnly()} disabled={busy || !draft.title.trim()}><Check size={17} /> {busy ? "Working..." : "Create task"}</button>
        {proposal
          ? <button className={styles.primary} onClick={() => void confirmSchedule()} disabled={busy}><Clock3 size={17} /> {busy ? "Scheduling..." : "Confirm create & schedule"}</button>
          : <button className={styles.primary} onClick={() => void suggestSchedule()} disabled={busy || !draft.title.trim()}><Plus size={17} /> {busy ? "Finding time..." : "Create & schedule"}</button>}
      </footer>
    </div>
  </div>;
}
