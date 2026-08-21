import { assessConversation, type ExecutiveSourceMessage } from "./executive-policy.ts";
import { reconcileAssessmentWithCalendar, type ExecutiveCalendarContext } from "./executive-intelligence.ts";

const now = Date.now();

Deno.test("James Carroll message becomes a high-confidence onboarding action pack", () => {
  const messages: ExecutiveSourceMessage[] = [
    {
      id: "sent-proposal",
      threadId: "james-thread",
      from: "Coris <coris@example.com>",
      to: "James Carroll <james@before.work>",
      subject: "Before:Work new business support",
      body: "The proposal covers discovery, positioning, messaging and the first 90-day benchmark.",
      date: new Date(now - 86_400_000).toUTCString(),
      internalDate: now - 86_400_000,
      mine: true,
    },
    {
      id: "james-reply",
      threadId: "james-thread",
      from: "James Carroll <james@before.work>",
      to: "Coris <coris@example.com>",
      subject: "Re: Before:Work new business support",
      body: "This is incredibly helpful. I really like establishing the benchmark during discovery and resetting targets after 90 days. I want positioning and messaging to be a real focus before we push significant volume. What do you need from me to get started?",
      date: new Date(now).toUTCString(),
      internalDate: now,
      mine: false,
    },
  ];

  const result = assessConversation(messages);
  if (result.category !== "revenue_opportunity") throw new Error(`Unexpected category: ${result.category}`);
  if (result.newState !== "positive_intent_pending_onboarding") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.attentionLevel !== "interrupt_now") throw new Error(`Unexpected attention: ${result.attentionLevel}`);
  if (result.attentionScore < 80) throw new Error(`Score too low: ${result.attentionScore}`);
  if (!result.actions.some(action => action.type === "reply_draft")) throw new Error("Reply draft not prepared");
  if (!result.actions.some(action => action.type === "document_draft")) throw new Error("Discovery document not prepared");
  if (!result.actions.some(action => action.type === "opportunity_patch" && action.content.mark_won === false)) throw new Error("Safe opportunity update not prepared");
  if (!result.missingFacts.includes("Confirmed fee")) throw new Error("Commercial blocker not surfaced");
});

Deno.test("newsletter is suppressed as noise", () => {
  const result = assessConversation([{
    id: "newsletter",
    threadId: "newsletter-thread",
    from: "Newsletter <notifications@example.com>",
    to: "coris@example.com",
    subject: "This week's news",
    body: "View in browser. Here are this week's stories. Unsubscribe at any time.",
    date: new Date(now).toUTCString(),
    internalDate: now,
    mine: false,
  }]);
  if (result.attentionLevel !== "silent") throw new Error(`Newsletter should be silent, got ${result.attentionLevel}`);
  if (result.actions.length) throw new Error("Newsletter should not prepare actions");
});

Deno.test("Everyday AI marketing copy cannot impersonate a commercial conversation", () => {
  const result = assessConversation([{
    id: "everyday-ai-newsletter",
    threadId: "everyday-ai-thread",
    from: "Everyday AI <info@youreverydayai.com>",
    to: "coris@example.com",
    subject: "Re: New: Google Gemini adds more connectors",
    body: "Get started with the latest AI tools. Want help with your engagement? Subscribe Here. Hire Us To Speak. Partner with Us.",
    date: new Date(now).toUTCString(),
    internalDate: now,
    mine: false,
    gmailLabels: ["INBOX", "CATEGORY_PRIMARY"],
  }]);

  if (result.category !== "noise") throw new Error(`Newsletter should be noise, got ${result.category}`);
  if (result.attentionLevel !== "silent") throw new Error(`Newsletter should be silent, got ${result.attentionLevel}`);
  if (result.newState !== "filtered_as_noise") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.actions.length) throw new Error("Newsletter should not prepare reply, document, task or follow-up actions");
});

