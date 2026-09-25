# Task entry, active project & hierarchical splitting — interface spec

**Status:** Decided (product questions answered 2026-09-25, see §9).
Ready for implementation via the work packages in §10.

**Related:** [task-hirachy.md](task-hirachy.md) (tree of tasks, remainder
task, "set estimate to sum" button), [development_plan.md](development_plan.md)
(planner, fixing via tracking, A7 recalculation triggers).

---

## 1. Goals

Plina follows GTD. The interface has to make four moments frictionless:

| Moment | GTD step | What the user needs | Target |
|---|---|---|---|
| A thought pops up | Capture | Get it out of the head *now*, without deciding anything | ≤ 3 s, keyboard only, from any tab |
| Working on something | Engage | See what is running, switch or finish it, add a related task | Header only; no tab change |
| Refining a project | Organize | Split a rough block into parts without retyping context | One dialog, the numbers add up by themselves |
| Sorting session | Clarify / Reflect | Walk many tasks quickly: parent, estimate, tags, priority | Keyboard-driven list, inline edits |

Design principles:

1. **Context flows in; it is never retyped.** The active project, the
   parent's tags, deadline and priority are prefilled everywhere.
2. **One parser for durations everywhere** (`1.5`, `1,5`, `1:30`, `2h`,
   `90m` — `parseDurationInput` from `taskFormValidation.ts`).
3. **Only the header is mandatory.** A task without an estimate is planned
   with the user's default duration (§2) until it gets a real one.
4. **The full edit dialog stays** (it is the mobile fallback and the place
   for rare fields) but daily work should rarely need it.
5. **Never lose measurement data.** Estimates and tracked time are kept
   even when they disagree, so projects can be analyzed later (§4.6).

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Task tree** | Every task has an optional `parent`. Tasks can be split indefinitely. Cycles are rejected. |
| **Project** | Every **top-level task** (no parent). A top-level task without children is a project with a single step. Nested tasks with children are **sub-projects**. The separate `Project` model is migrated into the tree (§10, UI-1). |
| **Active project** | The task (project or sub-project) the user is currently working in. Shown in the header as a breadcrumb, preselected as parent of every new task. Synced via the server to all devices. May be "none" (new tasks become top-level projects). |
| **Estimate / budget** | A task's own `duration`. For a parent it is a budget: it stays what the user typed and is *not* silently overwritten by the children's sum. |
| **Unestimated task** | `duration` is empty. It is planned with the **default duration** from the user's settings (1h if never set) and shown as `1h (default)` in grey. Unestimated tasks form the **Inbox** of sorting sessions. |
| **Σ parts** | Sum of the children's estimates (a child with children contributes its own estimate, not its children's). Unestimated children count with the default duration. |
| **Rest** | `max(0, estimate − Σ parts − time spent on the parent itself)`. If positive it is **planned** as a placeholder "Rest of ‹parent›". |
| **Over budget** | `Σ parts > estimate`. The parent shows a warning with the "Set estimate to Σ parts" button. Tracked time exceeding an estimate is *not* a warning; it is recorded (§4.6). |
| **Tracker** | The header widget showing the task whose time is being tracked. |

**Which project becomes active** when tracking starts on a task *T*: the
nearest task, starting with *T* itself and walking up, that is top-level
or has children.

| Tracked task | Active project |
|---|---|
| `CAD` (leaf under `T250 › Hardware Design`) | `T250 › Hardware Design` |
| `Hardware Design` itself / its Rest placeholder | `T250 › Hardware Design` |
| `Buy milk` (top-level, no children) | `Buy milk` |

Consequence of the last row (intended): quick-adding a task while a
single-step project is active makes it a child of that project, which
consumes the project's estimate as its Rest (§3.3). The quick-add chip
always shows the target, so one click on ✕ adds a top-level task instead.

---

## 3. Header bar

The header becomes the "engage" cockpit: where am I, what runs, capture.

```
Desktop
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ● T250 › Hardware Design ▾ │ ⏹ CAD   00:42:13   ✓ │ [ + Add task…            N ] │ Plan my week │ ⚙ │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Week Overview   Calendar   Tasks   Projects   Tags   Time Buckets   Dependencies                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘

Mobile (≤ 600 px)
┌────────────────────────────────────┐
│ ● Hardware Design ▾   ⏹ 00:42  ✓   │
├────────────────────────────────────┤
│ Week  Tasks  Projects  …        ⚙  │
│                                    │
│                              ( + ) │  ← floating "add" button → quick-add sheet
└────────────────────────────────────┘
```

