import type { V2Task } from "./v2-data";
import type { GoogleCalendarEvent } from "./v2-calendar";
import type { CalendarRoutine } from "./v2-calendar-routines";

export type PlanningWindow = { start: string; end: string };
export type ProposedCalendarBlock = { id: string; taskId: string; title: string; startsAt: string; endsAt: string; minutes: number; priority: number; source: "task" | "routine" };

const minutesBetween = (start: Date, end: Date) => Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
const clampToDay = (date: string, time: string) => new Date(`${date}T${time}:00`);

export function findAvailableWindows(date: string, events: GoogleCalendarEvent[], workdayStart = "09:00", workdayEnd = "17:30", bufferMinutes = 10): PlanningWindow[] {
  const dayStart = clampToDay(date, workdayStart);
  const dayEnd = clampToDay(date, workdayEnd);
  const busy = events.filter(event => !event.allDay && event.status !== "cancelled").map(event => ({ start: new Date(event.start), end: new Date(event.end) })).filter(event => event.end > dayStart && event.start < dayEnd).map(event => ({ start: new Date(Math.max(dayStart.getTime(), event.start.getTime() - bufferMinutes * 60_000)), end: new Date(Math.min(dayEnd.getTime(), event.end.getTime() + bufferMinutes * 60_000)) })).sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date; end: Date }> = [];
  for (const event of busy) { const last = merged[merged.length - 1]; if (!last || event.start > last.end) merged.push(event); else if (event.end > last.end) last.end = event.end; }
  const windows: PlanningWindow[] = [];
  let cursor = dayStart;
  for (const event of merged) { if (event.start > cursor) windows.push({ start: cursor.toISOString(), end: event.start.toISOString() }); if (event.end > cursor) cursor = event.end; }
  if (cursor < dayEnd) windows.push({ start: cursor.toISOString(), end: dayEnd.toISOString() });
  return windows.filter(window => minutesBetween(new Date(window.start), new Date(window.end)) >= 25);
}

function placeBlock(windows: Array<{ start: Date; end: Date }>, desired: number, preferredStart?: Date, preferredEnd?: Date) {
  let index = windows.findIndex(window => (!preferredStart || window.end > preferredStart) && (!preferredEnd || window.start < preferredEnd) && minutesBetween(new Date(Math.max(window.start.getTime(), preferredStart?.getTime() ?? window.start.getTime())), new Date(Math.min(window.end.getTime(), preferredEnd?.getTime() ?? window.end.getTime()))) >= desired);
  if (index < 0) index = windows.findIndex(window => minutesBetween(window.start, window.end) >= desired);
  if (index < 0) return null;
  const window = windows[index];
  const start = new Date(Math.max(window.start.getTime(), preferredStart?.getTime() ?? window.start.getTime()));
  const end = new Date(start.getTime() + desired * 60_000);
  window.start = end;
  if (window.start >= window.end) windows.splice(index, 1);
  return { start, end };
}

export function proposeWholeDayPlan(tasks: V2Task[], routines: CalendarRoutine[], windows: PlanningWindow[], date: string, maxBlocks = 10): ProposedCalendarBlock[] {
  const remaining = windows.map(window => ({ start: new Date(window.start), end: new Date(window.end) }));
  const proposals: ProposedCalendarBlock[] = [];
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const activeTasks = [...tasks].filter(task => task.status !== "complete" && task.status !== "cancelled").sort((a, b) => a.priority - b.priority || (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || a.position - b.position);

  for (const routine of routines.filter(item => item.isActive && item.daysOfWeek.includes(weekday)).sort((a, b) => a.priority - b.priority)) {
    const task = activeTasks.find(item => routine.category === "income" ? item.category === "cash" || /outreach|prospect|follow.?up|proposal|application|revenue|list/i.test(item.title) : item.category === routine.category) ?? activeTasks[0];
    if (!task) continue;
    const desired = Math.max(routine.minimumMinutes, routine.idealMinutes);
    const slot = placeBlock(remaining, desired, clampToDay(date, routine.preferredStart), clampToDay(date, routine.preferredEnd));
    if (!slot) continue;
    proposals.push({ id: `routine-${routine.id}-${slot.start.toISOString()}`, taskId: task.id, title: routine.title, startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString(), minutes: desired, priority: routine.priority, source: "routine" });
  }

  for (const task of activeTasks) {
    if (proposals.length >= maxBlocks) break;
    const desired = Math.max(25, Math.min(task.estimatedMinutes || 30, 120));
    const slot = placeBlock(remaining, desired);
    if (!slot) continue;
    proposals.push({ id: `task-${task.id}-${slot.start.toISOString()}`, taskId: task.id, title: task.title, startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString(), minutes: desired, priority: task.priority, source: "task" });
  }
  return proposals.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function proposePriorityBlocks(tasks: V2Task[], windows: PlanningWindow[], maxBlocks = 3) {
  return proposeWholeDayPlan(tasks, [], windows, new Date(windows[0]?.start ?? Date.now()).toISOString().slice(0, 10), maxBlocks);
}
