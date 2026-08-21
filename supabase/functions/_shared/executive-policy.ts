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
    type: "reply_draft" | "document_draft" | "calendar_proposal" | "task_create" | "task_reprioritise" | "opportunity_patch" | "follow_up_schedule";
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

type SchedulingAgreement = {
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  whenLabel: string | null;
  durationMinutes: number;
  replyLine: string;
  proposalEvidence: string;
  acceptanceEvidence: string;
};

const LONDON_TIMEZONE = "Europe/London";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function localDateParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday").toLowerCase(),
  };
}

function timezoneOffsetMinutes(timestamp: number, timezone: string) {
  const part = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(timestamp)).find(item => item.type === "timeZoneName")?.value || "GMT";
  const match = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function zonedIso(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const intendedUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = timezoneOffsetMinutes(intendedUtc, timezone);
  const candidate = intendedUtc - firstOffset * 60_000;
  const correctedOffset = timezoneOffsetMinutes(candidate, timezone);
  return new Date(intendedUtc - correctedOffset * 60_000).toISOString();
}

function proposedTime(value: string) {
  const match = value.match(/\b(\d{1,2})(?:[:.]([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = (match[3] || "").toLowerCase().replace(/[^apm]/g, "");
  if (!meridiem && hour > 23) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return { hour, minute };
}

function explicitCalendarDate(value: string, referenceTimestamp: number) {
  const dayFirst = value.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)?\s*(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/i);
  const monthFirst = value.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  const match = dayFirst || monthFirst;
  if (!match) return null;
  const day = Number(dayFirst ? match[1] : match[2]);
  const monthName = String(dayFirst ? match[2] : match[1]).toLowerCase();
  const suppliedYear = dayFirst ? match[3] : match[3];
  const reference = localDateParts(referenceTimestamp, LONDON_TIMEZONE);
  let year = suppliedYear ? Number(suppliedYear) : reference.year;
  const month = MONTHS.indexOf(monthName) + 1;
  if (!month || day < 1 || day > 31) return null;
  if (!suppliedYear && Date.UTC(year, month - 1, day) < Date.UTC(reference.year, reference.month - 1, reference.day) - 86_400_000) year += 1;
  return { year, month, day };
}

function weekdayCalendarDate(value: string, referenceTimestamp: number, time: { hour: number; minute: number }) {
  const dayName = WEEKDAYS.find(day => new RegExp(`\\b${day}\\b`, "i").test(value));
  if (!dayName) return null;
  const reference = localDateParts(referenceTimestamp, LONDON_TIMEZONE);
  const referenceDay = WEEKDAYS.indexOf(reference.weekday);
  const targetDay = WEEKDAYS.indexOf(dayName);
  let daysAhead = (targetDay - referenceDay + 7) % 7;
  const referenceMoment = new Date(referenceTimestamp);
  if (daysAhead === 0 && time.hour * 60 + time.minute <= referenceMoment.getUTCHours() * 60 + referenceMoment.getUTCMinutes()) daysAhead = 7;
  const target = new Date(Date.UTC(reference.year, reference.month - 1, reference.day + daysAhead));
  return { year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() };
}

function shortTime(time: { hour: number; minute: number }) {
  const hour = time.hour % 12 || 12;
  const minute = time.minute ? `:${String(time.minute).padStart(2, "0")}` : "";
  return `${hour}${minute}${time.hour >= 12 ? "pm" : "am"}`;
}

function meetingDuration(messages: ExecutiveSourceMessage[]) {
  for (const message of [...messages].reverse()) {
    const range = message.body.match(/\b(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*(?:minutes?|mins?)\b/i);
    if (range) return clamp(Number(range[2]), 10, 180);
    const single = message.body.match(/\b(\d{1,3})\s*(?:minutes?|mins?)\b/i);
    if (single) return clamp(Number(single[1]), 10, 180);
  }
  return 30;
}

function schedulingAgreement(
  messages: ExecutiveSourceMessage[],
  latestIncoming: ExecutiveSourceMessage | undefined,
  responseAlreadySent: boolean,
  automated: boolean,
): SchedulingAgreement | null {
  if (!latestIncoming || responseAlreadySent || automated) return null;
  const acceptance = /\b(?:yes|yeah|yep|sure|perfect|agreed|works for me|that works|sounds good|let(?:'|’)s do it)\b/i.test(latestIncoming.body);
  const inviteRequest = /\b(?:send|put|pop|create|share)\b.{0,45}\b(?:calendar\s+)?invite\b|\b(?:calendar\s+)?invite\b.{0,45}\b(?:send|create|share)\b|\bfeel free to share\b/i.test(latestIncoming.body);
  const latestTime = proposedTime(latestIncoming.body);
  const meetingProposal = Boolean(latestTime) && /\b(?:call|chat|meeting|talk|reconvene)\b/i.test(latestIncoming.body);
  if (!inviteRequest || (!acceptance && !meetingProposal)) return null;

  const ordered = [...messages].sort((left, right) => left.internalDate - right.internalDate);
  const timeSource = latestTime ? latestIncoming : [...ordered].reverse().find(message => Boolean(proposedTime(message.body)));
  const time = timeSource ? proposedTime(timeSource.body) : null;
  if (!time) {
    return {
      startsAt: null,
      endsAt: null,
      timezone: LONDON_TIMEZONE,
      whenLabel: null,
      durationMinutes: meetingDuration(messages),
      replyLine: "Yes, let's do it. Send me the time that works for you and I will get the invite across.",
      proposalEvidence: "A call was agreed, but no exact time could be read safely from the conversation.",
      acceptanceEvidence: excerpt(latestIncoming.body),
    };
  }
  const absoluteDateSource = [...ordered].reverse().find(message => Boolean(explicitCalendarDate(message.body, message.internalDate)));
  const weekdaySource = [...ordered].reverse().find(message => WEEKDAYS.some(day => new RegExp(`\\b${day}\\b`, "i").test(message.body)));
  const dateSource = absoluteDateSource || weekdaySource;
  if (!dateSource) {
    return {
      startsAt: null,
      endsAt: null,
      timezone: LONDON_TIMEZONE,
      whenLabel: null,
      durationMinutes: meetingDuration(messages),
      replyLine: acceptance ? "No problem. Invite on its way." : `${shortTime(time)} works for me. I will send the invite once the date is confirmed.`,
      proposalEvidence: "A call was proposed earlier in the conversation, but its date or time could not be read safely.",
      acceptanceEvidence: excerpt(latestIncoming.body),
    };
  }
  const date = explicitCalendarDate(dateSource.body, dateSource.internalDate) || weekdayCalendarDate(dateSource.body, dateSource.internalDate, time);
  if (!date) return null;
  const startsAt = zonedIso(date.year, date.month, date.day, time.hour, time.minute, LONDON_TIMEZONE);
  const durationMinutes = meetingDuration(messages);
  const endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
  const whenLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startsAt));
  return {
    startsAt,
    endsAt,
    timezone: LONDON_TIMEZONE,
    whenLabel,
    durationMinutes,
    replyLine: acceptance ? "No problem. Invite on its way." : `${shortTime(time)} works for me. Invite on its way.`,
    proposalEvidence: excerpt(dateSource.id === timeSource?.id ? dateSource.body : `${dateSource.body} ${timeSource?.body || ""}`),
    acceptanceEvidence: excerpt(latestIncoming.body),
  };
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
  const informationalCompletion = !automated && !responseAlreadySent
    && /\b(?:application|account|registration) (?:was|has been|is now) approved\b|\bwelcome to (?:our|the) (?:affiliate|partner) community\b/i.test(lower)
    && !/\?/.test(latestIncoming?.body || "");
  const meetingRequest = !automated && !responseAlreadySent && !onboardingSignal
    && /\b(?:shall we|could we|can we|let(?:'|’)s|book|arrange|schedule|have)\b.{0,55}\b(?:\d{1,3}\s*(?:minutes?|mins?)|call|chat|meeting)\b|\b(?:call|chat|meeting)\b.{0,55}\b(?:book|arrange|schedule|get .* in)\b/i.test(lower);
  const requestedMeetingMinutes = Number(lower.match(/\b(\d{1,3})\s*(?:minutes?|mins?)\b/i)?.[1] || 0);
  const associatePartnerDiscussion = /\bassociate partner\b/i.test(threadText);
  const pilotDiscussion = /\bpilot\b/i.test(incomingText);
  const negative = !automated && !responseAlreadySent && /\b(not proceeding|not moving forward|pass on this|decline|not right now|unfortunately|no budget|won't be able)\b/i.test(lower);
  const positioningFocus = !automated && !responseAlreadySent && /\b(positioning|messaging|what we(?:'re| are) selling|who(?:m)? we(?:'re| are) selling|meaningfully different|proposition)\b/i.test(lower);
  const relationship = sorted.length >= 3;
  const scheduling = schedulingAgreement(sorted, latestIncoming, responseAlreadySent, automated);

  let score = 0;
  if (revenue) score += 25;
  if (positive || negative) score += 25;
  if (explicitRequest) score += 15;
  if (!automated && (explicitRequest || positive || negative)) score += 15;
  if (revenue && (positive || negative || explicitRequest)) score += 10;
  if (relationship) score += 10;
  if (scheduling) score = Math.max(score, scheduling.startsAt ? 90 : 78);
  if (meetingRequest && revenue) score = Math.max(score, 75);
  if (informationalCompletion) score = Math.min(score, 20);
  if (automated) score -= 50;
  if (!explicitRequest && !positive && !negative) score -= 20;
  score = clamp(score, 0, 100);

  const confidence = automated || informationalCompletion ? .94 : scheduling?.startsAt ? .98 : scheduling ? .84 : meetingRequest && revenue ? .9 : onboardingSignal && revenue ? .96 : revenue && explicitRequest ? .86 : revenue ? .73 : .65;
  const attentionLevel = automated || informationalCompletion ? "silent" : score >= 80 && confidence >= .75 ? "interrupt_now" : score >= 60 ? "top_of_today" : score >= 35 ? "morning_brief" : "silent";
  const previousState = automated ? "automated_message" : /\bproposal|scope|recommendation|approach\b/i.test(threadText) ? "proposal_discussion" : "active_conversation";
  const newState = automated ? "filtered_as_noise" : responseAlreadySent ? "waiting_for_reply" : informationalCompletion ? "completed_no_response_required" : scheduling ? "meeting_agreed_invite_pending" : meetingRequest ? "meeting_requested_time_pending" : negative ? "at_risk_or_declined" : onboardingSignal && positive ? "positive_intent_pending_onboarding" : positive ? "positive_movement" : explicitRequest ? "response_required" : previousState;
  const changes: Array<{ type: string; evidence: string }> = [];
  if (positive) changes.push({ type: "buying_signal", evidence: excerpt(latestIncoming?.body || incomingText) });
  if (onboardingSignal) changes.push({ type: "onboarding_signal", evidence: excerpt(latestIncoming?.body || incomingText) });
  if (positioningFocus) changes.push({ type: "discovery_priority", evidence: "Positioning and messaging have been elevated as a focus before increasing outreach volume." });
  if (negative) changes.push({ type: "commercial_risk", evidence: excerpt(latestIncoming?.body || incomingText) });
  if (scheduling) changes.push({ type: "meeting_agreed", evidence: scheduling.acceptanceEvidence });

  const explicitRequests = scheduling ? ["Confirm the proposed time and send the calendar invitation"] : meetingRequest ? [`Arrange the requested ${requestedMeetingMinutes || 30}-minute conversation`] : explicitRequest ? [onboardingSignal ? "Explain what is needed to get started" : "Reply to the sender's request"] : [];
  const missingFacts = scheduling ? (scheduling.startsAt ? [] : ["Confirmed meeting date and time"]) : meetingRequest ? ["A suitable meeting time"] : onboardingSignal ? ["Confirmed fee", "Engagement length", "Preferred kickoff date"] : [];
  const summary = automated
    ? `${contact} was identified as an automated or bulk email and filtered from review.`
    : responseAlreadySent
    ? `You have already sent the latest message to ${contact}. There is no new change to interrupt you about.`
    : informationalCompletion
    ? `${contact} confirmed that the application is approved. No reply is required.`
    : scheduling
    ? `${contact} confirmed the call details${scheduling.whenLabel ? ` for ${scheduling.whenLabel}` : ""} and said you can send the invitation. The diary invite is now the next action.`
    : meetingRequest
    ? `${contact} wants to arrange a ${requestedMeetingMinutes || 30}-minute conversation${associatePartnerDiscussion ? " about the Associate Partner opportunity" : pilotDiscussion ? " about a possible pilot" : ""}. A meeting time is the next decision.`
    : negative
    ? `${contact} has replied with a negative commercial signal. Review the reason and decide whether to close, clarify or nurture the opportunity.`
    : onboardingSignal
      ? `${contact} appears ready to move forward and has asked what is needed to get started${positioningFocus ? ". Positioning and messaging should lead the discovery phase" : ""}.`
      : positive
        ? `${contact} has replied positively. The conversation has moved forward and needs a clear next step.`
        : explicitRequest
          ? `${contact} has asked for a response connected to active work.`
          : `${contact} sent an update that can wait for the next briefing.`;

  const whyNow = scheduling
    ? scheduling.startsAt
      ? "The meeting is agreed. Create the invitation today so the commitment is in both diaries while the conversation is current."
      : "The meeting is agreed, but the date or time needs your judgement before an invitation can be prepared."
    : meetingRequest
      ? "This is a live commercial conversation. Reply today, confirm your interest and move directly to choosing a meeting time."
    : attentionLevel === "interrupt_now"
    ? "Reply today while the conversation has momentum. The system has prepared the reversible work and left commercial commitments for your approval."
    : attentionLevel === "top_of_today"
      ? "This deserves action today, but it does not need to displace what you are doing this minute."
      : "This can wait for the next planned review.";

  const actions: ExecutiveAssessment["actions"] = [];
  if (scheduling) {
    actions.push({
      type: "reply_draft",
      title: `Confirm the invite to ${contact}`,
      position: 1,
      content: {
        to: emailAddress(from),
        subject: `Re: ${subject}`,
        body: `Hi ${first},\n\n${scheduling.replyLine}\n\nBest,\nCoris`,
      },
    });
    if (scheduling.startsAt && scheduling.endsAt) {
      actions.push({
        type: "calendar_proposal",
        title: `Create diary invite for ${contact}`,
        position: 2,
        content: {
          event_title: `${subject} with ${contact}`,
          attendee_name: contact,
          attendee_email: emailAddress(from),
          starts_at: scheduling.startsAt,
          ends_at: scheduling.endsAt,
          timezone: scheduling.timezone,
          duration_minutes: scheduling.durationMinutes,
          description: `Agreed by email. ${contact} accepted the proposed call and asked Coris to send the invitation.`,
        },
      });
    }
  } else if (meetingRequest) {
    const discussion = associatePartnerDiscussion
      ? `the Associate Partner model${pilotDiscussion ? ", what a pilot could look like and where I would focus" : ""}`
      : pilotDiscussion
        ? "what a pilot could look like"
        : "the opportunity";
    actions.push({
      type: "reply_draft",
      title: `Arrange the call with ${contact}`,
      position: 1,
      content: {
        to: emailAddress(from),
        subject: `Re: ${subject}`,
        body: `Hi ${first},\n\nThanks for picking this back up. Yes, I am still interested and I would be happy to get ${requestedMeetingMinutes || 30} minutes in to talk through ${discussion}.\n\nSend over a few times that work for you and I will get something in the diary.\n\nBest,\nCoris`,
      },
    });
  } else if (!negative && onboardingSignal) {
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
  if (!scheduling && onboardingSignal) actions.push({ type: "document_draft", title: "Initial discovery and onboarding requirements", position: 2, content: { title: `${organisation || contact}: discovery and onboarding requirements`, markdown: discoveryDocument(organisation) } });
  const hasPreparedReply = actions.some(action => action.type === "reply_draft");
  if (!scheduling && !hasPreparedReply && !informationalCompletion && (attentionLevel === "interrupt_now" || attentionLevel === "top_of_today")) actions.push({ type: "task_create", title: `Review and respond to ${contact}`, position: 3, content: { title: `Review ${subject} and decide the response`, category: "cash", priority: 5, estimated_minutes: 30, due_on: new Date().toISOString().slice(0, 10), revenue_proximity: "immediate" } });
  if (!scheduling && positive && revenue) actions.push({ type: "opportunity_patch", title: "Update commercial opportunity", position: 4, content: { previous_state: previousState, proposed_state: newState, mark_won: false, reason: "Positive movement detected; formal agreement is not yet evidenced." } });
  if (!scheduling && !negative && hasPreparedReply) actions.push({ type: "follow_up_schedule", title: "Prepare follow-up trigger", position: 5, content: { activate_after: "reply_sent", wait_days: 3, reason: "Preserve momentum if there is no response after the approved reply." } });

  return {
    category: automated ? "noise" : revenue ? "revenue_opportunity" : "relationship_update",
    summary,
    previousState,
    newState,
    changes,
    explicitRequests,
    commitments: scheduling ? [
      `Coris proposed the call: ${scheduling.proposalEvidence}`,
      `${contact} accepted the proposal: ${scheduling.acceptanceEvidence}`,
      `Coris owns the next step: send the calendar invitation${scheduling.whenLabel ? ` for ${scheduling.whenLabel}` : ""}.`,
    ] : [],
    missingFacts,
    evidence: latestIncoming ? [{ label: "Latest incoming message", quote: excerpt(latestIncoming.body || incomingText), source: latestIncoming.id }] : [],
    recommendedResponseBy: attentionLevel === "interrupt_now" || attentionLevel === "top_of_today" ? nextWorkingResponse() : null,
    consequenceOfDelay: revenue && (positive || explicitRequest) ? "The opportunity could lose momentum if the response waits." : null,
    attentionScore: score,
    attentionLevel,
    confidence,
    contactName: contact,
    organisationName: organisation,
    title: automated ? `${contact} was filtered as automated email` : responseAlreadySent ? `Waiting for ${contact}` : informationalCompletion ? `${contact} confirmed approval` : scheduling ? `${contact} confirmed the call. Invite ready` : meetingRequest ? `${contact} wants to arrange a call` : onboardingSignal ? `${contact} appears ready to get started` : negative ? `${contact} has sent a commercial risk signal` : `${contact} needs a response`,
    whyNow,
    actions,
  };
}
