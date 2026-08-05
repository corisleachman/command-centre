import type { V2Task } from "./v2-data";
import type { GoogleCalendarEvent } from "./v2-calendar";

export type PlanningWindow = { start: string; end: string };
export type ProposedCalendarBlock = { taskId: string; title: string; startsAt: string; endsAt: string; minutes: number; priority: number };

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function clampToDay(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

export function findAvailableWindows(
  date: string,
  events: GoogleCalendarEvent[],
  workdayStart = "09:00",
  workdayEnd = "17:30",
  bufferMinutes = 10,
): PlanningWindow[] {
  const dayStart = clampToDay(date, workdayStart);
  const dayEnd = clampToDay(date, workdayEnd);
  const busy = events
    .filter(event => !event.allDay && event.status !== "cancelled")
    .map(event => ({ start: new Date(event.start), end: new Date(event.end) }))
    .filter(event => event.end > dayStart && event.start < dayEnd)
    .map(event => ({
      start: new Date(Math.max(dayStart.getTime(), event.start.getTime() - bufferMinutes * 60_000)),
      end: new Date(Math.min(dayEnd.getTime(), event.end.getTime() + bufferMinutes * 60_000)),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Array<{ start: Date; end: Date }> = [];
  for (const event of busy) {
    const last = merged[merged.length - 1];
    if (!last || event.start > last.end) merged.push(event);
    else if (event.end > last.end) last.end = event.end;
  }

  const windows: PlanningWindow[] = [];
  let cursor = dayStart;
  for (const event of merged) {
    if (event.start > cursor) windows.push({ start: cursor.toISOString(), end: event.start.toISOString() });
    if (event.end > cursor) cursor = event.end;
  }
  if (cursor < dayEnd) windows.push({ start: cursor.toISOString(), end: dayEnd.toISOString() });
  return windows.filter(window => minutesBetween(new Date(window.start), new Date(window.end)) >= 25);
}

export function proposePriorityBlocks(
  tasks: V2Task[],
  windows: PlanningWindow[],
  maxBlocks = 3,
): ProposedCalendarBlock[] {
  const ranked = [...tasks]
    .filter(task => task.status !== "complete" && task.status !== "cancelled")
    .sort((a, b) => a.priority - b.priority || (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || a.position - b.position)
    .slice(0, maxBlocks);

  const remaining = windows.map(window => ({ start: new Date(window.start), end: new Date(window.end) }));
  const proposals: ProposedCalendarBlock[] = [];

  for (const task of ranked) {
    const desired = Math.max(25, Math.min(task.estimatedMinutes || 30, 120));
    const slotIndex = remaining.findIndex(window => minutesBetween(window.start, window.end) >= desired);
    if (slotIndex === -1) continue;
    const window = remaining[slotIndex];
    const end = new Date(window.start.getTime() + desired * 60_000);
    proposals.push({ taskId: task.id, title: task.title, startsAt: window.start.toISOString(), endsAt: end.toISOString(), minutes: desired, priority: task.priority });
    window.start = new Date(end.getTime() + 10 * 60_000);
    if (window.start >= window.end) remaining.splice(slotIndex, 1);
  }

  return proposals;
}
