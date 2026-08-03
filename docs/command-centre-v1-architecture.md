# Command Centre v1 Architecture

## Status

Working source of truth for the next build phase.

## 1. Product definition

The Command Centre is a private personal execution system. It converts long-term objectives and initiative roadmaps into a calm, prioritised and realistic plan for each week and day.

It is not intended to replace every strategy document, inbox, calendar or specialist application. It is the orchestration layer that understands what matters, identifies the next useful action, schedules the work and brings the relevant context into one task workspace.

The system must answer five questions quickly:

1. What am I trying to achieve?
2. What needs to happen next?
3. What matters most now?
4. When will I realistically do it?
5. Can I complete the work without unnecessary context switching?

## 2. Core product principles

### Action on the surface, strategy underneath

The default experience shows today's commitments and the next action. Full plans and backlogs remain available through progressive disclosure.

### Deliberate scarcity

The standard day contains three primary commitments, supported by appointments and short follow-ups. Completing the Big Three may reveal optional momentum work, but the system must not turn the home screen into a backlog.

### Initiatives are reusable containers

Song Room is one initiative, not a special product type. Future business, product, health, family or personal projects must use the same reusable structure.

### Strategy may live elsewhere

An initiative may originate in a document, conversation, spreadsheet or external plan. The Command Centre stores enough strategic context to manage execution, while linking back to the source material.

### Every task should have a reason

Where practical, tasks trace upward through milestone, phase, initiative, objective and life area. Unplanned administration is allowed but explicitly identified.

### Carry-over is a decision

Incomplete work must be rescheduled, split, deferred, delegated or cancelled. It must not silently roll forward.

### Calm, adaptive planning

The system supports low, standard and high-capacity days. It avoids shame-based productivity mechanics and protects health, family and recovery time.

### Integrations support execution

Calendar, Gmail, contacts and Drive are not separate destinations inside the product. Their relevant information and actions appear in the context of an initiative, task, meeting or follow-up.

## 3. Planning hierarchy

```text
Life area
  -> Outcome
    -> 90-day objective
      -> Initiative
        -> Phase
          -> Milestone
            -> Workstream
              -> Task
                -> Focus session / calendar block
                  -> Activity and result
```

Not every initiative requires every level. Small initiatives may contain milestones and tasks only.

## 4. Core entities

### Life areas

Stable areas such as Income & Business, Products, Financial Security, Health & Energy, Family & Lifestyle and Time & Freedom.

### Outcomes

Longer-term destination statements across six-month, one-year, three-year, five-year and ten-year horizons.

### Objectives

Measurable priorities for a planning cycle, usually 90 days.

### Initiatives

Reusable execution containers for substantial projects or programmes. Each initiative includes:

- title and purpose
- desired outcome
- success measures
- owner
- status
- priority
- target dates
- current phase
- source document links
- constraints and decision gates
- linked objective and life area

### Phases

Ordered sections of an initiative. A phase may be blocked until required milestones or tasks are complete.

### Milestones

Meaningful outcomes that indicate progress. Milestones are not simple task groups.

### Workstreams

Optional parallel areas of work within an initiative or phase.

### Tasks

Small executable actions, normally 10 to 90 minutes. Tasks include:

- title
- definition of done
- notes
- status
- priority
- estimated duration
- energy requirement
- work type
- due date
- earliest start date
- preferred time of day
- splittable flag
- dependencies
- linked contacts, emails, documents and URLs
- calendar status
- activity and result fields

### Task workspaces

A focused execution surface containing only the information and tools needed to complete a task. Depending on context it may include notes, checklist, documents, prior emails, recipients, a draft, meeting details, AI assistance and send or create actions.

### Calendar blocks

Time allocations created or recognised by the planner. Planner-created blocks remain linked to their task and can be moved, locked or removed safely.

### Communications

Email threads, drafts and sends linked to contacts, initiatives and tasks. The Command Centre should not become a full Gmail replacement.

### Contacts

People relevant to initiatives, opportunities, meetings and follow-ups. Google Contacts may enrich records, but the Command Centre stores its own relationship context.

### Results

Outcomes produced by work, kept separate from effort. Examples include a reply, meeting booked, proposal sent, payment, completed health session or product activation.

## 5. Primary product capabilities

### Daily execution

- Today's Big Three
- recommended first action
- appointments and follow-ups
- capacity selector
- focus mode
- completion and result capture
- momentum work after primary commitments
- end-of-day review

### Initiative management

- create an initiative manually
- import or extract a roadmap from an external source
- define phases, milestones, dependencies and decision gates
- view current phase and next milestone
- activate, pause, complete or stop an initiative
- prevent inactive ideas from becoming work automatically

### Weekly planning

- select weekly commitments
- balance cash, build, health and life work
- account for available diary capacity
- surface waiting and blocked work
- review progress against objectives and milestones

### Calendar planning

- read busy time from selected Google Calendars
- create work blocks in a dedicated Command Centre calendar
- preserve events not created by the planner
- move or remove planner blocks when priorities or meetings change
- respect locked blocks and working preferences
- run nightly and morning reconciliation

### Gmail execution

Initial scope:

- connect Gmail through Google OAuth
- search and read threads relevant to a task, contact or meeting
- attach a thread to an initiative or task
- draft a new email or reply inside a task workspace
- edit before sending
- send only after an explicit user action
- convert an email into a task or follow-up
- mark a task complete after a successful send when appropriate

Later scope:

- suggest replies
- detect promised follow-ups
- identify replies that unblock tasks
- prepare morning communications summaries