Deno.test("Gmail bulk headers are a hard stop even when copy contains buying signals", () => {
  const result = assessConversation([{
    id: "bulk-message",
    threadId: "bulk-thread",
    from: "AI Update <info@example.com>",
    to: "coris@example.com",
    subject: "Ready to move forward?",
    body: "This is incredibly helpful. What do you need from me to get started?",
    date: new Date(now).toUTCString(),
    internalDate: now,
    mine: false,
    automated: true,
  }]);

  if (result.attentionLevel !== "silent") throw new Error(`Bulk message should be silent, got ${result.attentionLevel}`);
  if (result.actions.length) throw new Error("Bulk message should never prepare actions");
});

Deno.test("an outbound reply moves the thread to waiting without another interruption", () => {
  const result = assessConversation([
    {
      id: "incoming-request",
      threadId: "active-thread",
      from: "Prospect <prospect@example.com>",
      to: "coris@example.com",
      subject: "Re: Proposal and next steps",
      body: "The proposal looks good. What do you need from me to get started?",
      date: new Date(now - 3_600_000).toUTCString(),
      internalDate: now - 3_600_000,
      mine: false,
    },
    {
      id: "outbound-reply",
      threadId: "active-thread",
      from: "Coris <coris@example.com>",
      to: "prospect@example.com",
      subject: "Re: Proposal and next steps",
      body: "Thanks. I will send the onboarding checklist and proposed kickoff date today.",
      date: new Date(now).toUTCString(),
      internalDate: now,
      mine: true,
    },
  ]);

  if (result.newState !== "waiting_for_reply") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.attentionLevel !== "silent") throw new Error(`Already-replied thread should be silent, got ${result.attentionLevel}`);
  if (result.actions.length) throw new Error("Already-replied thread should not prepare duplicate actions");
});

Deno.test("James Kape acceptance becomes a confirmation and an exact diary invitation", () => {
  const wednesday = Date.parse("2026-08-19T09:00:00+01:00");
  const messages: ExecutiveSourceMessage[] = [
    {
      id: "intro",
      threadId: "james-kape-thread",
      from: "Coris <coris@example.com>",
      to: "James Kape <james@omse.co>",
      subject: "Fractional new business support",
      body: "It would be useful to have a short 15-20 minute call.",
      date: new Date(wednesday - 86_400_000).toUTCString(),
      internalDate: wednesday - 86_400_000,
      mine: true,
    },
    {
      id: "proposal",
      threadId: "james-kape-thread",
      from: "Coris <coris@example.com>",
      to: "James Kape <james@omse.co>",
      subject: "Re: Fractional new business support",
      body: "How about Friday afternoon, around 2 p.m.?",
      date: new Date(wednesday).toUTCString(),
      internalDate: wednesday,
      mine: true,
    },
    {
      id: "acceptance",
      threadId: "james-kape-thread",
      from: "James Kape <james@omse.co>",
      to: "Coris <coris@example.com>",
      subject: "Re: Fractional new business support",
      body: "Yeah let’s do it, you ok to send an invite? Cheers, James",
      date: new Date(wednesday + 60_000).toUTCString(),
      internalDate: wednesday + 60_000,
      mine: false,
    },
  ];

  const result = assessConversation(messages);
  if (result.newState !== "meeting_agreed_invite_pending") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.title !== "James Kape confirmed the call. Invite ready") throw new Error(`Unexpected title: ${result.title}`);
  if (result.actions.length !== 2) throw new Error(`Expected two prepared actions, got ${result.actions.length}`);
  if (result.actions.some(action => action.type === "task_create" || action.type === "follow_up_schedule")) throw new Error("Generic task or follow-up should not be prepared");
  const reply = result.actions.find(action => action.type === "reply_draft");
  if (reply?.content.body !== "Hi James,\n\nNo problem. Invite on its way.\n\nBest,\nCoris") throw new Error("Short confirmation was not prepared");
  const invite = result.actions.find(action => action.type === "calendar_proposal");
  if (invite?.content.attendee_email !== "james@omse.co") throw new Error("Calendar attendee is wrong");
  if (invite?.content.starts_at !== "2026-08-21T13:00:00.000Z") throw new Error(`Unexpected start: ${invite?.content.starts_at}`);
  if (invite?.content.ends_at !== "2026-08-21T13:20:00.000Z") throw new Error(`Unexpected end: ${invite?.content.ends_at}`);
  if (result.commitments.length !== 3) throw new Error("Thread commitments were not retained");
});

