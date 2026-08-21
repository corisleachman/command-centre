import { assessConversation, type ExecutiveAssessment, type ExecutiveSourceMessage } from "./executive-policy.ts";

type ModelInfo = {
  provider: string;
  name: string;
  version: string;
};

export type InterpretedConversation = {
  assessment: ExecutiveAssessment;
  model: ModelInfo;
};

const ALLOWED_ACTIONS = new Set([
  "reply_draft",
  "document_draft",
  "calendar_proposal",
  "task_create",
  "task_reprioritise",
  "opportunity_patch",
  "follow_up_schedule",
]);
const ATTENTION_LEVELS = new Set(["interrupt_now", "top_of_today", "morning_brief", "silent"]);

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean).slice(0, 12) : [];
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, minimum), maximum) : fallback;
}

function emailAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase()
    || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()
    || value.trim().toLowerCase();
}

function senderName(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/^"|"$/g, "").trim() || emailAddress(value).split("@")[0] || "the sender";
}

function organisationFromEmail(value: string) {
  const domain = emailAddress(value).split("@")[1] || "";
  if (!domain || /gmail|outlook|hotmail|icloud|yahoo|protonmail/.test(domain)) return "";
  return domain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function safeContent(actionType: string, value: unknown, externalEmail: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const content = value as Record<string, unknown>;
  if (actionType === "reply_draft") {
    const to = emailAddress(stringValue(content.to));
    if (to !== externalEmail) return null;
    const subject = stringValue(content.subject);
    const body = stringValue(content.body);
    if (!subject || !body) return null;
    return { to, subject, body };
  }
  if (actionType === "calendar_proposal") {
    const attendeeEmail = emailAddress(stringValue(content.attendee_email));
    const startsAt = stringValue(content.starts_at);
    const endsAt = stringValue(content.ends_at);
    if (attendeeEmail !== externalEmail || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) return null;
    return {
      event_title: stringValue(content.event_title, "Meeting"),
      attendee_name: stringValue(content.attendee_name),
      attendee_email: attendeeEmail,
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: stringValue(content.timezone, "Europe/London"),
      duration_minutes: boundedNumber(content.duration_minutes, 30, 10, 180),
      description: stringValue(content.description),
    };
  }
  return Object.fromEntries(Object.entries(content).filter(([, item]) => item !== null && ["string", "number", "boolean"].includes(typeof item)));
}

function hasCalendarAgreement(messages: ExecutiveSourceMessage[]) {
  const sorted = [...messages].sort((left, right) => left.internalDate - right.internalDate);
  const latest = sorted.at(-1);
  if (!latest || latest.mine || latest.automated) return false;
  const thread = sorted.map(message => message.body).join("\n");
  const acceptedOrProposed = /\b(?:yes|yeah|yep|sure|perfect|agreed|works for me|that works|sounds good|let(?:'|’)s do it)\b/i.test(latest.body)
    || /\b(?:call|chat|meeting|talk|reconvene)\b/i.test(latest.body);
  const corisCanSend = /\b(?:send|put|pop|create|share)\b.{0,45}\b(?:calendar\s+)?invite\b|\b(?:calendar\s+)?invite\b.{0,45}\b(?:send|create|share)\b|\bfeel free to share\b/i.test(latest.body);
  const groundedDate = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(thread);
  const groundedTime = /\b\d{1,2}(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(thread);
  return acceptedOrProposed && corisCanSend && groundedDate && groundedTime;
}

function normalizeModelAssessment(raw: unknown, messages: ExecutiveSourceMessage[], fallback: ExecutiveAssessment): ExecutiveAssessment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The model returned an invalid assessment object.");
  const value = raw as Record<string, unknown>;
  const sorted = [...messages].sort((left, right) => left.internalDate - right.internalDate);
  const latestIncoming = [...sorted].reverse().find(message => !message.mine);
  if (!latestIncoming) return fallback;
  const externalEmail = emailAddress(latestIncoming.from);
  const contactName = senderName(latestIncoming.from);
  const calendarAgreement = hasCalendarAgreement(messages);
  const rawActions = Array.isArray(value.actions) ? value.actions : [];
  const actions: ExecutiveAssessment["actions"] = [];
  for (const [index, item] of rawActions.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rawAction = item as Record<string, unknown>;
    const type = stringValue(rawAction.type);
    if (!ALLOWED_ACTIONS.has(type) || (type === "calendar_proposal" && !calendarAgreement)) continue;
    let parsedContent: unknown;
    try { parsedContent = JSON.parse(stringValue(rawAction.content_json, "{}")); } catch { continue; }
    const content = safeContent(type, parsedContent, externalEmail);
    if (!content) continue;
    actions.push({
      type: type as ExecutiveAssessment["actions"][number]["type"],
      title: stringValue(rawAction.title, "Prepared action"),
      content,
      position: index + 1,
    });
  }

  const attentionLevel = stringValue(value.attentionLevel);
  const changes = Array.isArray(value.changes) ? value.changes.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const change = item as Record<string, unknown>;
    const type = stringValue(change.type);
    const evidence = stringValue(change.evidence);
    return type && evidence ? [{ type, evidence }] : [];
  }).slice(0, 10) : [];
  const evidence = latestIncoming ? [{
    label: "Latest incoming message",
    quote: latestIncoming.body.replace(/\s+/g, " ").trim().slice(0, 500),
    source: latestIncoming.id,
  }] : fallback.evidence;

  const resolvedAttentionLevel = ATTENTION_LEVELS.has(attentionLevel) ? attentionLevel as ExecutiveAssessment["attentionLevel"] : fallback.attentionLevel;
  return {
    category: stringValue(value.category, fallback.category),
    summary: stringValue(value.summary, fallback.summary),
    previousState: nullableString(value.previousState) ?? fallback.previousState,
    newState: nullableString(value.newState) ?? fallback.newState,
    changes: changes.length ? changes : fallback.changes,
    explicitRequests: stringArray(value.explicitRequests),
    commitments: stringArray(value.commitments),
    missingFacts: stringArray(value.missingFacts),
    evidence,
    recommendedResponseBy: nullableString(value.recommendedResponseBy) && Number.isFinite(Date.parse(stringValue(value.recommendedResponseBy))) ? stringValue(value.recommendedResponseBy) : fallback.recommendedResponseBy,
    consequenceOfDelay: nullableString(value.consequenceOfDelay),
    attentionScore: Math.round(boundedNumber(value.attentionScore, fallback.attentionScore, 0, 100)),
    attentionLevel: resolvedAttentionLevel,
    confidence: boundedNumber(value.confidence, fallback.confidence, 0, 1),
    contactName,
    organisationName: organisationFromEmail(latestIncoming.from),
    title: stringValue(value.title, fallback.title),
    whyNow: stringValue(value.whyNow, fallback.whyNow),
    actions,
  };
}

const assessmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "summary", "previousState", "newState", "changes", "explicitRequests", "commitments", "missingFacts", "recommendedResponseBy", "consequenceOfDelay", "attentionScore", "attentionLevel", "confidence", "title", "whyNow", "actions"],
  properties: {
    category: { type: "string" },
    summary: { type: "string" },
    previousState: { type: ["string", "null"] },
    newState: { type: ["string", "null"] },
    changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "evidence"], properties: { type: { type: "string" }, evidence: { type: "string" } } } },
    explicitRequests: { type: "array", items: { type: "string" } },
    commitments: { type: "array", items: { type: "string" } },
    missingFacts: { type: "array", items: { type: "string" } },
    recommendedResponseBy: { type: ["string", "null"] },
    consequenceOfDelay: { type: ["string", "null"] },
    attentionScore: { type: "number" },
    attentionLevel: { type: "string", enum: ["interrupt_now", "top_of_today", "morning_brief", "silent"] },
    confidence: { type: "number" },
    title: { type: "string" },
    whyNow: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "content_json"],
        properties: {
          type: { type: "string", enum: [...ALLOWED_ACTIONS] },
          title: { type: "string" },
          content_json: { type: "string" },
        },
      },
    },
  },
};

