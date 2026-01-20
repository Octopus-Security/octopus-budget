const express = require('express');
const authRoutes = require('./routes/auth');
const budgetRoutes = require('./routes/budget');

const router = express.Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/budget', budgetRoutes);

module.exports = router;
