# Plina frontend

React 19 + TypeScript + Vite, MUI for the components, TanStack Query for the
server state. Setup, ports and the backend: see the
[main README](../../README.md#development-setup).

## Commands

| Command | What it does |
|---|---|
| `yarn dev` | dev server on http://localhost:5173 (the backend must run on port 8000) |
| `yarn test --run` | all Vitest tests once (`yarn test` alone starts watch mode) |
| `yarn build` | type check (`tsc -b`) + production build; the type gate |
| `yarn lint` | ESLint |
| `yarn storybook` / `yarn build-storybook` | Storybook on port 6006 / static build |

## Layout of `src/`

- `api.ts`: typed axios calls, one per endpoint; `types.ts` mirrors the
  backend serializers.
- `queries.tsx`: TanStack Query hooks; every mutation that changes the
  schedule invalidates the plan.
- `components/<Name>/`: one folder per component with `<Name>.tsx`, its
  tests and usually a `<Name>.stories.tsx`.
- `utils/`: pure logic (task tree, drag and drop, quick-add parser, split
  math …), unit-tested without React.
- `hooks/`: shared hooks (shortcuts, tracking, responsive layout …).
- `testing/`: test helpers (`matchMedia` for phone layouts, task-tree
  fixtures).

## Tests

Vitest with jsdom and Testing Library; API calls are mocked with msw.
`src/setupTests.ts` fails a test on an `act()` warning or on a request
without an msw handler, and provides the jsdom shims React Flow needs.
Fixtures encode assumptions about the API: check a new payload against the
live backend before mocking it (docs/development_plan.md, WP-8 bugfix).
