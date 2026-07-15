const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;
const getDatabase = require('./database');
const { createAuthMiddleware, AuthClient } = require('@octopus-security/auth-client');
const axios = require('axios');

const auth = new AuthClient();
const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://octopus-auth:3002';

// Machine-to-machine auth for internal endpoints (e.g. cortex /purchase).
// Shared secret across the octopus stack; owner whose budget receives writes.
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';
const BUDGET_OWNER    = process.env.BUDGET_OWNER || 'psychopathy';

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Static files
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));

// ── Stateless SSO auth ────────────────────────────────────────────────────────
// One central login at auth.octopustechnology.net sets a JWT cookie scoped to the
// whole domain; verify it against octopus-auth (cached) and expose req.user.
const SSO_COOKIE     = 'octopus_sso';
const AUTH_LOGIN_URL = (process.env.AUTH_PUBLIC_URL || 'https://auth.octopustechnology.net') + '/login';
const _verifyCache = new Map();   // token -> { user, exp }
const _seededUsers = new Set();   // usernames whose DB has been ensured this run

function parseCookies(req) {
    const out = {};
    const header = req.headers.cookie;
    if (!header) return out;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

async function verifyToken(token) {
    const cached = _verifyCache.get(token);
    if (cached && cached.exp > Date.now()) return cached.user;
    try {
        const r = await axios.post(`${AUTH_URL}/api/auth/verify`, {}, {
            headers: { Authorization: `Bearer ${token}` }, timeout: 5000,
        });
        if (r.data && r.data.valid && r.data.user) {
            _verifyCache.set(token, { user: r.data.user, exp: Date.now() + 5 * 60 * 1000 });
            return r.data.user;
        }
    } catch { /* invalid or auth unreachable → unauthenticated */ }
    return null;
}

async function ensureUserDb(username) {
    if (_seededUsers.has(username)) return;
    const { sequelize } = getDatabase(username);
    await sequelize.sync({ alter: true });
    _seededUsers.add(username);
}

app.use(async (req, res, next) => {
    const token = parseCookies(req)[SSO_COOKIE];
    if (token) {
        const user = await verifyToken(token);
        if (user) req.user = { username: user.username, role: user.role, token };
    }
    res.locals.user = req.user || null;
    next();
});

const authenticateJWT = createAuthMiddleware();


const requireLogin = async (req, res, next) => {
    if (!req.user) {
        const back = encodeURIComponent(`https://${req.get('host')}${req.originalUrl}`);
        return res.redirect(`${AUTH_LOGIN_URL}?redirect=${back}`);
    }
    try { await ensureUserDb(req.user.username); }
    catch (e) { console.error('ensureUserDb failed:', e.message); }
    next();
};

// Login/register/logout are centralized at auth.octopustechnology.net now.
app.get('/login', (req, res) => {
    const back = encodeURIComponent(`https://${req.get('host')}/`);
    res.redirect(`${AUTH_LOGIN_URL}?redirect=${back}`);
});

app.get('/register', (req, res) => {
    const back = encodeURIComponent(`https://${req.get('host')}/`);
    res.redirect(`${AUTH_LOGIN_URL}?register=1&redirect=${back}`);
});

app.get('/logout', (req, res) => {
    const base = process.env.AUTH_PUBLIC_URL || 'https://auth.octopustechnology.net';
    const back = encodeURIComponent(`https://${req.get('host')}/`);
    res.redirect(`${base}/logout?redirect=${back}`);
});

// REST API endpoints for mobile app - proxy to auth service
app.post('/api/auth/register', async (req, res) => {
    try {
        const r = await auth.register(req.body.username, req.body.password, req.body.email, req.body.inviteCode);
        res.status(r.status).json(r.data);
    } catch (error) {
        res.status(503).json({ success: false, error: 'Auth service unavailable' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const r = await auth.login(req.body.username, req.body.password);
        res.status(r.status).json(r.data);
    } catch (error) {
        res.status(503).json({ success: false, error: 'Auth service unavailable' });
    }
});


const BUILTIN_ICONS = {
  Affirm: 'https://www.google.com/s2/favicons?sz=32&domain=affirm.com',
  Klarna: 'https://www.google.com/s2/favicons?sz=32&domain=klarna.com',
};

// Ensure the built-in BNPL providers (Affirm, Klarna) always exist and have icons.
async function ensureProviders(Provider) {
  for (const name of ['Affirm', 'Klarna']) {
    const [p, created] = await Provider.findOrCreate({
      where: { name },
      defaults: { name, allowance: 0, builtin: true, icon_url: BUILTIN_ICONS[name] }
    });
    if (!created && !p.icon_url) {
      p.icon_url = BUILTIN_ICONS[name];
      await p.save();
    }
  }
}

// Roll monthly-equivalent amounts for mixed frequencies.
function monthlyIncomeTotal(income) {
  let t = 0;
  for (const i of income) {
    if (i.frequency === 'weekly') t += i.amount * 4.33;
    else if (i.frequency === 'biweekly') t += i.amount * 2.166667;
    else t += i.amount;
  }
  return t;
}
function subscriptionMonthlyTotal(subscriptions) {
  let t = 0;
  for (const s of subscriptions) {
    let a = s.amount;
    if (s.frequency === 'daily') a *= 30;
    else if (s.frequency === 'weekly') a *= 4.33;
    else if (s.frequency === 'yearly') a /= 12;
    t += a;
  }
  return t;
}

app.get('/', requireLogin, async (req, res) => {
  const { Subscription, Account, Income, Debt, Installment, Provider, CreditScore, Snapshot, Transaction } = getDatabase(req.user.username);
  await ensureProviders(Provider);
  const [subscriptions, accounts, income, debts, installments, providerRows, scoreRows, transactions] = await Promise.all([
    Subscription.findAll(),
    Account.findAll(),
    Income.findAll(),
    Debt.findAll(),
    Installment.findAll({ order: [['next_due_date', 'ASC']] }),
    Provider.findAll({ order: [['builtin', 'DESC'], ['name', 'ASC']] }),
    CreditScore.findAll(),
    Transaction.findAll({ order: [['date', 'DESC']], limit: 200 }),
  ]);

  // Derive each provider's "used" = sum of outstanding balances across its
  // installment plans (remaining payments × payment amount).
  const usedByProvider = {};
  for (const inst of installments) {
    const key = (inst.provider || 'other').toLowerCase();
    const outstanding = (inst.remaining_payments || 0) * (inst.payment_amount || 0);
    usedByProvider[key] = (usedByProvider[key] || 0) + outstanding;
  }
  const providers = providerRows.map(p => {
    const used = usedByProvider[p.name.toLowerCase()] || 0;
    const allowance = p.allowance || 0;
    return {
      id: p.id, name: p.name, allowance, builtin: p.builtin, used, icon_url: p.icon_url || null,
      available: allowance > 0 ? allowance - used : null,
      pct: allowance > 0 ? Math.min(100, (used / allowance) * 100) : null,
    };
  });

  // Credit scores → simple { transunion, equifax } map
  const scores = {};
  for (const s of scoreRows) scores[s.bureau] = s.score;

  // Headline totals (also fed to the daily snapshot)
  const totalDebt         = debts.reduce((a, d) => a + (d.balance || 0), 0);
  const totalAccounts     = accounts.reduce((a, c) => a + (c.balance || 0), 0);
  const monthlyIncome     = monthlyIncomeTotal(income);
  const subscriptionTotal = subscriptionMonthlyTotal(subscriptions);
  const bnplUsed          = Object.values(usedByProvider).reduce((a, b) => a + b, 0);
  const netWorth          = totalAccounts - totalDebt - bnplUsed;

  // Sum positive-amount transactions in the current calendar month.
  const nowStr = new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthlySpend = transactions
    .filter(t => t.date && t.date.startsWith(nowStr) && t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  // Upsert today's snapshot so history accumulates automatically for graphs.
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const fields = {
      totalDebt, totalAccounts, monthlyIncome, subscriptionTotal, bnplUsed, netWorth,
      transunion: scores.transunion ?? null, equifax: scores.equifax ?? null,
      monthlySpend,
    };
    const [snap, created] = await Snapshot.findOrCreate({ where: { date: todayStr }, defaults: { date: todayStr, ...fields } });
    if (!created) { Object.assign(snap, fields); await snap.save(); }
  } catch (e) { console.error('snapshot upsert failed:', e.message); }

  // Build upcoming payments list (next 60 days)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 60);
  const upcoming = [];

  for (const debt of debts) {
    if (!debt.due_day) continue;
    const d = new Date(today.getFullYear(), today.getMonth(), debt.due_day);
    if (d < today) d.setMonth(d.getMonth() + 1);
    if (d <= horizon) {
      const daysAway = Math.round((d - today) / 86400000);
      upcoming.push({ label: debt.name, amount: debt.minimum_payment || null, date: d, daysAway, type: 'debt' });
    }
  }

  for (const inst of installments) {
    if (!inst.next_due_date) continue;
    const d = new Date(inst.next_due_date + 'T00:00:00');
    if (d > horizon) continue;
    const daysAway = Math.round((d - today) / 86400000);
    upcoming.push({ label: `${inst.name} (${inst.provider})`, amount: inst.payment_amount, date: d, daysAway, type: 'installment', remaining: inst.remaining_payments });
  }

  upcoming.sort((a, b) => a.date - b.date);

  res.render('index', {
    title: 'Budget Tracker',
    subscriptions,
    accounts,
    income,
    debts,
    installments,
    providers,
    scores,
    upcoming,
    transactions,
    monthlySpend,
    user: req.user,
  });
});

app.post('/subscriptions', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.user.username);
    await Subscription.create(req.body);
    res.redirect('/');
});

app.get('/subscriptions/edit/:id', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.user.username);
    const subscription = await Subscription.findByPk(req.params.id);
    res.render('edit_subscription', { title: 'Edit Subscription', subscription });
});

