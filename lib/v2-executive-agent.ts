import type { SupabaseClient } from "@supabase/supabase-js";

export type ExecutiveAttentionLevel = "interrupt_now" | "top_of_today" | "morning_brief" | "silent";
export type ExecutivePackStatus = "preparing" | "ready_for_review" | "approved" | "executing" | "completed" | "dismissed" | "failed" | "superseded";
export type ExecutiveActionType = "reply_draft" | "document_draft" | "meeting_brief" | "calendar_proposal" | "task_create" | "task_reprioritise" | "opportunity_patch" | "follow_up_schedule" | "metric_entry" | "notification";
export type ExecutiveFeedbackType = "correct_useful" | "important_no_interrupt" | "should_interrupt" | "not_important" | "wrong_interpretation" | "draft_direction";

export type ExecutiveEvidence = {
  label?: string;
  quote?: string;
  source?: string;
};

export type ExecutiveActionItem = {
  id: string;
  actionType: ExecutiveActionType;
  title: string;
  content: Record<string, unknown>;
  contentVersion: number;
  contentHash: string;
  approvalRequired: boolean;
  approvalStatus: "pending" | "approved" | "rejected" | "not_required";
  executionStatus: "not_started" | "queued" | "executing" | "completed" | "failed" | "cancelled";
  position: number;
};

export type ExecutiveActionPack = {
  id: string;
  eventId: string;
  assessmentId: string;
  title: string;
  executiveSummary: string;
  whyNow: string | null;
  status: ExecutivePackStatus;
  attentionLevel: ExecutiveAttentionLevel;
  reviewBy: string | null;
  contactName: string | null;
  organisationName: string | null;
  sourceUrl: string | null;
  missingFacts: string[];
  proposedChanges: Array<Record<string, unknown>>;
  confidence: number;
  readAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  assessment: {
    category: string;
    summary: string;
    previousState: string | null;
    newState: string | null;
    changes: Array<Record<string, unknown>>;
    explicitRequests: string[];
    evidence: ExecutiveEvidence[];
    consequenceOfDelay: string | null;
    attentionScore: number;
  } | null;
  items: ExecutiveActionItem[];
};

export type ExecutiveBriefEntry = {
  pack_id: string;
  title: string;
  summary: string;
  attention_level: ExecutiveAttentionLevel;
  review_by: string | null;
  contact: string | null;
  prepared_items: number;
  pending_approvals: number;
};

export type ExecutiveBrief = {
  id: string;
  briefDate: string;
  title: string;
  generatedAt: string;
  content: {
    commercial_movement: ExecutiveBriefEntry[];
    prepared_work: ExecutiveBriefEntry[];
    can_wait: ExecutiveBriefEntry[];
    suppressed_noise_count: number;
  };
};

type Row = Record<string, unknown>;

function asString(value: unknown) { return typeof value === "string" ? value : ""; }
function asNullableString(value: unknown) { return typeof value === "string" && value ? value : null; }
function asNumber(value: unknown) { return typeof value === "number" ? value : Number(value || 0); }
function asBoolean(value: unknown) { return value === true; }
function asRows(value: unknown) { return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as Row[] : []; }
function asStrings(value: unknown) { return Array.isArray(value) ? value.filter(item => typeof item === "string") as string[] : []; }

function parseItem(row: Row): ExecutiveActionItem {
  return {
    id: asString(row.id),
    actionType: asString(row.action_type) as ExecutiveActionType,
    title: asString(row.title),
    content: row.content && typeof row.content === "object" ? row.content as Record<string, unknown> : {},
    contentVersion: asNumber(row.content_version),
    contentHash: asString(row.content_hash),
    approvalRequired: asBoolean(row.approval_required),
    approvalStatus: asString(row.approval_status) as ExecutiveActionItem["approvalStatus"],
    executionStatus: asString(row.execution_status) as ExecutiveActionItem["executionStatus"],
    position: asNumber(row.position),
  };
}

function parsePack(row: Row): ExecutiveActionPack {
  const assessmentRows = asRows(row.assessment);
  const assessmentRow = assessmentRows[0] ?? (row.assessment && typeof row.assessment === "object" ? row.assessment as Row : null);
  const items = asRows(row.items).map(parseItem).sort((a, b) => a.position - b.position);
  return {
    id: asString(row.id),
    eventId: asString(row.event_id),
    assessmentId: asString(row.assessment_id),
    title: asString(row.title),
    executiveSummary: asString(row.executive_summary),
    whyNow: asNullableString(row.why_now),
    status: asString(row.status) as ExecutivePackStatus,
    attentionLevel: asString(row.attention_level) as ExecutiveAttentionLevel,
    reviewBy: asNullableString(row.review_by),
    contactName: asNullableString(row.contact_name),
    organisationName: asNullableString(row.organisation_name),
    sourceUrl: asNullableString(row.source_url),
    missingFacts: asStrings(row.missing_facts),
    proposedChanges: asRows(row.proposed_changes),
    confidence: asNumber(row.confidence),
    readAt: asNullableString(row.read_at),
    snoozedUntil: asNullableString(row.snoozed_until),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    assessment: assessmentRow ? {
      category: asString(assessmentRow.category),
      summary: asString(assessmentRow.summary),
      previousState: asNullableString(assessmentRow.previous_state),
      newState: asNullableString(assessmentRow.new_state),
      changes: asRows(assessmentRow.changes),
      explicitRequests: asStrings(assessmentRow.explicit_requests),
      evidence: asRows(assessmentRow.evidence).map(item => ({ label: asNullableString(item.label) ?? undefined, quote: asNullableString(item.quote) ?? undefined, source: asNullableString(item.source) ?? undefined })),
      consequenceOfDelay: asNullableString(assessmentRow.consequence_of_delay),
      attentionScore: asNumber(assessmentRow.attention_score),
    } : null,
    items,
  };
}

