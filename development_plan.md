# Plina — Development Plan: Dependency-Aware Planning

**Status of this document:** Design + work breakdown for the next development phase.
**Audience:** Junior developers and AI coding agents. Each work package is self-contained, lists its files, and has explicit acceptance criteria.
**Repository:** https://github.com/pinae/Plina (monorepo: `apps/backend` Django/DRF, `apps/frontend` React 19 + Vite + MUI)

---

## 1. The Idea (refined)

Plina is a task manager that plans for you, but never takes your freedom away.

Classic calendars force you to place every task by hand. Classic to-do lists ignore time entirely. Plina sits between the two: you describe your work (tasks, durations, deadlines, priorities, tags) and your available time (recurring TimeBuckets like "weekday mornings, 4h, #deep-work"), and the planner packs the tasks into the buckets like a CPU scheduler packs processes onto cores — respecting affinity (tags ↔ buckets), stickiness (avoid context switches), and preemption (re-plan when reality changes).

**The new core concept: task dependencies.** Tasks form a directed acyclic graph (DAG). An edge A → B means *finish-to-start*: B may not be scheduled before all planned work of A is allocated. Any valid plan is therefore a **topological ordering** of the remaining (unfinished) tasks, packed into buckets.

A DAG usually admits *many* valid topological orderings — and that is not a problem, it is the product. Wherever the graph leaves a choice (two independent branches, two ready tasks in different projects), Plina does not silently pick one. It computes **several meaningfully different plans** and lets the user choose based on their current mood and energy — while guaranteeing that *every* offered choice is a valid ordering that still meets all deadlines (or, if none can, warns explicitly).

**The fluidity principle (central design decision):**
- A task becomes **fixed** only when the user *starts time tracking* on it (or manually drags it to a slot). Fixing anchors it in place.
- Everything else stays **fluid**. After finishing a task, the frontier of the DAG changes, and the user is again offered the currently valid choices.
- Re-planning is cheap, constant, and safe: whatever the user picks, project chains still complete before their deadlines — or Plina tells them *now* that they won't, so deadlines/priorities can be renegotiated while there is still time.

Slogan for contributors: *Plina guarantees validity; the user keeps the choice.*

---

## 2. Glossary

| Term | Meaning |
|---|---|
| Task | Unit of work; has `duration` (estimate), `time_spent`, `priority`, optional `latest_finish_date`, tags. |
| Appointment | A task with a fixed `start_date` and duration (e.g., a meeting). Pre-placed, never moved by the planner. |
| Fixed task | `is_fixed=True`. Anchored to its planned slot. Set automatically when time tracking starts, or by manual placement. |
| Dependency | Directed edge `predecessor → successor`, finish-to-start semantics. |
| Frontier | The set of unfinished tasks with no unfinished predecessors — the tasks the user could start *right now*. This is where the user's real choices live. |
| TimeBucketType | Recurrence rule producing TimeBuckets (e.g., "every weekday at 09:00, 4h, tags #deep-work"). |
| TimeBucket | Concrete time block; the "bin" for bin packing. |
| Plan | One complete valid schedule: a topological ordering packed into buckets. |
| Plan alternative | One of 2–4 plans offered simultaneously, each with a human-readable label describing what it optimizes. |
| Critical chain | The dependency path whose total remaining duration leaves the least slack before a deadline. |

---

## 3. User Story (comprehensive)

Mara is a freelance developer with two client projects and a life.

**Setup.** She creates two projects. *Webshop Relaunch* (deadline in 3 weeks) contains: "Design schema" → "Implement API" → "Build checkout UI" → "Payment integration" → "Load test", each 4–8 hours. *Company Blog* contains three loosely coupled articles; only "Research CMS options" must precede "Write CMS comparison". She tags API and schema work `#deep-work`, articles `#writing`. Her TimeBucketTypes: weekday mornings 09:00–13:00 `#deep-work`, weekday afternoons 14:00–17:00 (untagged, accepts anything), Tuesday evening 19:00–21:00 `#writing`. Thursday 10:00 has a fixed client call (an appointment).