app.post('/subscriptions/edit/:id', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.user.username);
    const subscription = await Subscription.findByPk(req.params.id);
    subscription.name = req.body.name;
    subscription.amount = req.body.amount;
    subscription.frequency = req.body.frequency;
    await subscription.save();
    res.redirect('/');
});

app.get('/subscriptions/delete/:id', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.user.username);
    const subscription = await Subscription.findByPk(req.params.id);
    await subscription.destroy();
    res.redirect('/');
});

app.post('/accounts', requireLogin, async (req, res) => {
    const { Account } = getDatabase(req.user.username);
    const { name, balance } = req.body;
    const account = await Account.findOne({ where: { name } });
    if (account) {
        account.balance = balance;
        await account.save();
    } else {
        await Account.create(req.body);
    }
    res.redirect('/');
});

app.get('/accounts/delete/:id', requireLogin, async (req, res) => {
    const { Account } = getDatabase(req.user.username);
    await Account.destroy({ where: { id: req.params.id } });
    res.redirect('/');
});

app.post('/income', requireLogin, async (req, res) => {
    const { Income } = getDatabase(req.user.username);
    // For simplicity, assuming only one income entry
    const income = await Income.findOne();
    if (income) {
        income.amount = req.body.amount;
        income.frequency = req.body.frequency;
        await income.save();
    } else {
        await Income.create(req.body);
    }
    res.redirect('/');
});

