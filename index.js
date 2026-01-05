const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;
const getDatabase = require('./database');

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
    res.render('login', { title: 'Login', error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const validPassword = process.env.APP_PASSWORD || 'password';
    
    if (password === validPassword && username && username.length > 0) {
        req.session.user = { username };
        const { sequelize } = getDatabase(username);
        sequelize.sync();
        res.redirect('/');
    } else {
        res.render('login', { title: 'Login', error: 'Invalid credentials' });
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

app.listen(port, () => {
  console.log(`Budget Tracker app listening at http://localhost:${port}`);
});
