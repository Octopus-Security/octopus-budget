const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;
const getDatabase = require('./database');
const { User, authDb } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-jwt-secret';

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false, // set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(bodyParser.urlencoded({ extended: true }));

// JWT Authentication Middleware
const authenticateJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { username: decoded.username };
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};


const requireLogin = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};


app.get('/login', (req, res) => {
    const siteKey = process.env.RECAPTCHA_SITE_KEY;
    console.log('RECAPTCHA_SITE_KEY for /login page:', siteKey);
    res.render('login', { title: 'Login', error: null, mode: 'login', siteKey });
});


app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt for username:', username);

    try {
        console.log('Looking up user...');
        const user = await User.findOne({ where: { username } });

        if (!user) {
            console.log('User not found');
            return res.render('login', { title: 'Login', error: 'User not found', mode: 'login', siteKey: process.env.RECAPTCHA_SITE_KEY });
        }

        console.log('User found, comparing password...');
        const validPassword = await bcrypt.compare(password, user.password);

        if (validPassword) {
            console.log('Password valid, syncing database...');
            req.session.user = { username };
            const { sequelize } = getDatabase(username);
            await sequelize.sync();
            console.log('Sync complete, redirecting...');
            res.redirect('/');
        } else {
            console.log('Invalid password');
            res.render('login', { title: 'Login', error: 'Invalid password', mode: 'login', siteKey: process.env.RECAPTCHA_SITE_KEY });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { title: 'Login', error: 'Login failed', mode: 'login', siteKey: process.env.RECAPTCHA_SITE_KEY });
    }
});


app.get('/register', (req, res) => {
    res.render('login', { title: 'Register', error: null, mode: 'register', siteKey: process.env.RECAPTCHA_SITE_KEY });
});


app.post('/register', async (req, res) => {
    const { username, password, confirmPassword } = req.body;
    
    try {
        if (!username || !password || !confirmPassword) {
            return res.render('login', { title: 'Register', error: 'All fields required', mode: 'register', siteKey: process.env.RECAPTCHA_SITE_KEY });
        }
        
        if (password !== confirmPassword) {
            return res.render('login', { title: 'Register', error: 'Passwords do not match', mode: 'register', siteKey: process.env.RECAPTCHA_SITE_KEY });
        }
        
        if (password.length < 6) {
            return res.render('login', { title: 'Register', error: 'Password must be at least 6 characters', mode: 'register', siteKey: process.env.RECAPTCHA_SITE_KEY });
        }
        
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.render('login', { title: 'Register', error: 'Username already exists', mode: 'register', siteKey: process.env.RECAPTCHA_SITE_KEY });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username, password: hashedPassword });
        
        req.session.user = { username };
        const { sequelize } = getDatabase(username);
        await sequelize.sync();
        res.redirect('/');
    } catch (error) {
        console.error('Registration error:', error);
        res.render('login', { title: 'Register', error: 'Registration failed', mode: 'register', siteKey: process.env.RECAPTCHA_SITE_KEY });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// REST API endpoints for mobile app
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }
        
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username, password: hashedPassword });
        
        // Initialize user's database
        const { sequelize } = getDatabase(username);
        await sequelize.sync();
        
        // Generate token
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
        
        res.status(201).json({ success: true, token, message: 'User registered successfully' });
    } catch (error) {
        console.error('API registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    console.log('API login attempt for username:', username);
    
    try {
        const user = await User.findOne({ where: { username } });
        
        if (!user) {
            console.log('User not found');
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            console.log('Invalid password');
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        // Ensure user's database is synced
        const { sequelize } = getDatabase(username);
        await sequelize.sync();
        
        // Generate token
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log('Login successful, token generated');
        res.json({ success: true, token, message: null });
    } catch (error) {
        console.error('API login error:', error);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});


app.get('/', requireLogin, async (req, res) => {
  const { Subscription, Account, Income, Debt } = getDatabase(req.session.user.username);
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
    user: req.session.user
   });
});