The system must not send autonomous external emails in v1.

### Meeting preparation

- combine calendar event, attendees, linked emails, notes and documents
- generate a concise meeting brief
- capture decisions and actions afterwards
- create follow-up tasks and draft emails

### AI chief of staff

- recommend priorities
- estimate and split tasks
- explain why work was scheduled
- identify blockers and dependencies
- produce morning and end-of-day briefings
- compare time allocation against active objectives

Deterministic rules control scheduling and safety. AI assists interpretation and drafting.

## 6. Information architecture

Primary navigation:

- Today
- Week
- Initiatives
- Objectives
- Scorecard
- Reviews
- Ideas
- Settings

Contextual surfaces:

- Task workspace
- Initiative detail
- Contact detail
- Meeting brief
- Command palette

Gmail, Calendar and Drive should not become permanent top-level navigation in v1. They appear where they support execution.

## 7. Technical architecture

### Front end

The existing Next.js application remains a static GitHub Pages deployment during the first migration stages.

### Backend

Supabase provides:

- authentication
- PostgreSQL data
- row-level security
- Edge Functions
- Cron scheduling
- audit logs and planner runs

### Integrations

Google OAuth should cover Calendar, Gmail and selected identity scopes. Drive and Contacts can be added through incremental consent where needed.

Sensitive tokens and service credentials remain server-side. They must never be included in the GitHub Pages bundle.

### Automation flow

```text
Supabase Cron
  -> planner Edge Function
    -> load tasks, initiatives and preferences
    -> read Google Calendar busy windows
    -> rank eligible work
    -> reconcile Command Centre calendar blocks
    -> update Today's Big Three
    -> create briefing and planner run record
```

## 8. Proposed database domains

The current `command_centre_state.state` JSON remains a temporary compatibility store only. The target model uses relational tables.

Required domains:

- life_areas
- outcomes
- planning_cycles
- objectives
- initiatives
- initiative_phases
- milestones
- workstreams
- tasks
- task_dependencies
- task_links
- task_checklist_items
- contacts
- task_contacts
- external_resources
- email_thread_links
- email_drafts
- calendar_connections
- calendar_blocks
- planner_preferences
- planner_runs
- daily_plans
- reviews
- activities
- results
- ideas

Migration must preserve current tasks, notes, links, completion state and ideas.

## 9. Planner rules for v1

The planner should:

1. Respect fixed calendar commitments.
2. Schedule only eligible incomplete tasks.
3. Prioritise due, overdue and dependency-unblocking work.
4. Protect the active primary cash objective.
5. Ensure the active product experiment and health objective receive agreed weekly capacity.
6. Use capacity, energy and preferred work type.
7. Avoid scheduling more than the user's daily limit.
8. Leave buffer time.
9. Never modify events it did not create.
10. Avoid duplicates through idempotent reconciliation.
11. explain significant changes.

Suggested default cadence:

- nightly full plan at 23:00 Europe/London
- morning reconciliation at 07:00
- midday reconciliation at 13:00

## 10. Security and permissions

- Row-level security on all user-owned tables
- encrypted server-side storage for Google refresh tokens
- least-privilege OAuth scopes
- explicit confirmation before sending email
- explicit confirmation before deleting external events
- planner writes limited to its dedicated calendar
- audit record for all automated planning changes
- disconnect controls for each integration
- no confidential third-party business data imported without a clear user action

## 11. Delivery sequence

### Foundation A: architecture and migration plan

- agree this source of truth
- inventory current behaviours
- map current JSON state to target tables
- identify features to preserve, redesign or retire

### Foundation B: relational execution model

- create initiatives, phases, milestones and tasks schema
- migrate existing state
- update the UI to use relational data
- retain compatibility until verification is complete

### Integration A: Google connection

- configure Google OAuth
- connect Calendar and Gmail
- store tokens securely
- add connection management in Settings

### Integration B: calendar planning

- create dedicated Command Centre calendar
- read availability
- manually plan a day
- reconcile planner-created blocks
- add scheduled runs

### Execution workspace

- create reusable task workspace
- add notes, checklist, links and context
- add Gmail read, draft and explicit send actions
- add meeting preparation context

### Intelligence

- planner recommendations
- morning briefing
- end-of-day review
- weekly objective and capacity analysis
- AI-assisted roadmap extraction

## 12. Immediate build slice

The fastest useful vertical slice is:

1. Relational initiatives, milestones and tasks.
2. Migration of current Command Centre state.
3. Initiative detail page with phases and next actions.
4. Task workspace preserving notes and links.
5. Google OAuth connection.
6. Calendar availability read.
7. Manual `Plan tomorrow` action.
8. Dedicated calendar block creation.
9. Gmail thread linking and explicit draft/send from a task.
10. Scheduled nightly planning after manual planning is proven reliable.

This sequence delivers visible value early while avoiding an unsafe jump directly to autonomous scheduling and communications.

## 13. Decisions still to capture

These can be set as defaults and refined through use:

- normal working hours and working days
- protected lunch and personal time
- maximum planned focus time per day
- preferred deep-work windows
- weekly capacity allocation by objective
- which calendars count as busy
- default Command Centre calendar colour
- whether email drafts are stored in Gmail, Supabase or both
- retention policy for imported email content

## 14. Definition of success

The product succeeds when the user can open it, understand the day in under 30 seconds, start the highest-value action, complete common communication and planning tasks with minimal context switching, and see that daily effort is advancing the initiatives and outcomes that matter.