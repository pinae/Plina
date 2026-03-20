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

### Core Data Structures (Domain Model)

The system is built on Django, utilizing the following primary models to 
represent the scheduling domain:

* Task: The fundamental unit of work.
  * Key Algorithmic Fields: 
    * duration (estimated time required)
    * time_spent (actual time logged)
    * latest_finish_date (hard deadline constraint)
    * priority (soft importance constraint)
    * tags (used for affinity).

* Project: A structured collection of Tasks.
  * Tasks within a project maintain a specific order (via the ProjectTaskItem 
    through-model). Projects themselves have priorities and tags, which can 
    be inherited by their constituent tasks.

* Tag: A label (with an optional color) used to categorize Tasks, Projects, 
  and TimeBucketTypes. Tags are the primary mechanism for establishing 
   Affinity (e.g., mapping a #deep-work task to a #deep-work time bucket).

* TimeBucketType: A recurring template for available time.
  * It defines a rule for when a bucket occurs (e.g., "Every weekday at 
    09:00"), its duration (e.g., 4 hours), and its accepted tags.

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

1.  Navigate to the `plina` directory:
    ```bash
    cd plina
    ```
2.  Install dependencies (if not already installed):
    ```bash
    .venv/bin/pip install -r requirements.txt
    ```
3.  Start the development server:
    ```bash
    .venv/bin/python manage.py runserver
    ```
    The backend will be available at `http://localhost:8000`.

### Frontend (React/Vite)

1.  Navigate to the `frontend` directory:
    ```bash
    cd plina/frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```
    The frontend will be available at `http://localhost:5173`.

## Testing

### Backend Tests
Run Django tests from the `plina` directory:
```bash
python manage.py test tasks
```

### Frontend Tests
Run Vitest from the `frontend` directory:
```bash
npm test
```
