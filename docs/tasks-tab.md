# The Tasks tab — one tree for navigating, editing and ordering

Status: plan (2026-09-30). Replaces the old flat "Tasks" tab and renames the
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
│ ⠿       CAD                          3h          #maker          ━━●━  7 ▶│   the active node marked
│ ⠿       test prints                  2h          #maker          ━━●━  7 ▶│
│         Rest of Hardware Design      2h                                  ▶│
│ ⠿   ▸ Firmware                       4h                          ━●━━  5 ▶│
│ ⠿ ▾ ● Company Blog                 Σ 9h                          ━●━━  6   │ ← then all other projects,
│ ⠿       Write CMS comparison         3h (default)                ━●━━  6 ▶│   by priority
│ ⠿   ● Buy milk                       1h (default)                ●━━━  2 ▶│
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

## 3. Decisions (proposed defaults — confirm or change)

| # | Question | Proposal |
|---|---|---|
| 1 | What does a click on a row do? | Opens the edit dialog (like the old Tasks tab). Selection follows the click; ↑/↓ + Enter do the same from the keyboard. Inline header editing is dropped in favour of the dialog. |
| 2 | Completed tasks? | Hidden by default; "Show completed" shows them greyed and struck through in their place in the tree (not draggable, ✓ can reopen). |
| 3 | Collapsed by default? | Everything expanded; collapse state remembered per browser. |
| 4 | Drag what? | Only the handle ⠿ — keeps clicks (dialog), the slider and text selection free, and works with long-press on touch. |
| 5 | Keyboard `A` | Freed (no filter). Tab/Shift+Tab/Alt+↑↓ stay and use the new move endpoint. |

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

**T-2 · Tabs: Tasks first, old list removed — S**
- Tab order *Tasks · Week · Calendar · Tags · Time Buckets · Dependencies*;
  the app opens on Tasks. The outline is the Tasks tab; `TaskList` is
  removed. "+ New task" button in the tab. The switcher's "Show all
  projects" becomes "Show all tasks" (opens the tab). Short phone labels
  (UI-9) adapted.
- *Accept:* tab order and default tab; every former way to add/edit a task
  still exists in the Tasks tab (tests migrated from `TaskList`).

**T-3 · One tree, active project on top, compact rows — M**
- Remove the filter; build the tree with the active project's root first,
  the active path expanded and marked; collapse state per browser, default
  expanded; compact aligned rows; "Show completed" toggle (decision 2).
- *Accept:* order with an active sub-project; switching the active project
  (header) re-sorts; collapsed state survives a reload; completed rows only
  with the toggle.

**T-4 · Edit dialog in the tree — S**
- Click / Enter opens `TaskFormDialog`; focus returns to the row on close;
  after saving, the row shows the changes; the sorting session keeps its keys.
- *Accept:* click → dialog → save → row updated and still selected; ↓ Enter
  opens the next task.

**T-5 · Priority slider — S**
- `PrioritySlider` (own component): compact MUI slider 0–10, value label
  while dragging, keyboard arrows; optimistic, one PATCH on release;
  phones: tapping the `!7` chip opens the slider in a popover.
- *Accept:* drag from 5 to 8 sends exactly one PATCH `{priority: 8}`; the
  planner-relevant order updates; failure rolls back with a message.

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

**T-7 · Phones, docs, live check — S**
- Touch: long-press on the handle drags; row buttons (UI-9) keep working;
  slider popover. Update README/spec, Storybook stories for new pieces, live
  check with demo data (desktop + 390 px).

Order: T-1 → T-2 → T-3 → T-4 → T-5 → T-6 → T-7 (T-4/T-5 are independent of
T-3 and can swap).