function intelligencePrompt(messages: ExecutiveSourceMessage[]) {
  const transcript = [...messages].sort((left, right) => left.internalDate - right.internalDate).map(message => ({
    id: message.id,
    direction: message.mine ? "sent_by_coris" : "received_by_coris",
    from: message.from,
    to: message.to,
    subject: message.subject,
    sent_at: new Date(message.internalDate).toISOString(),
    body: message.body,
  }));
  return `You are the private executive assistant inside Coris Leachman's Command Centre. Read the entire email thread in chronological order before deciding what changed and who owns the next step.

Rules:
- Revenue, client and opportunity movement matters most. Bulk email and promotions are silent.
- The latest message alone is not enough. Resolve proposals, acceptances, commitments, dates, times and ownership from the full thread.
- Do not create a generic reply, task, onboarding document or follow-up when a specific operational next step is already agreed.
- It is valid to return attentionLevel silent and no actions when an email is informational, confirms completion, or does not require Coris to respond. Do not preserve an action just because a rules-based fallback suggested one.
- If a meeting was accepted and Coris was asked to send the invite, use newState meeting_agreed_invite_pending. Prepare a short confirmation reply only if useful and a calendar_proposal only when the exact date and time are grounded in the thread.
- Never invent a date, fee, scope, attendee, commitment or commercial agreement. Put unresolved facts in missingFacts.
- Prepared actions require approval. Do not claim anything has been sent or created.
- content_json must be a valid JSON object encoded as a string. reply_draft uses to, subject and body. calendar_proposal uses event_title, attendee_name, attendee_email, starts_at, ends_at, timezone, duration_minutes and description. document_draft uses title and markdown. task_create uses title, category, priority, estimated_minutes and due_on.
- Use Europe/London for relative dates. Current time: ${new Date().toISOString()}.

Thread:
${JSON.stringify(transcript)}`;
}

