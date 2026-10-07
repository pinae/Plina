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
the **Dependencies** tab (a node editor) or drawn in the Tasks tab
("Draw dependency", below); attempts to close a cycle are rejected by the
server with the exact offending path, which the editor highlights in red.

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

An accepted plan keeps appointments and anchored tasks where they are and
reflows the rest around them; when one of them moves (dragged, changed in
its calendar, started) or is new (a calendar read, an occurrence of a
recurring appointment), its place in the plan follows. Where two time
buckets cover the same hours, that time is planned once. In the Week view
cards are drawn at their exact times (seconds too), split at the device's
midnight, and only cards that really overlap (by a minute or more, e.g. two
appointments at once) share their column side by side.

Try it: `uv run python manage.py populate_demo_data --user <name>` (in
`apps/backend`, after `migrate` and `createsuperuser`, see
[Development Setup](#development-setup)) sets up the full demo (two
projects, a dependency diamond, tagged recurring buckets, one fixed
appointment), then use "Plan my week" in the frontend. The command replaces
that user's tasks, tags, time buckets and plans.

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
  Below 900 px the title itself takes the color and the tags give way, so
  the title keeps its room.
* "+ Add task" at the end of every project and quick add in the header
  understand tokens: `Order filament 30m #maker !7 >fri +Blog`.
* "Sort ▶" walks the inbox of tasks without an estimate.
* "Draw dependency" (or a tap on AltGr — right Option on a Mac; held down,
  it draws only while held): drag a line from one task to another and the
  first depends on the second (Undo in the toast). When that is not
  possible — a cycle, its own parent or subtask, a duplicate — a toast says
  why.

The header shows the active project, the time tracker (▶ next planned task)
and the quick add; the split editor breaks a task into parts with ghost
estimates that add up. On phones the header is compact, quick add opens as a
bottom sheet from ⊕, rows are dragged after a long-press and the selected
row offers indent/outdent buttons (docs/task-entry-ui.md §7).

### Recurring tasks

"Repeats" in the edit dialog takes a rule in plain language — "every tuesday
20:00", "every 4 weeks on tuesday 14:00", "every first sunday each month at
12:30" — and shows it in Plina's words with the next dates while you type,
or says which word it does not understand. Every occurrence is a task of
its own (`apps/backend/tasks/services/series.py`):

* Completing one completes only that one; each collects its own tracked
  time. Deleting a row deletes only that occurrence (its date is skipped);
  "Delete all occurrences" in the dialog deletes the series, done ones too.
* An **appointment**'s occurrences exist for the planning horizon (60 days)
  ahead and block their time like any appointment; a past one completes
  itself when it ends, unless it is being tracked. The Tasks tab lists only
  the next one.
* Any **other task** comes again when its next date is reached and is
  planned like any other task from then on, not before ("from Tue 06/10" in
  its row). They do not pile up: the new one replaces an open one nobody
  worked on, and after weeks away there is one task, for the latest date.
  An occurrence with tracked time stays until it is completed.
* A new occurrence copies the latest one (title, description, estimate,
  priority, tags, color, project); a deadline moves along with the date.
* Edits apply to "this occurrence" or "this and the following ones". A
  changed rule applies from the edited occurrence on; an emptied one stops
  the repetition after it.
* A recurring task has no subtasks (it cannot be split, nothing moves into
  it), and is never the active project.

Occurrences are made when tasks or the plan are loaded — no scheduler is
needed. The rules (`apps/backend/tasks/services/recurrence.py`, also used
by time buckets) are 24-hour times with or without "at" ("8pm" works too);
"morning", "afternoon", "evening" and "night" mean 08:00, 14:00, 18:00 and
21:00, and a rule without a time starts the day at 00:00. They understand
intervals ("every other week", "every 3 days", "fortnightly"), weekday
ranges ("mon-wed", "weekdays"), days of the month and year ("the 15th",
"the last workday of the month", "december 24th"), several times ("at 9
and 14"), "starting march 3rd", "until june", "for the next 3 weeks", "10
times" and "except on weekends / in may / december 24th" — everything the
`recurrent` library understood before, which Plina no longer needs. Rules
repeat at most hourly. "every 4 weeks" counts from the first occurrence:
made on a Wednesday, "every 4 weeks on tuesday" starts on the coming
Tuesday.

### Calendar

Plina can replace Google Calendar while invitations keep arriving there: it
reads the calendar's secret iCal address (Settings → Calendars → "Add a
calendar"; in Google Calendar: Settings → your calendar → "Integrate
calendar" → "Secret address in iCal format"). It only reads — answer
invitations in Google Calendar or the invitation email. The code is in
`apps/backend/tasks/services/calendar_sync.py`, `markers.py` and `merge.py`.

* **Timed events** become appointments: top-level tasks in the calendar's
  color, marked with a calendar icon in the Tasks tab; a repeating event
  becomes a task per occurrence. Cancelled events and those you declined
  (given your address in that calendar) are left out. An imported
  appointment completes itself when it ends, unless it is being tracked.
* **All-day events** become **markers** (⚑ in the lane under the Week view's
  day headers): something on certain days — a conference, a holiday. A click
  on a free lane makes one by hand: all day (midnight to midnight), from a
  time for a while, or a moment (e.g. a deadline). "Deadline at a marker" in
  the task form makes it a named deadline that moves with the marker.
* **Special buckets** (◆; "Time Buckets" → "Add special bucket", or "Make
  special bucket" on a marker): a time frame such as travel or a hackathon
  in which the regular time buckets give way. Without a rule the whole frame
  is one bucket; with one ("every day at 09:00", 8 hours) it holds those
  buckets. A marker made a special bucket keeps following its event.
* Every event is linked by its UID (and an occurrence's original time), so
  reading again updates instead of duplicating. Time and place always follow
  the event. Title and description follow until you change them in Plina;
  then the task form says what the calendar changed, and "Compare" shows
  both side by side to take over what you want. A coming event removed from
  the calendar removes its task or marker, unless it was worked on (tracked
  time), merged or made a special bucket. Deleting an imported task
  dismisses the event: it does not come back.
* **Merging** ("Merge tasks" in the Week view, then drag from one card onto
  the other): your task and the invitation of the same meeting become one.
  Like Meld, the kept task is on the left, the other on the right and the
  result in the middle; arrows copy a field, and title, description and
  place can be edited. Your own task is kept (when the other came from a
  calendar); the other one's tracked time, dependencies, subtasks and
  calendar link move over, then it is deleted — updates of the event then go
  to the kept task. Overlapping cards share their column side by side.
* Tasks have a **place** (an address, a room, a call link), filled from the
  event's location.

The open app reads the calendars when it starts and every 5 minutes; the
server reads each at most every 10 minutes ("Read now" in the settings
reads them at once), from a day back to 60 days ahead. All-day events are
on the days of your time zone (else the calendar's own). The address is a
secret: it is never sent back to the browser (the settings show only its
host) and left out of the admin. Plina fetches only https (`webcal://`
becomes `https://`) from public addresses — no private networks, also after
a redirect — at most 10 MB within 15 seconds. Removing a calendar removes
its coming events nobody worked on; the rest stays as your own tasks.

### Time sheet

The "Time Sheet" tab shows a month of tracked time (▶ on a task), a row
per day (`apps/backend/tasks/services/timesheet.py`):

* **Begin** and **End**: the start of the first and the end of the last
  tracked time on a task tagged **#Arbeit** or **#Work** that day.
* **Pause**: the time tracked on tasks tagged **#Freizeit** or
  **#Freetime** (and not #Arbeit or #Work) between begin and end, added up.
  Free time before work began or after it ended is no pause.
* **Working time**: from begin to end without the pauses — time in between
  that was not tracked at all counts as work. The month's total is below.
* The arrow opens a day: the tasks counted on it, their tags and their time
  that day.

Only a task's own tags count (subtasks get their parent's tags when they
are made). Tag names count in any case. Days are those of your time zone; a
session counts on the day it began, also when it went on after midnight
(its end then shows "+1"), and a running one until now. Days without work
are left out. `GET /api/timesheet/?from=2026-10-01&to=2026-10-31` gives the
same as JSON.

**Correcting and entering tracked time** — a task left running over night,
or work that was not tracked live: "Edit the times of this day" in an open
day of the time sheet, "Add time" above it (any day, any task), or "Tracked
time" in a task's edit dialog (all of that task's time). Each stretch has a
day, a from and an until; an until at or before the from is on the next
day. Giving the running one an end stops it. Tracking keeps seconds, the
editor shows whole minutes: a time you type joins the neighbour that ended
(or began) within that minute — from "10:15" after a task stopped at
10:15:37 begins at 10:15:37 — and a time you leave alone keeps its seconds.
Plina refuses an end before the start, time in the future and overlaps
(one task at a time, the reason names the other task). The task's tracked time, a done task's figures, the
plan and the time sheet follow every change
(`apps/backend/tasks/services/sessions.py`, `/api/sessions/`).


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

* TaskSeries: the rule of a recurring task; its occurrences are Tasks
  (`series`, `occurrence`), see Recurring tasks.

* Marker: something on certain days or at a time (`start`, `duration`),
  usable as a task's named deadline (`Task.deadline_marker`), see Calendar.

* CalendarSubscription and CalendarLink: a calendar Plina reads, and the
  link of each of its events (UID + occurrence) to the task, marker or
  special bucket made of it, with the event as last read (`data`).

* Tag: A label (with an optional color) used to categorize Tasks 
  and TimeBucketTypes. Tags are the primary mechanism for establishing 
   Affinity (e.g., mapping a #deep-work task to a #deep-work time bucket).

* TimeBucketType: A recurring template for available time.
  * It defines a rule for when a bucket occurs (e.g., "Every weekday at 
    09:00", in the language of recurring tasks), its duration (e.g., 4
    hours), and its accepted tags. The rule counts from when it was set
    ("every other week" keeps its weeks).
  * Its color is chosen, or else automatic: unlike the other bucket types'.
  * A special one (`special_start`, `special_end`) exists only within its
    time frame, where the regular buckets give way to it.

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
4. Create your account: the app asks for a login ([Accounts](#accounts)).
   ```bash
   uv run python manage.py createsuperuser
   ```
5. Optional: load the demo data (the story above) for that user.
   **It deletes that user's tasks (with their tracked time and
   dependencies), tags, time buckets and plans first** — nobody else's.
   ```bash
   uv run python manage.py populate_demo_data --user <name>
   ```
6. Start the development server:
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
   The frontend will be available at `http://localhost:5173`. Open it
   there, not at `127.0.0.1:5173`: the login's session cookie belongs to the
   backend at `localhost:8000`, and the browser only sends it from the same
   site.

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
always use the default (pinned in `vite.config.ts`). `/` means the page's
own origin (the Docker image, where nginx proxies `/api/`). A backend on
another host must list that host in the environment variable
`ALLOWED_HOSTS` (see [Settings](#settings)).

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
error instead. The listed origins may also send the session cookie and make
changes (`CSRF_TRUSTED_ORIGINS` defaults to them).

## Accounts

Every user has their own data: tasks, tags, time buckets, dependencies,
plans and settings. Every API endpoint needs a login (401 without one),
and the data layer makes sure nobody reaches anybody else's rows:
`plina/scoping.py` gives every model an owner, queries only ever see the
logged-in user's rows, new rows belong to them, and a query without a user
fails instead of seeing everything. The app logs in with Django's session;
changes carry its CSRF token.

**Local accounts** always work. The first one comes from
`manage.py createsuperuser`; superusers add more in the Django admin
(`/django/admin/` → Users). Everybody changes their password in ⚙ Settings
→ Account. With mail configured (`EMAIL_HOST`, [Settings](#settings)), the
login page offers "Forgot your password?" (Django's reset by mail).

**Single sign-on** with OpenID Connect (e.g. Authentik, Keycloak) when the
`OIDC_` variables are set — all six required ones, or none for local
accounts only (some but not all is an error at startup):

| Variable | Authentik, for example |
|---|---|
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | from the provider (confidential client) |
| `OIDC_AUTHORIZATION_ENDPOINT` | `https://auth.example.com/application/o/authorize/` |
| `OIDC_TOKEN_ENDPOINT` | `https://auth.example.com/application/o/token/` |
| `OIDC_USER_ENDPOINT` | `https://auth.example.com/application/o/userinfo/` |
| `OIDC_JWKS_ENDPOINT` | `https://auth.example.com/application/o/<slug>/jwks/` |
| `OIDC_LOGOUT_ENDPOINT` (optional) | `https://auth.example.com/application/o/<slug>/end-session/`: logging out of Plina logs out there too |
| `OIDC_PROVIDER_NAME` (optional) | the button says "Log in with …" (default: the provider's host name) |
| `OIDC_REDIRECT_URL` (optional) | where the app opens after logging in (default `/`; during development e.g. `http://localhost:5173/`) |
| `OIDC_SCOPES`, `OIDC_SIGN_ALGO` (optional) | default `openid email profile`, `RS256` |

Register the redirect URI **`https://<your host>/django/oidc/callback/`** at
the provider. The login uses PKCE; ID tokens are checked for signature,
expiry, nonce and audience. A user is created on their first login, named
after the provider's `preferred_username`, and found again by the
provider's stable subject (`sub`) — never by name or email, so a local
account with the same name (which gets `-2` appended) is never taken over.
They have no password in Plina and log in through the provider only; local
accounts keep working next to it (e.g. the superuser).

Data from before accounts existed belongs, after `migrate`, to the first
superuser, or else to a new user `plina` without a password
(`manage.py changepassword plina` sets one).

There is no protection against guessing passwords yet: limit the rate of
`POST /api/auth/login/` at the reverse proxy (e.g. Traefik's `ratelimit`
middleware) when local accounts are reachable from the internet.

## Deployment with Docker

Three containers (`docker-compose.yml` is a complete example):

* **db**: PostgreSQL 17.
* **backend** (`apps/backend/Dockerfile`): Django behind gunicorn on port
  5000, only reachable inside the Compose network. On every start it brings
  the database up to date (`migrate`) and copies the admin's static files
  into the `/app/static` volume (`collectstatic`), then runs as an
  unprivileged user.
* **nginx** (`apps/frontend/nginx/Dockerfile`): the built frontend; `/api/`
  and `/django/` (single sign-on, the admin) proxied to the backend;
  `/static/` and `/media/` served from the volumes the backend fills. Its
  configuration is `apps/frontend/nginx/nginx.conf`, copied into the image
  when it is built.

TLS is the job of a reverse proxy in front (Traefik, Caddy, nginx, …), which
must send `X-Forwarded-Proto`; the example publishes nginx on
`127.0.0.1:8080` for it. Logging in is Plina's own ([Accounts](#accounts)):
local accounts, and single sign-on when the `OIDC_` variables are set.

### First start

```bash
git clone https://github.com/pinae/Plina.git && cd Plina
cp .env.example .env    # git ignores .env
```

Create the secrets and put them into `.env` (`SECRET_KEY`, `DB_PASSWORD`):

```bash
# The Django secret key: letters, digits, - and _ only (Compose would expand a $)
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
# … or without Python on the server:
docker run --rm python:3.14-slim python -c "import secrets; print(secrets.token_urlsafe(50))"

# The database password
openssl rand -hex 32
```

In `.env`, set `ALLOWED_HOSTS` to the host name Plina is reached under (for
example `plina.example.com`) and `CSRF_TRUSTED_ORIGINS` to its HTTPS origin
(`https://plina.example.com`); for single sign-on also the `OIDC_` variables
([Accounts](#accounts)). Then build, start, and create the first account
(it asks for a password):

```bash
docker compose up -d --build
docker compose ps                # after about a minute all three are "healthy"
docker compose logs -f backend   # migrations, then gunicorn's workers
docker compose exec backend python manage.py createsuperuser
```

Point the reverse proxy at `http://127.0.0.1:8080`; with Caddy, for example:
```
plina.example.com {
    reverse_proxy 127.0.0.1:8080
}
```
With Traefik, put the nginx container into Traefik's network with router
labels (port 80) instead of publishing a port. `/healthz` needs no login and
answers `ok` while the backend reaches its database; the images' Docker
health checks use it (also for autoheal).

To try it before TLS is set up, set `PLINA_HTTP_BIND=0.0.0.0`, add the
server's address to `ALLOWED_HOSTS` and `http://<server>:8080` to
`CSRF_TRUSTED_ORIGINS`, set `SECURE_COOKIES=False` (else the browser keeps
the login cookie for HTTPS only) and open `http://<server>:8080`, knowing
that passwords then travel unencrypted.

The Django admin at `/django/admin/` shows superusers their own data, and
all users.

### Updates and backups

```bash
git pull && docker compose up -d --build    # migrations run on start
```

Back up before updating:
```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  > plina-$(date +%F).sql
```
Restore a backup (it replaces everything in the database):
```bash
docker compose stop backend
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < plina-2026-10-05.sql
docker compose start backend
```

### Ansible

The images build with Ansible's `community.docker.docker_image` (its
classic builder works) with the repository root as build path and the
Dockerfiles `apps/backend/Dockerfile` and `apps/frontend/nginx/Dockerfile`.
The repository's `apps/frontend/nginx/nginx.conf` needs no template (it
answers any host name and expects the backend service to be called
`backend`). The build argument `VITE_BACKEND_URL` of the nginx image is `/`
by default (the API on the page's own origin); a full URL such as
`https://plina.example.com` works too.

### Settings

The backend reads its settings from the environment. Without any, it runs
as for development (`DEBUG` on, SQLite in `apps/backend/db.sqlite3`); the
Docker image sets `DEBUG=False`.

| Variable | Meaning |
|---|---|
| `DEBUG` | `True`/`False` (also 1/0, yes/no, on/off). Never on with real data. |
| `SECRET_KEY` | Required without `DEBUG`. Or `SECRET_KEY_FILE`: a file with the key (Docker secrets). |
| `ALLOWED_HOSTS` | Required without `DEBUG`: the host names, comma-separated. |
| `CSRF_TRUSTED_ORIGINS` | The origins that may make changes, e.g. `https://plina.example.com` behind a TLS proxy; default: the `CORS_ALLOWED_ORIGINS`. |
| `SECURE_COOKIES` | Cookies only over HTTPS; default: on without `DEBUG`. |
| `CORS_ALLOWED_ORIGINS` | Only for a frontend on another origin ([above](#backend-url-and-ports)). |
| `DB_ENGINE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` | The database, e.g. `postgresql` (or `django.db.backends.postgresql`), `plina`, …, `db`, `5432`. Without `DB_ENGINE`: SQLite at `DB_NAME` (default `db.sqlite3`). `DB_PASSWORD_FILE` instead of `DB_PASSWORD` works too. |
| `OIDC_…` | Single sign-on ([Accounts](#accounts)); `OIDC_CLIENT_SECRET_FILE` works too. |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_USE_SSL`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM` | Mail for "Forgot your password?", offered when `EMAIL_HOST` is set. Port 587 means STARTTLS and 465 TLS unless `EMAIL_USE_TLS` / `EMAIL_USE_SSL` say otherwise. |
| `WEB_CONCURRENCY` | gunicorn's workers (image default 3). |
| `LOG_LEVEL` | Default `INFO`; everything goes to the container log, errors with their traceback. |
| `PLINA_MIGRATE`, `PLINA_COLLECTSTATIC` | `0` skips that step when the container starts. |

## Testing

### Backend Tests
Run Django tests from the `apps/backend/` directory:
```bash
uv run python manage.py test tasks accounts
```

They use SQLite. Against PostgreSQL, as deployed (the migrations differ in
places):
```bash
docker run -d --name plina-test-db -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:17-alpine
DB_ENGINE=postgresql DB_USER=postgres DB_PASSWORD=pw DB_HOST=127.0.0.1 DB_PORT=55432 \
  uv run python manage.py test tasks accounts --noinput
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
