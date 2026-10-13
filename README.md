# Octopus Budget Tracker

A simple budget tracking application with subscription, account, income, and debt management.

## Features

- 📊 Track subscriptions (daily, weekly, monthly, yearly)
- 💰 Manage multiple accounts with balances
- 💵 Track income sources
- 📉 Monitor debts and payments
- 🔐 Password-protected multi-user support
- 💾 SQLite database (per-user)

## Quick Start

### Using Docker Compose (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/anonymous14386/octopus-budget.git
cd octopus-budget
```

2. Create a `.env` file:
```bash
cp .env.example .env
# Edit .env and set your SESSION_SECRET and APP_PASSWORD
```

3. Run with Docker Compose:
```bash
docker-compose up -d
```

4. Access the app at `http://localhost:3001`

### Manual Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export APP_PASSWORD=your-secure-password
export SESSION_SECRET=your-random-secret-key
```

3. Run the application:
```bash
node index.js
```

## Configuration

Environment variables:
- `APP_PASSWORD` - Password for login (default: "password")
- `SESSION_SECRET` - Secret key for session encryption
- `PORT` - Application port (default: 3000)
- `NODE_ENV` - Environment (development/production)

## Docker Deployment

The application is designed to work with Portainer auto-deployment:

1. In Portainer, create a new stack
2. Use the GitHub deployment option
3. Point to: `https://github.com/anonymous14386/octopus-budget`
4. Set environment variables in Portainer
5. Deploy!

## Data Persistence

Data is stored in SQLite databases in the `/data` directory. Each user gets their own database file (`username_database.sqlite`). In Docker, this is persisted via the `budget_data` volume.

## Tech Stack

- Node.js + Express
- SQLite + Sequelize ORM
- EJS templating
- Express Session for auth

## License

MIT

## Paycheck plan and debt planner
`/paychecks` (income sources with weekly / biweekly / semi-monthly / monthly / custom
schedules, payday check-in, estimated-vs-actual history), `/plan` (check-to-check
plan and debt planner, `/plan.json` for the raw data), `/plan/bills` (real due
dates for subscriptions, due days for debts). Code is in `planner/`; the plan is
computed on every read and never stored. Dashboard widgets can render
`partials/payday_prompt.ejs` and `computePlan()` from `planner/routes.js`.
