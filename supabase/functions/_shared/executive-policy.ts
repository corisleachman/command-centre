export type ExecutiveSourceMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  internalDate: number;
  mine: boolean;
  automated?: boolean;
  gmailLabels?: string[];
};

export type ExecutiveAssessment = {
  category: string;
  summary: string;
  previousState: string | null;
  newState: string | null;
  changes: Array<{ type: string; evidence: string }>;
  explicitRequests: string[];
  commitments: string[];
  missingFacts: string[];
  evidence: Array<{ label: string; quote: string; source: string }>;
  recommendedResponseBy: string | null;
  consequenceOfDelay: string | null;
  attentionScore: number;
  attentionLevel: "interrupt_now" | "top_of_today" | "morning_brief" | "silent";
  confidence: number;
  contactName: string;
  organisationName: string;
  title: string;
  whyNow: string;
  actions: Array<{
    type: "reply_draft" | "document_draft" | "task_create" | "task_reprioritise" | "opportunity_patch" | "follow_up_schedule";
    title: string;
    content: Record<string, unknown>;
    position: number;
  }>;
};

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function cleanSubject(value: string) { return value.replace(/^(re|fw|fwd):\s*/i, "").trim(); }
function emailAddress(value: string) { return value.match(/<([^>]+)>/)?.[1]?.trim() || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || value.trim(); }
function senderName(value: string) { return value.replace(/<[^>]+>/g, "").replace(/^\"|\"$/g, "").trim() || emailAddress(value).split("@")[0] || "the sender"; }
function firstName(value: string) { return senderName(value).split(/\s+/)[0] || "there"; }
function organisationFromEmail(value: string) {
  const domain = emailAddress(value).split("@")[1]?.toLowerCase() || "";
  if (!domain || /gmail|outlook|hotmail|icloud|yahoo|protonmail/.test(domain)) return "";
  const label = domain.split(".")[0].replace(/[-_]+/g, " ");
  return label.replace(/\b\w/g, character => character.toUpperCase());
}
function excerpt(value: string, limit = 220) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1).trim()}…`;
}
function nextWorkingResponse() {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
  }
  return date.toISOString();
}

function discoveryDocument(organisation: string) {
  const company = organisation || "the business";
  return `# ${company}: discovery and onboarding requirements

## Positioning and offer

- Current positioning or proposition documents
- Service and offer descriptions, including indicative pricing
- Website copy, credentials deck and recent pitch materials
- The clearest examples of work that demonstrate meaningful difference
- Known objections or points of confusion from recent prospect conversations

## Ideal customers and market

- Current view of the ideal customer profile
- Existing client list and the types of work each client buys
- Priority sectors, company sizes, locations and buyer roles
- Competitors or alternatives prospects commonly compare against

## Pipeline and previous activity

- Current prospect and opportunity list
- CRM or pipeline access, if available
- Recent outreach messages, follow-ups and responses
- Historic activity and conversion data, even if incomplete
- Referral sources and relationships currently producing opportunities

## Team and delivery

- Who owns new business, marketing, sales and delivery
- Who should join discovery interviews
- Current capacity to respond to opportunities and deliver new work
- Any fixed dates, revenue pressures or market commitments

## First working session

