# Executive Agent foundation

## What this slice adds

The Executive Agent foundation turns connected Gmail conversations into auditable action packs:

1. A Gmail conversation is assessed as a change, not just an unread message.
2. A deterministic revenue policy assigns an attention level.
3. Reversible work is prepared, including a reply, discovery document and internal updates.
4. The Today screen surfaces only important changes.
5. The Attention Centre lets Coris edit and approve each prepared action separately.
6. External actions remain unexecuted until a later controlled execution slice.

The agent runs in shadow mode. It records assessments and prepares work, but it does not send email, schedule meetings, change opportunities or replace Big Three tasks.

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

## Model provider boundary

This slice deliberately uses the transparent `revenue-ea-v1` policy. It proves event capture, attention handling, prepared actions and approval boundaries before adding probabilistic interpretation.

The next intelligence slice should add a server-side provider adapter and validated structured output. The application tables and UI must not depend on a particular model vendor.

Until then, the agent should remain in shadow mode. The rule policy is expected to over-prepare some commercial conversations so Coris can label false positives safely.

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
- Model output will never directly call tools when a model provider is added.
- All prepared external work requires an exact content hash at approval.
- Approval of one item does not approve the rest of the pack.
- Modified content invalidates a stale approval.
- The service role and connector tokens remain server-side.
- Dismissed assessments remain available as tuning evidence.

