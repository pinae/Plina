# The Tasks tab — one tree for navigating, editing and ordering

Status: plan, decisions confirmed (2026-09-30). Replaces the old flat "Tasks" tab and renames the
outline ("Projects") to **Tasks**. Builds on docs/task-entry-ui.md (task tree,
outline §5, sorting session §5.1).

## 1. Why

Since UI-1 every project is just a top-level task, so "Projects" and "Tasks"
show the same thing twice: the old Tasks tab as a flat list that wastes space
and hides the structure, the outline under a name that no longer fits. One
tab should give the overview of everything on the todo list — as a tree, with
the current project on top — and let the user edit, prioritize and reorder
without leaving it.

## 2. Target picture

```
 Tasks   Week   Calendar   Tags   Time Buckets   Dependencies          ← Tasks first, Week second
┌────────────────────────────────────────────────────────────────────────────┐
│ Tasks          [+ New task]   Inbox (3)  Sort ▶      ☐ Show completed      │
├────────────────────────────────────────────────────────────────────────────┤
│ ⠿ ▾ ● T250                         Σ 18h / 20h  #maker  ⏰ 31.10. ━━●━━ 9 ▶│ ← active project on top,
│ ⠿   ▾ Hardware Design  (active)    Σ 10h / 12h  #maker  ⏰ 10.10. ━━●━  7  │   its path expanded,
│ ⠿       CAD                          3h         #maker            ━━●━  7 ▶│   the active node marked
│ ⠿       test prints                  2h         #maker            ━━●━  7 ▶│
│         Rest of Hardware Design      2h                                   ▶│
│ ⠿   ▸ Firmware                       4h                           ━●━━  5 ▶│
│ ⠿ ▾ ● Company Blog                 Σ 9h                           ━●━━  6  │ ← then all other projects,
│ ⠿       Write CMS comparison         3h (default)                 ━●━━  6 ▶│   by priority
│ ⠿   ● Buy milk                       1h (default)                 ●━━━  2 ▶│
└────────────────────────────────────────────────────────────────────────────┘
 ⠿ drag handle · ━━●━━ priority slider (0–10) · ▶ track
```

- **All tasks, one tree.** Every open task is shown with its indentation;
  there is no *Active project / All projects* filter any more. The active
  project's top-level task comes first, the path down to the active
  (sub-)project is expanded and the active node is marked; the other
  projects follow by priority. Collapsed parents are remembered per browser;
  by default everything is expanded.
- **Compact rows** (≈ 32 px) with aligned columns: handle, expander, name,
  Σ/estimate, tags, deadline, priority, ▶. The keyboard help line becomes a
  "?" tooltip.
- **Edit in place with the full dialog.** Clicking a row (or Enter) opens the
  existing `TaskFormDialog` for that task; closing it returns to the same row,
  so ↑/↓ + Enter walk through the list. "+ New task" opens the dialog for a
  new task in the active project. The quick inline edits (E estimate, #
  tag, digits for priority) and the sorting session stay.
- **Priority slider** in every row: click-and-drag (or click a position) sets
  0–10; saved once on release. Digit keys keep working.
- **Drag and drop** by the handle: move a row (with its subtree) up/down and
  left/right — the horizontal position of the pointer decides the new
  indentation level, a line with an indented marker shows where it will land.
  Rest rows cannot be dragged; a row cannot be dropped into its own subtree.
- **A parent that loses its last subtask stays open.** It becomes an
  ordinary task again with its own estimate — moving a task never completes
  (or deletes) anything. Only *completing* the last open subtask completes the
  parent (UI-2, unchanged).

## 3. Decisions (confirmed 2026-09-30)

| # | Question | Decision |
|---|---|---|
| 1 | What does a click on a row do? | Opens the edit dialog (like the old Tasks tab). Selection follows the click; ↑/↓ + Enter do the same from the keyboard. Inline header editing is dropped in favour of the dialog. |
| 2 | Completed tasks? | Hidden by default; "Show completed" shows them greyed and struck through in their place in the tree (not draggable, ✓ can reopen). |
| 3 | Collapsed by default? | Everything expanded; collapse state remembered per browser. |
| 4 | Drag what? | Only the handle ⠿ — keeps clicks (dialog), the slider and text selection free, and works with long-press on touch. |
| 5 | Keyboard `A` | Freed (no filter). Tab/Shift+Tab/Alt+↑↓ stay and use the new move endpoint. |

### 3.1 Usability guides: Todoist and Wunderlist (2026-09-30)

The tab follows the conventions users know from Todoist and Wunderlist
where they fit Plina:

| Convention (source) | In the Tasks tab | WP |
|---|---|---|
| Round checkbox at the start of every row completes the task; a toast offers Undo (both) | ○ before the name; completing shows "Completed “CAD” — Undo" (parents still complete by themselves with their last subtask) | T-3 |
| Drag handle appears on hover, left of the row (Todoist) | ⠿ fades in on row hover/selection; always visible on touch | T-3, T-6 |
| Dragging sideways changes the indentation; an indented drop line shows the level (Todoist) | as planned in T-6 | T-6 |
| Moves can be undone from a toast (Todoist) | "Moved “CAD” into “Firmware” — Undo" — Undo moves it back to its old parent and position | T-6 |
| Click opens the task detail; ↑/↓ in the detail walk to the previous/next task without closing it (Todoist) | the edit dialog gets ‹ › buttons and Alt+↑/↓ to switch to the neighbouring row; unsaved changes are saved first (or the switch is refused while the form is invalid) | T-4 |
| "Add task" inline at the end of a list/section (Todoist) | "+ Add task" row at the end of every expanded parent and at the end of the tree; opens an inline input with the quick-add tokens | T-3 |
| Completed to-dos behind "Show completed" (Wunderlist) | the toggle (decision 2) | T-3 |
| Dense rows, secondary info right-aligned and muted (both) | compact rows; estimate, tags, deadline muted; overdue deadlines red | T-3 |
| Priority is visible at a glance (Todoist's coloured flags) | the slider's track is coloured by priority band (0–3 grey, 4–6 blue, 7–8 orange, 9–10 red) | T-5 |

## 4. Work packages

Each package is testable on its own and leaves the app working.

**T-1 · Backend: atomic move — S**
- `POST /api/tasks/{id}/move/` with `{parent_id: uuid|null, index: int}`:
  sets the parent and the position among the new siblings, renumbers the
  old and new sibling lists contiguously, in one transaction, one plan
  recalculation.
- Refuses (400, message + path/cycle): moving into the own subtree, a move
  that creates a dependency cycle through the tree, moving into or out of a
  completed task, moving a completed task.
- Never completes a parent that loses its last (open) subtask; the parent
  keeps its estimate and becomes a leaf or keeps only completed children.
- *Accept:* tests for reorder within a level, move to another level at a
  given index, move to top level, all refusals, sibling orders contiguous
  afterwards, parent that lost its last subtask is open and plannable.
- *Delivered (2026-09-30, TDD):* 15 new backend tests (`test_move.py`), 309
  backend tests green. `services/tree.py`: `move_task(task, new_parent,
  index)` — `index` counts the new siblings without the task itself and is
  clamped to the end; old and new sibling lists are renumbered 0, 1, 2 … in
  one transaction; `parent_change_error()` now holds the own-subtree and
  dependency-cycle checks shared with PATCH `parent_id` (same messages,
  `path`/`cycle` in the payload). `POST /api/tasks/{id}/move/` with
  `{parent_id, index}` returns `{task}` and recalculates the plan once.
  Refused: a completed task ("Reopen it first to move it"), a completed
  target, own subtree, dependency cycle, negative index, unknown parent.
  Verified over HTTP on the demo data (reorder, move into another project,
  cycle refused). Beyond the plan: an active sub-project that loses all its
  subtasks is no longer a project, so the nearest project above it becomes
  active (`ensure_active_is_project`).

**T-2 · Tabs: Tasks first, old list removed — S**
- Tab order *Tasks · Week · Calendar · Tags · Time Buckets · Dependencies*;
  the app opens on Tasks. The outline is the Tasks tab; `TaskList` is
  removed. "+ New task" button in the tab. The switcher's "Show all
  projects" becomes "Show all tasks" (opens the tab). Short phone labels
  (UI-9) adapted.
- *Accept:* tab order and default tab; every former way to add/edit a task
  still exists in the Tasks tab (tests migrated from `TaskList`).
- *Delivered (2026-09-30, TDD):* 5 new frontend tests (`App.test.tsx`: tab
  order, default tab, no Projects tab, "+ New task", double-click → dialog,
  "Show all tasks"); the CRUD happy-path test now adds its task via "+ New
  task" in the Tasks tab. Tabs are keyed (`'tasks' | 'week' | …`) instead of
  numbered; the app opens on Tasks; accepting a plan in "Plan my week"
  still switches to the Week. `TaskList` and its floating add button are
  removed (on phones the ⊕ quick-add sheet covers quick capture). The
  outline's heading reads "Tasks" and carries "+ New task" (full dialog,
  parent preselected with the active project); a double-click on a row opens
  the edit dialog instead of inline renaming (decision 1 — single click and
  Enter follow in T-4). The switcher's footer reads "Show all tasks".

