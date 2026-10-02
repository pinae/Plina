# Plina

Plina is a smart task manager and calendar application that bridges the gap between 
static to-do lists and rigid calendar scheduling. Instead of forcing the user to 
manually drag and drop every task into a calendar slot manually, Plina automatically 
plans tasks into time buckets based on estimated durations, priorities, deadlines, 
and context. The user can still manually plan their task and a manually placed task 
always overrides the automatic planning. But they do not have to and the planning 
algorithm will take over like a personal assistant if needed.

The core philosophy is inspired by CPU Schedulers. Just as an operating system 
minimizes "context switches" to keep a CPU running efficiently, Plina attempts to 
minimize mental context switches for the user. It treats human attention as a 
constrained resource, utilizing concepts like:

* Affinity: Matching specific types of work (Tasks) to specific environments or 
  times of day (Time Buckets).
* Stickiness: Preferring to keep the user working on the same task across 
  adjacent time blocks rather than arbitrarily switching tasks.
* Preemption & Recalculation: If a task takes longer than expected, or a 
  high-priority interruption occurs, the algorithm recalculates the entire 
  schedule, acting as a preemptive priority scheduler.

If the algorithm detects that hard constraints (deadlines) cannot be met given 
the available time buckets and task durations, it proactively warns the user, 
prompting a manual review of priorities or deadlines.

### Task Dependencies and Alternative Plans

Tasks form a directed acyclic graph (DAG): an edge A -> B means
*finish-to-start* — B may not be scheduled before all planned work of A is
allocated. Every valid plan is therefore a topological ordering of the
remaining tasks packed into time buckets. The graph is edited visually in
the **Dependencies** tab (a node editor); attempts to close a cycle are
rejected by the server with the exact offending path, which the editor
highlights in red.

A DAG usually admits many valid orderings, and that is the product:
wherever the graph leaves a real choice (independent branches at the
frontier), Plina computes up to `MAX_PLAN_ALTERNATIVES` meaningfully
different plans — focus-per-branch and weight presets (deadline-safe /
priority-first / flow) — deduplicates them by ordering, and presents them
as cards with metrics (minimum slack, context switches, projected finish
date per project). A strict chain yields exactly one plan and is accepted
silently: no fake choices.

Fluidity principle: accepting a plan fixes nothing. A task is anchored only
when time tracking starts on it (or it is dragged manually — the server
rejects placements that would violate the dependency order). Completing a
task recalculates the plan and, when the new frontier forks, immediately
offers fresh choices. Feasibility warnings ("Project X can't finish by ...")
surface as a banner with remedy shortcuts, and the Week view can jump to
the first day with free capacity.