Deno.test("Adam Graham meeting request gets an Associate Partner response, not onboarding boilerplate", () => {
  const result = assessConversation([{
    id: "adam-associate-partner",
    threadId: "adam-thread",
    from: "Adam Graham <adam@gray-matters.co>",
    to: "Coris <coris@example.com>",
    subject: "Gray Matters - Associate Partner Opportunity",
    body: "Hey Coris, I have been thinking about it and I think there could be a really good fit with the Associate Partner model, particularly with you leaning into the AI, martech and new business systems side. If you are still interested, shall we get 30 mins in and talk through what a pilot might look like and where you would want to focus?",
    date: "Wed, 19 Aug 2026 12:16:18 +0000",
    internalDate: Date.parse("2026-08-19T12:16:18Z"),
    mine: false,
  }]);

  if (result.newState !== "meeting_requested_time_pending") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.title !== "Adam Graham wants to arrange a call") throw new Error(`Unexpected title: ${result.title}`);
  const reply = result.actions.find(action => action.type === "reply_draft");
  const body = String(reply?.content.body || "");
  if (!body.includes("Associate Partner model") || !body.includes("30 minutes")) throw new Error(`Reply did not reflect Adam's proposal: ${body}`);
  if (/discovery|onboarding checklist|positioning and messaging/i.test(body)) throw new Error("Unrelated onboarding copy was reused");
  if (result.actions.some(action => action.type === "document_draft" || action.type === "task_create")) throw new Error("No onboarding document or redundant response task should be prepared");
});

Deno.test("Dripify affiliate approval is informational and needs no reply", () => {
  const result = assessConversation([
    {
      id: "affiliate-application",
      threadId: "dripify-thread",
      from: "Affiliate Manager <affiliate@dripify.com>",
      to: "Coris <coris@example.com>",
      subject: "Your Dripify Affiliate Application: Additional Information Needed",
      body: "Please tell us about your promotion plans and target audience.",
      date: "Mon, 17 Aug 2026 04:13:40Z",
      internalDate: Date.parse("2026-08-17T04:13:40Z"),
      mine: false,
    },
    {
      id: "affiliate-response",
      threadId: "dripify-thread",
      from: "Coris <coris@example.com>",
      to: "Affiliate Manager <affiliate@dripify.com>",
      subject: "Re: Your Dripify Affiliate Application: Additional Information Needed",
      body: "I work with creative agencies and hope to share an affiliate link with a client before they sign up.",
      date: "Thu, 20 Aug 2026 07:12:15 +0100",
      internalDate: Date.parse("2026-08-20T07:12:15+01:00"),
      mine: true,
    },
    {
      id: "affiliate-approved",
      threadId: "dripify-thread",
      from: "Affiliate Manager <affiliate@dripify.com>",
      to: "Coris <coris@example.com>",
      subject: "Re: Your Dripify Affiliate Application: Additional Information Needed",
      body: "Hi Coris, your application was approved. Here is your link to promote Dripify. You will also get an invite to PartnerStack. Welcome to our affiliate community!",
      date: "Thu, 20 Aug 2026 12:34:01 +0300",
      internalDate: Date.parse("2026-08-20T12:34:01+03:00"),
      mine: false,
    },
  ]);

  if (result.newState !== "completed_no_response_required") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.attentionLevel !== "silent") throw new Error(`Approval should be informational, got ${result.attentionLevel}`);
  if (result.actions.length) throw new Error("An approval notice should not produce a reply, onboarding document or follow-up");
});

