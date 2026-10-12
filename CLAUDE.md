# octopus-budget — build foundation

Personal financial hub (budget.octopustechnology.net), part of the octopus
ecosystem. Server-rendered EJS + per-user SQLite. Designed to **grow into a
full financial hub**: every new thing you track should also feed the daily
Snapshot so it becomes graphable over time. See `ROADMAP.md` for the backlog
and per-feature build specs.

> Working here as Sonnet? Read this file + `ROADMAP.md`, then pick the top
> unstarted item in the roadmap and follow its spec. The patterns below make
> most features mechanical.

## Stack & layout
- **Express app: `index.js`** (data routes live here, ~33 routes). The customizable-dashboard
  JSON routes are in `layout-routes.js`, mounted from `index.js`.
- **`database.js`** — `getDatabase(username)` returns per-user SQLite models.
  Each user has their own `data/<username>_database.sqlite`.
- **`views/`** — EJS: `index.ejs` (dashboard shell), `partials/` (one per section,
  plus `table`, `cell`, `tiles`, `section_head`, `column_manager`), `graphs.ejs`
  (Trends), `settings.ejs`, `login.ejs`, `edit_subscription.ejs`, `edit_transaction.ejs`.
- **`layout.js`** (pure logic) and **`layout-store.js`** (persistence) — see Dashboard layout.
- **`public/scroll.js`**, **`public/layout-edit.js`** — client scripts, linked with `asset()`.
- **`public/theme.css`** — the only stylesheet. Dark theme, CSS in one file.
- **`api/`** — legacy mobile REST scaffold, **NOT mounted** in index.js. Ignore
  unless building the mobile API; don't assume it runs.
- Deploy: Docker + Portainer git-backed stack. `PORT` env (default 3000).

## Auth (already done — just reuse `requireLogin`)
- SSO via `octopus_sso` cookie, verified against octopus-auth
  (`AUTH_SERVICE_URL`, default `http://octopus-auth:3002`), cached 5 min.
- `requireLogin` middleware puts `req.user = { username, role, token }` and
  calls `ensureUserDb(username)` which runs `sequelize.sync({ alter: true })`.
- **Every page/route that touches data uses `requireLogin`.** Admin is
  username-gated if ever needed, but budget is currently single-user-per-account.

## Models (`database.js`)
`Subscription, Account, Income, Debt, Installment, Provider, CreditScore, Snapshot, Transaction`,
plus the layout layer below.
- **Provider** — BNPL provider (Affirm/Klarna builtin + custom). Has `allowance`.
  "Used" is NOT stored — it's derived from that provider's Installment plans.
- **Installment** — a BNPL plan: provider, total_amount, paid_amount,
  payment_amount, remaining_payments, next_due_date, frequency.
- **CreditScore** — `{ bureau, score }`, one row per bureau (transunion/equifax).
- **Snapshot** — **the growth spine.** One row per calendar day, upserted on
  every dashboard `GET /`, capturing all headline metrics + scores. Adding a
  metric = add a column + set it in the upsert; history then accrues for free.

### Layout layer models (additive; per-user DB, so no owner columns)
- **SectionPref** `{ key, title, position, hidden }` — one row per *built-in* section the
  user has customised.
- **CustomSection** `{ title, position, hidden }` — a section the user created. Rows are
  **CustomRow** `{ section_id, position }`.
- **ColumnPref** `{ section_key, builtin_key, label, type, position, hidden }` — `builtin_key`
  set = a built-in column (rename/reorder/hide only); null = a user column (type
  text/number/money/date, deletable). `section_key` is a built-in key or `custom:<id>`.
- **CustomValue** `{ column_id, row_id, value }`, unique on (column_id, row_id). `row_id` is the
  built-in model's id for built-in sections, or `CustomRow.id`.
- **TilePref** `{ key, title, position, hidden, column_id }` — built-in tile prefs by `key`; a
  user tile has `key` null and sums the values of `column_id` (number/money). No formulas.

## Migrations
`sync({ alter: true })` runs on every login via `ensureUserDb`, so **adding a
model or column needs no migration script** — just define it and it appears.
Keep new columns nullable so existing rows don't break.

## The "add a tracked thing" recipe (copy this)
1. **Model** in `database.js`: define it, add to the `return { ... }` object.
2. **Load** it in `GET /` (`getDatabase` destructure + `findAll`), pass to
   `res.render('index', { ... })`.
3. **Routes** in `index.js`: `app.post('/thing', requireLogin, ...)` to create,
   `app.get('/thing/delete/:id', requireLogin, ...)` to remove. Follow the
   existing Debt/Installment routes verbatim (parse floats/ints, redirect `/`).