⚙ opens the settings page (§6.1).

### 3.1 Active project switcher

- A chip with the project color and a **breadcrumb** of the active
  project's path (`T250 › Hardware Design`). Clicking an ancestor in the
  breadcrumb makes that ancestor the active project (widening the scope).
- Clicking ▾ (or pressing **P**) opens an autocomplete popover:
  - type to filter; ↑/↓ + Enter selects;
  - shows the tree of projects and sub-projects (tasks with children and
    all top-level tasks), recently active first, then by priority;
  - first entry "No project" (new tasks become top-level);
  - last entry "+ New project ‹typed text›" — creates a top-level task
    and activates it;
  - footer link "Show all projects" → Projects tab with the *All* filter.
- Stored on the server (`UserSettings.active_task`). Other devices pick up
  a change on window focus and every 30 s (TanStack Query
  `refetchOnWindowFocus` + `refetchInterval`).

### 3.2 Tracker

| State | Shows | Actions |
|---|---|---|
| Tracking | ⏹, task header (click → edit dialog), elapsed time (live `hh:mm:ss`), ✓ | ⏹ stop; ✓ complete (existing "What next?" chooser appears if the plan forks) |
| Idle, active project has planned work | ▶ `Next: ‹first planned task inside the active project›` | ▶ starts it; ▾ opens a picker with the project's other open tasks |
| Idle, nothing planned | ▶ `Start a task…` | opens the picker (all open tasks, active project first) |

Rules:

- **Starting tracking anywhere** (▶ on a Week-view card, an outline row,
  the header picker, `T`) sets the active project according to the rule
  in §2 and starts the session.