app.post('/debts', requireLogin, async (req, res) => {
    const { Debt } = getDatabase(req.user.username);
    const { name, amount, credit_limit, minimum_payment, due_day } = req.body;
    const parsedAmount = parseFloat(amount);
    const parsedLimit = credit_limit !== '' && credit_limit !== undefined ? parseFloat(credit_limit) : null;
    const parsedMin   = minimum_payment !== '' && minimum_payment !== undefined ? parseFloat(minimum_payment) : null;
    const parsedDay   = due_day !== '' && due_day !== undefined ? parseInt(due_day) : null;
    const debt = await Debt.findOne({ where: { name } });
    if (debt) {
        debt.amount = parsedAmount;
        debt.balance = parsedAmount;
        if (parsedLimit !== null) debt.credit_limit = parsedLimit;
        if (parsedMin   !== null) debt.minimum_payment = parsedMin;
        if (parsedDay   !== null) debt.due_day = parsedDay;
        await debt.save();
    } else {
        await Debt.create({
            name,
            amount: parsedAmount,
            balance: parsedAmount,
            credit_limit: parsedLimit,
            minimum_payment: parsedMin,
            due_day: parsedDay,
        });
    }
    res.redirect('/');
});

app.get('/debts/delete/:id', requireLogin, async (req, res) => {
    const { Debt } = getDatabase(req.user.username);
    await Debt.destroy({ where: { id: req.params.id } });
    res.redirect('/');
});

