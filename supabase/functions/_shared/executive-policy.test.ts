import { assessConversation, type ExecutiveSourceMessage } from "./executive-policy.ts";

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
  if (result.title !== "James Kape accepted the call. Invite ready") throw new Error(`Unexpected title: ${result.title}`);
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
