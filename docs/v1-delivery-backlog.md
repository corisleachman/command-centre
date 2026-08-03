# Command Centre v1 delivery backlog

## Delivery approach

Build in thin, reversible vertical slices. The live GitHub Pages application stays usable throughout. Automatic Calendar and Gmail actions remain disabled until their manual equivalents have been tested successfully.

## Epic 0: Architecture and safeguards

### Completed in draft PR #4

- Define product and technical architecture.
- Document current-state behaviour.
- Draft relational execution schema.
- Define compatibility migration strategy.

### Remaining

- Validate migration SQL against a Supabase development branch or local project.
- Confirm the current production user state can be backed up.
- Add migration verification queries.

## Epic 1: Data access layer

### Goal

Separate UI behaviour from storage before changing the user experience.

### Stories

1. Create typed domain models for initiatives, milestones, tasks, links, ideas and daily plans.
2. Create a repository interface with methods such as:
   - `listTasks`
   - `getTask`
   - `saveTask`
   - `completeTask`
   - `listDailyPlan`
   - `saveDailyPlan`
   - `listInitiatives`
3. Implement the current JSON/local-storage repository behind that interface.
4. Implement a Supabase relational repository.
5. Add a feature flag that selects the relational repository after migration verification.
6. Add visible but calm sync-error handling.

### Acceptance criteria

- The current Today screen behaves identically through the repository layer.
- No UI component directly reads or writes `command_centre_state`.
- Local fallback remains available.

## Epic 2: Safe state migration

### Goal

Move existing tasks, notes, links and ideas into relational records without loss.

### Stories

1. Back up the full current state to `migration_status.source_backup`.
2. Create or identify the active planning cycle and seeded objectives.
3. Convert every current task to a UUID-backed task row.
4. Preserve legacy task IDs for idempotency.
5. Convert task notes and links.
6. Convert ideas into `ideas_v1`.
7. Create today's dated daily plan from current `today` flags.
8. Compare source and destination counts.
9. Mark the migration verified only when all checks pass.
10. Provide a rollback function that restores the original JSON state.

### Acceptance criteria

- Task count matches.
- Completion count matches.
- Every non-empty note is preserved.
- Every valid link is preserved.
- Today contains the same Big Three.
- Re-running migration creates no duplicates.

## Epic 3: Reusable initiative engine

### Goal

Replace hard-coded plans and the bespoke Song Room assumption with reusable initiative structures.

### Stories

1. Add Initiatives navigation and overview.
2. Add initiative creation.
3. Add editable purpose, desired outcome, priority, status and target date.
4. Add phases, milestones and workstreams.
5. Add initiative progress derived from milestone state.
6. Add source-document links.
7. Add dependencies and decision gates.
8. Convert static consultancy, health and product plans into initiatives.
9. Migrate Song Room launch milestones and actions into the reusable model.
10. Preserve the visual matrix as an optional initiative view for complex roadmaps.

### Acceptance criteria

- A new future project can be created without code changes.
- Song Room uses the same tables and workspace as any other initiative.
- A task can trace upward to its milestone, initiative and objective.

## Epic 4: Dated daily and weekly planning

### Goal

Turn boolean Today flags and numeric weeks into explicit plans.

### Stories

1. Create dated daily plans.
2. Store Big Three order explicitly.
3. Keep momentum tasks separate from primary commitments.
4. Add explicit carry-over decisions.
5. Create dated weekly commitments.
6. Add capacity setting for low, standard and high days.
7. Recommend tasks without automatically changing the plan.
8. Preserve the current completed-day and optional-momentum experience.

### Acceptance criteria

- Historical daily plans remain reviewable.
- Incomplete tasks never silently roll forward.
- Today still shows no more than three primary commitments.

## Epic 5: Task workspace

### Goal

Make the Command Centre a place to complete work, not only list it.

### Stories

1. Add definition of done.
2. Add estimated duration independent of points.
3. Add checklist items.
4. Add dependency and blocker context.
5. Add linked contacts and resources.
6. Add focus timer.
7. Add completion result capture.
8. Add a reusable execution action area for email, meeting and document actions.

### Acceptance criteria