4. **View**: add the section to the registry in `layout.js` (and its columns), a
   `views/partials/section_<key>.ejs`, and load its rows in `GET /` (see Dashboard layout).
5. **Snapshot**: if it's a metric worth trending, add a column to Snapshot and
   include it in the upsert block in `GET /`, then add a dataset in `graphs.ejs`.

## Dashboard layout (customizable)
The built-in models, server math and Snapshot are unchanged; customization is a **layout layer**
on top, stored in each user's own DB.
- **`layout.js`** — pure: the registries (sections in default order `subscriptions, debts,
  installments, accounts, income, credit_scores, transactions`; columns per table section;
  tiles `totalDebt, monthlyIncome, totalAccounts, subscriptionTotal, monthlySpend` visible, and
  `netWorth, bnplUsed` hidden by default), merge-with-saved-prefs, `moveItem`, position
  normalisation, cell validation (`parseCellValue`, `cleanLabel`) and `sumValues`.
  **Merge rule:** saved prefs override defaults; a built-in with no pref appears after the
  positioned ones in its default place; prefs for unknown keys are ignored. Every mutation loads the
  resolved list, changes it, and saves the whole list, so prefs are created on demand and positions
  stay 0..n-1.
- **`layout-store.js`** — persistence + the data rules. `rowBelongsToSection` is the ownership
  check: a CustomValue may only be written for a row that exists in the column's built-in model, or
  is a CustomRow of that very custom section. Deleting a built-in row deletes its CustomValues;
  deleting a user column/section cascades to values and tiles. Built-ins are only ever hidden.
- **`layout-routes.js`** — `POST /layout/{sections,columns,tiles}[/rename|move|hide|delete]` and
  `/custom/{rows,rows/delete,values}`; JSON, all `requireLogin`.
- **Rendering:** `GET /` computes every tile value and passes `layout`
  (`buildLayout`) to `index.ejs`, which loops over `layout.sections` and includes
  `partials/section_<key>` (or `section_custom`). Tables render headers and cells by iterating
  the resolved column list (`partials/table.ejs`, `partials/cell.ejs` holds one case per
  built-in cell with the original markup). Order is DOM order in one CSS grid
  (`repeat(auto-fit, minmax(500px, 1fr))`); there is no `order:N` any more, and Debts and
  Installments are ordinary separate sections. "Upcoming Payments" stays fixed above the grid.
- **Edit mode** (`public/layout-edit.js`): the Customize button shows every `.edit-only` element
  (hidden inline, per the robust-panels rule). Layout changes POST then reload with the scroll
  position restored; user-column cells and custom rows update the DOM in place via fetch.
- **Scroll** (`public/scroll.js`): `<body data-scroll="dashboard|edit">`. The position is stored in
  sessionStorage with a timestamp when a navigation/submit actually proceeds and is ignored after
  30s. New full-page views that redirect back to `/` should load it too.
- Tests: `test/layout*.test.js` (logic, store, routes) and `test/dashboard-render.test.js`, which
  renders the real `index.ejs` and its partials when `ejs` is available.

## Conventions & gotchas (important)
- **theme.css is cache-busted**: views link `/theme.css?v=<%= Date.now() %>`.
  Keep this on any new full-page view or CSS changes won't show after deploy.
- **Robust panels**: for anything toggled/positioned (like the scratchpad),
  put critical layout as **inline styles** on the element and drive show/hide
  via `element.style.display` in JS — don't rely solely on CSS classes (a
  stale cached stylesheet silently broke the scratchpad before this rule).
- **EJS render-testing needs `ejs`** (no local node_modules; with the usual borrowed NODE_PATH
  `test/dashboard-render.test.js` renders the real dashboard, otherwise it skips). Before
  committing a view change, sanity-check: `grep -o '<div' file | wc -l` vs
  `</div>`, and eyeball the `<% %>` scriptlets. `node -c index.js` for JS.
- **Money math**: monthly-equivalent helpers `monthlyIncomeTotal` and
  `subscriptionMonthlyTotal` live in index.js — reuse them, don't duplicate the
  frequency multipliers (weekly ×4.33, biweekly ×2.166667, daily ×30, yearly ÷12).
- **Charts**: Chart.js via CDN in `graphs.ejs`. Serialize snapshot data with
  `<%- JSON.stringify(...) %>` (raw, not escaped). `spanGaps: true` for series
  with nulls (e.g. scores before they were entered).
- Redirect-after-POST everywhere (`res.redirect('/')`) — no JSON for the web UI.
- Commit messages end with the Co-Authored-By trailer. Branch off main, don't
  push to main directly unless the user asks (they usually deploy via Portainer).

## Deploy note for the user (not automatic)
Budget is its own Portainer stack, separate from cortex. After a push the user
must redeploy the budget stack. New models auto-migrate on next login.