// ── Credit scores (TransUnion / Equifax) ─────────────────────────────────────
app.post('/credit-scores', requireLogin, async (req, res) => {
    const { CreditScore } = getDatabase(req.user.username);
    for (const bureau of ['transunion', 'equifax']) {
        const raw = req.body[bureau];
        if (raw === undefined || raw === '') continue;
        const score = parseInt(raw);
        if (isNaN(score)) continue;
        const [row] = await CreditScore.findOrCreate({ where: { bureau }, defaults: { bureau, score } });
        row.score = score;
        await row.save();
    }
    res.redirect('/');
});

// ── Graphs / history ─────────────────────────────────────────────────────────
app.get('/graphs', requireLogin, async (req, res) => {
    const { Snapshot } = getDatabase(req.user.username);
    const snapshots = await Snapshot.findAll({ order: [['date', 'ASC']] });
    res.render('graphs', { title: 'Trends', user: req.user, snapshots });
});

// ── BNPL Providers (Affirm / Klarna / custom) ────────────────────────────────
// Set or update a provider's allowance; also creates custom providers.
app.post('/providers', requireLogin, async (req, res) => {
    const { Provider } = getDatabase(req.user.username);
    const name = (req.body.name || '').trim();
    if (!name) return res.redirect('/');
    const allowance = req.body.allowance !== '' && req.body.allowance !== undefined ? parseFloat(req.body.allowance) : 0;
    const icon_url = (req.body.icon_url || '').trim() || null;
    const [provider] = await Provider.findOrCreate({ where: { name }, defaults: { name, allowance, builtin: false, icon_url } });
    provider.allowance = isNaN(allowance) ? 0 : allowance;
    if (icon_url) provider.icon_url = icon_url;
    await provider.save();
    res.redirect('/');
});

app.get('/providers/delete/:id', requireLogin, async (req, res) => {
    const { Provider } = getDatabase(req.user.username);
    const provider = await Provider.findByPk(req.params.id);
    if (provider && !provider.builtin) await provider.destroy();
    res.redirect('/');
});

// ── Installments (Affirm / Klarna / BNPL) ────────────────────────────────────
app.post('/installments', requireLogin, async (req, res) => {
    const { Installment, Provider } = getDatabase(req.user.username);
    let { name, provider, provider_other, total_amount, payment_amount, next_due_date, remaining_payments, frequency, notes } = req.body;
    // "Add other" flow: use the typed provider name and remember it as a provider
    if (provider === '__other__') {
        provider = (provider_other || '').trim() || 'Other';
        await Provider.findOrCreate({ where: { name: provider }, defaults: { name: provider, allowance: 0, builtin: false } });
    }
    await Installment.create({
        name,
        provider: provider || 'Other',
        total_amount: parseFloat(total_amount),
        payment_amount: parseFloat(payment_amount),
        next_due_date,
        remaining_payments: parseInt(remaining_payments),
        frequency: frequency || 'biweekly',
        notes: notes || null,
    });
    res.redirect('/');
});

app.get('/installments/paid/:id', requireLogin, async (req, res) => {
    const { Installment } = getDatabase(req.user.username);
    const inst = await Installment.findByPk(req.params.id);
    if (inst) {
        inst.paid_amount = (inst.paid_amount || 0) + inst.payment_amount;
        inst.remaining_payments = Math.max(0, inst.remaining_payments - 1);
        // Advance next_due_date
        const d = new Date(inst.next_due_date + 'T00:00:00');
        if (inst.frequency === 'monthly') {
            d.setMonth(d.getMonth() + 1);
        } else {
            d.setDate(d.getDate() + 14);
        }
        inst.next_due_date = d.toISOString().slice(0, 10);
        await inst.save();
    }
    res.redirect('/');
});

