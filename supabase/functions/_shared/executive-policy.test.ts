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