**Wiring the graph.** She opens the **Dependency Editor** tab: a node editor showing each task as a card (colored by project), edges as arrows. She drags a connection from "Implement API" to "Build checkout UI". When she accidentally tries to connect "Load test" back to "Design schema", the edge snaps back with a message: *"This would create a cycle: Design schema → … → Load test → Design schema."* The graph auto-layouts left-to-right; the two projects appear as two visually separate strands.

**Choosing a plan.** She hits *Plan my week*. Plina answers with three alternatives, each shown as a labeled card with a mini week preview and metrics:

1. **"Deadline-safe — Webshop first"**: the entire critical chain of the relaunch fills the deep-work mornings; blog work fills Tuesday evening and afternoon gaps. *Min slack: 2.5 days. Context switches: 4.*
2. **"Balanced — start with the blog"**: "Research CMS options" and one article come first (the blog frontier is independent of the webshop chain), webshop chain starts Wednesday. *Min slack: 0.5 days. Context switches: 5.* A yellow badge warns the slack is thin.
3. **"Flow — fewest switches"**: same tasks, ordered to maximize stickiness; whole days on one project. *Min slack: 1.5 days. Context switches: 2.*

There is no alternative like "Payment integration first" — that would violate the dependency graph, so it is never offered. Mara feels like writing today; she picks plan 2, eyes open about the thin slack.

**Working fluidly.** Monday 09:00 she presses ▶ on "Research CMS options". The task turns **fixed** and time tracking runs. She finishes after 3 hours instead of 4. On completion, Plina recalculates: the frontier now contains "Write CMS comparison" *and* "Design schema". Since more than one valid next step exists, the Week view shows a small chooser: *"Continue blog (comparison article)"* vs. *"Switch to Webshop (Design schema)"*. Nothing else in her week is pinned — only the tracked task was ever fixed — so whichever she picks, the rest of the week reflows into a valid ordering.

**Reality intervenes.** Wednesday, "Implement API" overruns badly. When she stops tracking, the planner recalculates and finds the critical chain no longer fits before the deadline. Plina shows a **feasibility warning**: *"Webshop Relaunch cannot finish by Fri 24th. Options: add time buckets (e.g., a weekend morning), extend the deadline, or deprioritize 'Load test'."* Mara adds a Saturday bucket; the warning clears and new alternatives appear. At no point did she drag a single task by hand — but she could have: a manually dragged task simply becomes fixed, and the planner plans *around* it.

**Why she stays.** Mara never faces an invalid plan, never has to re-derive by hand "what can I even do next?", and never loses the freedom to follow her mood. Plina's guarantee is the ordering; the choice is hers.

---

## 4. Current State of the Code (gap analysis)

**Done:** Models (`Task`, `Project`/`ProjectTaskItem`, `Tag`, `TimeBucketType` with recurrence parsing, `TimeBucket`); DRF CRUD for all of them; `services/planner_service.py` with dynamic scoring, EDF ranking, greedy allocation (affinity, stickiness, 15-min quantum, deadline warnings) + tests; `GET /api/plan/`; frontend tabs WeekView (dummy data, midnight splitting, tests), Calendar (renders `/api/plan/`), read-only TaskList; demo-data command.

**Missing / broken:**
1. No dependency model, no cycle detection, no topological sorting, no alternatives.
2. No node editor.
3. No "done" state on Task at all (`time_spent` exists but nothing marks completion).
4. `is_fixed` exists but the allocator ignores it — manual-overrides-automatic is not enforced. Appointments (`start_date` set) are also not pre-placed.
5. `tasks/planner.py` is a half-finished parallel implementation (`plan_untimed_tasks()` is `pass`); `gather_time_buckets()` (bucket generation over a horizon) is never called by `PlannerView`, which only reads buckets already in the DB.
6. Plan is recomputed on every GET; nothing persists; no accept flow; no time tracking endpoints.
7. WeekView not connected to the API; no create/edit UI for tasks/projects/tags/bucket types.
8. The allocator mutates `task.duration` in-place during planning (dangerous if anything ever saves) — violates the README's immutability guideline.