app.get('/installments/delete/:id', requireLogin, async (req, res) => {
    const { Installment } = getDatabase(req.user.username);
    await Installment.destroy({ where: { id: req.params.id } });
    res.redirect('/');
});

// ── Transactions ─────────────────────────────────────────────────────────────
app.post('/transactions', requireLogin, async (req, res) => {
    const { Transaction } = getDatabase(req.user.username);
    const { description, amount, category, account_id, provider, date, notes } = req.body;
    const today = new Date().toISOString().slice(0, 10);
    await Transaction.create({
        description,
        amount: parseFloat(amount),
        category: category || null,
        account_id: account_id ? parseInt(account_id) : null,
        provider: provider || null,
        date: date || today,
        notes: notes || null,
    });
    res.redirect('/');
});

app.get('/transactions/edit/:id', requireLogin, async (req, res) => {
    const { Transaction, Account, Provider } = getDatabase(req.user.username);
    const transaction = await Transaction.findByPk(req.params.id);
    if (!transaction) return res.redirect('/');
    const [accounts, providers] = await Promise.all([Account.findAll(), Provider.findAll()]);
    res.render('edit_transaction', { title: 'Edit Transaction', transaction, accounts, providers, user: req.user });
});

app.post('/transactions/edit/:id', requireLogin, async (req, res) => {
    const { Transaction } = getDatabase(req.user.username);
    const tx = await Transaction.findByPk(req.params.id);
    if (!tx) return res.redirect('/');
    const { description, amount, category, date, provider, notes } = req.body;
    if (description !== undefined && description.trim() !== '') tx.description = description.trim();
    if (amount !== undefined && amount !== '') tx.amount = parseFloat(amount);
    tx.category = (category || '').trim() || null;
    if (date) tx.date = date;
    tx.provider = (provider || '').trim() || null;
    tx.notes = (notes || '').trim() || null;
    await tx.save();
    res.redirect('/');
});

app.get('/transactions/delete/:id', requireLogin, async (req, res) => {
    const { Transaction } = getDatabase(req.user.username);
    await Transaction.destroy({ where: { id: req.params.id } });
    res.redirect('/');
});

