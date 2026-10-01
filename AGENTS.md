# Receipt Certificate Project

Thai-language web app for issuing receipt-substitute certificates for multiple companies, searching history, and printing A4 / saving PDF. Runs on Cloudflare Workers, D1, and Static Assets; production login is provided by Cloudflare Access.

## Layout

- `src/index.js`: Worker entry point, API routing, validation, and D1 queries. Non-`/api/` requests go to `env.ASSETS.fetch(request)`.
- `public/index.html`: vanilla browser UI with inline JavaScript and CSS, form state, document rendering, and print layout; no frontend framework.
- `public/baht.js`: Thai money-to-words conversion; `public/test_baht.html` contains its browser checks.
- `migrations/0001_init.sql` through `0006_approver_position.sql`: numbered D1 schema migrations.
- `wrangler.jsonc`: deployment, static assets, and database bindings.
- `README.md`: setup and design notes; `USER_GUIDE.md`: user-facing guide.

## Setup and commands

Run from the repository root. The project uses npm, `package-lock.json`, and Wrangler (`^4.0.0` in `package.json`).

- `npm install`: install dependencies.
- `npm run db:local`: apply migrations to local `receipt-db`.
- `npm run dev`: run Wrangler locally at `http://localhost:8787`.
- Open `http://localhost:8787/test_baht`: existing nine-case money-to-words check; expect `ALL 9 PASS`.
- `npm run db:remote`: apply migrations to the production database (not a local verification step).
- `npm run deploy`: deploy the Worker and static assets to Cloudflare.
- For a separate fresh Cloudflare setup, README documents `npx wrangler d1 create receipt-db`; use its ID in that setup's configuration. This checkout already has a database ID configured.

There are no build, lint, or CLI test scripts in `package.json`, and no tracked CI configuration. The browser self-check is the existing test entry point; it does not cover API/database behavior.

## Code conventions

- JavaScript uses two-space indentation, semicolons, and mostly single-quoted strings. Worker exports an object with `async fetch(request, env)`.
- Functions use camelCase; database and API fields use snake_case (`doc_date`, `amount_satang`, `items_json`). UI text and validation messages are Thai.
- API routes are handled by a method/resource switch in `src/index.js`, not a routing library.
- JSON responses use `json(data, status)`; validation failures use `bad(message)` returning `{ error: message }` with status 400. The fetch handler converts uncaught API exceptions to JSON status 500.
- D1 queries use `DB.prepare(...).bind(...)` with numbered SQL placeholders. Dynamic autocomplete column names come only from `NAME_FIELDS`.
- Frontend rendering builds HTML strings and escapes user values with `esc()`. Keep escaping when extending document rendering.
- Certificate create and update paths share `validateCertificate()`; form collection and rendering live in `collect()` and `renderDoc()`.

## Data invariants

- Money is integer satang, not floating-point baht. The server validates positive integer item amounts and recalculates totals rather than trusting client totals.
- Certificates store company snapshots for historical printing. Company deletion is soft (`active=0`); certificate deletion is a real DELETE.
- Updating a certificate uses the active company's current data; an existing certificate for the same deleted company retains its snapshot.
- Document numbers are `<CODE>-<Buddhist year>/<sequence>`, e.g. `INS-2569/0001`. Counters are per company and year; derive the year from `doc_date` plus 543, not the Worker clock.
- Company codes normalize to uppercase ASCII letters/digits, length 2–10, and must remain unique even across deleted companies.
- Edited document numbers must match the company code and document year. Counter advancement must never move backward. Updates preserve `created_at` and set `updated_at`.
- Number reservation uses an atomic counter statement, followed by a separate certificate INSERT. Gaps after failed INSERTs are accepted; D1 does not provide interactive transactions here.

## Operational pitfalls

- Keep bindings named `DB` and `ASSETS`; the Worker accesses those exact names.
- Local development intentionally has no D1 `remote: true`. Do not point routine development at production.
- The configured production hostname is `receipt.sukanyayot.com`; README's `receipt.example.com` setup wording is a placeholder, not the current configuration.
- Production requires Cloudflare Access on the configured hostname. Keep both `workers_dev` and `preview_urls` false to avoid alternate URLs bypassing that login boundary; the app has no in-app login implementation.
- `.wrangler/` is ignored generated runtime/local database state; `node_modules/` is installed output. `.dev.vars` is ignored local configuration, not a tracked project file.
- Printing relies on browser print/PDF. Disable browser headers and footers to avoid URLs/dates appearing on certificates; preserve A4 print styling when changing the UI.
- Company and certificate list queries cap results at 200; autocomplete caps results at 50. There is no pagination in these endpoints.