Deno.test("Chloe's cross-message date and time produce a concise confirmation and diary invite", () => {
  const messages: ExecutiveSourceMessage[] = [
    {
      id: "chloe-proposes-date",
      threadId: "chloe-thread",
      from: "Chloe Flexman <chloe@buffmotion.com>",
      to: "Coris <coris@example.com>",
      subject: "Re: New business planning",
      body: "We would love another chat about next steps. Are you free on Tuesday 1st September?",
      date: "Thu, 20 Aug 2026 14:14:37 +0100",
      internalDate: Date.parse("2026-08-20T14:14:37+01:00"),
      mine: false,
    },
    {
      id: "coris-confirms-date",
      threadId: "chloe-thread",
      from: "Coris <coris@example.com>",
      to: "Chloe Flexman <chloe@buffmotion.com>",
      subject: "Re: New business planning",
      body: "Tuesday 1st September works for me. What time were you thinking?",
      date: "Thu, 20 Aug 2026 14:20:49 +0100",
      internalDate: Date.parse("2026-08-20T14:20:49+01:00"),
      mine: true,
    },
    {
      id: "chloe-proposes-time",
      threadId: "chloe-thread",
      from: "Chloe Flexman <chloe@buffmotion.com>",
      to: "Coris <coris@example.com>",
      subject: "Re: New business planning",
      body: "Great, does the afternoon work, around 2pm? It would be good to talk through your proposal and align on scope and priorities. Let us know if that time works and I will send over an invite, or feel free to share.",
      date: "Thu, 20 Aug 2026 21:23:13 +0100",
      internalDate: Date.parse("2026-08-20T21:23:13+01:00"),
      mine: false,
    },
  ];

  const result = assessConversation(messages);
  if (result.newState !== "meeting_agreed_invite_pending") throw new Error(`Unexpected state: ${result.newState}`);
  const reply = result.actions.find(action => action.type === "reply_draft");
  if (reply?.content.body !== "Hi Chloe,\n\n2pm works for me. Invite on its way.\n\nBest,\nCoris") throw new Error(`Unexpected reply: ${reply?.content.body}`);
  const invite = result.actions.find(action => action.type === "calendar_proposal");
  if (invite?.content.starts_at !== "2026-09-01T13:00:00.000Z") throw new Error(`Unexpected start: ${invite?.content.starts_at}`);
  if (invite?.content.attendee_email !== "chloe@buffmotion.com") throw new Error("Calendar attendee is wrong");
  if (result.actions.some(action => action.type === "document_draft" || action.type === "task_create" || action.type === "follow_up_schedule")) throw new Error("Specific meeting handling should replace generic onboarding actions");
});

Deno.test("an accepted meeting without a safe date stays with Coris for judgement", () => {
  const result = assessConversation([
    {
      id: "proposal-without-time",
      threadId: "ambiguous-meeting",
      from: "Coris <coris@example.com>",
      to: "Prospect <prospect@example.com>",
      subject: "Introductory call",
      body: "Let's arrange a call next week.",
      date: "Wed, 19 Aug 2026 09:00:00 +0100",
      internalDate: Date.parse("2026-08-19T09:00:00+01:00"),
      mine: true,
    },
    {
      id: "accepted-without-time",
      threadId: "ambiguous-meeting",
      from: "Prospect <prospect@example.com>",
      to: "Coris <coris@example.com>",
      subject: "Re: Introductory call",
      body: "Yes, let's do it. Please send an invite.",
      date: "Wed, 19 Aug 2026 09:01:00 +0100",
      internalDate: Date.parse("2026-08-19T09:01:00+01:00"),
      mine: false,
    },
  ]);

  if (result.newState !== "meeting_agreed_invite_pending") throw new Error(`Unexpected state: ${result.newState}`);
  if (!result.missingFacts.includes("Confirmed meeting date and time")) throw new Error("Missing meeting time was not surfaced");
  if (result.actions.some(action => action.type === "calendar_proposal")) throw new Error("No calendar event should be invented without a time");
});