// ── Internal transactions API (machine-to-machine, e.g. cortex /purchase) ─────
// Docker-network only, guarded by x-internal-secret. Writes to the owner's DB.
app.post('/api/internal/transactions', async (req, res) => {
    const secret = req.headers['x-internal-secret'];
    if (INTERNAL_SECRET && secret !== INTERNAL_SECRET) return res.status(403).json({ error: 'Forbidden' });
    try {
        const username = (req.body.username || BUDGET_OWNER || '').trim();
        if (!username) return res.status(400).json({ error: 'no target user' });
        await ensureUserDb(username);
        const { Transaction } = getDatabase(username);

        const amount = parseFloat(req.body.amount);
        if (isNaN(amount)) return res.status(400).json({ error: 'amount must be a number' });

        const today = new Date().toISOString().slice(0, 10);
        let date = (req.body.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today; // fall back on bad/blank dates
        const description = (req.body.note || '').trim() || 'Unlabeled';

        const tx = await Transaction.create({
            description,
            amount,
            category: (req.body.category || '').trim() || null,
            date,
            notes: null,
        });
        res.json({ ok: true, id: tx.id, description: tx.description, amount: tx.amount, date: tx.date });
    } catch (e) {
        console.error('internal transaction create failed:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// User settings routes
app.get('/settings', requireLogin, (req, res) => {
    res.render('settings', { title: 'Account Settings', user: req.user, error: null, success: null });
});

app.post('/settings/change-password', requireLogin, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const render = (error, success) => res.render('settings', { title: 'Account Settings', user: req.user, error, success });
    if (newPassword !== confirmPassword) return render('New passwords do not match', null);
    try {
        // Password is managed centrally by octopus-auth.
        const r = await axios.post(`${AUTH_URL}/api/auth/password`,
            { oldPassword: currentPassword, newPassword },
            { headers: { Authorization: `Bearer ${req.user.token}` }, timeout: 5000 });
        if (r.data && r.data.success) return render(null, 'Password changed successfully');
        return render(r.data?.error || 'Failed to change password', null);
    } catch (err) {
        return render(err.response?.data?.error || 'Failed to change password', null);
    }
});

app.post('/settings/delete-account', requireLogin, async (req, res) => {
    // The account lives in octopus-auth (shared across all apps), so per-app
    // deletion is disabled — it would orphan the auth account.
    res.render('settings', {
        title: 'Account Settings', user: req.user,
        error: 'Account deletion is managed centrally — contact the admin.', success: null,
    });
});

// API Subscription Routes
app.get('/api/subscriptions', authenticateJWT, async (req, res) => {
    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscriptions = await Subscription.findAll();
        res.json(subscriptions);
    } catch (error) {
        console.error('API get subscriptions error:', error);
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
});

app.post('/api/subscriptions', authenticateJWT, async (req, res) => {
    try {
        const { name, amount, frequency, category, notes } = req.body;
        
        if (!name || !amount || !frequency) {
            return res.status(400).json({ error: 'Name, amount, and frequency are required' });
        }
        
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.create({ name, amount, frequency, category, notes });
        res.status(201).json(subscription);
    } catch (error) {
        console.error('API create subscription error:', error);
        res.status(500).json({ error: 'Failed to create subscription' });
    }
});

app.put('/api/subscriptions/:id', authenticateJWT, async (req, res) => {
    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.findByPk(req.params.id);
        
        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found' });
        }
        
        const { name, amount, frequency, category, notes } = req.body;
        
        if (name !== undefined) subscription.name = name;
        if (amount !== undefined) subscription.amount = amount;
        if (frequency !== undefined) subscription.frequency = frequency;
        if (category !== undefined) subscription.category = category;
        if (notes !== undefined) subscription.notes = notes;
        
        await subscription.save();
        res.json(subscription);
    } catch (error) {
        console.error('API update subscription error:', error);
        res.status(500).json({ error: 'Failed to update subscription' });
    }
});

app.delete('/api/subscriptions/:id', authenticateJWT, async (req, res) => {
    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.findByPk(req.params.id);
        
        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found' });
        }
        
        await subscription.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('API delete subscription error:', error);
        res.status(500).json({ error: 'Failed to delete subscription' });
    }
});

// API Account Routes
app.get('/api/accounts', authenticateJWT, async (req, res) => {
    try {
        const { Account } = getDatabase(req.user.username);
        const accounts = await Account.findAll();
        res.json(accounts);
    } catch (error) {
        console.error('API get accounts error:', error);
        res.status(500).json({ error: 'Failed to fetch accounts' });
    }
});