**T-3 · One tree, active project on top, compact rows — M**
- Remove the filter; build the tree with the active project's root first,
  the active path expanded and marked; collapse state per browser, default
  expanded; compact aligned rows; "Show completed" toggle (decision 2).
- *Accept:* order with an active sub-project; switching the active project
  (header) re-sorts; collapsed state survives a reload; completed rows only
  with the toggle.
- *Delivered (2026-09-30, TDD):* 21 new frontend tests (494 total):
  `outlineTree` (order, active mark, completed rows, expander without open
  subtasks), `taskTreePrefs`, and 12 outline tests. `outlineItems(tasks,
  {activeId, collapsed, showCompleted})` replaces the filter: the active
  project's top-level task first, the other projects in their **own
  (manual) order** — not by priority as sketched in §2, so reordering by drag
  and drop (T-6) is what the user sees; the active node carries an "active"
  label. The filter, its toggle, the `A` key and `utils/outlineFilter.ts`
  are gone. Collapsed rows and "Show completed" live per browser
  (`utils/taskTreePrefs.ts`); when the active project changes, its path is
  opened once (the user may collapse it again). Rows: a circle completes the
  task (toast "Completed “CAD” — Undo", naming a parent that completed
  along; Undo reopens it and those parents), disabled with a tooltip on
  parents with open subtasks; completed rows (with the switch) are greyed,
  struck through, and their circle reopens them. "+ Add task" sits at the
  end of every expanded **top-level** project (like Todoist's per-project
  add) and at the end of the tree, opening the inline input with the
  quick-add tokens and the parent's tags/priority. Compact 32 px rows with
  right-aligned muted columns (estimate, tags, deadline, priority, ▶); tags
  and deadline hide on phone widths; overdue deadlines are red and bold.
  The keyboard help moved into a "?" tooltip (not on touch). Verified live
  with the demo data (desktop and 390 px): order with the active project,
  complete + Undo, add a task to a project with tokens, "Show completed",
  collapse surviving a reload. The row still selects on click — the dialog
  on click follows in T-4.

**T-4 · Edit dialog in the tree — S**
- Click / Enter opens `TaskFormDialog`; focus returns to the row on close;
  after saving, the row shows the changes; the sorting session keeps its keys.
- *Accept:* click → dialog → save → row updated and still selected; ↓ Enter
  opens the next task.
- *Delivered (2026-09-30, TDD):* 9 new frontend tests (503 total): 4 in
  `TaskFormDialog` (walk without changes, save first, invalid form refuses,
  Alt+↑/↓), 5 in the outline (click and Enter open, closing returns to the
  row, ↑/↓ skip Rest rows with the selection following, first task has no
  previous, Rest row → split editor). A click on a row (or Enter) opens the
  edit dialog; a Rest row opens the split editor. `TaskFormDialog` is now a
  shell keeping the `Dialog` open and a form remounted per task (`key`), so
  switching tasks does not close and reopen it; with `onNavigate` /
  `canNavigate` it shows ↑/↓ buttons in the title (and Alt+↑/↓ from any
  field). Unsaved changes are saved before switching; an invalid form
  refuses and shows its errors. The outline keeps the dialog's task by id,
  so returning to an edited task shows the saved values, and moves the
  selection along; closing refocuses the tree on that row. Inline renaming
  on Enter is gone (decision 1) and with it "Enter on the last row adds a
  sibling" — the "+ Add task" rows (T-3) do that now; `#` still edits the
  tags inline, E the estimate. Verified live with the demo data: click →
  rename → ↓ saves and shows the next task, Alt+↓, Cancel lands on the last
  shown row, ↓ Enter opens the next; on a phone a tap opens the full-screen
  dialog with the arrows.

**T-5 · Priority slider — S**
- `PrioritySlider` (own component): compact MUI slider 0–10, value label
  while dragging, keyboard arrows; optimistic, one PATCH on release;
  phones: tapping the `!7` chip opens the slider in a popover.
- *Accept:* drag from 5 to 8 sends exactly one PATCH `{priority: 8}`; the
  planner-relevant order updates; failure rolls back with a message.