---

## 5. Architecture Decisions

**A1 — Dependencies as their own model.** `TaskDependency(predecessor FK → Task, successor FK → Task)` with `unique_together` and a check against self-edges. Cycle detection happens in the service layer at write time (reject with the offending cycle path in the error) and defensively again at planning time.

**A2 — All algorithmic logic lives in `tasks/services/`.** Split into:
- `services/graph.py` — DAG construction, cycle detection, topological utilities, forward/backward pass (earliest start / latest start / slack), critical chain, frontier computation. Pure functions over lightweight in-memory structures (dicts of UUIDs), no Django queries inside the algorithms.
- `services/planner_service.py` — scoring, ranking, dependency-aware allocation. Operates on immutable `PlanningTask` dataclasses (snapshot of `remaining_duration = duration - time_spent`), never mutates model instances (fixes gap 8).
- `services/alternatives.py` — generation, deduplication, labeling, and metrics of plan alternatives.
- Delete `tasks/planner.py` after moving `gather_time_buckets` into the service layer (fixes gap 5).

**A3 — Finish-to-start only.** A successor is eligible for a bucket only if every predecessor is *fully allocated* strictly before that bucket's start (completed tasks count as satisfied). No partial overlaps in v1; the model leaves room for a `type` field later.

**A4 — Plans are persisted, tasks stay fluid.** New models `Plan` (timestamp, label, config JSON, `is_accepted`) and `PlanEntry` (plan, task, start, duration, bucket FK nullable, order). Accepting a plan marks it and discards siblings. Crucially, accepting a plan does **not** fix any task. Fixing happens only via (a) starting time tracking or (b) manual placement. On every recalculation, fixed tasks and appointments are pre-placed as immovable blocks; fluid tasks reflow around them.

**A5 — Alternatives = frontier branches × weight presets.** See §6. Cap at 4 presented plans, deduplicated by induced task ordering.

**A6 — Node editor with `@xyflow/react` (React Flow) + `dagre` auto-layout.** Battle-tested, React-19-compatible, MIT-licensed; do not hand-roll pan/zoom/edge-dragging.