export async function assessConversationWithIntelligence(messages: ExecutiveSourceMessage[]): Promise<InterpretedConversation> {
  const fallback = assessConversation(messages);
  if (fallback.category === "noise" || fallback.newState === "waiting_for_reply" || fallback.newState === "meeting_agreed_invite_pending") {
    return { assessment: fallback, model: { provider: "rules", name: "revenue-ea-policy", version: "3" } };
  }
  const apiKey = Deno.env.get("AI_GATEWAY_API_KEY") || "";
  const modelName = Deno.env.get("EXECUTIVE_AGENT_MODEL") || "openai/gpt-5.4";
  if (!apiKey) {
    console.warn("[executive-agent] AI_GATEWAY_API_KEY is not configured; deterministic policy retained", { model: modelName });
    return { assessment: fallback, model: { provider: "rules", name: "revenue-ea-policy", version: "3" } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "Return only the structured executive assessment. Accuracy and grounded next-action ownership are more important than producing many actions." },
          { role: "user", content: intelligencePrompt(messages) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "executive_assessment", strict: true, schema: assessmentSchema } },
      }),
    });
    if (!response.ok) throw new Error(`AI Gateway returned ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("AI Gateway returned no assessment.");
    const assessment = normalizeModelAssessment(JSON.parse(text), messages, fallback);
    return { assessment, model: { provider: "vercel-ai-gateway", name: stringValue(payload.model, modelName), version: "2" } };
  } catch (error) {
    console.error("[executive-agent] model assessment failed; deterministic policy retained", {
      model: modelName,
      detail: error instanceof Error ? error.message : "Unknown model failure",
    });
    return { assessment: fallback, model: { provider: "rules", name: "revenue-ea-policy", version: "3" } };
  } finally {
    clearTimeout(timeout);
  }
}
