const express = require('express');
const { AuthClient } = require('@octopus-security/auth-client');

const router = express.Router();
const auth = new AuthClient();

router.post('/login', async (req, res) => {
    try {
        const r = await auth.login(req.body.username, req.body.password);
        res.status(r.status).json(r.data);
    } catch (error) {
        res.status(503).json({ success: false, error: 'Authentication service unavailable' });
    }
});

router.post('/register', async (req, res) => {
    try {
        const r = await auth.register(req.body.username, req.body.password, req.body.email, req.body.inviteCode);
        res.status(r.status).json(r.data);
    } catch (error) {
        res.status(503).json({ success: false, error: 'Authentication service unavailable' });
    }
});

router.post('/verify', async (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const r = await auth.verify(token);
        res.status(r.status).json(r.data);
    } catch (error) {
        res.status(503).json({ success: false, error: 'Authentication service unavailable' });
    }
});

module.exports = router;
