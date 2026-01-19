const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;
const getDatabase = require('./database');
const { User, authDb } = require('./database');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

app.set('view engine', 'ejs');
app.set('views', './views');

// CORS middleware for API routes
app.use(cors());

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false, // set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(bodyParser.urlencoded({ extended: true }));

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'change-me-in-production';
const JWT_EXPIRATION = '7d';

// JWT verification middleware for API routes
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
};


const requireLogin = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

// ============================================
// API ENDPOINTS (Mobile/JWT Authentication)
// ============================================

// API Authentication Routes
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }
        
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Username already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username, password: hashedPassword });
        
        // Initialize user database
        const { sequelize } = getDatabase(username);
        await sequelize.sync();
        
        // Generate JWT token
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
        
        res.status(201).json({ success: true, token, username });
    } catch (error) {
        console.error('API registration error:', error);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required' });
        }
        
        const user = await User.findOne({ where: { username } });
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        // Generate JWT token
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
        
        res.json({ success: true, token, username });
    } catch (error) {
        console.error('API login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// API Budget Routes - Subscriptions
app.get('/api/budget/subscriptions', verifyToken, async (req, res) => {
    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscriptions = await Subscription.findAll();
        res.json({ success: true, data: subscriptions });
    } catch (error) {
        console.error('Get subscriptions error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch subscriptions' });
    }
});

app.post('/api/budget/subscriptions', verifyToken, async (req, res) => {
    try {
        const { name, amount, frequency, startDate, notes } = req.body;
        
        if (!name || !amount || !frequency) {
            return res.status(400).json({ success: false, error: 'Name, amount, and frequency are required' });
        }
        
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.create({ name, amount, frequency, startDate, notes });
        res.status(201).json({ success: true, data: subscription });
    } catch (error) {
        console.error('Create subscription error:', error);
        res.status(500).json({ success: false, error: 'Failed to create subscription' });
    }
});

app.put('/api/budget/subscriptions/:id', verifyToken, async (req, res) => {
    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.findByPk(req.params.id);
        
        if (!subscription) {
            return res.status(404).json({ success: false, error: 'Subscription not found' });
        }
        
        const { name, amount, frequency, startDate, notes } = req.body;
        await subscription.update({ name, amount, frequency, startDate, notes });
        
        res.json({ success: true, data: subscription });
    } catch (error) {
        console.error('Update subscription error:', error);
        res.status(500).json({ success: false, error: 'Failed to update subscription' });
    }
});

app.delete('/api/budget/subscriptions/:id', verifyToken, async (req, res) => {
    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.findByPk(req.params.id);
        
        if (!subscription) {
            return res.status(404).json({ success: false, error: 'Subscription not found' });
        }
        
        await subscription.destroy();
        res.json({ success: true, message: 'Subscription deleted' });
    } catch (error) {
        console.error('Delete subscription error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete subscription' });
    }
});

// API Budget Routes - Accounts
app.get('/api/budget/accounts', verifyToken, async (req, res) => {
    try {
        const { Account } = getDatabase(req.user.username);
        const accounts = await Account.findAll();
        res.json({ success: true, data: accounts });
    } catch (error) {
        console.error('Get accounts error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch accounts' });
    }
});

app.post('/api/budget/accounts', verifyToken, async (req, res) => {
    try {
        const { name, balance, accountType, notes } = req.body;
        
        if (!name || balance === undefined) {
            return res.status(400).json({ success: false, error: 'Name and balance are required' });
        }
        
        const { Account } = getDatabase(req.user.username);
        const account = await Account.create({ name, balance, accountType, notes });
        res.status(201).json({ success: true, data: account });
    } catch (error) {
        console.error('Create account error:', error);
        res.status(500).json({ success: false, error: 'Failed to create account' });
    }
});

app.put('/api/budget/accounts/:id', verifyToken, async (req, res) => {
    try {
        const { Account } = getDatabase(req.user.username);
        const account = await Account.findByPk(req.params.id);
        
        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        
        const { name, balance, accountType, notes } = req.body;
        await account.update({ name, balance, accountType, notes });
        
        res.json({ success: true, data: account });
    } catch (error) {
        console.error('Update account error:', error);
        res.status(500).json({ success: false, error: 'Failed to update account' });
    }
});

app.delete('/api/budget/accounts/:id', verifyToken, async (req, res) => {
    try {
        const { Account } = getDatabase(req.user.username);
        const account = await Account.findByPk(req.params.id);
        
        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        
        await account.destroy();
        res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete account' });
    }
});

// API Budget Routes - Income
app.get('/api/budget/income', verifyToken, async (req, res) => {
    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findAll();
        res.json({ success: true, data: income });
    } catch (error) {
        console.error('Get income error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch income' });
    }
});

app.post('/api/budget/income', verifyToken, async (req, res) => {
    try {
        const { source, amount, frequency, startDate, notes } = req.body;
        
        if (!amount || !frequency) {
            return res.status(400).json({ success: false, error: 'Amount and frequency are required' });
        }
        
        const { Income } = getDatabase(req.user.username);
        const income = await Income.create({ source, amount, frequency, startDate, notes });
        res.status(201).json({ success: true, data: income });
    } catch (error) {
        console.error('Create income error:', error);
        res.status(500).json({ success: false, error: 'Failed to create income' });
    }
});

