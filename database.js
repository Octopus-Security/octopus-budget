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

const resolveStorage = (username) => {
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
    return { name, storage };
};

// Applied to EVERY new connection (Sequelize's sqlite dialect opens a separate
// handle per transaction, so once-after-authenticate is not enough). The data
// dir is the budget_data volume (a directory mount), so WAL's -wal/-shm files
// have somewhere to live.
const PRAGMAS = 'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;';
const applyPragmas = (connection) => new Promise((resolve, reject) => {
    connection.exec(PRAGMAS, (err) => (err ? reject(err) : resolve()));
});

function buildInstance(storage) {
    // Initialize Sequelize with SQLite - per-user database for budget data
    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage,
        logging: false
    });

    // The sqlite dialect's getConnection() never runs Sequelize's afterConnect
    // hook, so wrap it (as octopus-auth/database.js does for busyTimeout). It is
    // called on every query and returns a cached handle, hence the WeakSet: the
    // pragmas run once per distinct connection (default one, plus one per
    // transaction).
    const cm = sequelize.connectionManager;
    const origGetConnection = cm.getConnection.bind(cm);
    const configured = new WeakSet();
    cm.getConnection = async function withPragmas(options) {
        const connection = await origGetConnection(options);
        if (!configured.has(connection)) {
            await applyPragmas(connection);
            configured.add(connection);
        }
        return connection;
    };

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

    // Paycheck plan + debt planner tables (planner/models.js): new tables only.
    const planner = require('./planner/models')(sequelize);

    return {
        ...planner,
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
    };
}

// ── Per-user instance cache ──────────────────────────────────────────────────
// This used to build a new Sequelize instance (and, on first query, a new
// SQLite connection) on EVERY call — 39 call sites, 8 of them in parallel on
// the dashboard. Keyed by the username that already passed resolveStorage(), so
// one person's handle can never be returned for another's name; the key is the
// same string that picks the file.
const MAX_OPEN = 200;
const CLOSE_GRACE_MS = 30 * 1000;
const cache = new Map(); // name -> db object; Map order = recency (oldest first)

const closeLater = (db) => {
    // Evicted instances may still have a query in flight; give it time, then close.
    const t = setTimeout(() => { db.sequelize.close().catch(() => {}); }, CLOSE_GRACE_MS);
    if (t.unref) t.unref();
};

const getDatabase = (username) => {
    const { name, storage } = resolveStorage(username);
    const hit = cache.get(name);
    if (hit) {
        cache.delete(name);
        cache.set(name, hit); // refresh recency
        return hit;
    }
    const db = buildInstance(storage);
    cache.set(name, db);
    while (cache.size > MAX_OPEN) {
        const oldest = cache.keys().next().value;
        const evicted = cache.get(oldest);
        cache.delete(oldest);
        closeLater(evicted);
    }
    return db;
};

// Idempotent: CREATE INDEX IF NOT EXISTS, so it is safe on every start and on
// databases that already hold data. The model `indexes` option is not used
// because sync({alter:true}) on SQLite is a table rebuild we do not want to
// widen. Columns: the dashboard's ORDER BY Transaction.date DESC LIMIT 200 and
// Installment.next_due_date ASC.
const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_transactions_date ON Transactions (date)',
    'CREATE INDEX IF NOT EXISTS idx_installments_next_due_date ON Installments (next_due_date)',
];
const ensureIndexes = async (sequelize) => {
    for (const sql of INDEXES) await sequelize.query(sql);
};

module.exports = getDatabase;
module.exports.ensureIndexes = ensureIndexes;
module.exports.INDEXES = INDEXES;
module.exports._cacheSize = () => cache.size;
module.exports._MAX_OPEN = MAX_OPEN;
