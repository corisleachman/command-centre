# Command Centre current-state inventory

## Purpose

This document records the behaviour that exists today and must be preserved, deliberately redesigned or retired during the v1 migration.

## Deployment and runtime

- Next.js 15 application exported as static files.
- Hosted on GitHub Pages under `/command-centre`.
- Browser-facing Supabase client uses the public project URL and anon key.
- Authentication uses Supabase magic-link sign-in.
- The app remains usable without Supabase by falling back to local browser storage.
- Server-side work is not available in the GitHub Pages runtime. Secure integrations and scheduled work must run in Supabase Edge Functions.

## Current persistence model

### Main Command Centre

The main app stores one user-owned JSON document in `command_centre_state.state`.

Current shape:

```ts
type TaskLink = {
  id: number;
  label: string;
  url: string;
};

type Task = {
  id: number;
  title: string;
  category: "cash" | "build" | "health" | "life";
  points: number;
  done: boolean;
  today: boolean;
  week: number;
  notes?: string;
  links?: TaskLink[];
};

type CommandCentreState = {
  tasks: Task[];
  ideas: string[];
  songRoomLaunch?: SongRoomLaunchState;
};
```

The same main tasks and ideas are also stored in `localStorage` under `command-centre`.

### Song Room launch tracker

The tracker stores a separate local copy under `song-room-launch-v1` and a cloud copy under `command_centre_state.state.songRoomLaunch`.

Its model contains:

- target launch date
- workstreams
- fixed stages
- milestones
- actions
- status
- priority
- notes
- working link
- due date

The tracker currently acts as a bespoke initiative workspace and is useful evidence for the future reusable initiative model.

## Current screens and behaviours

### Navigation

The main navigation currently exposes:

- Today
- This week
- Objectives
- Plans
- Scorecard
- Ideas

Account and cloud-sync controls appear contextually.

### Today

Current behaviour to preserve:

- Shows a maximum of three tasks marked `today`.
- Displays completion count.
- Clearly identifies the next incomplete Big Three task.
- Allows completion directly from the list.
- Opens a task detail workspace.
- Collapses completed Big Three after all three are complete.
- Offers optional momentum tasks after the Big Three are complete.
- Shows optional work in increments of three.
- Allows the user to finish the day without being pushed into more work.

Current limitation:

- `today` is a boolean on the task rather than part of a dated daily plan.
- The first three matching tasks are used, so order and date history are weak.

### This week

Current behaviour to preserve:

- Shows tasks for the current seeded week.
- Supports completion and detail access.
- Keeps the backlog away from the default Today view.

Current limitations:

- Week is an integer rather than a real date range or planning-cycle relationship.
- No capacity calculation.
- No waiting, blocked or scheduled distinction.
- No calendar overlay.

### Task detail workspace

Current behaviour to preserve:

- Edit title, category, points and week.
- Add and edit notes.
- Add multiple labelled links.
- Open external working links.
- Delete a task.

Current limitations:

- No definition of done.
- No duration field separate from points.
- No task status beyond complete/incomplete.
- No dependencies, contacts, emails, documents, checklist or calendar blocks.
- No activity or result capture.

### Objectives and Plans

Current behaviour:

- Static seeded objective and plan cards communicate strategic context.
- Plans show status and progress.

Current limitation:

- These are hard-coded presentation data and aren't connected to tasks.
- Song Room has a bespoke tracker rather than using a reusable initiative structure.

### Scorecard

Current behaviour:

- Displays effort points from completed tasks.
- Provides visible momentum.

Current limitation:

- Effort isn't separated from results strongly enough.
- Metrics aren't tied to objectives or time periods.

### Ideas

Current behaviour to preserve:

- Fast idea capture.
- Ideas remain outside active task execution.

Current limitation:

- Ideas are plain strings with no status, review date, source or conversion history.

## Current product strengths

These are non-negotiable strengths and should survive the migration:

1. Today is calm and scarce.
2. The Big Three are immediately understandable.
3. The system reveals extra work only after primary commitments are complete.
4. Notes and working links reduce context switching.
5. Local fallback makes the app resilient.
6. Cloud sync allows use across devices.
7. Song Room demonstrates that detailed plans can live behind a visual overview.
8. Language remains neutral rather than punitive.

## Current technical risks

1. Main product behaviour lives in a large client component.
2. Concurrent updates can overwrite unrelated sections of the shared JSON state.
3. Individual tasks can't be queried or updated reliably by scheduled functions.
4. The bespoke Song Room model duplicates concepts that belong in reusable initiative tables.
5. Numeric task IDs are only locally generated and aren't safe for relational references.
6. Static objective and plan definitions prevent durable links from actions to strategy.
7. Local and cloud persistence can diverge without a formal migration or conflict policy.
8. The current `tasks` table in `supabase/schema.sql` isn't the actual source used by the main UI.

## Preserve, redesign, retire

### Preserve

- Big Three scarcity
- rolling momentum work
- local fallback
- cloud sync
- notes and multiple links
- category balance
- effort points
- quick idea capture
- visual plan progress
- task-focused workspace

### Redesign

- Tasks as relational records
- Today as a dated daily plan
- Week as a dated commitment view
- Objectives and plans as editable relational entities
- Song Room tracker as a reusable initiative view
- Scorecard as effort plus outcomes
- task duration independent of points
- carry-over as an explicit decision
- progress derived from milestones, tasks and results

### Retire after verified migration

- `command_centre_state.state.tasks` as the source of truth
- `command_centre_state.state.ideas` as the source of truth
- hard-coded plans and objective progress
- separate Song Room persistence model
- week-number-only scheduling

## Migration strategy

Use a compatibility period rather than a hard cut-over.

1. Create relational tables without removing the current JSON state.
2. Add a migration Edge Function or authenticated client migration that reads the current state once.
3. Insert relational records using stable UUIDs and legacy IDs for deduplication.
4. Read relational data first, with JSON fallback while verification is active.
5. Dual-write only for a short, controlled period if necessary.
6. Compare task counts, notes, links, completion state and ideas.
7. Mark migration complete per user.
8. Stop writing task and idea data to the JSON state.
9. Keep a timestamped backup of the original state for rollback.
10. Migrate Song Room after the reusable initiative model is proven with simpler data.

## First safe implementation slice

The first implementation release should add relational tasks and initiatives without changing the overall Today experience.

It should deliver:

- relational initiatives
- relational milestones
- relational tasks
- task links
- dated daily plans
- a migration status record
- a repository layer used by the existing UI
- JSON fallback if relational loading fails

It should not yet enable autonomous planning, Gmail sending or calendar writes.
