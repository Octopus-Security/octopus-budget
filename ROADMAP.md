# octopus-budget — build roadmap

Prioritized backlog for growing the financial hub. Read `CLAUDE.md` first for
architecture + the "add a tracked thing" recipe. Work top-down; each item has
enough spec to build without re-deriving context. Check items off as you go.

Legend: **P1** = do first (core expenditure tracking) · **P2** = high value ·
**P3** = later / nice-to-have.

---

## ✅ P1 — Transactions (the real expenditure spine) — DONE

**Why:** Today "spending" is only inferred from subscriptions/debts. To actually
graph expenditure the hub needs a per-transaction log. This is the single most
important addition and everything category/trend-related builds on it.

**Model — `Transaction`** (`database.js`):
```
description   STRING   notNull
amount        FLOAT    notNull        // positive = expense, negative = income/refund
category      STRING   nullable       // e.g. Groceries, Rent, Dining
account_id    INTEGER  nullable       // FK-ish to Account (by id), optional
provider      STRING   nullable       // if paid via a BNPL provider
date          DATEONLY notNull        // when it happened
notes         TEXT     nullable
```
Add to the `return {}` in getDatabase.

**Routes** (`index.js`, follow the Debt route style):
- `POST /transactions` — create (parse amount float, date required, default
  date = today if blank).
- `GET /transactions/delete/:id` — destroy.
- `POST /transactions/edit/:id` (optional now) — update.
- Load in `GET /`: `Transaction.findAll({ order: [['date','DESC']], limit: 200 })`
  and pass to the template.

**View** (`index.ejs`): new `.card` `style="order:6"`:
- Table of recent transactions (date, description, category, amount colored
  red for expense / green for negative) with Delete.
- Add form: description, amount, category (datalist of existing categories),
  date (default today), optional account/provider selects.

**Snapshot + graph:**
- Add Snapshot columns `monthlySpend FLOAT`. In `GET /` upsert, compute
  this-calendar-month expense total from Transactions (sum of positive amounts
  where date in current month) and store it.
- In `graphs.ejs` add a "Monthly Spending" line chart from `monthlySpend`.

**Acceptance:** can log an expense, see it in the list, it colors correctly,
this month's spend appears on the dashboard summary and trends on /graphs.

---

## P1 — Spending by category (next to build)

Depends on Transactions.

- `GET /graphs` already loads snapshots; also load Transactions there and build
  a category → total map for a chosen window (default current month).
- Add a **doughnut/bar chart** in `graphs.ejs` of spend per category.
- Optional: a small "top categories this month" list on the dashboard.

**Acceptance:** /graphs shows a category breakdown that matches the logged data.

---

## P2 — Payment history log

**Why:** Right now paying an installment (`/installments/paid/:id`) mutates the
plan but keeps no history. Log payments so cashflow is auditable and graphable.

**Model — `Payment`**: `{ source STRING (installment|debt), source_id INTEGER,
label STRING, amount FLOAT, date DATEONLY }`.
- In the existing `/installments/paid/:id` route, after advancing the plan,
  `Payment.create({...})`. Do the same if/when debts get a "pay" action.
- Show a "Payment history" section (collapsible) and/or feed a
  Snapshot `paymentsThisMonth` column + trend.

---

## P2 — Category budgets / targets

- **Model — `Budget`**: `{ category STRING unique, monthly_limit FLOAT }`.
- Routes to set/delete budgets.
- On dashboard, per budget show spent-this-month vs limit as a progress bar
  (reuse the credit-limit bar markup pattern from the Debts/Provider cards).
- Color: green <70%, amber <100%, red over.

---

## P2 — Recurring transactions

- **Model — `Recurring`**: `{ description, amount, category, frequency
  (weekly|biweekly|monthly), next_date DATEONLY }`.
- On `GET /` (or a lightweight daily check), for any Recurring whose
  `next_date <= today`, auto-create a Transaction and advance `next_date`.
  Guard against double-posting (advance in the same pass).
- Lets subscriptions/rent flow into the transaction log automatically.

---

## P2 — Notifications via the octopus ecosystem

**Why:** Ties budget into cortex's Discord/Telegram like the rest of octopus.

- cortex already exposes a notify path (it DMs/Telegrams the owner). Simplest:
  POST to cortex's internal notify endpoint (see octopus-cortex
  `/api/notify` / `discord/notify`) with an `X-Internal-Secret` header when
  configured, else trust the docker network.
- Trigger: a daily job (or on dashboard load, throttled to once/day via a
  Snapshot flag) that finds upcoming due dates (the `upcoming` list already
  computed in `GET /`) within N days and sends a summary.
- Keep the integration behind an env flag (`CORTEX_URL`, `INTERNAL_SECRET`) so
  it no-ops when unset.

---

## P3 — Later

- **CSV import/export** of transactions (bank export → categorized rows).
- **Savings goals**: `{ name, target_amount, saved_amount, target_date }` with
  progress bars; feed a `savings` snapshot column.
- **Net worth breakdown** on /graphs (stacked: accounts − debts − BNPL).
- **Snapshot management**: retention/pruning, manual "record snapshot now",
  and a one-time backfill so early graphs aren't empty.
- **Mobile API**: the dormant `api/` router (auth + budget) can be wired up and
  mounted (`app.use('/api', require('./api'))`) if a mobile client is built.
- **Multi-user polish**: budget is per-user already; if it ever serves others,
  audit that every query is scoped by `req.user.username` (it is, via
  `getDatabase(username)`), and add per-user data export/delete.

---

## Snapshot columns cheat-sheet
Current: `totalDebt, totalAccounts, monthlyIncome, subscriptionTotal, bnplUsed,
netWorth, transunion, equifax, monthlySpend`. Planned additions:
`paymentsThisMonth, savings`. Every new headline metric → add a column here +
set it in the `GET /` upsert + add a dataset in `graphs.ejs`. That's the whole
pattern for "make it graphable over time."
