const express = require('express');
const getDatabase = require('../../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all budget routes
router.use(authenticateToken);

// Subscriptions endpoints
router.get('/subscriptions', async (req, res) => {
    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscriptions = await Subscription.findAll();
        res.json({ success: true, data: subscriptions });
    } catch (error) {
        console.error('Error fetching subscriptions:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch subscriptions' });
    }
});

router.post('/subscriptions', async (req, res) => {
    const { name, amount, frequency } = req.body;

    try {
        // Validate input
        if (!name || amount === undefined || !frequency) {
            return res.status(400).json({ success: false, error: 'Name, amount, and frequency are required' });
        }

        if (!['daily', 'weekly', 'monthly', 'yearly'].includes(frequency)) {
            return res.status(400).json({ success: false, error: 'Invalid frequency. Must be daily, weekly, monthly, or yearly' });
        }

        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.create({ name, amount, frequency });
        res.status(201).json({ success: true, data: subscription });
    } catch (error) {
        console.error('Error creating subscription:', error);
        res.status(500).json({ success: false, error: 'Failed to create subscription' });
    }
});

router.put('/subscriptions/:id', async (req, res) => {
    const { id } = req.params;
    const { name, amount, frequency } = req.body;

    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.findByPk(id);

        if (!subscription) {
            return res.status(404).json({ success: false, error: 'Subscription not found' });
        }

        // Validate frequency if provided
        if (frequency && !['daily', 'weekly', 'monthly', 'yearly'].includes(frequency)) {
            return res.status(400).json({ success: false, error: 'Invalid frequency. Must be daily, weekly, monthly, or yearly' });
        }

        // Update fields
        if (name !== undefined) subscription.name = name;
        if (amount !== undefined) subscription.amount = amount;
        if (frequency !== undefined) subscription.frequency = frequency;

        await subscription.save();
        res.json({ success: true, data: subscription });
    } catch (error) {
        console.error('Error updating subscription:', error);
        res.status(500).json({ success: false, error: 'Failed to update subscription' });
    }
});

router.delete('/subscriptions/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { Subscription } = getDatabase(req.user.username);
        const subscription = await Subscription.findByPk(id);

        if (!subscription) {
            return res.status(404).json({ success: false, error: 'Subscription not found' });
        }

        await subscription.destroy();
        res.json({ success: true, message: 'Subscription deleted' });
    } catch (error) {
        console.error('Error deleting subscription:', error);
        res.status(500).json({ success: false, error: 'Failed to delete subscription' });
    }
});

// Accounts endpoints
router.get('/accounts', async (req, res) => {
    try {
        const { Account } = getDatabase(req.user.username);
        const accounts = await Account.findAll();
        res.json({ success: true, data: accounts });
    } catch (error) {
        console.error('Error fetching accounts:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch accounts' });
    }
});

router.post('/accounts', async (req, res) => {
    const { name, balance } = req.body;

    try {
        // Validate input
        if (!name || balance === undefined) {
            return res.status(400).json({ success: false, error: 'Name and balance are required' });
        }

        const { Account } = getDatabase(req.user.username);
        const account = await Account.create({ name, balance });
        res.status(201).json({ success: true, data: account });
    } catch (error) {
        console.error('Error creating account:', error);
        // Handle unique constraint violation
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ success: false, error: 'Account with this name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to create account' });
    }
});

router.put('/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { name, balance } = req.body;

    try {
        const { Account } = getDatabase(req.user.username);
        const account = await Account.findByPk(id);

        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }

        // Update fields
        if (name !== undefined) account.name = name;
        if (balance !== undefined) account.balance = balance;

        await account.save();
        res.json({ success: true, data: account });
    } catch (error) {
        console.error('Error updating account:', error);
        // Handle unique constraint violation
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ success: false, error: 'Account with this name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to update account' });
    }
});

router.delete('/accounts/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { Account } = getDatabase(req.user.username);
        const account = await Account.findByPk(id);

        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }

        await account.destroy();
        res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ success: false, error: 'Failed to delete account' });
    }
});

// Income endpoints
router.get('/income', async (req, res) => {
    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findAll();
        res.json({ success: true, data: income });
    } catch (error) {
        console.error('Error fetching income:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch income' });
    }
});