**A8 — Buckets are concrete, hand-adjustable instances (resolved with PO).** TimeBucketTypes pre-generate recurring occurrences over the horizon, but every bucket instance is directly editable: the user can drag and resize buckets in the calendar view like appointments. A generated occurrence materializes (is persisted) the moment the user edits it or a plan using it is accepted; a persisted bucket suppresses the overlapping generated occurrence (implemented in `services/bucket_service.py`). Scheduling semantics: **appointments ignore buckets entirely** (they occupy their fixed start regardless of bucket coverage and reduce any overlapping bucket's capacity); **fixed tasks fill their current bucket and may split across subsequent buckets** if they don't fit.

**A9 — Horizon & free-day lookout (resolved with PO).** Default planning horizon 60 days (an arbitrary but configurable constant, `PLANNING_HORIZON_DAYS`). Appointments beyond the horizon remain visible in the calendar even though nothing is auto-planned there. A deliberate feature: the user can scroll (or jump) to the **first day with no automatically planned task** to see when they'd be free for a new project without rescheduling anything.

**A10 — Per-project finish forecast (resolved with PO).** Task-level dependencies are sufficient; users run multiple projects in parallel and switch by mood. Therefore every plan alternative reports the **projected finish date per project** ("if you stick to this plan, Webshop finishes Thu 22nd, Blog finishes Tue 27th") as a first-class metric.

**A11 — Alternatives cap (resolved with PO).** `MAX_PLAN_ALTERNATIVES = 4`, defined as a single settings constant — explicitly expected to be tuned after real-world use; nothing may hard-code the number elsewhere.

**A7 — Recalculation triggers:** dependency edit, task create/complete/delete, tracking stop, bucket change, manual placement, deadline/priority/duration edit. Recalculation is synchronous for now (single user, small graphs); an async/job design is out of scope for this phase.

---

## 6. The Planning Algorithm (specification)

Input: unfinished tasks (snapshot with `remaining_duration`), dependency edges, buckets over the planning horizon (existing + generated from TimeBucketTypes), current time. Output: a list of `PlanAlternative { label, entries[], metrics, warnings[] }`.

### Phase 0 — Graph preparation (`graph.py`)
1. Drop completed tasks; edges from completed predecessors are satisfied.
2. Cycle check (Kahn's algorithm); on cycle, abort with the cycle path (should never happen — API rejects cycles — but fail loudly).
3. Forward pass: `earliest_finish(t) = max over predecessors + remaining_duration`, measured in *available bucket time* respecting affinity, not wall-clock. Backward pass from `latest_finish_date` gives `latest_start` and `slack(t)`.
4. Any `slack < 0` → **infeasibility warning** carrying the critical chain and suggested remedies (add buckets / move deadline / reduce scope). Still produce best-effort plans, flagged.

### Phase 1 — Choice-point discovery
1. Compute the frontier. Group frontier tasks by *branch*: the sub-DAG reachable from each frontier task (branches may overlap; group by project as tie-breaker).
2. If ≥2 distinct branches exist, each of the top-3 branches (by aggregate score) seeds a **focus alternative**: its tasks get a large score bonus so the ordering starts there.
3. Independently, three **weight presets** exist: `deadline_safe` (deadline weight ↑), `priority_first` (priority weight ↑), `flow` (stickiness bonus ↑↑, quantum ↑ to 30 min).

### Phase 2 — Per-alternative scheduling
For each candidate config (focus branch × preset, pruned to ≤6 runs):
1. Pre-place appointments at their fixed start (ignoring buckets; any overlapped bucket loses that capacity). Pre-place fixed tasks into their bucket; if a fixed task exceeds its bucket, it splits and continues in the following bucket(s).
2. Greedy allocation as today (chronological buckets; affinity filter; stickiness; min quantum) **plus the eligibility rule**: task eligible only if all predecessors fully allocated before this bucket starts. Track per-task allocated time on the immutable snapshot's mutable counter — never on models.
3. Deadline check per task → warnings; a plan violating any hard deadline is marked infeasible.

### Phase 3 — Deduplicate, rank, present
1. Two plans are duplicates if the sequence of (task, first-start) pairs is identical → keep one.
2. Compute metrics: minimum slack, number of context switches, weighted-priority completion earliness, % of `#deep-work` in matching buckets.
3. Keep ≤4: prefer feasible ones, then maximize pairwise ordering difference (so choices are *meaningfully* different). Label each from its config: "Deadline-safe — Webshop first", "Flow — fewest switches", …

### Fixing & re-planning rules
- `POST /tasks/{id}/track/start` → `is_fixed=True`, tracking session opens, accepted PlanEntry anchored.
- `POST /tasks/{id}/track/stop` → add elapsed to `time_spent`, recalc.
- `POST /tasks/{id}/complete` → `completed_at=now`, recalc; if new frontier has ≥2 branches, response includes fresh alternatives ("what next?" chooser).
- Manual drag in Week view → `is_fixed=True` + explicit `start_date`; validation rejects placements before an unfinished predecessor's allocation with a clear error.

---

## 7. Work Packages

Order roughly = dependency order. Sizes: S ≈ ½ day, M ≈ 1–2 days, L ≈ 2–4 days. Every backend WP includes unit tests (`apps/backend/tasks/tests/`); every frontend WP includes Vitest tests. Follow the README's architecture rules: dumb models, logic in services, no DB writes during allocation loops.

---

**WP-0 · Housekeeping & completion state — S — ✅ DONE (2026-07-06, TDD)**
Consolidate `tasks/planner.py` into `services/` (move `gather_time_buckets`, delete the rest). Add `completed_at` (nullable DateTime) to `Task` + migration + serializer + a `is_done` property. Enable CORS for the Vite dev origin. Make the allocator operate on `PlanningTask` snapshot dataclasses instead of mutating model instances.
*Accept:* existing tests still pass; no references to `tasks.planner` remain; completing a task via PATCH works; allocator provably does not touch model fields (test asserts `task.duration` unchanged after planning).
*Delivered:* 21 new tests (28 total, all green) in `test_task_completion.py`, `test_planning_snapshot.py`, `test_bucket_service.py`. `planner_service.py` rewritten around frozen `PlanningTask` snapshots with a local `_AllocationState` (no DB queries or model writes inside the loop); `bucket_service.gather_time_buckets` reimplemented with correct overlap suppression per A8. Additional findings fixed: `tasks/tests.py` stub collided with the `tests/` package so `manage.py test tasks` couldn't even load; `generate_buckets(start=timezone.now())` default was frozen at import time (regression test added); allocation now subtracts `time_spent` from planned durations and skips completed tasks; CORS was already configured (no change needed); `pyproject.toml` was missing four runtime deps present in `requirements.txt`, breaking the README's `uv install` path.

**WP-1 · TaskDependency model + API + cycle guard — M — ✅ DONE (2026-07-06, TDD)**
New model per A1, migration, serializer, `DependencyViewSet` (list/create/delete), registered under `/api/dependencies/`. `services/graph.py::would_create_cycle(edges, new_edge)` used in create-validation; error payload contains the cycle path as an ordered list of task IDs. Also reject self-edges and duplicates. Extend `populate_demo_data` with a small two-project DAG.
*Accept:* creating A→B→C then C→A returns HTTP 400 with the path `[A,B,C,A]`; deleting a task cascades its edges; demo data contains ≥6 edges.
*Delivered:* 23 new tests (51 total, all green) in `test_graph_service.py` (pure functions, `SimpleTestCase`, no DB) and `test_dependencies.py` (model constraints, API, demo data). `services/graph.py` provides `find_path` (BFS, shortest) and `would_create_cycle` — a new edge `p→s` closes a cycle iff `p` is reachable from `s`; the returned path starts and ends at the same node (`[a,b,c,a]`) with IDs stringified for the JSON payload. `TaskDependency` uses `related_name="outgoing_dependencies"/"incoming_dependencies"` and enforces uniqueness plus no-self-edge at the **database** level (constraints) in addition to serializer validation; the viewset deliberately omits update (edges are created/deleted, never edited → PATCH returns 405). Demo data now contains an 8-edge DAG: a backend chain (Upgrade Django → Design Schema → Implement API → {Load Test, Write Documentation}) and a frontend diamond (Setup React → {Build Components, Style Guide} → Wire API Client), verified acyclic by test.
*Note:* the backend was switched to **uv** in the same session: `pyproject.toml` + `uv.lock` are the source of truth, `requirements.txt` removed, README setup/test commands updated to `uv sync` / `uv run python manage.py …`.

**WP-2 · Graph service: topology, slack, frontier — M**
Pure functions in `services/graph.py`: `build_dag(tasks, edges)`, `topological_order`, `frontier(dag)`, `branches(dag)` (reachable sets per frontier task, project-grouped), forward/backward pass against a bucket-capacity timeline (Phase 0.3), `critical_chain`, `feasibility_warnings`. No ORM calls inside; callers pass plain data.
*Accept:* unit tests cover diamond DAG, two disjoint chains, single chain, empty graph; negative-slack fixture yields a warning naming the correct chain; functions handle 500 tasks < 1 s.

**WP-3 · Dependency-aware allocation + fixed/appointment pre-placement — L**
Extend `allocate_tasks`: (a) eligibility rule from §6 Phase 2; (b) pre-place appointments at their fixed start ignoring buckets (overlapped buckets lose that capacity), and pre-place fixed tasks filling their bucket with splitting into following buckets if they don't fit (per A8); (c) wire `gather_time_buckets` into the planning horizon (`PLANNING_HORIZON_DAYS = 60`, a settings constant per A9) inside `PlannerView`'s successor. Keep affinity/stickiness/quantum behavior and its tests green.
*Accept:* test: with A→B and one bucket, B is never allocated before A completes its remaining duration; test: fixed task exceeding its bucket splits into the next bucket; test: appointment overlapping a bucket reduces usable capacity correctly; test: appointment outside any bucket is still placed.

**WP-4 · Alternatives engine — L**
`services/alternatives.py` implementing §6 Phases 1 & 3: focus-branch seeding, three presets, ≤6 scheduling runs, dedup by ordering, metrics (min slack, context switches, priority earliness, **projected finish date per project** per A10), labels, cap `MAX_PLAN_ALTERNATIVES = 4` as a settings constant (A11). New endpoint `GET /api/plan/alternatives/` replacing the current single-plan semantics (keep `GET /api/plan/` returning the accepted plan, see WP-5).
*Accept:* two disjoint chains fixture yields ≥2 alternatives whose first task differs; a strict single chain yields exactly 1 alternative (no fake choices); every returned plan passes a validator asserting topological validity; infeasible fixtures return plans flagged with warnings.

**WP-5 · Plan persistence + accept flow — M**
Models `Plan`, `PlanEntry` per A4 + migrations + serializers. `POST /api/plan/alternatives/` computes and *stores* the candidate plans; `POST /api/plans/{id}/accept/` marks accepted, deletes sibling candidates; `GET /api/plan/` returns the accepted plan (entries grouped by bucket, same shape the Calendar component already consumes, plus `order`). Recalculation replaces non-anchored entries of the accepted plan.
*Accept:* accept flow round-trips; recalculation after adding a task keeps anchored entries byte-identical; old Calendar tab still renders.

**WP-6 · Time tracking, completion, auto-fix — M**
`TrackingSession` model (task FK, start, end nullable). Endpoints: `POST /api/tasks/{id}/track/start` (opens session, sets `is_fixed=True`, 409 if another session is open), `…/track/stop` (closes, adds to `time_spent`, triggers recalc), `POST /api/tasks/{id}/complete` (sets `completed_at`, recalc; response embeds fresh alternatives when the new frontier has ≥2 branches).
*Accept:* start→stop updates `time_spent` within 1 s accuracy in tests (freeze time); completing a diamond-DAG root returns 2 alternatives in the response; starting tracking on a task with unfinished predecessors returns 400 naming them.

**WP-7 · Frontend API layer & types — S**
`src/types.ts` mirroring serializers (Task, Dependency, Plan, PlanEntry, Alternative, metrics). Typed functions in `src/api.ts` for all new endpoints. Introduce TanStack Query for caching/invalidation (invalidate plan queries on every mutation per A7).
*Accept:* `yarn tsc --noEmit` clean; msw-mocked tests for the plan-alternatives hook.

**WP-8 · Dependency editor: read-only graph — M**
New tab "Dependencies". `@xyflow/react` + `dagre` left-to-right auto-layout. Nodes: task cards (header, duration chip, project color bar, done = greyed). Edges from `/api/dependencies/`. Pan/zoom, minimap, fit-view.
*Accept:* renders the demo DAG without overlaps; completed tasks visually distinct; snapshot/interaction tests for node rendering.

**WP-9 · Dependency editor: editing — M**
Drag node-to-node creates a dependency (optimistic, rolls back on 400 showing the server's cycle path highlighted on the graph in red). Edge select + Delete removes it. Button "add task" creates a task inline. Depends on WP-8.
*Accept:* cycle attempt shows the red highlighted path and a toast; created edges survive reload; Vitest covers optimistic rollback.

**WP-10 · Plan chooser UI — M**
When alternatives exist (initial planning or after `complete` returns choices): a chooser view/dialog with one card per alternative — label, metric chips (min slack with warn color, context switches, projected finish date per project), mini timeline strip (first 3 days), warning badges. Selecting calls accept and navigates to Week view. Single-alternative case auto-accepts silently (no fake choice).
*Accept:* mocked 3-alternative payload renders 3 cards; accept fires exactly one request; infeasible plan card shows the warning text.

**WP-11 · Week view on real data + manual fixing — L**
Replace dummy tasks with the accepted plan (map PlanEntries → `ViewTask`, reuse `splitTaskAcrossDays`). Render buckets as background zones (bucket-type color), appointments/fixed tasks visually distinct (solid vs. pastel is already half-implemented in `WeekViewTask`). Buckets themselves are draggable/resizable per A8: moving or resizing a bucket persists it (materializing a generated occurrence on first edit) and triggers recalculation. Drag-and-drop a task to a slot → PATCH `start_date` + `is_fixed`; server validation errors (predecessor conflict) surface as a snackbar and revert. ▶/⏹ tracking button on the task card; ✓ complete button opens the WP-10 chooser when the response contains alternatives.
*Accept:* existing WeekView tests adapted and green; drag of a dependent task before its predecessor reverts with the error message; tracking button toggles fixed styling.

**WP-12 · CRUD forms — M**
MUI dialogs/forms: create/edit Task (header, description, duration, deadline, priority slider, tags, project, appointment toggle with start), Project, Tag (color picker), TimeBucketType (recurrence string with live preview of next 5 occurrences via a small backend endpoint). Wire "add task" buttons in TaskList and the dependency editor to the same dialog.
*Accept:* full happy-path e2e in Vitest (create tag → task → bucket type); recurrence preview shows server-parsed dates; invalid recurrence string shows the parser error.

**WP-13 · Feasibility surface & demo polish — S**
Global warning banner (from plan warnings): "Project X can't finish by …" with the three remedy shortcuts (open bucket-type form / open task deadline / open priority). "**Jump to first free day**" button in the Week view (per A9): scrolls to the first day inside the horizon with no automatically planned task, so the user sees when they'd be free for a new project; appointments beyond the horizon remain visible. Update `populate_demo_data` to tell the Mara story from §3 (two projects, DAG, buckets, one appointment). Update README (§Algorithm gains the dependency/alternatives section; screenshots).
*Accept:* fresh checkout + demo command + both dev servers reproduces the §3 walkthrough end-to-end by hand.

---

## 8. Suggested Milestones

- **M1 — "The graph exists"**: WP-0…WP-2. Dependencies stored, validated, analyzable. Demoable via admin + API.
- **M2 — "Valid plans with choices"**: WP-3…WP-6. The full algorithm; demoable via API/Calendar tab.
- **M3 — "The product"**: WP-7…WP-11. Node editor, chooser, live week.
- **M4 — "Complete app"**: WP-12, WP-13. No admin needed for daily use.

Out of scope for this phase (backlog): multi-user auth & per-user data scoping, notifications/reminders, partial-overlap dependency types, async recalculation jobs, mobile layout, calendar (ICS) import of appointments.

---

## 9. Resolved Product Decisions (2026-07-06)

1. **Buckets** are hand-adjustable concrete instances, usually generated by recurring types; generated occurrences materialize on first edit or plan acceptance; persisted buckets suppress overlapping generated ones. Appointments ignore buckets; fixed tasks fill their bucket and may split into following buckets. → A8, WP-3, WP-11.
2. **Quantum 15 min confirmed; horizon 60 days** as a configurable constant. Appointments far beyond the horizon stay visible; the "first day with no auto-planned task" is a deliberate feature for spotting free capacity. → A9, WP-13.
3. **Task-level dependencies are sufficient.** Users juggle parallel projects by mood; each plan therefore reports the projected finish date per project. → A10, WP-4, WP-10.
4. **Cap of 4 alternatives** confirmed for now, held in a single `MAX_PLAN_ALTERNATIVES` constant because it is expected to be re-tuned once the UI is testable. → A11.