- **Starting a task while another one is tracked stops the running
  session and starts the new one** (replaces today's 409).
- **Changing the active project by hand never stops tracking.** The
  tracker then shows a task outside the active project, prefixed with its
  project name in small type.
- If the tracked time exceeds the task's estimate, the elapsed time turns
  amber and shows `+0:15 over` — informational only.
- Shortcut **T** toggles tracking of the current / next task.

### 3.3 Quick add

A single-line input in the header (mobile: bottom sheet from the ⊕ button).
**N** focuses it from anywhere. Enter saves and keeps the input open and
empty for the next item (rapid capture); Escape closes.

Inline tokens, parsed live and shown as chips under the input so the user
sees how the text was understood:

| Token | Meaning | Example |
|---|---|---|
| duration | estimate (same parser as the form); omitted → unestimated (default duration) | `30m`, `1.5h`, `1:30` |
| `#name` | tag (autocomplete; unknown name → "new tag" chip, created on save) | `#maker` |
| `+name` | parent project, overrides the active project for this one task (autocomplete over projects and sub-projects) | `+Blog` |
| `!n` | priority 0–10 | `!8` |
| `>date` | deadline | `>fri`, `>tomorrow`, `>2026-10-03`, `>10.3.` |
| `\` | escapes the next token (`\#1` stays text) | |

Deadline words: English and German weekday names and abbreviations
(`mon`/`mo`/`montag` …), `today`/`heute`, `tomorrow`/`morgen`; dates
`YYYY-MM-DD`, `D.M.` and `D.M.YYYY`. A weekday always means the next such
day (today's weekday means one week ahead). Time of day defaults to 23:59.

Everything else is the header. Example:

```
[ + Order high-temp filament 30m #maker !7 >fri                        ]
    ● T250 › Hardware Design ✕   ⏱ 30m   #maker   !7   ⏰ Fri 02.10.
```

- The active project is preselected and shown as the first chip; its ✕
  makes this one task top-level.
- ⌘/Ctrl+Enter saves *and* opens the full edit dialog for details.
- A new task in a project with a budget **consumes the project's Rest**
  (Σ parts grows, the estimate is unchanged). If the Rest runs out, the
  project shows the over-budget warning; after saving, a snackbar says
  `T250 › Hardware Design is now 1h over budget — [Raise estimate]`.
- New tasks inherit tags, priority and deadline from the parent exactly as
  in the split editor (§4.4); tokens override.

---

## 4. Splitting a task into subtasks

### 4.1 Entry points

- "Split into subtasks" button in the edit dialog (all devices).
- Context menu / keyboard **S** on a selected outline row (§5) and on a
  Week-view card (desktop).
- A task that already has subtasks opens the same editor with them loaded
  ("Edit parts"). Clicking a Rest placeholder in the Week view opens it too.

### 4.2 Split editor

```
┌ Split "Hardware Design" ────────────────────────────── T250 · #maker · ⏰ Fri 10.10. ┐
│                                                                                     │
│ Estimate [ 12h  ]   Σ parts 10h  ·  spent 0h  ·  2h not assigned yet                │
│ ██████ CAD 3h ██████│ prints 2h │orders│ refine 2h │ assembly 2h │░░░░ 2h ░░░░│     │
│                                                                                     │
│   1  CAD                              [ 3h    ]   #maker                            │
│   2  test prints                      [ 2h    ]   #maker                            │
│   3  component orders                 [ 1h    ]   #maker                            │
│   4  CAD refinements                  [ 2h    ]   #maker                            │
│   5  assembly                         [ 2h    ]   #maker                            │
│   6  ▏                                [ ~2h   ]            ← ghost: share of rest   │
│                                                                                     │
│ ☑ Do these in this order  (adds dependencies 1 → 2 → 3 → 4 → 5)                     │
│ Inherit from parent:  ☑ tags #maker   ☑ priority 7   (deadline always applies)      │
│                                                                                     │
│ [ Set estimate to Σ parts (10h) ]                              [ Cancel ] [ Save ]  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Row editing (keyboard-first, like an outliner):

| Key | Effect |
|---|---|
| Enter | new row below (focus in header) |
| Tab / Shift+Tab | indent / outdent — a row becomes a sub-part of the row above (nested split in one go; its indented rows split *its* ghost share) |
| Backspace in an empty row | delete row, focus previous |
| Alt+↑ / Alt+↓ | move row |
| typing `CAD 3h` in the header cell | the duration token moves into the estimate cell (all §3.3 tokens work) |
| pasting multi-line text | one row per line (tokens parsed per line); leading spaces/tabs/`-` indent |

### 4.3 How the numbers add up

1. **Estimate is a budget.** It starts as the parent's current estimate
   (default duration if unestimated) and only changes when the user edits
   it or presses *Set estimate to Σ parts*.
2. **Available for parts** = estimate − time already spent on the parent.
3. **Rows without a typed duration show a ghost value** (`~2h`, grey): the
   not-yet-assigned available time divided equally among them, rounded to
   15 min (the rounding remainder goes to the first rows, so ghosts always
   add up exactly). A fresh split of a 12h task into four empty rows shows
   `~3h` each — it adds up without typing a single number. If nothing is
   left, ghosts show the default duration and the bar goes red.
4. **Typing a duration makes that row explicit**; the ghosts of the other
   rows rebalance immediately. Clearing the field turns it back into a ghost.
5. The **allocation bar** shows time already spent (dark), explicit parts
   (solid, in row order), ghosts (lighter) and the unassigned rest
   (hatched). If Σ parts exceeds what is available the overflow is red and
   the summary reads `2h over the estimate — [Raise estimate to 14h]`.
6. **On Save** ghost values are written as real estimates. A remaining
   positive rest (only possible when every row is explicit) stays on the
   parent as its planned Rest; a negative one leaves the parent over budget.
7. Editing the estimate field directly is how the user says "now that I
   see the steps, the whole thing takes 14h, not 12h". Every estimate
   change is recorded (§4.6).

### 4.4 What the subtasks inherit

| Field | Rule |
|---|---|
| Project | implicit through the tree |
| Tags | copied at creation (checkbox in the editor, on by default), editable per task afterwards |
| Priority | copied at creation (checkbox, on by default) |
| Deadline | inherited live: effective deadline = earliest of own and all ancestors' deadlines. A child can have an earlier deadline, never a later one (the form rejects it with a message naming the ancestor). |
| Color | inherited live unless the child sets its own |
| Time spent on the parent | stays on the parent; it reduces the parent's Rest while there is Rest left (§2) |
| Dependencies | a parent's predecessors apply to all its descendants; a task depending on the parent waits for all its descendants and its Rest (§10, UI-2) |

### 4.5 The parent after splitting

- The parent is no longer scheduled as one block; its descendants and (if
  positive) its Rest placeholder are. The Rest is placed after the
  children when "in this order" is on, otherwise planned like a sibling.
- In the Week view the Rest placeholder is drawn hatched with the title
  "Rest of Hardware Design". Clicking it opens the split editor; ▶ on it
  tracks time on the parent itself.
- The parent can still be tracked directly (e.g. for coordination work);
  that time stays on the parent.
- **When the last child is completed, the parent completes automatically
  and its Rest is dropped.** A snackbar offers `Hardware Design completed
  — [Undo]` (undo re-opens the parent; the child stays done). This
  cascades upwards (completing the last sub-project can complete the
  project) with one snackbar naming the topmost completed task.
- Deleting a parent asks whether to delete its descendants or move them up
  one level.

### 4.6 Estimate vs. reality (data for later analysis)

No analysis UI is part of this spec, but the data must exist from day one:

- **Estimate history:** every change of a task's estimate is stored with
  old value, new value, timestamp and reason (`created`, `edited`,
  `split`, `set_to_sum`, `raised_from_warning`).
- **Tracked time** stays per task (existing `TrackingSession`s and
  `time_spent`); tracked time above the estimate is kept as is, never
  capped.
- **On completion** the task stores a snapshot: final estimate, first
  estimate, own tracked time and the rolled-up tracked time of its
  descendants. The dropped Rest of an auto-completed parent is part of the
  snapshot.
- The edit dialog shows `spent 3h 20m of 3h (+20m)` for completed and
  running tasks.

---

## 5. Outline (Projects tab and sorting sessions)

The split editor's row editing is the same component as a full-page
**outline**: the tree of all open tasks, one row per task. It replaces the
current Projects list.

```
[ Active project │ All projects ]   A toggles        Inbox (3)   Sort ▶
▾ ● T250                               Σ 18h / 20h   #maker          ⏰ 31.10.   !7
    ▾ Hardware Design                  Σ 10h / 12h   #maker          ⏰ 10.10.   !7
        CAD                              3h          #maker                      !7   ▶
        test prints                      2h          #maker                      !7   ▶
        …
      Rest of Hardware Design            2h                                           ▶
    ▸ Firmware                           4h
▸ ● Company Blog                       Σ 9h
▸ ● Buy milk                            1h (default)
```

- **Filter:** by default only the active project's subtree is shown. The
  segmented control *Active project │ All projects* (key **A**) switches
  to every project with one click / key press; the choice is remembered
  per browser. With no active project, *All projects* is shown.
- Click a cell (or Enter on a row) to edit it inline; the header cell
  accepts the §3.3 tokens. Enter on the last row adds a sibling.
- Tab / Shift+Tab re-parents (indenting *is* splitting); Alt+↑/↓
  reorders. The same numbers rules apply (a re-parented task consumes the
  new parent's Rest).
- Digit keys `0`–`9` set the priority of the selected row to 0–9
  (priority 10 is set in the edit dialog).
- ▶ on a row starts tracking (and sets the active project, §2).
- Parents show `Σ parts / estimate`, amber when over budget.

### 5.1 Sorting session

**Sort ▶** filters the outline to the **Inbox** (unestimated tasks, across
all projects) and selects the first row. The user walks the list with
↑/↓ and processes rows with single keys:

| Key | Action |
|---|---|
| E | type an estimate (row leaves the Inbox) |
| M | move: pick a new parent (same popover as the project switcher) |
| # | add tag |
| 0–9 | priority |
| S | split |
| Space | start tracking (GTD two-minute rule) |
| Del | delete (with undo snackbar) |
| Enter | full edit dialog |

---

## 6. Dialogs and settings

### 6.1 Settings page (new, ⚙ in the header)

| Setting | Default | Effect |
|---|---|---|
| Default duration | 1h | used for unestimated tasks in planning, Σ parts and ghosts |

Stored in the server-side `UserSettings` together with the active project.
More settings can be added later.

### 6.2 Full edit dialog (existing `TaskFormDialog`)

- The project select becomes a **Parent** field (autocomplete over all
  open tasks, showing their breadcrumb; empty = top-level project).
  Preselected with the active project for new tasks.
- **Duration becomes optional:** empty is valid and shows the helper
  `Empty = your default (1h)`; malformatted values keep their error.
- For a task with children: the estimate shows `Σ parts 10h / 12h` with
  the *Set estimate to Σ parts* button and an *Edit parts* button.
- Deadline later than an ancestor's → error `The deadline is later than
  the deadline of “T250” (31.10.). Choose a date on or before it.`
- Choosing a parent that would create a cycle (the task itself or one of
  its descendants) is impossible in the autocomplete; the server rejects
  it anyway with a message naming the path.

---

## 7. Mobile

- Header: active project chip (breadcrumb shortened to the last level) +
  compact tracker (⏹ time ✓); tabs below.
- ⊕ floating button → quick-add bottom sheet (same tokens, plus tappable
  chips for recent tags/projects because typing `#` is slow on phones).
- v1 on mobile: quick add, tracker, project switcher, edit dialog. The
  split editor and the outline are desktop-first (usable but not
  optimized: indent/outdent via buttons on the focused row).
- Hover overlays don't exist; tapping a card opens the edit dialog.

---

## 8. Keyboard map (desktop)

Global shortcuts are ignored while focus is in an input.

| Key | Where | Action |
|---|---|---|
| N | anywhere | focus quick add |
| P | anywhere | open active project switcher |
| T | anywhere | toggle tracking of the current / next task |
| A | outline | toggle *Active project / All projects* |
| S | outline row, Week-view card | split |
| 0–9 | outline row | priority |
| / | anywhere | search tasks |
| Esc | popovers, quick add | close |

---

## 9. Decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | What is a project? | Every top-level task. Tasks can be split indefinitely; the `Project` model is migrated into the task tree. |
| 2 | Which level becomes active when tracking a nested task? | The nearest top-level-or-parent task (§2), shown as a breadcrumb for widening. |
| 3 | Is the Rest planned? | Yes. |
| 4 | Time spent on a parent | Stays on the parent and reduces the Rest while there is some. Tracked time exceeding estimates is kept for later analysis (§4.6). Tags/priority copied at creation, deadline inherited live. |
| 5 | Dependencies & tree | Parent's predecessors apply to all children; depending on a parent means on all children; "in this order" is on by default. |
| 6 | Parent completion | Automatic when the last child is done, Rest dropped, undo snackbar. |
| 7 | Tasks without estimate | Planned with a default duration from the settings page (1h if unset). |
| 8 | Quick-add tokens | Table in §3.3 as proposed. |
| 9 | Prioritizing | Digit keys (numeric priority stays). |
| 10 | Tracking switches | Starting another task stops the running one and starts the new one; changing the active project never stops tracking. |
| 11 | Active project storage | Server, synced to all devices. Outline filters to the active project, with a one-click/one-key switch to all projects. |
| 12 | Mobile v1 | Quick add, tracker, switcher, edit dialog; split editor and outline desktop-first. |
| 13 | Tracking a top-level task | It becomes the active project itself (follows from 1). |
| 14 | New task in a budgeted project | Consumes the Rest; over-budget warning if necessary. |

---

## 10. Work packages

Order = dependency order. Each WP follows the repo conventions: TDD,
tests in `apps/backend/tasks/tests/` / next to the component, every new
frontend component in its own folder with unit tests and a Storybook
story. Sizes as in development_plan.md (S ≈ ½ day, M ≈ 1–2 days,
L ≈ 2–4 days).

**UI-1 · Task tree in the backend + Project migration — L**
- `Task.parent` (FK self, nullable, `related_name="children"`,
  `on_delete=PROTECT`; deletion handled by the API per §4.5) and
  `Task.order` (sibling order; top-level order replaces `Project.order`).
- Validation in `services/tree.py`: no self-parent, no parent inside the
  own subtree (400 with the path); child deadline ≤ ancestors' deadlines.
- `TaskEstimateChange` model (task, old, new, at, reason) written by a
  service function used by every estimate-changing path; `completion_*`
  snapshot fields on `Task` (§4.6).
- Data migration: each `Project` becomes a top-level task (name → header,
  description, color, tags, priority, order); its `ProjectTaskItem`s
  become children in order. Existing task→project links survive as
  parent links.
- Serializer: `parent_id` (writable), `children_ids`, `ancestor_ids`
  (root first), `effective_deadline`, `is_estimated`, `rest`,
  `parts_total`, `over_budget`.
- `/api/projects/` stays as a read-only compatibility view over top-level
  tasks with the old shape (`task_ids` = all descendants) until the
  frontend has migrated (UI-8); then it is removed together with the
  `Project`/`ProjectTaskItem` models.
- *Accept:* migration round-trip test on a fixture with two projects;
  re-parenting into the own subtree → 400 with path; deleting a parent
  with `?children=lift` moves children up, `?children=delete` cascades;
  estimate history rows for create/edit.
- *Delivered (2026-09-25, TDD):* 37 new tests (`test_task_tree.py`,
  `test_project_migration.py`); 226 backend / 195 frontend tests green.
  `services/tree.py` holds a one-query `TreeIndex` (children, ancestors,
  descendants, Σ parts, Rest, over budget, effective deadline) shared by all
  items of a list response, plus re-parenting/deadline validation and
  `delete_task`; `services/estimates.py` records estimate changes and
  writes/clears the completion snapshot (also when `completed_at` is set via
  PATCH). The data migration reuses each project's id for its top-level
  task, so ids the frontend holds stay valid; the new task's estimate is Σ of
  its parts, so migrating creates no Rest and no warning. Until UI-2 the
  planner simply skips parents (no Rest placeholders yet) and uses the
  top-level ancestor as `project_id`. Verified live: legacy data migrated,
  then plan → accept → add child → track → complete → delete (refused /
  lift) over HTTP, and every tab of the unchanged frontend loads against it.
  Deviations: **(1)** `/api/projects/` stays writable instead of read-only
  (create = new top-level task, rename, delete = lift the children, as the
  old delete kept the tasks) because the current frontend still creates and
  edits projects; **(2)** the deadline rule is checked when a deadline is
  set, not when a task is moved — moving never fails, the effective
  deadline covers it; **(3)** a top-level task's `project_id` (and planner
  snapshot) is null, as before for tasks without a project, so single-step
  projects don't add finish chips to the plan chooser. Frontend `Task` type
  mirrors the new fields as optional until the fixtures migrate (UI-8).

**UI-2 · Planner on the tree — L**
- Plannable units = open leaves + one Rest placeholder per parent with
  `rest > 0` (planned under the parent's id with a `is_rest` flag in plan
  entries). Unestimated tasks use `UserSettings.default_duration`.
- Effective deadline and dependency expansion: an edge `P → X` becomes
  edges from every leaf/Rest of `P` to every leaf/Rest of `X`. Edges
  between a task and its own ancestor/descendant are rejected by the
  dependency API (they would be cycles after expansion).
- Per-project finish forecast (A10) = per top-level task.
- Auto-completion: completing a task completes every ancestor whose
  descendants are now all done (Rest dropped, snapshot written); the
  response lists them. `POST /api/tasks/{id}/reopen/` undoes it.
- *Accept:* split parent with Rest plans leaves + Rest; dependency on a
  parent delays successors until all its leaves and Rest are allocated;
  completing the last child completes parent and grandparent; reopen
  restores both.

**UI-3 · Settings, active project, tracking switch — M**
- `UserSettings` singleton (single-user app; becomes per-user with auth):
  `default_duration` (1h), `active_task` (nullable FK). `GET/PATCH
  /api/settings/`.
- `track/start` on a task while another session is open closes that
  session (booking its time) instead of 409, and sets `active_task` per
  the §2 rule. Response includes the stopped task id and the new settings.
- `POST /api/tasks/{id}/split/` — atomic create/update/delete/reorder of
  children, new parent estimate, optional sequential dependencies,
  estimate-history reasons `split` / `set_to_sum`.
- *Accept:* starting B while A runs → A's session closed with correct
  time, B running, active project = B's project; split endpoint creates
  children + chain edges in one transaction and rolls back fully on any
  validation error.

**UI-4 · Quick-add parser — S**
- Pure `parseQuickAdd(text, { now, tags, projects })` → `{ header,
  durationMinutes | null, tags: {existing, new}, parentId | null |
  'none', priority, deadline, tokens: [{kind, start, end, label}] ,
  errors }` covering every §3.3 token, escaping and date format (EN + DE).
- *Accept:* table-driven tests for each token kind, combinations,
  escapes, ambiguous input (e.g. `>32.1.` → error chip, not silently text).

**UI-5 · Header: switcher, tracker, quick add, shortcuts — L**
- `ActiveProjectSwitcher`, `HeaderTracker`, `QuickAdd` (uses UI-4),
  `useGlobalShortcuts`, settings query with focus/interval refetch.
- Week-view ▶ buttons and every other start point go through one
  `useStartTracking` hook (sets active project via the server response).
- *Accept:* §11 scenarios 1 and 2 as integration tests (msw); shortcut
  keys ignored inside inputs.

**UI-6 · Split editor — L**
- Pure helpers: `ghostDurations(available, rows)` (15-min rounding, exact
  sum), `allocation(estimate, spent, rows)` for the bar, row-tree ops
  (indent/outdent/move) shared with UI-7.
- Components: `OutlineRows` (editable rows + keyboard), `AllocationBar`,
  `SplitEditor` (dialog, calls the split endpoint).
- *Accept:* §11 scenario 3; paste of an indented list builds nested rows;
  over-budget state shows the raise button and saves correctly.

**UI-7 · Outline view + sorting session — L**
- `OutlineView` replaces `ProjectList` in the Projects tab: tree rows
  with inline editing, filter *Active project / All projects* (A), Rest
  rows, ▶, digit priorities, Tab re-parenting (PATCH `parent_id`).
- Sort mode (Inbox = unestimated) with the §5.1 keys.
- *Accept:* toggling A shows all projects; Tab on a row re-parents it and
  the new parent's Σ/Rest update; sort mode removes a row from the list
  once an estimate is entered.

**UI-8 · Form, settings page, Week view, migration of old UI — M**
- `TaskFormDialog`: Parent field, optional duration with default hint,
  Σ/estimate display with the two buttons, ancestor-deadline validation;
  remove the project select.
- `SettingsPage` (default duration).
- Week view: hatched Rest placeholders, completion snackbar with Undo
  (cascade message), tracked-over-estimate display.
- Remove all frontend uses of `/api/projects/` (dependency editor colors
  via `ancestor_ids`), then drop the compatibility endpoint and the old
  models (UI-1).
- *Accept:* existing tests migrated; saving a task with empty duration
  works and it is planned with the default; completing the last child in
  the Week view shows the undo snackbar and Undo reopens the parent.

**UI-9 · Mobile — M**
- Compact header, ⊕ quick-add bottom sheet with recent tag/project chips,
  split editor/outline row buttons for indent/outdent.
- *Accept:* at 390 px width header fits without horizontal scroll;
  quick add works by tapping only (plus typing the header).

---

## 11. Acceptance scenarios

These become e2e tests (see e2e-test-cases.md).

1. **Capture.** From the Week view: N, type `Order filament 30m #maker`,
   Enter → a task exists under the active project `T250 › Hardware
   Design` with 30 min and #maker, the project's Rest shrank by 30 min,
   focus stays in quick add.
2. **Engage.** ▶ on "CAD" in the Week view → header shows `T250 ›
   Hardware Design` and `⏹ CAD 00:00:01`. ▶ on "Write CMS comparison"
   (child of top-level "Company Blog") → CAD's session is closed with its
   time booked, the Blog task runs, header shows `Company Blog`. Choosing
   another project in the switcher leaves the Blog task running.
3. **Split.** Split "Hardware Design" (12h, nothing spent): type five
   names without numbers → ghosts `~2h 30m, ~2h 30m, ~2h 30m, ~2h 15m,
   ~2h 15m` (sum 12h). Type `3h` for CAD → the other four show `~2h 15m`
   each. "Do these in this order" is checked. Save → five children with
   those estimates, a dependency chain CAD → … → assembly, parent estimate
   still 12h, no Rest. Reopen, change "assembly" to `4h` → bar shows
   `1h 45m over the estimate`; press *Set estimate to Σ parts* → estimate
   13h 45m, history row with reason `set_to_sum`.
4. **Default duration.** Quick-add `Call landlord` without duration → the
   task is planned for 1h and shows `1h (default)`; set the default to
   30 min in ⚙ → it is re-planned for 30 min and still appears in the
   Inbox.
5. **Auto-completion.** Complete the last open child of "Hardware Design"
   (with 2h Rest left) → parent completes, snackbar `Hardware Design
   completed — Undo`; its completion snapshot contains the dropped 2h
   Rest. Undo → parent is open again with its Rest planned.
