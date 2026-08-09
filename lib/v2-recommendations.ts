import type { V2Workspace } from "./v2-data";
import type { GoogleCalendarEvent } from "./v2-calendar";
import type { CrmOpportunity } from "./v2-crm";
import type { GmailActionMessage } from "./v2-gmail";

export type ProactiveRecommendation = {
  id: string;
  source: "task" | "calendar" | "gmail" | "crm" | "initiative" | "capacity";
  title: string;
  detail: string;
  score: number;
  href: string;
  actionLabel: string;
  tone: "urgent" | "important" | "watch";
};

type Inputs = {
  workspace: V2Workspace;
  events: GoogleCalendarEvent[];
  crm: CrmOpportunity[];
  gmail: GmailActionMessage[];
  today: string;
  now?: Date;
};

const active = (status: string) => status !== "complete" && status !== "cancelled";
const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(word => word.length > 3);
const emailAddress = (value: string) => value.match(/<([^>]+)>/)?.[1]?.toLowerCase() || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || "";

function hasPrepTask(workspace: V2Workspace, event: GoogleCalendarEvent) {
  const eventWords = words(event.title);
  if (!eventWords.length) return false;
  return workspace.allTasks.some(task => {
    if (!active(task.status)) return false;
    const text = `${task.title} ${task.notes || ""}`.toLowerCase();
    return /\b(prep|prepare|review|read|brief)\b/.test(text) && eventWords.some(word => text.includes(word));
  });
}

export function buildProactiveRecommendations({ workspace, events, crm, gmail, today, now = new Date() }: Inputs) {
  const items: ProactiveRecommendation[] = [];
  const tasks = workspace.allTasks.filter(task => active(task.status));

  tasks
    .filter(task => task.dueOn && task.dueOn < today)
    .sort((a, b) => (b.priority - a.priority) || String(a.dueOn).localeCompare(String(b.dueOn)))
    .slice(0, 2)
    .forEach(task => items.push({
      id: `overdue:${task.id}`,
      source: "task",
      title: task.title,
      detail: `Overdue since ${task.dueOn}. Decide whether to do it, move it or drop it.`,
      score: 98 + task.priority,
      href: "/v2/tasks",
      actionLabel: "Open task",
      tone: "urgent",
    }));

  crm
    .filter(item => item.stage === "Follow-up due" || item.stage === "Engaged")
    .slice(0, 3)
    .forEach(item => items.push({
      id: `crm:${item.id}`,
      source: "crm",
      title: item.stage === "Follow-up due" ? `Follow up with ${item.name}` : `Move ${item.name} forward`,
      detail: `${item.company ? `${item.company}. ` : ""}${item.nextAction} ${item.reason}`.trim(),
      score: (item.stage === "Follow-up due" ? 94 : 82) + Math.min(item.urgency || 0, 8),
      href: "/v2/opportunities",
      actionLabel: "Open opportunity",
      tone: item.stage === "Follow-up due" ? "urgent" : "important",
    }));

  const crmEmails = new Set(crm.filter(item => item.stage === "Follow-up due" || item.stage === "Engaged").map(item => item.email.toLowerCase()).filter(Boolean));
  gmail
    .filter(message => message.score >= 5 && !crmEmails.has(emailAddress(message.from)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .forEach(message => items.push({
      id: `gmail:${message.threadId}`,
      source: "gmail",
      title: message.suggestedTaskTitle || `Reply: ${message.subject}`,
      detail: message.reasons.length ? message.reasons.join(" · ") : `${message.from} may need a response.`,
      score: 76 + Math.min(message.score, 15) + (message.important ? 3 : 0),
      href: "/v2/gmail",
      actionLabel: "Open email",
      tone: message.important || message.score >= 10 ? "important" : "watch",
    }));

  const upcoming = events
    .filter(event => !event.allDay && !event.managed && new Date(event.end).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  upcoming.slice(0, 3).forEach(event => {
    const startsInMinutes = Math.round((new Date(event.start).getTime() - now.getTime()) / 60000);
    if (startsInMinutes > 480 || hasPrepTask(workspace, event)) return;
    items.push({
      id: `meeting:${event.id}`,
      source: "calendar",
      title: `Prepare for ${event.title}`,
      detail: startsInMinutes <= 60 ? "This starts within the hour and no related prep task is visible." : `Starts in about ${Math.max(1, Math.round(startsInMinutes / 60))} hours and no related prep task is visible.`,
      score: startsInMinutes <= 60 ? 96 : startsInMinutes <= 180 ? 88 : 72,
      href: "/v2/calendar",
      actionLabel: "Open calendar",
      tone: startsInMinutes <= 180 ? "urgent" : "important",
    });
  });

  const busyMinutes = events.filter(event => !event.allDay).reduce((sum, event) => {
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    return sum + Math.max(0, Math.round((end - start) / 60000));
  }, 0);
  if (busyMinutes >= 420) items.push({
    id: "capacity:today",
    source: "capacity",
    title: "Protect the rest of today",
    detail: `${Math.round(busyMinutes / 30) / 2} hours are already committed. Avoid adding low-value work unless something moves.`,
    score: busyMinutes >= 510 ? 93 : 78,
    href: "/v2/calendar",
    actionLabel: "Review capacity",
    tone: busyMinutes >= 510 ? "urgent" : "important",
  });

  workspace.initiatives.filter(initiative => initiative.status === "active").forEach(initiative => {
    const initiativeTasks = tasks.filter(task => task.initiativeId === initiative.id);
    if (!initiativeTasks.length) items.push({
      id: `initiative:${initiative.id}`,
      source: "initiative",
      title: `${initiative.title} has no next action`,
      detail: "An active initiative with no executable task is likely to stall.",
      score: 62 + initiative.priority,
      href: "/v2/initiatives",
      actionLabel: "Add next action",
      tone: "watch",
    });
    initiative.workstreams.flatMap(workstream => workstream.milestones).filter(milestone => milestone.status !== "complete" && milestone.status !== "cancelled" && !milestone.tasks.some(task => active(task.status))).slice(0, 1).forEach(milestone => items.push({
      id: `milestone:${milestone.id}`,
      source: "initiative",
      title: `${milestone.title} needs a next action`,
      detail: `${initiative.title} has an active milestone with nothing executable beneath it.`,
      score: 60 + initiative.priority,
      href: "/v2/initiatives",
      actionLabel: "Open initiative",
      tone: "watch",
    }));
  });

  const scheduledTaskIds = new Set(events.map(event => event.taskId).filter(Boolean));
  tasks
    .filter(task => task.priority >= 4 && task.dueOn && task.dueOn <= today && !scheduledTaskIds.has(task.id))
    .slice(0, 2)
    .forEach(task => items.push({
      id: `unscheduled:${task.id}`,
      source: "task",
      title: `Make time for ${task.title}`,
      detail: "This is high priority and due now, but it does not have protected Calendar time.",
      score: 84 + task.priority,
      href: "/v2/calendar",
      actionLabel: "Schedule it",
      tone: "important",
    }));

  const unique = new Map<string, ProactiveRecommendation>();
  items.sort((a, b) => b.score - a.score).forEach(item => {
    const key = `${item.source}:${item.title.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, item);
  });
  return [...unique.values()].slice(0, 6);
}
