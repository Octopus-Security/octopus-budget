const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// User data is now handled by octopus-auth service
// This file only handles budget-specific data models

// The username is interpolated straight into a filesystem path below, so it is
// the whole isolation boundary of this service: there is no owner column, and an
// unfiltered query inside one user's database is correct precisely BECAUSE the
// file is the boundary.
//
// Until 2026-09-05 nothing here checked it. A username containing a slash
// escaped the data directory — `../..` resolved to `<root>/.._database.sqlite`,
// one level outside `data/`. It was never reachable in practice, because
// octopus-auth restricts usernames to exactly this pattern at registration.
//
// That is the problem. The control lived in a DIFFERENT REPO, was invisible from
// this file, and this service would have kept trusting it through any future
// loosening. The estate rule is that enforcement goes in the service that owns
// the data, so it goes here too — the two agreeing is the point, not duplication.
const SAFE_USERNAME = /^[A-Za-z0-9_.-]+$/;

const getDatabase = (username) => {
    const name = String(username == null ? '' : username);
    if (!SAFE_USERNAME.test(name)) {
        // Refuse rather than sanitise. Stripping the offending characters would
        // map several distinct people onto one filename, which is a quieter and
        // far worse failure than the traversal it prevents.
        throw new Error(`refusing to open a budget database for an unsafe username: ${JSON.stringify(name)}`);
    }

    const storage = path.join(__dirname, 'data', `${name}_database.sqlite`);
    const dataDir = path.resolve(__dirname, 'data');
    // The invariant the regex is protecting, asserted directly. If the pattern is
    // ever widened, this still holds the line.
    if (!path.resolve(storage).startsWith(dataDir + path.sep)) {
        throw new Error(`refusing to open a budget database outside data/: ${storage}`);
    }

    // Initialize Sequelize with SQLite - per-user database for budget data
    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage,
        logging: false
    });

    // Define the models
    const Subscription = sequelize.define('Subscription', {
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        frequency: {
            type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'yearly'),
            allowNull: false
        },
        category: {
            type: DataTypes.STRING,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    const Account = sequelize.define('Account', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        balance: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        type: {
            type: DataTypes.STRING,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    const Income = sequelize.define('Income', {
        source: {
            type: DataTypes.STRING,
            allowNull: true
        },
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        frequency: {
            type: DataTypes.ENUM('weekly', 'biweekly', 'monthly'),
            allowNull: false
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    const Debt = sequelize.define('Debt', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        balance: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        interest_rate: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        minimum_payment: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        due_date: {
            type: DataTypes.DATE,
            allowNull: true
        },
        // Day of month (1–28) for recurring monthly payment reminder
        due_day: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        credit_limit: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    // Affirm / Klarna / BNPL installment plans
    const Installment = sequelize.define('Installment', {
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        provider: {
            type: DataTypes.STRING,  // affirm | klarna | other
            allowNull: false,
            defaultValue: 'other'
        },
        total_amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        paid_amount: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        },
        payment_amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        next_due_date: {
            type: DataTypes.DATEONLY,  // YYYY-MM-DD
            allowNull: false
        },
        remaining_payments: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        frequency: {
            type: DataTypes.STRING,  // biweekly | monthly
            allowNull: false,
            defaultValue: 'biweekly'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    // BNPL provider (Affirm / Klarna / custom) with a credit allowance.
    // "Used" is derived at render time from the sum of that provider's
    // installment plans — not stored here.
    const Provider = sequelize.define('Provider', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        allowance: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        },
        builtin: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        icon_url: {
            type: DataTypes.STRING,
            allowNull: true
        }
    });

    // Per-transaction expense/income log. positive amount = expense, negative = refund/income.
    const Transaction = sequelize.define('Transaction', {
        description: { type: DataTypes.STRING,  allowNull: false },
        amount:      { type: DataTypes.FLOAT,   allowNull: false },
        category:    { type: DataTypes.STRING,  allowNull: true },
        account_id:  { type: DataTypes.INTEGER, allowNull: true },
        provider:    { type: DataTypes.STRING,  allowNull: true },
        date:        { type: DataTypes.DATEONLY, allowNull: false },
        notes:       { type: DataTypes.TEXT,    allowNull: true },
    });

    // Current credit score per bureau (transunion | equifax | ...).
    const CreditScore = sequelize.define('CreditScore', {
        bureau: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        score: {
            type: DataTypes.INTEGER,
            allowNull: true
        }
    });

    // Daily rollup of every headline metric, so trends can be graphed over
    // time. One row per calendar day (upserted). This is the growth spine —
    // new metrics get new columns; history accumulates automatically.
    const Snapshot = sequelize.define('Snapshot', {
        date:              { type: DataTypes.DATEONLY, allowNull: false, unique: true },
        totalDebt:         { type: DataTypes.FLOAT, allowNull: true },
        totalAccounts:     { type: DataTypes.FLOAT, allowNull: true },
        monthlyIncome:     { type: DataTypes.FLOAT, allowNull: true },
        subscriptionTotal: { type: DataTypes.FLOAT, allowNull: true },
        bnplUsed:          { type: DataTypes.FLOAT, allowNull: true },
        netWorth:          { type: DataTypes.FLOAT, allowNull: true },
        transunion:        { type: DataTypes.INTEGER, allowNull: true },
        equifax:           { type: DataTypes.INTEGER, allowNull: true },
        monthlySpend:      { type: DataTypes.FLOAT,   allowNull: true }
    });

    // ── Dashboard layout layer ────────────────────────────────────────────────
    // Built-in sections keep their real models above; these tables only hold the
    // per-user presentation (titles, order, hidden) and generic user-made data.
    // All additive: sync({ alter: true }) creates them on next login.

    // One row per built-in section the user has customised, keyed by built-in key.
    const SectionPref = sequelize.define('SectionPref', {
        key:      { type: DataTypes.STRING, allowNull: false, unique: true },
        title:    { type: DataTypes.STRING, allowNull: true },
        position: { type: DataTypes.INTEGER, allowNull: true },
        hidden:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    });

    // A section the user created. Its rows are CustomRow, its cells CustomValue.
    const CustomSection = sequelize.define('CustomSection', {
        title:    { type: DataTypes.STRING, allowNull: false },
        position: { type: DataTypes.INTEGER, allowNull: true },
        hidden:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    });

    // Column prefs. builtin_key set => a built-in column (rename/reorder/hide only,
    // never deleted). builtin_key null => a user column, which owns CustomValues.
    // section_key is a built-in section key or 'custom:<CustomSection.id>'.
    const ColumnPref = sequelize.define('ColumnPref', {
        section_key: { type: DataTypes.STRING, allowNull: false },
        builtin_key: { type: DataTypes.STRING, allowNull: true },
        label:       { type: DataTypes.STRING, allowNull: false },
        type:        { type: DataTypes.ENUM('text', 'number', 'money', 'date'), allowNull: false, defaultValue: 'text' },
        position:    { type: DataTypes.INTEGER, allowNull: true },
        hidden:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    });

    // A row of a custom section.
    const CustomRow = sequelize.define('CustomRow', {
        section_id: { type: DataTypes.INTEGER, allowNull: false },
        position:   { type: DataTypes.INTEGER, allowNull: true },
    });

    // One cell of a user column. row_id is the built-in model's id for built-in
    // sections, or CustomRow.id for custom ones (ownership is checked in
    // layout-store.js before every write).
    const CustomValue = sequelize.define('CustomValue', {
        column_id: { type: DataTypes.INTEGER, allowNull: false },
        row_id:    { type: DataTypes.INTEGER, allowNull: false },
        value:     { type: DataTypes.TEXT, allowNull: true },
    }, {
        indexes: [{ unique: true, fields: ['column_id', 'row_id'] }],
    });

    // Summary tiles. key = built-in metric key; key null => a user tile that sums
    // the values of column_id (a number/money user column). No formulas.
    const TilePref = sequelize.define('TilePref', {
        key:       { type: DataTypes.STRING, allowNull: true },
        title:     { type: DataTypes.STRING, allowNull: true },
        position:  { type: DataTypes.INTEGER, allowNull: true },
        hidden:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        column_id: { type: DataTypes.INTEGER, allowNull: true },
    });

    return {
        sequelize,
        Subscription,
        Account,
        Income,
        Debt,
        Installment,
        Provider,
        CreditScore,
        Snapshot,
        Transaction,
        SectionPref,
        CustomSection,
        ColumnPref,
        CustomRow,
        CustomValue,
        TilePref,
    };
}

module.exports = getDatabase;