app.post('/subscriptions', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.session.user.username);
    await Subscription.create(req.body);
    res.redirect('/');
});

app.get('/subscriptions/edit/:id', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.session.user.username);
    const subscription = await Subscription.findByPk(req.params.id);
    res.render('edit_subscription', { title: 'Edit Subscription', subscription });
});

app.post('/subscriptions/edit/:id', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.session.user.username);
    const subscription = await Subscription.findByPk(req.params.id);
    subscription.name = req.body.name;
    subscription.amount = req.body.amount;
    subscription.frequency = req.body.frequency;
    await subscription.save();
    res.redirect('/');
});

app.get('/subscriptions/delete/:id', requireLogin, async (req, res) => {
    const { Subscription } = getDatabase(req.session.user.username);
    const subscription = await Subscription.findByPk(req.params.id);
    await subscription.destroy();
    res.redirect('/');
});

app.post('/accounts', requireLogin, async (req, res) => {
    const { Account } = getDatabase(req.session.user.username);
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
    const { Account } = getDatabase(req.session.user.username);
    await Account.destroy({ where: { id: req.params.id } });
    res.redirect('/');
});

app.post('/income', requireLogin, async (req, res) => {
    const { Income } = getDatabase(req.session.user.username);
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
    const { Debt } = getDatabase(req.session.user.username);
    const { name, balance } = req.body;
    const debt = await Debt.findOne({ where: { name } });
    if (debt) {
        debt.balance = balance;
        await debt.save();
    } else {
        await Debt.create(req.body);
    }
    res.redirect('/');
});

app.get('/debts/delete/:id', requireLogin, async (req, res) => {
    const { Debt } = getDatabase(req.session.user.username);
    await Debt.destroy({ where: { id: req.params.id } });
    res.redirect('/');
});

// User settings routes
app.get('/settings', requireLogin, (req, res) => {
    res.render('settings', { title: 'Account Settings', user: req.session.user, error: null, success: null });
});

app.post('/settings/change-password', requireLogin, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    try {
        const user = await User.findOne({ where: { username: req.session.user.username } });
        
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.render('settings', { 
                title: 'Account Settings', 
                user: req.session.user, 
                error: 'Current password is incorrect', 
                success: null 
            });
        }
        
        if (newPassword !== confirmPassword) {
            return res.render('settings', { 
                title: 'Account Settings', 
                user: req.session.user, 
                error: 'New passwords do not match', 
                success: null 
            });
        }
        
        if (newPassword.length < 6) {
            return res.render('settings', { 
                title: 'Account Settings', 
                user: req.session.user, 
                error: 'Password must be at least 6 characters', 
                success: null 
            });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();
        
        res.render('settings', { 
            title: 'Account Settings', 
            user: req.session.user, 
            error: null, 
            success: 'Password changed successfully' 
        });
    } catch (error) {
        console.error('Password change error:', error);
        res.render('settings', { 
            title: 'Account Settings', 
            user: req.session.user, 
            error: 'Failed to change password', 
            success: null 
        });
    }
});

app.post('/settings/delete-account', requireLogin, async (req, res) => {
    const { password } = req.body;
    const username = req.session.user.username;
    
    try {
        const user = await User.findOne({ where: { username } });
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.render('settings', { 
                title: 'Account Settings', 
                user: req.session.user, 
                error: 'Incorrect password', 
                success: null 
            });
        }
        
        // Delete user database
        const dbPath = path.join(dataDir, `${username}_database.sqlite`);
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
        
        // Delete user from auth database
        await user.destroy();
        
        // Destroy session and redirect to login
        req.session.destroy(() => {
            res.redirect('/login');
        });
    } catch (error) {
        console.error('Account deletion error:', error);
        res.render('settings', { 
            title: 'Account Settings', 
            user: req.session.user, 
            error: 'Failed to delete account', 
            success: null 
        });
    }
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
        
        if (!name || !amount) {
            return res.status(400).json({ error: 'Name and amount are required' });
        }
        
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.create({ 
            name, 
            amount, 
            balance: amount, // Initialize balance with amount
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
