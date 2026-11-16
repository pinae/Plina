# Sorting tracked time afterwards — development plan

*Status: S1–S11 delivered; README: Sorting tracked time afterwards.*

Two ways time tracking breaks down in a flow state:

1. A session runs on task A while A, B and C get done: A gets all the time,
   B and C none.
2. Work begins before the first task is chosen ("Start work"), or a few
   urgent hours go by without tracking at all.

Both leave a stretch of time whose start, end and total are known, but not
how it split between tasks. **Sorting** it afterwards: tick the tasks done
in it (or add them right there, already done), and the stretch is shared
out by their estimates, scaled to fill it. One sheet for all cases, fast
with the keyboard, undone with Undo instead of confirmed beforehand.

## Decisions

* **Work block** (`WorkBlock`): a stretch to sort — begun with "Start work"
  (`started`, open while it runs), made from a session (`split`) or from a
  gap in the time sheet (`gap`). What the user ticked is kept
  (`WorkBlockItem`); the result is ordinary `TrackingSession`s marked
  `apportioned`, laid end to end in the block, so tracked time, the time
  sheet and the tracked-time editor work on them unchanged. Sorting again
  replaces them; Undo restores what was there before.
* **Shares.** Each ticked task weighs what is left of its estimate (its
  estimate, or the default duration, minus time tracked outside this
  block), at least a quarter of the estimate. Done (☑) counts in full,
  worked on (◐) half. Minutes typed for a task are pinned; the rest scales
  to fill the block. Pinned minutes beyond the block are refused; with
  every task pinned, what is left stays untracked.
* **Done in the block:** a ticked task is completed at the end of its share
  (a task already done keeps its completion). Undo reopens what the block
  completed and deletes the tasks made in the sheet.
* **Estimates stay honest:** a task's completion figures say how much of
  its time was shared out (`completion_time_apportioned`); a task made in
  the sheet records its estimate as `logged` (typed after the work).
* **Never interrupt the flow:** starting a task while "Start work" runs
  ends the block and leaves it "to sort" (a count in the header); stopping
  a session that ran long asks "Only this task?" without blocking.
* **Suggestions** (recognition over recall): the tracked task, tasks
  completed in the block without time, the tasks the plan had in the
  block, open tasks of the same project, recently tracked ones — and, so a
  fresh day offers something too (found in the live check), the active
  project's open tasks, then the open ones by priority.

## Work packages

Each one is done test first; the checks of the repo (backend tests, ruff on
the changed files, frontend tests, tsc, eslint) pass before the next.

### S1 — Models (backend)
`WorkBlock`, `WorkBlockItem`, `TrackingSession.block` and `.apportioned`,
`Task.completion_time_apportioned`, the `logged` estimate reason, migration.
*Tests:* owner scoping of the new rows; deleting a block keeps no sessions.

### S2 — Shares (backend, pure)
`services/work_blocks.shares(total, items)`: weights, pinning, scaling,
whole minutes (the last share takes the seconds), refusals.
*Tests:* proportional split; remaining estimate (time spent elsewhere
counts); quarter floor; ◐ half; pinned fixed and the rest scaled; all
pinned leaves the rest; pinned beyond the block refused; no estimate uses
the default; sums are exact.

### S3 — Sorting a block (backend service)
`sort_block(block, items)`: replaces the block's sessions with apportioned
ones in item order; books tracked time (done tasks' figures follow);
completes ticked tasks at the end of their share; creates new tasks
(done, `logged`); re-sorting replaces; `undo_block` restores (a split's
session, reopens, deletes created tasks). `split_session` and `fill_gap`
make the block and sort it in one step; a gap must not overlap tracked time.
*Tests:* one per behaviour, including re-sort and undo of each origin.

### S4 — "Start work" (backend service)
`start_work`, `stop_work`; starting a task ends an open block (to sort);
"Start work" while a task runs stops it; one open block at most.
*Tests:* each transition; tracked time untouched by an unsorted block.

### S5 — API (backend)
`/api/work-blocks/`: list (open and to sort; `?from&to` sorted ones too),
`start/`, `stop/`, create from `session_id` or `start`/`end` with items,
`{id}/sort/`, `DELETE` (Undo), `suggestions/?start&end&task`. Stopping or
completing a task answers with the session it closed. Sessions say
`apportioned`.
*Tests:* API round trips, refusals as field errors, owner isolation.

### S6 — Suggestions and the time sheet (backend)
Suggestion order and reasons. Time sheet: an open or unsorted block counts
as work ("Not sorted yet"); an entry made of shared-out time says
`approximate`.
*Tests:* each suggestion source, de-duplication, the order; time sheet
entries.

### S7 — Shares in the browser (frontend, pure)
`utils/workBlocks.ts`: the same shares as S2 for the live preview.
*Tests:* the S2 cases.

### S8 — The sheet (frontend)
`SortTimeDialog`: the span, a bar with a colour per task, quick-add for a
done task, the suggestions with ☑/◐ (Space, a second tap), minutes to pin,
↑/↓, Enter saves, Undo in a snackbar; a bottom sheet on phones.
*Tests:* ticking updates the shares; pinning; keyboard path; new task
sent; save and Undo calls.

### S9 — Tracker (frontend)
Idle: "Start work" next to ▶. Running block: "Working · 1:23 · not
sorted yet" with ⏹ (stop opens the sheet). Starting a task meanwhile:
"1 to sort" in the header opens the sheet. Stopping or completing a session
that ran long (over 1.5× what was left of the estimate when it began, and
30 minutes at least; "over 90 minutes" alone would ask after every long
task): "Only “A” for 2h 10m? Split…".
*Tests:* each of these.

### S10 — Time sheet (frontend)
"Split…" on a tracked session, "Fill…" on a gap of a day, "to sort"
blocks listed and sortable, shared-out time marked ≈.
*Tests:* each entry point opens the sheet with the right span.

### S11 — Docs and live check
README (Time sheet / tracking), a live run of both cases, commit, push.
