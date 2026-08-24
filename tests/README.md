# Testing convention

When adding or changing any feature, update `tests/frontend.spec.ts` or `tests/backend.spec.ts` to cover it.

## What to add

- **New UI element** → assert it renders with correct text/content
- **New button or interactive control** → assert it's visible, then click it and assert the resulting state change (toast, navigation, mode switch, etc.)
- **New screen or route** → add a `test.describe` block covering: initial render, key interactions, and navigation in/out
- **New API endpoint** → add tests for: happy path, missing/invalid input, auth required, and edge cases
- **New state transition** → test the full path from start to end (e.g. running → help → proposal → settled → closed)
- **New context action** → test that calling it produces the expected UI effect

## How to run

```bash
npx playwright test --reporter=list          # all tests
npx playwright test tests/frontend.spec.ts    # frontend only
npx playwright test tests/backend.spec.ts     # backend only
npx playwright test -g "pattern"              # filtered by name
```

## Rules

- Every test must hit a real user interaction or API call — no testing internal state directly
- Use `{ exact: true }` or `.nth()` when text appears in multiple elements
- Prefer `getByRole` and `getByText` over CSS selectors
- Backend tests use `apiRequest.newContext()` — dispose after each test
- Frontend tests use `waitForLoadState("networkidle")` after navigation