router.post('/income', async (req, res) => {
    const { amount, frequency } = req.body;

    try {
        // Validate input
        if (amount === undefined || !frequency) {
            return res.status(400).json({ success: false, error: 'Amount and frequency are required' });
        }

        if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) {
            return res.status(400).json({ success: false, error: 'Invalid frequency. Must be weekly, biweekly, or monthly' });
        }

        const { Income } = getDatabase(req.user.username);
        const income = await Income.create({ amount, frequency });
        res.status(201).json({ success: true, data: income });
    } catch (error) {
        console.error('Error creating income:', error);
        res.status(500).json({ success: false, error: 'Failed to create income' });
    }
});

router.put('/income/:id', async (req, res) => {
    const { id } = req.params;
    const { amount, frequency } = req.body;

    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findByPk(id);

        if (!income) {
            return res.status(404).json({ success: false, error: 'Income not found' });
        }

        // Validate frequency if provided
        if (frequency && !['weekly', 'biweekly', 'monthly'].includes(frequency)) {
            return res.status(400).json({ success: false, error: 'Invalid frequency. Must be weekly, biweekly, or monthly' });
        }

        // Update fields
        if (amount !== undefined) income.amount = amount;
        if (frequency !== undefined) income.frequency = frequency;

        await income.save();
        res.json({ success: true, data: income });
    } catch (error) {
        console.error('Error updating income:', error);
        res.status(500).json({ success: false, error: 'Failed to update income' });
    }
});

router.delete('/income/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { Income } = getDatabase(req.user.username);
        const income = await Income.findByPk(id);

        if (!income) {
            return res.status(404).json({ success: false, error: 'Income not found' });
        }

        await income.destroy();
        res.json({ success: true, message: 'Income deleted' });
    } catch (error) {
        console.error('Error deleting income:', error);
        res.status(500).json({ success: false, error: 'Failed to delete income' });
    }
});

// Debts endpoints
router.get('/debts', async (req, res) => {
    try {
        const { Debt } = getDatabase(req.user.username);
        const debts = await Debt.findAll();
        res.json({ success: true, data: debts });
    } catch (error) {
        console.error('Error fetching debts:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch debts' });
    }
});

router.post('/debts', async (req, res) => {
    const { name, balance } = req.body;

    try {
        // Validate input
        if (!name || balance === undefined) {
            return res.status(400).json({ success: false, error: 'Name and balance are required' });
        }

        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.create({ name, balance });
        res.status(201).json({ success: true, data: debt });
    } catch (error) {
        console.error('Error creating debt:', error);
        // Handle unique constraint violation
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ success: false, error: 'Debt with this name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to create debt' });
    }
});

router.put('/debts/:id', async (req, res) => {
    const { id } = req.params;
    const { name, balance } = req.body;

    try {
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.findByPk(id);

        if (!debt) {
            return res.status(404).json({ success: false, error: 'Debt not found' });
        }

        // Update fields
        if (name !== undefined) debt.name = name;
        if (balance !== undefined) debt.balance = balance;

        await debt.save();
        res.json({ success: true, data: debt });
    } catch (error) {
        console.error('Error updating debt:', error);
        // Handle unique constraint violation
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ success: false, error: 'Debt with this name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to update debt' });
    }
});

router.delete('/debts/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { Debt } = getDatabase(req.user.username);
        const debt = await Debt.findByPk(id);

        if (!debt) {
            return res.status(404).json({ success: false, error: 'Debt not found' });
        }

        await debt.destroy();
        res.json({ success: true, message: 'Debt deleted' });
    } catch (error) {
        console.error('Error deleting debt:', error);
        res.status(500).json({ success: false, error: 'Failed to delete debt' });
    }
});

// Summary endpoint - get all budget data in one call
router.get('/summary', async (req, res) => {
    try {
        const { Subscription, Account, Income, Debt } = getDatabase(req.user.username);
        
        const [subscriptions, accounts, income, debts] = await Promise.all([
            Subscription.findAll(),
            Account.findAll(),
            Income.findAll(),
            Debt.findAll()
        ]);

        res.json({
            success: true,
            data: {
                subscriptions,
                accounts,
                income,
                debts
            }
        });
    } catch (error) {
        console.error('Error fetching summary:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch budget summary' });
    }
});

module.exports = router;
