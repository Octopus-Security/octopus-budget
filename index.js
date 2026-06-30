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

app.get('/register', (req, res) => res.redirect(AUTH_LOGIN_URL));

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


app.get('/', requireLogin, async (req, res) => {
  const { Subscription, Account, Income, Debt } = getDatabase(req.user.username);
  const subscriptions = await Subscription.findAll();
  const accounts = await Account.findAll();
  const income = await Income.findAll();
  const debts = await Debt.findAll();

  res.render('index', {
    title: 'Budget Tracker',
    subscriptions,
    accounts,
    income,
    debts,
    user: req.user
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
    const { name, amount, credit_limit } = req.body;
    const parsedAmount = parseFloat(amount);
    const parsedLimit = credit_limit !== '' && credit_limit !== undefined ? parseFloat(credit_limit) : null;
    const debt = await Debt.findOne({ where: { name } });
    if (debt) {
        debt.amount = parsedAmount;
        debt.balance = parsedAmount;
        if (parsedLimit !== null) debt.credit_limit = parsedLimit;
        await debt.save();
    } else {
        await Debt.create({
            name,
            amount: parsedAmount,
            balance: parsedAmount,
            credit_limit: parsedLimit,
        });
    }
    res.redirect('/');
});

app.get('/debts/delete/:id', requireLogin, async (req, res) => {
    const { Debt } = getDatabase(req.user.username);
    await Debt.destroy({ where: { id: req.params.id } });
    res.redirect('/');
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