We will use the opening session to agree the initial benchmark, sharpen what ${company} is selling, define who it is for and articulate why it is meaningfully different. Outreach volume should increase only after these foundations are clear enough to test consistently.`;
}

export function assessConversation(messages: ExecutiveSourceMessage[]): ExecutiveAssessment {
  const sorted = [...messages].sort((a, b) => a.internalDate - b.internalDate);
  const latest = sorted[sorted.length - 1];
  const latestIncoming = [...sorted].reverse().find(message => !message.mine) ?? latest;
  const responseAlreadySent = Boolean(latest?.mine);
  const incomingText = `${latestIncoming?.subject || ""}\n${latestIncoming?.body || ""}`.trim();
  const threadText = sorted.map(message => `${message.subject} ${message.body}`).join(" ").toLowerCase();
  const lower = incomingText.toLowerCase();
  const from = latestIncoming?.from || "";
  const contact = senderName(from);
  const first = firstName(from);
  const organisation = organisationFromEmail(from);
  const subject = cleanSubject(latestIncoming?.subject || "the conversation");
  const marketingFooterSignals = [
    /\bsubscribe(?: here| now)?\b/i,
    /\b(?:hire|book) us to speak|speaking engagements?\b/i,
    /\bpartner with us\b/i,
    /\bmanage (?:your )?(?:email )?(?:preferences|subscription)\b/i,
    /\bprivacy policy\b/i,
  ].filter(pattern => pattern.test(lower)).length;
  const automated = Boolean(latestIncoming?.automated)
    || latestIncoming?.gmailLabels?.includes("CATEGORY_PROMOTIONS") === true
    || /no[-_. ]?reply|newsletter|notifications?@|mailer-daemon/i.test(from)
    || /unsubscribe|view (?:this email )?in (?:your )?browser|email preferences/i.test(lower)
    || marketingFooterSignals >= 2;
  const revenue = /\b(proposal|scope|fee|budget|contract|engagement|discovery|positioning|messaging|pipeline|new business|outreach|kick[ -]?off|onboard|get started|move forward|proceed)\b/i.test(threadText);
  const explicitRequest = !automated && !responseAlreadySent && /\?|\b(can you|could you|would you|please|let me know|what do you need|send|share|confirm|review)\b/i.test(incomingText);
  const positive = !automated && !responseAlreadySent && /\b(keen to (continue|move forward|proceed)|move forward|proceed|get started|sounds good|looks good|agree|happy to|exactly what|really like|incredibly helpful|yes[, .]|go ahead)\b/i.test(lower);
  const onboardingSignal = !automated && !responseAlreadySent && /\b(get started|kick[ -]?off|onboard|what do you need from me|next steps?)\b/i.test(lower);
  const negative = !automated && !responseAlreadySent && /\b(not proceeding|not moving forward|pass on this|decline|not right now|unfortunately|no budget|won't be able)\b/i.test(lower);
  const positioningFocus = !automated && !responseAlreadySent && /\b(positioning|messaging|what we(?:'re| are) selling|who(?:m)? we(?:'re| are) selling|meaningfully different|proposition)\b/i.test(lower);
  const relationship = sorted.length >= 3;

  let score = 0;
  if (revenue) score += 25;
  if (positive || negative) score += 25;
  if (explicitRequest) score += 15;
  if (!automated && (explicitRequest || positive || negative)) score += 15;
  if (revenue && (positive || negative || explicitRequest)) score += 10;
  if (relationship) score += 10;
  if (automated) score -= 50;
  if (!explicitRequest && !positive && !negative) score -= 20;
  score = clamp(score, 0, 100);

  const confidence = automated ? .94 : onboardingSignal && revenue ? .96 : revenue && explicitRequest ? .86 : revenue ? .73 : .65;
  const attentionLevel = automated ? "silent" : score >= 80 && confidence >= .75 ? "interrupt_now" : score >= 60 ? "top_of_today" : score >= 35 ? "morning_brief" : "silent";
  const previousState = automated ? "automated_message" : /\bproposal|scope|recommendation|approach\b/i.test(threadText) ? "proposal_discussion" : "active_conversation";
  const newState = automated ? "filtered_as_noise" : responseAlreadySent ? "waiting_for_reply" : negative ? "at_risk_or_declined" : onboardingSignal && positive ? "positive_intent_pending_onboarding" : positive ? "positive_movement" : explicitRequest ? "response_required" : previousState;
  const changes: Array<{ type: string; evidence: string }> = [];
  if (positive) changes.push({ type: "buying_signal", evidence: excerpt(latestIncoming?.body || incomingText) });
  if (onboardingSignal) changes.push({ type: "onboarding_signal", evidence: excerpt(latestIncoming?.body || incomingText) });
  if (positioningFocus) changes.push({ type: "discovery_priority", evidence: "Positioning and messaging have been elevated as a focus before increasing outreach volume." });
  if (negative) changes.push({ type: "commercial_risk", evidence: excerpt(latestIncoming?.body || incomingText) });

  const explicitRequests = explicitRequest ? [onboardingSignal ? "Explain what is needed to get started" : "Reply to the sender's request"] : [];
  const missingFacts = onboardingSignal ? ["Confirmed fee", "Engagement length", "Preferred kickoff date"] : [];
  const summary = automated
    ? `${contact} was identified as an automated or bulk email and filtered from review.`
    : responseAlreadySent
    ? `You have already sent the latest message to ${contact}. There is no new change to interrupt you about.`
    : negative
    ? `${contact} has replied with a negative commercial signal. Review the reason and decide whether to close, clarify or nurture the opportunity.`
    : onboardingSignal
      ? `${contact} appears ready to move forward and has asked what is needed to get started${positioningFocus ? ". Positioning and messaging should lead the discovery phase" : ""}.`
      : positive
        ? `${contact} has replied positively. The conversation has moved forward and needs a clear next step.`
        : explicitRequest
          ? `${contact} has asked for a response connected to active work.`
          : `${contact} sent an update that can wait for the next briefing.`;

  const whyNow = attentionLevel === "interrupt_now"
    ? "Reply today while the conversation has momentum. The system has prepared the reversible work and left commercial commitments for your approval."
    : attentionLevel === "top_of_today"
      ? "This deserves action today, but it does not need to displace what you are doing this minute."
      : "This can wait for the next planned review.";

  const actions: ExecutiveAssessment["actions"] = [];
  if (!negative && (explicitRequest || positive)) {
    const positioningParagraph = positioningFocus
      ? `I agree that positioning and messaging should be the first workstream in discovery. There is little value in pushing more volume through the system until we are confident about what ${organisation || "the business"} is selling, who it is for and why it is meaningfully different.`
      : "That sounds good. I am happy to take the next step and make sure the opening discovery work gives us a clear foundation.";
    const blockerLine = missingFacts.length
      ? "Before I send the final start plan, I will also confirm the commercial details and proposed kickoff date so everything is clear on both sides."
      : "I will include the proposed kickoff and immediate next steps so everything is clear on both sides.";
    actions.push({
      type: "reply_draft",
      title: `Reply to ${contact}`,
      position: 1,
      content: {
        to: emailAddress(from),
        subject: `Re: ${subject}`,
        body: `Hi ${first},\n\nGreat to hear, and I agree. ${positioningParagraph}\n\nI have pulled together a short discovery and onboarding checklist covering the materials and access I will need. Once those are in place, we can confirm the kickoff session, establish the initial benchmark and work through the foundations before increasing outreach.\n\n${blockerLine}\n\nBest,\nCoris`,
      },
    });
  }
  if (onboardingSignal) actions.push({ type: "document_draft", title: "Initial discovery and onboarding requirements", position: 2, content: { title: `${organisation || contact}: discovery and onboarding requirements`, markdown: discoveryDocument(organisation) } });
  if (attentionLevel === "interrupt_now" || attentionLevel === "top_of_today") actions.push({ type: "task_create", title: `Review and respond to ${contact}`, position: 3, content: { title: `Review prepared response to ${contact}`, category: "cash", priority: 5, estimated_minutes: 30, due_on: new Date().toISOString().slice(0, 10), revenue_proximity: "immediate" } });
  if (positive && revenue) actions.push({ type: "opportunity_patch", title: "Update commercial opportunity", position: 4, content: { previous_state: previousState, proposed_state: newState, mark_won: false, reason: "Positive movement detected; formal agreement is not yet evidenced." } });
  if (!negative && (explicitRequest || positive)) actions.push({ type: "follow_up_schedule", title: "Prepare follow-up trigger", position: 5, content: { activate_after: "reply_sent", wait_days: 3, reason: "Preserve momentum if there is no response after the approved reply." } });

  return {
    category: automated ? "noise" : revenue ? "revenue_opportunity" : "relationship_update",
    summary,
    previousState,
    newState,
    changes,
    explicitRequests,
    commitments: [],
    missingFacts,
    evidence: latestIncoming ? [{ label: "Latest incoming message", quote: excerpt(latestIncoming.body || incomingText), source: latestIncoming.id }] : [],
    recommendedResponseBy: attentionLevel === "interrupt_now" || attentionLevel === "top_of_today" ? nextWorkingResponse() : null,
    consequenceOfDelay: revenue && (positive || explicitRequest) ? "The opportunity could lose momentum if the response waits." : null,
    attentionScore: score,
    attentionLevel,
    confidence,
    contactName: contact,
    organisationName: organisation,
    title: automated ? `${contact} was filtered as automated email` : responseAlreadySent ? `Waiting for ${contact}` : onboardingSignal ? `${contact} appears ready to get started` : negative ? `${contact} has sent a commercial risk signal` : `${contact} needs a response`,
    whyNow,
    actions,
  };
}
