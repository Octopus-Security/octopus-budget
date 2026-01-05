const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
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


const requireLogin = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

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