- *Delivered (2026-10-01, TDD):* 19 new frontend tests (522 total): band
  helper (`utils/priority.ts`), 8 for `PrioritySlider` (drag commits once on
  release, track click, arrows, unchanged value not sent, clicks stay out of
  the row, holds the committed value until the save settles and follows a
  rollback, compact chip + popover) and 3 in the outline (drag 5 → 8 → one
  PATCH and the row shows 8 at once, refused change rolls back with the
  server's message, phones get the chip). `useSetPriority` updates the task
  list optimistically and restores it on error; the digit keys use it too.
  The slider (72 px, value next to it, coloured grey/blue/orange/red by
  band) replaces the `!7` text; completed rows keep the text. Phones show a
  coloured `!7` chip opening the slider in a popover. Detail: an optimistic
  update and its rollback can reach the row in one render, so the slider
  holds the committed value until the returned save promise settles, not
  just until its value changes. Verified live: a real mouse drag 8 → 10
  sent exactly one PATCH and opened no dialog; on a phone the chip's
  popover changed "Load test" by two steps with the arrow keys.

**T-6 · Drag and drop — L**
- `@dnd-kit/core` + `@dnd-kit/sortable` (touch + keyboard sensors, screen
  reader announcements). Pure helper `projectDrop(rows, activeId, overId,
  offsetX)` → `{parentId, index, depth}` (the "sortable tree" projection:
  horizontal offset / indent width = depth change, clamped to what the
  neighbours allow); drop indicator; collapsed parents auto-expand on hover;
  own subtree and Rest rows excluded; optimistic reorder in the cache with
  rollback and the server's message on refusal. Tab/Alt+↑↓ reuse the same
  move call.
- *Accept:* table tests for `projectDrop` (same level, deeper, shallower,
  into an empty parent, top level, own subtree refused); component test with
  dnd-kit's keyboard sensor moving a row into another parent → one move
  request with the right parent/index; the former parent without children
  stays open (visible, not completed).
- *Delivered (2026-10-01, TDD):* 23 new frontend tests (545 total): 17
  table tests in `utils/treeDnd.test.ts` (`projectDrop`: reorder, deeper,
  shallower, top level, into a leaf, clamping, own subtree refused, collapsed
  parent appends, no nesting under completed tasks, hidden completed
  siblings counted, unchanged; `applyMove`; Tab/Shift+Tab/Alt+↑↓ targets),
  and in the outline 6 drag tests driven by real pointer events (jsdom gets
  a `PointerEvent` polyfill and stacked row rectangles): right by one indent
  → `move fw hw 2`, down one row → reorder, a parent losing its last
  subtask stays open, the subtree hides while its parent is dragged, Rest
  and completed rows have no handle, hovering a collapsed parent opens it —
  plus 3 for Undo and refusals. New dependency: `@dnd-kit/core` 6.3,
  `@dnd-kit/sortable` 10, `@dnd-kit/utilities` 3. Rows are sortable by the
  ⠿ handle (fades in on hover/selection, always shown on touch; pointer
  sensor after 4 px, touch after a 250 ms long-press, keyboard sensor for
  up/down); while dragging the row's subtree is hidden and the row shows
  the projected indentation. `projectDrop` expresses the drop against the
  stored sibling order (the move endpoint's `index`), so hidden completed
  tasks and the pinned active project do not shift it. `useMoveTask` applies
  the move optimistically (`applyMove`) and rolls back on refusal with the
  server's message; Tab, Shift+Tab, Alt+↑/↓, M and the touch row buttons use
  it too (one request each instead of several PATCHes; outdent lands right
  after the old parent). One Undo toast serves completions and moves:
  "Moved “X” into “Y” / to the top level — Undo". The old `indentParent` /
  `outdentParent` / `reorderPatches` helpers are gone.
  Verified live with a real mouse: a task nested by dragging one indent
  right (and Undo put it back), a task dragged from Company Blog into
  Webshop Relaunch at the pointer's position, the last subtask dragged out
  of Company Blog (which stayed open with no subtasks), a parent with its
  subtree dragged to the top; on a phone a long-press drag nested a task
  without opening the dialog. A dependency-cycle refusal showed the
  server's reason and left the row in place.
  Bug found on the way: hiding the "+ Add task" rows during a drag shifted
  the dragged row away from the pointer — they stay, and the rows are
  re-measured while dragging (the subtree collapses).

**T-7 · Phones, docs, live check — S**
- Touch: long-press on the handle drags; row buttons (UI-9) keep working;
  slider popover. Update README/spec, Storybook stories for new pieces, live
  check with demo data (desktop + 390 px).

Order: T-1 → T-2 → T-3 → T-4 → T-5 → T-6 → T-7 (T-4/T-5 are independent of
T-3 and can swap).