Deno.test("an existing James Kape diary event removes the stale reply and invite", () => {
  const messages: ExecutiveSourceMessage[] = [
    {
      id: "proposal",
      threadId: "james-kape-calendar-thread",
      from: "Coris <coris@example.com>",
      to: "James Kape <james@omse.co>",
      subject: "Re: Fractional new business support",
      body: "How about Friday afternoon, around 2 p.m.?",
      date: "Wed, 19 Aug 2026 09:00:00 +0100",
      internalDate: Date.parse("2026-08-19T09:00:00+01:00"),
      mine: true,
    },
    {
      id: "acceptance",
      threadId: "james-kape-calendar-thread",
      from: "James Kape <james@omse.co>",
      to: "Coris <coris@example.com>",
      subject: "Re: Fractional new business support",
      body: "Yeah let's do it. You okay to send an invite?",
      date: "Wed, 19 Aug 2026 09:01:00 +0100",
      internalDate: Date.parse("2026-08-19T09:01:00+01:00"),
      mine: false,
    },
  ];
  const calendar: ExecutiveCalendarContext = {
    status: "available",
    calendarId: "primary",
    events: [{
      id: "james-event",
      status: "confirmed",
      summary: "Fractional new business support with James Kape",
      description: "Call agreed by email",
      htmlLink: "https://calendar.google.com/calendar/event?eid=james-event",
      start: "2026-08-21T13:00:00.000Z",
      end: "2026-08-21T13:20:00.000Z",
      attendeeEmails: ["james@omse.co"],
      organiserEmail: "coris@example.com",
      creatorEmail: "coris@example.com",
    }],
  };

  const result = reconcileAssessmentWithCalendar(assessConversation(messages), messages, calendar);
  if (result.newState !== "meeting_scheduled") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.attentionLevel !== "silent") throw new Error(`Scheduled meeting should be silent, got ${result.attentionLevel}`);
  if (result.actions.length) throw new Error("An existing diary event should remove the stale reply and invitation");
  if (!result.evidence.some(item => item.label === "Matching Google Calendar event")) throw new Error("Calendar evidence was not retained");
});

Deno.test("a recruiter meeting already in the diary is treated as complete", () => {
  const messages: ExecutiveSourceMessage[] = [{
    id: "recruiter-follow-up",
    threadId: "recruiter-thread",
    from: "Katarina Modric <katarina@hypefy.ai>",
    to: "Coris <coris@example.com>",
    subject: "Second-round interview with Hypefy",
    body: "Friday at 9am UK time works. I will send the diary invitation.",
    date: "Thu, 20 Aug 2026 09:00:00 +0100",
    internalDate: Date.parse("2026-08-20T09:00:00+01:00"),
    mine: false,
  }];
  const calendar: ExecutiveCalendarContext = {
    status: "available",
    calendarId: "primary",
    events: [{
      id: "hypefy-interview",
      status: "confirmed",
      summary: "Interview with Filip and Katarina",
      description: "Interview with Katarina and Filip",
      htmlLink: "https://calendar.google.com/calendar/event?eid=hypefy-interview",
      start: "2026-08-21T08:00:00.000Z",
      end: "2026-08-21T09:00:00.000Z",
      attendeeEmails: ["coris@example.com", "katarina@hypefy.ai"],
      organiserEmail: "katarina@hypefy.ai",
      creatorEmail: "katarina@hypefy.ai",
    }],
  };

  const result = reconcileAssessmentWithCalendar(assessConversation(messages), messages, calendar);
  if (result.newState !== "meeting_scheduled") throw new Error(`Unexpected state: ${result.newState}`);
  if (result.actions.length) throw new Error("A confirmed recruiter event should not produce follow-up work");
  if (!/already in your diary/i.test(result.summary)) throw new Error(`Calendar completion was not explained: ${result.summary}`);
});
