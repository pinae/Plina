# Task entry, active project & hierarchical splitting — interface design

**Status:** DRAFT for discussion. Sections marked **❓Qn** depend on open
questions (collected in §9). Once they are answered this document becomes
the implementation spec; §10 then turns into work packages.

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
| Sorting session | Clarify / Reflect | Walk many tasks quickly: project, estimate, tags, priority | Keyboard-driven list, inline edits |

Design principles:

1. **Context flows in; it is never retyped.** The active project, the
   parent's tags, deadline and priority are prefilled everywhere.
2. **One parser for durations everywhere** (`1.5`, `1,5`, `1:30`, `2h`,
   `90m` — `parseDurationInput` from `taskFormValidation.ts`).
3. **Only the header is mandatory at capture time.** Everything else can
   be clarified later (❓Q7).
4. **The full edit dialog stays** (it is the mobile fallback and the place
   for rare fields) but daily work should rarely need it.

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Project** | ❓Q1 — proposed: a task that has subtasks (as in task-hirachy.md). Root tasks with children are projects; nested ones are sub-projects. |
| **Active project** | The project the user is currently working in. Shown in the header, preselected in every new task. At most one; may be "none". |
| **Estimate / budget** | A parent's own `duration`. Stays what the user typed; it is *not* silently overwritten by the children's sum. |
| **Σ parts** | Sum of the children's estimates (recursively: a child with children contributes its own estimate). |
| **Rest** | `estimate − Σ parts`. If positive it is shown (and planned, ❓Q3) as a placeholder "Rest of ‹parent›"; if negative the parent shows an over-budget warning with the "Set estimate to sum" button. |
| **Tracker** | The header widget showing the task whose time is being tracked. |

---

## 3. Header bar

The header becomes the "engage" cockpit: where am I, what runs, capture.

```
Desktop
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ● T250 › Hardware Design ▾ │ ⏹ CAD   00:42:13   ✓ │ [ + Add task…         N ] │ Plan my week │
├──────────────────────────────────────────────────────────────────────────────────┤
│  Week Overview   Calendar   Tasks   Projects   Tags   Time Buckets   Dependencies     │
└──────────────────────────────────────────────────────────────────────────────────┘

Mobile (≤ 600 px)
┌────────────────────────────────────┐
│ ● Hardware Design ▾   ⏹ 00:42  ✓  │
├────────────────────────────────────┤
│ Week  Tasks  Projects  …           │
│                                    │
│                              ( + ) │  ← floating "add" button → quick-add sheet
└────────────────────────────────────┘
```

### 3.1 Active project switcher

- A chip with the project color and name. For a sub-project it shows a
  **breadcrumb** (`T250 › Hardware Design`); clicking an ancestor in the
  breadcrumb widens the active project to that ancestor (❓Q2).
- Clicking the chip (or pressing **P**) opens an autocomplete popover:
  - type to filter; ↑/↓ + Enter selects;
  - list order: recently active first, then by priority; sub-projects are
    indented under their project;
  - first entry "No project";
  - last entry "+ New project ‹typed text›" — creates it and activates it.
- The active project is persisted (❓Q11) so a reload keeps it.

### 3.2 Tracker

| State | Shows | Actions |
|---|---|---|
| Tracking | ⏹, task header (click → edit dialog), elapsed time (live `hh:mm:ss`), ✓ | ⏹ stop; ✓ complete (existing "What next?" chooser appears if the plan forks) |
| Idle, active project has planned work | ▶ `Next: ‹first planned task of the active project›` | ▶ starts it; ▾ opens a picker with the project's other open tasks |
| Idle, nothing planned | ▶ `Start a task…` | opens the picker (all open tasks, active project first) |

Rules:

- **Starting tracking anywhere** (▶ on a Week-view card, in the task list,
  in the header picker) **sets the active project to that task's project**
  (❓Q2 for which level; ❓Q13 for tasks without project) and starts the
  session.
- Starting a task while another one is tracked **stops the running one
  first** instead of failing with the current 409 (❓Q10).
- Changing the active project by hand does **not** stop tracking (❓Q10);
  the tracker simply shows a task outside the active project, with its
  project name as a small prefix.
- Shortcut **T** toggles tracking of the current/next task.

### 3.3 Quick add

A single-line input in the header (mobile: bottom sheet from the ⊕ button).
**N** focuses it from anywhere. Enter saves and keeps the input open and
empty for the next item (rapid capture); Escape closes.

Inline tokens (❓Q8), parsed live and shown as chips under the input so the
user sees how the text was understood:

| Token | Meaning | Example |
|---|---|---|
| duration | estimate (same parser as the form) | `30m`, `1.5h`, `1:30` |
| `#name` | tag (autocomplete; unknown name → "new tag" chip, created on save) | `#maker` |
| `+name` | project, overrides the active project for this one task | `+Blog` |
| `!n` | priority 0–10 | `!8` |
| `>date` | deadline | `>fri`, `>tomorrow`, `>2026-10-03`, `>10.3.` |
| `\` | escapes the next token (`\#1` stays text) | |

Everything else is the header. Example:

```
[ + Order high-temp filament 30m #maker !7 >fri                        ]
    ● T250   ⏱ 30m   #maker   !7   ⏰ Fri 02.10.
```

- The active project is preselected and shown as the first chip; clicking
  its ✕ removes it for this task.
- ⌘/Ctrl+Enter saves *and* opens the full edit dialog for details.
- Where does a new task go inside a project with a budget? ❓Q14.

---

## 4. Splitting a task into subtasks

### 4.1 Entry points

- "Split into subtasks" button in the edit dialog (all devices).
- Context menu / keyboard **S** on a selected task in the outline (§5) and
  on a Week-view card (desktop).
- A task that already has subtasks opens the same editor with them loaded
  ("Edit parts").

### 4.2 Split editor

```
┌ Split "Hardware Design" ────────────────────────────── T250 · #maker · ⏰ Fri 10.10. ┐
│                                                                                    │
│ Estimate [ 12h  ]      Σ parts 10h  ·  2h not assigned yet                          │
│ ██████ CAD 3h ██████│ prints 2h │orders│ refine 2h │ assembly 2h │░░░░ 2h ░░░░│      │
│                                                                                    │
│   1  CAD                              [ 3h    ]   #maker                           │
│   2  test prints                      [ 2h    ]   #maker                           │
│   3  component orders                 [ 1h    ]   #maker                           │
│   4  CAD refinements                  [ 2h    ]   #maker                           │
│   5  assembly                         [ 2h    ]   #maker                           │
│   6  ▏                                [ ~2h   ]            ← ghost: share of rest   │
│                                                                                    │
│ ☐ Do these in this order  (adds dependencies 1 → 2 → 3 → 4 → 5)                    │
│ Inherit from parent:  ☑ tags #maker   ☑ deadline Fri 10.10.   ☑ priority 7          │
│                                                                                    │
│ [ Set estimate to Σ parts (10h) ]                              [ Cancel ] [ Save ]  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Row editing (keyboard-first, like an outliner):

| Key | Effect |
|---|---|
| Enter | new row below (focus in header) |
| Tab / Shift+Tab | indent / outdent — a row can become a sub-part of the row above (nested split in one go) |
| Backspace in an empty row | delete row, focus previous |
| Alt+↑ / Alt+↓ | move row |
| typing `CAD 3h` in the header cell | the duration token moves into the estimate cell |
| pasting multi-line text | one row per line (tokens parsed per line) |

### 4.3 How the numbers add up

The user asked for parts that "automatically add up to the original
estimate but also allow changing the sum". Proposal:

1. **Estimate is a budget.** It starts as the parent's current estimate and
   only changes when the user edits it or presses *Set estimate to Σ parts*.
2. **Rows without a typed duration show a ghost value** (`~2h`, grey): the
   not-yet-assigned rest divided equally among them, rounded to 15 min.
   So a fresh split of a 12h task into four empty rows shows `~3h` each —
   it adds up without typing a single number.
3. **Typing a duration makes that row explicit**; the ghosts of the other
   rows rebalance immediately.
4. The **allocation bar** shows explicit parts (solid, in row order), ghosts
   (lighter) and the unassigned rest (hatched). If Σ parts exceeds the
   estimate the overflow is red and the summary reads
   `2h over the estimate — [Raise estimate to 14h]`.
5. **On Save** ghost values are written as real estimates. A remaining
   positive rest (only possible when every row is explicit) stays on the
   parent as its *Rest* (task-hirachy.md's dummy task); a negative one
   leaves the parent with the over-budget warning.
6. Editing the estimate field directly is how the user says "now that I
   see the steps, the whole thing takes 14h, not 12h".

### 4.4 What the subtasks inherit (❓Q4)

| Field | Proposal |
|---|---|
| Project | implicit through the tree |
| Tags | copied at creation (checkbox in the editor), editable per row afterwards |
| Deadline | effective deadline = earliest of own and all ancestors' (a child can be earlier, never later) |
| Priority | copied at creation |
| Color | inherited live unless the child sets its own |
| Time already spent on the parent | stays on the parent and is subtracted from its Rest (❓Q4) |
| Dependencies | ❓Q5 — proposed: a parent's predecessors apply to all its children, and anything depending on the parent waits for all children |

### 4.5 The parent after splitting

- The parent is no longer scheduled itself; its children and (if positive)
  its Rest placeholder are (❓Q3).
- In the Week view, the Rest placeholder is drawn hatched with the title
  "Rest of Hardware Design"; clicking it opens the split editor.
- The parent completes automatically when all children are done (❓Q6).
  A leftover Rest is then dropped.

---

## 5. Outline (Projects / Tasks tab and sorting sessions)

The split editor's row editing is the same component as a full-page
**outline**: the tree of all open tasks, one row per task.

```
▾ ● T250                               Σ 18h / 20h   #maker          ⏰ 31.10.   !7
    ▾ Hardware Design                  Σ 10h / 12h   #maker          ⏰ 10.10.   !7
        CAD                              3h          #maker                      !7   ▶
        test prints                      2h          #maker                      !7   ▶
        …
      Rest of Hardware Design            2h
    ▸ Firmware                           4h
