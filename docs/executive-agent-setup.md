# Executive Agent foundation

## What this slice adds

The Executive Agent foundation turns connected Gmail conversations into auditable action packs:

1. A Gmail conversation is assessed as a change, not just an unread message.
2. A guarded thread interpreter assigns an attention level and identifies who owns the next step.
3. Reversible work is prepared, including a reply, discovery document and internal updates.
4. The Today screen surfaces only important changes.
5. The Attention Centre lets Coris edit and approve each prepared action separately.
6. External actions remain unexecuted until a later controlled execution slice.

The agent prepares every action before it commits anything. Supported actions can then be executed only by a signed-in user approving the exact reviewed version. Controlled execution supports approved Gmail replies, private Google Doc creation, diary invitations and Command Centre task creation. Opportunity changes and follow-up triggers remain approval-only.

## Controlled execution boundary

- A document draft exists only inside the action pack until Coris selects **Approve and create document**.
- Document approval creates one private Google Doc through the narrow `drive.file` scope. It does not share the file and cannot read unrelated Drive files.
- Email approval sends the exact reviewed recipient, subject and body through the existing `gmail.send` scope.
- Diary-invite approval checks the selected calendar for a clash and creates one event through the existing `calendar.events` scope. Google sends the invitation only after approval.
- Calendar execution records the action item on the private event metadata and searches for it before creation, preventing a retry from sending a duplicate invitation.
- Task approval creates one idempotent Command Centre task linked to the action item.
- A stale or missing immutable approval cannot execute.
- Completed actions retain their external reference for audit and access from Recent history.
- If Coris replies directly in Gmail, the reply draft is marked handled while prepared follow-on decisions remain available.
- Sharing documents, changing CRM opportunities and activating follow-up automation are not enabled in this slice.

After deployment, reconnect Google once from `/v2/gmail` to grant the additional `https://www.googleapis.com/auth/drive.file` scope before testing document creation.

## Deploy order

1. Apply `20260813130000_executive_agent_foundation.sql`.
2. Deploy `executive-agent-api`.
3. Deploy the static Next.js application.
4. Open `/v2/attention` once to seed the default operating rules.
5. Open Today with Gmail connected. The first page load assesses up to eight recent inbox threads.
6. Review real results before enabling scheduled monitoring.

The existing Supabase deployment workflow applies migrations before deploying Edge Functions. It now ignores `_shared`, which contains bundled source rather than a deployable function.

## Existing secrets reused

The function uses the server-side secrets already required by Calendar and Gmail:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CALENDAR_TOKEN_ENCRYPTION_KEY`

No provider or service key is exposed to the browser.

## Scheduled shadow monitoring

Before enabling scheduled monitoring, create a strong random Supabase Edge Function secret named:

`EXECUTIVE_AGENT_CRON_SECRET`

Then configure a scheduler to POST to:

`https://<project-ref>.supabase.co/functions/v1/executive-agent-api`

Required headers:

- `Content-Type: application/json`
- `X-Executive-Agent-Secret: <the configured secret>`

Body:

```json
{
  "action": "scanAllConnected",
  "maxResults": 10
}
```

Recommended shadow cadence: every 15 minutes between 07:30 and 21:00 Europe/London. Keep quiet-hour behaviour in the presentation policy even if monitoring continues overnight.

Do not store the monitor secret in the repository, frontend variables or migration SQL. Use Supabase Vault or the scheduler's encrypted secret store.

## Gmail push notifications

The first live slice uses a bounded recent-inbox scan because it can be tested with the existing Gmail connection. Gmail Pub/Sub push should replace periodic scanning after shadow-mode judgement is reliable.

Push setup will require:

- a Google Cloud Pub/Sub topic;
- permission for Gmail's publishing service account;
- a verified webhook receiver;
- renewal of `users.watch` before expiry;
- recovery via `users.history.list` from the stored history ID.

The database already includes the Gmail history, watch-expiry and recovery-sync fields needed for that later slice.

## Thread intelligence

The `revenue-ea-v3` policy uses a hybrid path:

- hard safety rules suppress automated mail, avoid repeat work after Coris has replied and handle agreed meeting invitations from the full thread;
- a server-side model adapter can interpret less predictable conversations using validated JSON output;
- unsafe recipients, invalid calendar times and ungrounded calendar actions are rejected before they reach an action pack;
- if the model is unavailable, slow or returns unsafe output, the deterministic policy remains in force.

To enable the model adapter, add a Supabase Edge Function secret named `AI_GATEWAY_API_KEY`. The optional `EXECUTIVE_AGENT_MODEL` secret chooses the model and defaults to `openai/gpt-5.6-luna`. The key is never sent to the browser. Adding the key means full email-thread text is sent from the Edge Function to Vercel AI Gateway and the selected model provider for interpretation.

The application tables and UI do not depend on a particular model vendor. If the key is not configured, all other behaviour, including the agreed-meeting flow, continues with the deterministic policy.

## James Kape meeting case

For a thread where Coris proposes Friday at 2 p.m., previously describes the call as 15–20 minutes, and James replies "Yeah let's do it, you ok to send an invite?", the expected result is:

- new state: `meeting_agreed_invite_pending`;
- a short confirmation reply: "No problem. Invite on its way.";
- one diary invitation for Friday at 2 p.m. Europe/London, lasting 20 minutes;
- James's verified sender address as the attendee;
- no generic response task, onboarding document or three-day follow-up;
- no event or email created before separate approval.

## James Carroll acceptance case

For a message that:

- agrees with the benchmark and 90-day reset;
- elevates positioning and messaging;
- asks what is needed to get started;

the expected result is:

- category: `revenue_opportunity`;
- previous state: `proposal_discussion`;
- new state: `positive_intent_pending_onboarding`;
- attention level: `interrupt_now`;
- a reply draft;
- an initial discovery and onboarding document;
- a Cash Now task proposal;
- an opportunity-state proposal that does not mark the opportunity won;
- a follow-up trigger that activates only after a reply is sent;
- missing facts for fee, engagement length and kickoff date.

## Safety boundaries

- Email bodies are treated as untrusted data.
- The deterministic policy cannot call tools.
- Model output never directly calls tools. It can only propose allow-listed action data that passes deterministic validation.
- All prepared external work requires an exact content hash at approval.
- Approval of one item does not approve the rest of the pack.
- Modified content invalidates a stale approval.
- The service role and connector tokens remain server-side.
- Dismissed assessments remain available as tuning evidence.
