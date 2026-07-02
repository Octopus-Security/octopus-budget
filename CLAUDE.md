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
- **Single-file Express app: `index.js`** (all routes live here, ~33 routes).
- **`database.js`** — `getDatabase(username)` returns per-user SQLite models.
  Each user has their own `data/<username>_database.sqlite`.
- **`views/`** — EJS: `index.ejs` (dashboard), `graphs.ejs` (Trends),
  `settings.ejs`, `login.ejs`, `edit_subscription.ejs`.
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
`Subscription, Account, Income, Debt, Installment, Provider, CreditScore, Snapshot`.
- **Provider** — BNPL provider (Affirm/Klarna builtin + custom). Has `allowance`.
  "Used" is NOT stored — it's derived from that provider's Installment plans.
- **Installment** — a BNPL plan: provider, total_amount, paid_amount,
  payment_amount, remaining_payments, next_due_date, frequency.
- **CreditScore** — `{ bureau, score }`, one row per bureau (transunion/equifax).
- **Snapshot** — **the growth spine.** One row per calendar day, upserted on
  every dashboard `GET /`, capturing all headline metrics + scores. Adding a
  metric = add a column + set it in the upsert; history then accrues for free.

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
4. **View**: add a `.card` in the dashboard grid in `index.ejs`. Cards use
   `style="order:N"` to position within the grid (see layout note below).
5. **Snapshot**: if it's a metric worth trending, add a column to Snapshot and
   include it in the upsert block in `GET /`, then add a dataset in `graphs.ejs`.

## Dashboard layout (index.ejs)
- Cards live in one CSS grid: `repeat(auto-fit, minmax(500px, 1fr))`.
- Order is controlled by inline `style="order:N"` on each `.card`:
  1 Subscriptions · 2 Debts+Installments group · 3 Accounts · 4 Income ·
  5 Credit Scores. New cards get the next order number.
- Debts + Installments are wrapped in one `order:2` flex-column div so they
  stay paired in the same column.

## Conventions & gotchas (important)
- **theme.css is cache-busted**: views link `/theme.css?v=<%= Date.now() %>`.
  Keep this on any new full-page view or CSS changes won't show after deploy.
- **Robust panels**: for anything toggled/positioned (like the scratchpad),
  put critical layout as **inline styles** on the element and drive show/hide
  via `element.style.display` in JS — don't rely solely on CSS classes (a
  stale cached stylesheet silently broke the scratchpad before this rule).
- **EJS can't be render-tested locally** (deps only in the container). Before
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