Try it: `uv run python manage.py populate_demo_data` (in `apps/backend`,
after `migrate`, see [Development Setup](#development-setup)) sets up the
full demo (two projects, a dependency diamond, tagged recurring buckets, one
fixed appointment), then use "Plan my week" in the frontend. The command
replaces all tasks, tags, time buckets and plans in the database.

### Working with tasks

The app opens on the **Tasks** tab: every open task as one tree, the active
project on top (docs/tasks-tab.md). It follows the conventions of Todoist
and Wunderlist:

* A click (or Enter) opens the edit dialog; ↑/↓ in the dialog (Alt+↑/↓)
  walk to the neighbouring tasks without closing it, saving changes first.
* Drag a row by its ⠿ handle: up/down reorders, sideways changes the level
  (a subtask of the row above, or one level up). Every move — also Tab,
  Shift+Tab and Alt+↑/↓ — can be undone from the toast. A parent that loses
  its last subtask stays open.
* The circle completes a task (Undo in the toast); parents complete by
  themselves with their last subtask. "Show completed" brings completed
  tasks back into the tree.
* The priority slider (0–10, coloured by urgency) is set with one click or
  drag; digit keys work too.
* Every task has a color (the dot in front of its row): its own, else its
  parent's; a new project gets an automatic color unlike the other
  projects'. It is chosen in the edit dialog (docs/task-entry-ui.md §4.4).
* "+ Add task" at the end of every project and quick add in the header
  understand tokens: `Order filament 30m #maker !7 >fri +Blog`.
* "Sort ▶" walks the inbox of tasks without an estimate.

The header shows the active project, the time tracker (▶ next planned task)
and the quick add; the split editor breaks a task into parts with ghost
estimates that add up. On phones the header is compact, quick add opens as a
bottom sheet from ⊕, rows are dragged after a long-press and the selected
row offers indent/outdent buttons (docs/task-entry-ui.md §7).


### Core Data Structures (Domain Model)

The system is built on Django, utilizing the following primary models to 
represent the scheduling domain:

* Task: The fundamental unit of work.
  * Key Algorithmic Fields: 
    * duration (estimated time required; empty = the default duration)
    * time_spent (actual time logged)
    * latest_finish_date (hard deadline constraint)
    * priority (soft importance constraint)
    * tags (used for affinity).
    * color (its own, else inherited from the parent; projects get a
      distinct automatic one).
  * Tasks form a tree (`parent` + sibling `order`): every top-level task is a
    project, and any task can be split into subtasks. A parent's estimate is
    a budget; what its subtasks do not cover is planned as its "Rest". The
    deadline of a parent applies to all its subtasks.

* UserSettings: the default duration for unestimated tasks, the active
  project (synced to all devices) and the user's time zone, in which
  recurrence rules are read.

* Tag: A label (with an optional color) used to categorize Tasks 
  and TimeBucketTypes. Tags are the primary mechanism for establishing 
   Affinity (e.g., mapping a #deep-work task to a #deep-work time bucket).

* TimeBucketType: A recurring template for available time.
  * It defines a rule for when a bucket occurs (e.g., "Every weekday at 
    09:00"), its duration (e.g., 4 hours), and its accepted tags.
  * Its color is chosen, or else automatic: unlike the other bucket types'.

* TimeBucket: A concrete, instantiated block of time in the calendar, 
  generated from a TimeBucketType. These are the "bins" into which the 
  algorithm packs the "items" (Tasks).

### The Scheduling Algorithm

Plina's planning algorithm solves a Resource Constrained Scheduling 
Problem (RCSP). It operates in three continuous phases:

##### Phase 1: Scoring and Ranking (The Priority Queue)

Tasks are not simply sorted by priority. Plina calculates a dynamic 
score for unscheduled work to balance Urgency (Deadlines) and 
Importance (Priority).

* Earliest Deadline First (EDF): Tasks with an imminent 
  latest_finish_date receive a massive score multiplier to ensure hard 
  constraints are met.
* Priority Fallback: Among tasks with similar deadline pressures, the 
  user-defined priority dictates the order.

##### Phase 2: Allocation (Bin Packing with Affinity)

The algorithm iterates chronologically through available TimeBucket 
instances. For each bucket:

* Affinity Filtering: It checks the TimeBucketType's tags. If tags 
  exist, it only considers Tasks sharing at least one matching Tag.
  Tasks without any tag are the exception: they fit every bucket, as 
  if they had all tags (usually they just were not sorted yet).
* Stickiness Bonus: The algorithm looks at the previously scheduled 
  task. If that task is incomplete and fits the current bucket's 
  affinity, it receives a heavy "stickiness bonus" to prevent 
  unnecessary context switching.
* Quantum Checking: It enforces a minimum time slice (e.g., 
  15 minutes) to prevent fragmentation (scheduling 3 minutes of a 
  task just to fill a gap).

##### Phase 3: Verification and Feedback

As tasks are placed into buckets, the system virtually "subtracts" 
the scheduled time from the task's remaining duration.

* Constraint Checking: If a task's required completion time extends 
  past its latest_finish_date, the algorithm flags a warning.
* User Prompt: These warnings are aggregated and presented to the 
  user, inviting them to renegotiate deadlines, lower the priority 
  of competing tasks, or add more TimeBuckets.

### Notes for AI Agents and Contributors

When modifying or extending Plina, please adhere to the following 
architectural guidelines:

* Separation of Concerns: Keep the Django models (models.py) "dumb". 
  They should primarily handle data integrity, relationships, and 
  simple properties (like color mixing).
* Service Layer for Logic: Complex algorithmic logic (like the 
  scheduling engine, ranking computations, and constraint 
  verification) must live in a dedicated service layer (e.g., 
  services/planner.py). Do not bloat the Task or TimeBucket models 
  with scheduling loops.
* Immutability in Planning: The planning algorithm should ideally 
  operate on in-memory representations or temporary "Plan" records 
  until the schedule is finalized. Avoid constantly writing partial 
  state to the database during the while loops of the allocation 
  phase to optimize performance.

## Development Setup

### Backend (Django)

1. Navigate to the `apps/backend/` directory:
   ```bash
   cd apps/backend
   ```
2. Install dependencies (if not already installed):
   ```bash
   uv sync
   ```
3. Create the database (SQLite, `apps/backend/db.sqlite3`); run this again
   whenever a pull brings new migrations:
   ```bash
   uv run python manage.py migrate
   ```
   Without it every request, the admin included, fails with
   `no such table: tasks_usersettings`.
4. Optional: load the demo data (the story above).
   **It deletes all tasks (with their tracked time and dependencies), tags,
   time buckets and plans in the database first.**
   ```bash
   uv run python manage.py populate_demo_data
   ```
5. Start the development server:
   ```bash
   uv run python manage.py runserver
   ```
   The backend will be available at `http://localhost:8000`.

### Frontend (React/Vite)

1. Navigate to the `frontend` directory:
   ```bash
   cd apps/frontend
   ```
2. Install dependencies:
   ```bash
   yarn install
   ```
   The repository is a yarn workspace (`apps/*`), so this installs the
   whole workspace and `node_modules` ends up in the repository root.
3. Start the development server:
   ```bash
   yarn run dev
   ```
   The frontend will be available at `http://localhost:5173`.

### Backend URL and ports

The frontend calls the backend directly at `http://localhost:8000`. For
another backend set `VITE_BACKEND_URL` to its root URL (without `/api`),
either in the environment or in `apps/frontend/.env.local` (ignored by git):
```bash
uv run python manage.py runserver 8001                 # in apps/backend
VITE_BACKEND_URL=http://localhost:8001 yarn run dev    # in apps/frontend
```
Vite reads the variable when the dev server starts and writes it into the
bundle on `yarn build`, so restart or rebuild after changing it. The tests
always use the default (pinned in `vite.config.ts`). A backend on another
host must list that host in Django's `ALLOWED_HOSTS`.

The backend accepts browser requests only from the origins in the
environment variable `CORS_ALLOWED_ORIGINS` (comma-separated
`scheme://host:port`), by default the Vite dev server:
`http://localhost:5173,http://127.0.0.1:5173`. A list replaces the default,
so name both spellings of the host if you open the page with both; an empty
value allows none (enough for a frontend served from the backend's own
origin, which needs no CORS). A typo such as a missing `http://` keeps the server from starting;
it prints a `corsheaders` error instead. For the frontend on port 5174:
```bash
CORS_ALLOWED_ORIGINS=http://localhost:5174,http://127.0.0.1:5174 \
  uv run python manage.py runserver    # in apps/backend
yarn run dev --port 5174               # in apps/frontend
```
If the frontend's port is taken, Vite moves to the next free one and every
API call fails with a CORS error; start Vite with `--strictPort` to get an
error instead.

## Testing

### Backend Tests
Run Django tests from the `apps/backend/` directory:
```bash
uv run python manage.py test tasks
```

### Frontend Tests
Run Vitest from the `apps/frontend/` directory:
```bash
yarn test --run
```
Without `--run`, Vitest starts in watch mode in an interactive terminal and
re-runs the affected tests on every change until you quit with `q`.

`yarn test` in the repository root runs both suites once (via Turborepo).

### Frontend checks
From `apps/frontend/`:

* `yarn build`: the type check (`tsc -b`) plus the production build. This
  is the type gate; `yarn tsc --noEmit` checks nothing, because the root
  `tsconfig.json` only references the real configs.
* `yarn lint`: ESLint.
* `yarn build-storybook`: builds every story (`yarn storybook` serves them
  on port 6006).

### End-to-end tests
There is no automated end-to-end suite yet;
[docs/e2e-test-cases.md](docs/e2e-test-cases.md) describes the target
scenarios.