export async function loadExecutiveActionPacks(
  client: SupabaseClient,
  userId: string,
  options: { limit?: number; includeCompleted?: boolean } = {},
) {
  let query = client
    .from("action_packs")
    .select(`
      id,event_id,assessment_id,title,executive_summary,why_now,status,attention_level,review_by,
      contact_name,organisation_name,source_url,missing_facts,proposed_changes,confidence,
      read_at,snoozed_until,created_at,updated_at,
      assessment:attention_assessments(category,summary,previous_state,new_state,changes,explicit_requests,evidence,consequence_of_delay,attention_score),
      items:action_items(id,action_type,title,content,content_version,content_hash,approval_required,approval_status,execution_status,position)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 20);

  if (!options.includeCompleted) {
    query = query.in("status", ["ready_for_review", "executing", "failed"]);
  }

  const { data, error } = await query;
  if (error) throw error;
  const now = Date.now();
  return (data ?? [])
    .map(row => parsePack(row as Row))
    .filter(pack => !pack.snoozedUntil || new Date(pack.snoozedUntil).getTime() <= now);
}

export async function loadTodaysExecutiveBrief(client: SupabaseClient, userId: string) {
  const briefDate = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const { data, error } = await client.from("executive_briefs").select("id,brief_date,title,content,generated_at").eq("user_id", userId).eq("brief_date", briefDate).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const content = data.content && typeof data.content === "object" ? data.content as Record<string, unknown> : {};
  return {
    id: asString(data.id),
    briefDate: asString(data.brief_date),
    title: asString(data.title),
    generatedAt: asString(data.generated_at),
    content: {
      commercial_movement: asRows(content.commercial_movement) as unknown as ExecutiveBriefEntry[],
      prepared_work: asRows(content.prepared_work) as unknown as ExecutiveBriefEntry[],
      can_wait: asRows(content.can_wait) as unknown as ExecutiveBriefEntry[],
      suppressed_noise_count: asNumber(content.suppressed_noise_count),
    },
  } satisfies ExecutiveBrief;
}

export async function prepareExecutiveThread(client: SupabaseClient, threadId: string) {
  const { data, error } = await client.functions.invoke("executive-agent-api", { body: { action: "prepareThread", threadId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { eventId: string; assessmentId: string; packId: string | null; assessment: { summary: string; attentionLevel: ExecutiveAttentionLevel } };
}

export async function syncExecutiveInbox(client: SupabaseClient, maxResults = 10) {
  const { data, error } = await client.functions.invoke("executive-agent-api", { body: { action: "scanInbox", maxResults } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { checked: number; prepared: number; retained: number };
}

export async function markExecutivePackRead(client: SupabaseClient, userId: string, packId: string) {
  void userId;
  const { error } = await client.rpc("manage_executive_action_pack", { p_action_pack_id: packId, p_action: "read" });
  if (error) throw error;
}

export async function snoozeExecutivePack(client: SupabaseClient, userId: string, packId: string, until: string) {
  void userId;
  const { error } = await client.rpc("manage_executive_action_pack", { p_action_pack_id: packId, p_action: "snooze", p_snoozed_until: until });
  if (error) throw error;
}

export async function dismissExecutivePack(client: SupabaseClient, userId: string, packId: string, reason: string) {
  void userId;
  const { error } = await client.rpc("manage_executive_action_pack", { p_action_pack_id: packId, p_action: "dismiss", p_reason: reason });
  if (error) throw error;
}

export async function approveExecutiveActionItem(client: SupabaseClient, item: ExecutiveActionItem, amendments: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc("approve_executive_action_item", {
    p_action_item_id: item.id,
    p_content_hash: item.contentHash,
    p_amendments: amendments,
  });
  if (error) throw error;
  return data;
}

export async function submitExecutiveFeedback(
  client: SupabaseClient,
  userId: string,
  pack: ExecutiveActionPack,
  feedbackType: ExecutiveFeedbackType,
  note = "",
) {
  const { error } = await client.from("executive_feedback").insert({
    user_id: userId,
    action_pack_id: pack.id,
    assessment_id: pack.assessmentId,
    feedback_type: feedbackType,
    note: note.trim() || null,
  });
  if (error) throw error;
}

export function attentionLabel(level: ExecutiveAttentionLevel) {
  if (level === "interrupt_now") return "Needs attention now";
  if (level === "top_of_today") return "Act today";
  if (level === "morning_brief") return "Morning brief";
  return "Recorded quietly";
}

export function actionTypeLabel(type: ExecutiveActionType) {
  const labels: Record<ExecutiveActionType, string> = {
    reply_draft: "Reply drafted",
    document_draft: "Document prepared",
    meeting_brief: "Meeting brief prepared",
    calendar_proposal: "Calendar proposal",
    task_create: "Task proposed",
    task_reprioritise: "Priority change proposed",
    opportunity_patch: "Opportunity update proposed",
    follow_up_schedule: "Follow-up prepared",
    metric_entry: "Metric update proposed",
    notification: "Notification",
  };
  return labels[type];
}

export function executiveAgentUnavailable(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error || "");
  return code === "42P01" || code === "PGRST202" || code === "PGRST205" || /action_packs|seed_executive_agent_rules|schema cache/i.test(message);
}