app.put('/api/budget/income/:id', verifyToken, async (req, res) => {
    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findByPk(req.params.id);
        
        if (!income) {
            return res.status(404).json({ success: false, error: 'Income not found' });
        }
        
        const { source, amount, frequency, startDate, notes } = req.body;
        await income.update({ source, amount, frequency, startDate, notes });
        
        res.json({ success: true, data: income });
    } catch (error) {
        console.error('Update income error:', error);
        res.status(500).json({ success: false, error: 'Failed to update income' });
    }
});

app.delete('/api/budget/income/:id', verifyToken, async (req, res) => {
    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findByPk(req.params.id);
        
        if (!income) {
            return res.status(404).json({ success: false, error: 'Income not found' });
        }
        
        await income.destroy();
        res.json({ success: true, message: 'Income deleted' });
    } catch (error) {
        console.error('Delete income error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete income' });
    }
});

// API Budget Routes - Debts
app.get('/api/budget/debts', verifyToken, async (req, res) => {
    try {
        const { Debt } = getDatabase(req.user.username);
        const debts = await Debt.findAll();
        res.json({ success: true, data: debts });
    } catch (error) {
        console.error('Get debts error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch debts' });
    }
});

app.post('/api/budget/debts', verifyToken, async (req, res) => {
    try {
        const { name, totalAmount, remainingAmount, interestRate, minimumPayment, dueDate, notes } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, error: 'Name is required' });
        }
        
        // Calculate balance from remainingAmount or totalAmount
        const balance = remainingAmount || totalAmount || 0;
        
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.create({ 
            name, 
            totalAmount, 
            remainingAmount, 
            balance,
            interestRate, 
            minimumPayment, 
            dueDate, 
            notes 
        });
        res.status(201).json({ success: true, data: debt });
    } catch (error) {
        console.error('Create debt error:', error);
        res.status(500).json({ success: false, error: 'Failed to create debt' });
    }
});

app.put('/api/budget/debts/:id', verifyToken, async (req, res) => {
    try {
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.findByPk(req.params.id);
        
        if (!debt) {
            return res.status(404).json({ success: false, error: 'Debt not found' });
        }
        
        const { name, totalAmount, remainingAmount, interestRate, minimumPayment, dueDate, notes } = req.body;
        
        // Calculate balance from remainingAmount if provided
        const balance = remainingAmount !== undefined ? remainingAmount : debt.balance;
        
        await debt.update({ 
            name, 
            totalAmount, 
            remainingAmount, 
            balance,
            interestRate, 
            minimumPayment, 
            dueDate, 
            notes 
        });
        
        res.json({ success: true, data: debt });
    } catch (error) {
        console.error('Update debt error:', error);
        res.status(500).json({ success: false, error: 'Failed to update debt' });
    }
});

app.delete('/api/budget/debts/:id', verifyToken, async (req, res) => {
    try {
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.findByPk(req.params.id);
        
        if (!debt) {
            return res.status(404).json({ success: false, error: 'Debt not found' });
        }
        
        await debt.destroy();
        res.json({ success: true, message: 'Debt deleted' });
    } catch (error) {
        console.error('Delete debt error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete debt' });
    }
});

// ============================================
// WEB UI ROUTES (Session-based Authentication)
// ============================================

app.get('/login', (req, res) => {
    res.render('login', { title: 'Login', error: null, mode: 'login' });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    console.log('Login attempt for username:', username);
    
    try {
        console.log('Looking up user...');
        const user = await User.findOne({ where: { username } });
        
        if (!user) {
            console.log('User not found');
            return res.render('login', { title: 'Login', error: 'User not found', mode: 'login' });
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
            res.render('login', { title: 'Login', error: 'Invalid password', mode: 'login' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { title: 'Login', error: 'Login failed', mode: 'login' });
    }
});

app.get('/register', (req, res) => {
    res.render('login', { title: 'Register', error: null, mode: 'register' });
});

app.post('/register', async (req, res) => {
    const { username, password, confirmPassword } = req.body;
    
    try {
        if (!username || !password || !confirmPassword) {
            return res.render('login', { title: 'Register', error: 'All fields required', mode: 'register' });
        }
        
        if (password !== confirmPassword) {
            return res.render('login', { title: 'Register', error: 'Passwords do not match', mode: 'register' });
        }
        
        if (password.length < 6) {
            return res.render('login', { title: 'Register', error: 'Password must be at least 6 characters', mode: 'register' });
        }
        
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.render('login', { title: 'Register', error: 'Username already exists', mode: 'register' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username, password: hashedPassword });
        
        req.session.user = { username };
        const { sequelize } = getDatabase(username);
        await sequelize.sync();
        res.redirect('/');
    } catch (error) {
        console.error('Registration error:', error);
        res.render('login', { title: 'Register', error: 'Registration failed', mode: 'register' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
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

app.listen(port, () => {
  console.log(`Budget Tracker app listening at http://localhost:${port}`);
  console.log(`Data directory: ${dataDir}`);
});
