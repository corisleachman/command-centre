import type { V2Initiative, V2Task, V2Workspace } from "./v2-data";
import type { GoogleCalendarEvent } from "./v2-calendar";

export type DailyRecommendation = {
  task: V2Task;
  score: number;
  reasons: string[];
  initiativeTitle: string;
};

export type DailyPlanBlock = {
  id: string;
  taskId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  reasons: string[];
  initiativeTitle: string;
  category: string;
};

const WORKDAY_START = 9 * 60;
const WORKDAY_END = 17 * 60 + 30;
const MAX_BLOCKS = 6;
const BUFFER_MINUTES = 30;

function initiativeFor(workspace: V2Workspace, task: V2Task): V2Initiative | null {
  return workspace.initiatives.find(item => item.id === task.initiativeId) ?? null;
}

function daysUntil(date: string, today: string) {
  const start = new Date(`${today}T12:00:00`).getTime();
  const end = new Date(`${date}T12:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function scoreTask(task: V2Task, workspace: V2Workspace, today: string): DailyRecommendation {
  let score = task.priority * 12;
  const reasons: string[] = [];
  const initiative = initiativeFor(workspace, task);

  if (task.category === "cash") {
    score += 38;
    reasons.push("Directly supports income");
  }
  if (workspace.todayTasks.some(item => item.id === task.id)) {
    score += 32;
    reasons.push("Already marked for Today");
  }
  if (task.dueOn) {
    const distance = daysUntil(task.dueOn, today);
    if (distance < 0) {
      score += 42;
      reasons.push("Overdue");
    } else if (distance === 0) {
      score += 36;
      reasons.push("Due today");
    } else if (distance <= 2) {
      score += 24;
      reasons.push("Deadline is close");
    } else if (distance <= 7) {
      score += 10;
      reasons.push("Due this week");
    }
  }
  if (initiative) {
    score += Math.max(0, 6 - initiative.priority) * 6;
    if (initiative.priority <= 2) reasons.push("High-priority initiative");
    if (initiative.status === "paused" || initiative.status === "parked") {
      score -= 50;
      reasons.push("Initiative is paused");
    }
  }
  if (!task.initiativeId) score -= 4;
  if (task.estimatedMinutes <= 60) score += 6;
  if (task.estimatedMinutes > 150) score -= 12;
  if (!reasons.length) reasons.push("Best fit from current active work");

  return {
    task,
    score,
    reasons: reasons.slice(0, 3),
    initiativeTitle: initiative?.title ?? "Unassigned",
  };
}

function minuteOfDay(value: string) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function isoAt(dateKey: string, minutes: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toISOString();
}

function busyIntervals(events: GoogleCalendarEvent[]) {
  return events
    .filter(event => !event.allDay && event.status !== "cancelled")
    .map(event => ({
      start: Math.max(WORKDAY_START, minuteOfDay(event.start)),
      end: Math.min(WORKDAY_END, minuteOfDay(event.end)),
    }))
    .filter(item => item.end > item.start)
    .sort((a, b) => a.start - b.start);
}

function freeWindows(events: GoogleCalendarEvent[]) {
  const busy = busyIntervals(events);
  const windows: Array<{ start: number; end: number }> = [];
  let cursor = WORKDAY_START;
  for (const item of busy) {
    if (item.start > cursor) windows.push({ start: cursor, end: item.start });
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < WORKDAY_END) windows.push({ start: cursor, end: WORKDAY_END });
  return windows;
}

export function proposeDailyPlan(workspace: V2Workspace, events: GoogleCalendarEvent[], today: string) {
  const active = workspace.allTasks.filter(task => task.status !== "complete" && task.status !== "cancelled");
  const alreadyScheduled = new Set(events.map(event => event.taskId).filter((value): value is string => Boolean(value)));
  const ranked = active
    .filter(task => !alreadyScheduled.has(task.id))
    .map(task => scoreTask(task, workspace, today))
    .sort((a, b) => b.score - a.score || a.task.position - b.task.position);

  const picked: DailyRecommendation[] = [];
  const initiativeCounts = new Map<string, number>();
  let hasCash = false;
  let hasHealthLife = false;

  for (const candidate of ranked) {
    const key = candidate.task.initiativeId ?? "unassigned";
    const count = initiativeCounts.get(key) ?? 0;
    if (count >= 1 && picked.length >= 3) continue;
    if (candidate.task.category === "cash" && hasCash && picked.length >= 3) continue;
    if (["health", "life"].includes(candidate.task.category) && hasHealthLife && picked.length >= 4) continue;
    picked.push(candidate);
    initiativeCounts.set(key, count + 1);
    if (candidate.task.category === "cash") hasCash = true;
    if (["health", "life"].includes(candidate.task.category)) hasHealthLife = true;
    if (picked.length >= MAX_BLOCKS) break;
  }

  if (!hasCash) {
    const cash = ranked.find(item => item.task.category === "cash" && !picked.some(chosen => chosen.task.id === item.task.id));
    if (cash) picked.unshift(cash);
  }

  const windows = freeWindows(events);
  const blocks: DailyPlanBlock[] = [];
  let windowIndex = 0;
  let cursor = windows[0]?.start ?? WORKDAY_END;

  for (const recommendation of picked.slice(0, MAX_BLOCKS)) {
    const desired = Math.min(Math.max(recommendation.task.estimatedMinutes, 15), 120);
    while (windowIndex < windows.length) {
      const window = windows[windowIndex];
      cursor = Math.max(cursor, window.start);
      const available = window.end - cursor;
      if (available >= desired) {
        blocks.push({
          id: `proposal-${recommendation.task.id}`,
          taskId: recommendation.task.id,
          title: recommendation.task.title,
          startsAt: isoAt(today, cursor),
          endsAt: isoAt(today, cursor + desired),
          minutes: desired,
          reasons: recommendation.reasons,
          initiativeTitle: recommendation.initiativeTitle,
          category: recommendation.task.category,
        });
        cursor += desired + 15;
        break;
      }
      windowIndex += 1;
      cursor = windows[windowIndex]?.start ?? WORKDAY_END;
    }
  }

  const committedMinutes = busyIntervals(events).reduce((sum, item) => sum + (item.end - item.start), 0);
  const proposedMinutes = blocks.reduce((sum, block) => sum + block.minutes, 0);
  const workingMinutes = WORKDAY_END - WORKDAY_START;
  const remainingAfterPlan = Math.max(0, workingMinutes - committedMinutes - proposedMinutes - BUFFER_MINUTES);

  return {
    recommendations: ranked.slice(0, 12),
    blocks,
    committedMinutes,
    proposedMinutes,
    bufferMinutes: BUFFER_MINUTES,
    remainingAfterPlan,
    overloaded: committedMinutes + proposedMinutes + BUFFER_MINUTES > workingMinutes,
  };
}