▸ ● Company Blog                       Σ 9h
  Inbox (3)                                          ← tasks without project/estimate
```

- Click a cell (or Enter on a row) to edit it inline; same tokens as quick
  add in the header cell. Enter on the last row adds a sibling.
- Tab / Shift+Tab re-parents (indenting *is* splitting); Alt+↑/↓ reorders.
- Digit keys `0`–`9` set the priority of the selected row (❓Q9).
- ▶ on a row starts tracking (and sets the active project, §3.2).
- A filter bar: *Active project only* (default ❓Q11) · *All* · *Inbox*.

### 5.1 Sorting session

"Sort" mode is the outline filtered to *Inbox* (no project and/or no
estimate, ❓Q7) with the first row selected. The user walks the list
with ↑/↓ and assigns with single keys: **P** project, **E** estimate,
**#** tag, digits priority, **S** split, **Del** delete, **Enter** full
dialog. A row leaves the inbox as soon as it has a project and an estimate.

---

## 6. The full edit dialog (existing `TaskFormDialog`)

Changes only:

- Project select is preselected with the active project for new tasks.
- New "Parent" field (autocomplete over tasks) when the tree model is
  adopted (❓Q1); it replaces the project select, or the project select
  stays as a shortcut for "parent = project root".
- For a task with children: the estimate shows `Σ parts 10h / 12h` with the
  *Set estimate to Σ parts* button and an "Edit parts" button.
- Validation messages stay as implemented.

---

## 7. Mobile

- Header: active project chip + compact tracker (⏹ time ✓); tabs below.
- ⊕ floating button → quick-add bottom sheet (same tokens, plus tappable
  chips for recent tags/projects because typing `#` is slow on phones).
- Split editor becomes a full-screen dialog; indent/outdent via buttons
  on the focused row instead of Tab.
- Hover overlays don't exist; tapping a card opens the edit dialog.

---

## 8. Keyboard map (desktop)

| Key | Where | Action |
|---|---|---|
| N | anywhere (not in an input) | focus quick add |
| P | anywhere | open active project switcher |
| T | anywhere | toggle tracking of the current / next task |
| S | outline row, Week-view card | split |
| / | anywhere | search tasks |
| Esc | popovers, quick add | close |

---

## 9. Open questions

Each question lists the proposed default; the sections above assume it.

1. **What is a project?** (a) As in task-hirachy.md: any task with
   subtasks; the separate `Project` model is migrated into the task tree.
   (b) Keep `Project` as a separate container and allow subtasks only
   *inside* it. — *Proposed: (a).* Splitting a task and creating a
   (sub-)project become the same act, and "Hardware Design" can be active
   just like "T250".
2. **Which level becomes active** when tracking starts on a deeply nested
   task (`T250 › Hardware Design › CAD`)? — *Proposed: the nearest parent
   (`Hardware Design`), shown as a breadcrumb so one click widens it to
   `T250`.*
3. **Is the Rest placeholder planned** (it reserves calendar time) or only
   displayed in lists? — *Proposed: planned, so splitting never silently
   frees up time you still believe you need.*
4. **Time already spent on a parent** before it was split: does it count
   against its Rest, or is it moved onto the first child? — *Proposed:
   counts against the Rest.* And: tags/priority **copied** at creation vs.
   **inherited live**? — *Proposed: copied (editable per child); deadline
   inherited live as an upper bound.*