app.post('/api/accounts', authenticateJWT, async (req, res) => {
    try {
        const { name, balance, type, notes } = req.body;
        
        if (!name || balance === undefined) {
            return res.status(400).json({ error: 'Name and balance are required' });
        }
        
        const { Account } = getDatabase(req.user.username);
        const account = await Account.create({ name, balance, type, notes });
        res.status(201).json(account);
    } catch (error) {
        console.error('API create account error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

app.put('/api/accounts/:id', authenticateJWT, async (req, res) => {
    try {
        const { Account } = getDatabase(req.user.username);
        const account = await Account.findByPk(req.params.id);
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        const { name, balance, type, notes } = req.body;
        
        if (name !== undefined) account.name = name;
        if (balance !== undefined) account.balance = balance;
        if (type !== undefined) account.type = type;
        if (notes !== undefined) account.notes = notes;
        
        await account.save();
        res.json(account);
    } catch (error) {
        console.error('API update account error:', error);
        res.status(500).json({ error: 'Failed to update account' });
    }
});

app.delete('/api/accounts/:id', authenticateJWT, async (req, res) => {
    try {
        const { Account } = getDatabase(req.user.username);
        const account = await Account.findByPk(req.params.id);
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        await account.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('API delete account error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// API Income Routes
app.get('/api/income', authenticateJWT, async (req, res) => {
    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findAll();
        res.json(income);
    } catch (error) {
        console.error('API get income error:', error);
        res.status(500).json({ error: 'Failed to fetch income' });
    }
});

app.post('/api/income', authenticateJWT, async (req, res) => {
    try {
        const { source, amount, frequency, notes } = req.body;
        
        if (!amount || !frequency) {
            return res.status(400).json({ error: 'Amount and frequency are required' });
        }
        
        const { Income } = getDatabase(req.user.username);
        const income = await Income.create({ source, amount, frequency, notes });
        res.status(201).json(income);
    } catch (error) {
        console.error('API create income error:', error);
        res.status(500).json({ error: 'Failed to create income' });
    }
});

app.put('/api/income/:id', authenticateJWT, async (req, res) => {
    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findByPk(req.params.id);
        
        if (!income) {
            return res.status(404).json({ error: 'Income not found' });
        }
        
        const { source, amount, frequency, notes } = req.body;
        
        if (source !== undefined) income.source = source;
        if (amount !== undefined) income.amount = amount;
        if (frequency !== undefined) income.frequency = frequency;
        if (notes !== undefined) income.notes = notes;
        
        await income.save();
        res.json(income);
    } catch (error) {
        console.error('API update income error:', error);
        res.status(500).json({ error: 'Failed to update income' });
    }
});

app.delete('/api/income/:id', authenticateJWT, async (req, res) => {
    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findByPk(req.params.id);
        
        if (!income) {
            return res.status(404).json({ error: 'Income not found' });
        }
        
        await income.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('API delete income error:', error);
        res.status(500).json({ error: 'Failed to delete income' });
    }
});

// API Debt Routes
app.get('/api/debts', authenticateJWT, async (req, res) => {
    try {
        const { Debt } = getDatabase(req.user.username);
        const debts = await Debt.findAll();
        res.json(debts);
    } catch (error) {
        console.error('API get debts error:', error);
        res.status(500).json({ error: 'Failed to fetch debts' });
    }
});

app.post('/api/debts', authenticateJWT, async (req, res) => {
    try {
        const { name, amount, interest_rate, minimum_payment, due_date, notes } = req.body;

        if (!name || amount === undefined || amount === null || amount === "") {
            return res.status(400).json({ error: 'Name and amount are required' });
        }

        // Validate amount is a number and > 0
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Amount must be a positive number' });
        }

        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.create({ 
            name, 
            amount: parsedAmount, 
            balance: parsedAmount, // Initialize balance with amount
            interest_rate, 
            minimum_payment, 
            due_date, 
            notes 
        });
        res.status(201).json(debt);
    } catch (error) {
        console.error('API create debt error:', error);
        res.status(500).json({ error: 'Failed to create debt' });
    }
});

app.put('/api/debts/:id', authenticateJWT, async (req, res) => {
    try {
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.findByPk(req.params.id);
        
        if (!debt) {
            return res.status(404).json({ error: 'Debt not found' });
        }
        
        const { name, amount, interest_rate, minimum_payment, due_date, notes } = req.body;
        
        if (name !== undefined) debt.name = name;
        if (amount !== undefined) debt.amount = amount;
        if (interest_rate !== undefined) debt.interest_rate = interest_rate;
        if (minimum_payment !== undefined) debt.minimum_payment = minimum_payment;
        if (due_date !== undefined) debt.due_date = due_date;
        if (notes !== undefined) debt.notes = notes;
        
        await debt.save();
        res.json(debt);
    } catch (error) {
        console.error('API update debt error:', error);
        res.status(500).json({ error: 'Failed to update debt' });
    }
});

app.delete('/api/debts/:id', authenticateJWT, async (req, res) => {
    try {
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.findByPk(req.params.id);
        
        if (!debt) {
            return res.status(404).json({ error: 'Debt not found' });
        }
        
        await debt.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('API delete debt error:', error);
        res.status(500).json({ error: 'Failed to delete debt' });
    }
});

app.listen(port, () => {
  console.log(`Budget Tracker app listening at http://localhost:${port}`);
  console.log(`Data directory: ${dataDir}`);
});