- Common task information is available without leaving the workspace.
- The surface remains focused and progressively disclosed.

## Epic 6: Google connection foundation

### Goal

Establish one secure Google OAuth connection that can support Calendar and Gmail with incremental scopes.

### Stories

1. Create Google Cloud OAuth credentials.
2. Add Supabase Edge Function OAuth start and callback routes.
3. Store encrypted refresh-token data server-side.
4. Add Settings connection status and disconnect control.
5. Request minimum identity and Calendar read scopes first.
6. Request Gmail scopes only when the user enables email actions.
7. Log token refresh failures without exposing credentials.

### Acceptance criteria

- No Google secret or refresh token reaches the GitHub Pages bundle.
- Disconnecting revokes or deletes stored access.
- The user can see exactly which capabilities are enabled.

## Epic 7: Calendar planning

### Goal

Read real availability and create safe, task-linked work blocks.

### Stories

1. Select calendars that count as busy.
2. Create or select a dedicated Command Centre calendar.
3. Add planner preferences.
4. Read availability for a chosen date.
5. Implement deterministic task ranking.
6. Add manual Plan tomorrow preview.
7. Create blocks only after approval.
8. Store Google event IDs and local mappings.
9. Reconcile moved or deleted blocks.
10. Add lock and do-not-move controls.
11. Add nightly, morning and midday scheduled runs after manual reliability is proven.

### Acceptance criteria

- The planner never modifies events it didn't create.
- Re-running a plan creates no duplicates.
- A new meeting causes only planner-managed blocks to move.
- The user can pause automation immediately.

## Epic 8: Gmail execution

### Goal

Support email where it advances a task, contact, meeting or initiative.

### Stories

1. Search relevant Gmail threads from a task workspace.
2. Link a thread without copying unnecessary message content.
3. Read the selected thread in context.
4. Draft a new message or reply.
5. Save drafts in Gmail where practical.
6. Send only through an explicit user action.
7. Record the message ID and task relationship.
8. Mark a task complete after a successful send when the user chooses.
9. Convert a message or promised follow-up into a task.
10. Add meeting follow-up drafting.

### Acceptance criteria

- No autonomous sends in v1.
- The recipient, subject and final body are visible before sending.
- Email content retention is minimal and configurable.
- Failed sends don't mark tasks complete.

## Epic 9: Planner automation and briefings

### Goal

Create the Chief of Staff behaviour once the underlying actions are reliable.

### Stories

1. Rank eligible work using explicit rules.
2. Respect due dates, dependencies, objective priority and capacity.
3. Generate tomorrow's proposed Big Three.
4. Reconcile Calendar blocks.
5. Generate a morning briefing.
6. Generate an end-of-day review.
7. Explain significant priority or schedule changes.
8. Compare weekly planned time against objective allocation.
9. Record all planner runs and failures.

### Acceptance criteria

- Deterministic inputs produce explainable recommendations.
- AI assists interpretation and language but doesn't bypass safety rules.
- A failed planner run leaves the previous valid plan intact.

## Epic 10: Reviews and scorecard

### Goal

Show whether effort is producing meaningful outcomes.

### Stories

1. Separate activities from results.
2. Add objective metrics.
3. Add weekly review flow.
4. Add monthly initiative review.
5. Review paused ideas only at intentional review points.
6. Add continue, change, pause or stop decisions.

## Immediate implementation order

1. Validate schema.
2. Build the repository layer.
3. Build migration and verification.
4. Switch existing Today and task workspace to relational data behind a feature flag.
5. Add reusable initiative overview.
6. Migrate Song Room.
7. Add dated planning.
8. Add Google connection.
9. Add Calendar manual planning.
10. Add Gmail contextual execution.
11. Enable scheduled planner runs.

## User input gates

Development can continue without input until one of these gates is reached:

1. Google Cloud OAuth setup requires access to the user's Google Cloud project or guided configuration.
2. Applying the migration requires Supabase project access and a confirmed backup.
3. Calendar planning preferences require working-hours and protected-time choices, though defaults can be used initially.
4. Gmail retention and sending choices require explicit approval before production use.
5. Final visual approval is needed before merging major navigation changes.