5. **Dependencies and the tree:** do a parent's predecessors automatically
   apply to all children, and does "depends on Hardware Design" mean "on
   all of its children"? Should the split editor's "in this order"
   checkbox be on or off by default? — *Proposed: yes / yes / off.*
6. **Parent completion:** automatically when all children are done (Rest
   dropped), or explicit? — *Proposed: automatic, with an undo snackbar.*
7. **Tasks without estimate:** allowed (they sit in the Inbox and are not
   planned until estimated), or always required / defaulted (e.g. 30 min)
   so they get planned right away? — *Proposed: allowed; Inbox until
   estimated.* This relaxes the current "duration is required" validation
   for quick add.
8. **Inline syntax in quick add:** wanted? Are `#tag`, `+project`, `!prio`,
   `>deadline`, durations the right tokens? Which date formats do you type
   (`fri`/`fr`, `3.10.`, `2026-10-03`, German weekday names)? — *Proposed:
   the table in §3.3, English and German weekday abbreviations.*
9. **Prioritizing during sorting:** keep the numeric 0–10 priority (digit
   keys), switch to a ranked order within a project (drag = priority), or
   use a few categories (must / should / could)? — *Proposed: keep 0–10
   with digit keys; ranking may come later.*
10. **Tracking switches:** starting task B while A is tracked → stop A
    automatically (instead of today's 409)? Changing the active project by
    hand → keep tracking? — *Proposed: yes / yes.*
11. **Active project scope:** persisted on the server (same on all
    devices) or per browser? Should it also filter the Tasks/Projects
    views by default? — *Proposed: server; filter the outline by default
    with a one-click "All".*
12. **Mobile priority:** is quick capture on the phone a must for the first
    version, or is desktop first fine? — *Proposed: quick add + tracker on
    mobile in v1; split editor and outline desktop-first.*
13. **Tracking a task without a project:** clear the active project or
    keep the previous one? — *Proposed: keep the previous one* (a stray
    errand shouldn't knock you out of your project context).
14. **Adding a task to a project that has a budget** (via quick add): does
    it consume the project's Rest (Σ parts grows, estimate unchanged) or
    grow the estimate? — *Proposed: consume the Rest; the over-budget
    warning appears if it runs out.*

---

## 10. Implementation outline (to be refined after §9)

Backend (assuming Q1 = a):

- `Task.parent` (FK to self, nullable) + `Task.order` among siblings;
  cycle check on re-parenting (reuse `graph.find_path` logic) → 400 with
  the path, as for dependencies.
- Data migration: each `Project` becomes a root task; its
  `ProjectTaskItem`s become children in order; project color/tags/priority
  move onto the root task. `/api/projects/` stays as a read view
  ("tasks with children") until the frontend has migrated.
- Planner: plan leaves + positive Rests of parents; effective deadline =
  min over ancestors; dependency expansion per Q5; parent completion per Q6.
- `POST /api/tasks/{id}/split/` — atomic: create/update/delete children,
  update the parent estimate, optional sequential dependencies.
- Tracking start auto-stops the open session (Q10).
- User settings singleton: `active_task_id` (the active project) (Q11).

Frontend:

- `parseQuickAdd(text, context)` pure function (+ tests) returning header,
  duration, tags (existing/new), project, priority, deadline, tokens with
  character ranges for the chips.
- Components (each in its own folder with tests + stories):
  `ActiveProjectSwitcher`, `HeaderTracker`, `QuickAdd`,
  `SplitEditor` (built on `OutlineRows`), `OutlineView`, `AllocationBar`.
- Pure helpers: `ghostDurations(estimate, rows)`, `restOf(task, children)`,
  `effectiveDeadline(task, ancestors)`.
- Keyboard shortcuts via one `useGlobalShortcuts` hook that ignores events
  from inputs.

Acceptance scenarios (become e2e tests, see e2e-test-cases.md):

1. From the Week view: N, type `Order filament 30m #maker`, Enter → task
   exists in the active project T250 with 30 min and #maker; focus stays in
   quick add.
2. ▶ on "CAD" in the Week view → header shows `T250 › Hardware Design`
   and `⏹ CAD 00:00:01`; ▶ on a Blog task → CAD stops, Blog becomes active.
3. Split "Hardware Design" (12h): type five names, no numbers → each shows
   `~2h 15m`/`~2h 30m` summing to 12h; type `3h` for CAD → the others
   rebalance to fill 9h; press "Set estimate to Σ parts" after changing
   values to a 10h total → estimate becomes 10h, no Rest remains.
