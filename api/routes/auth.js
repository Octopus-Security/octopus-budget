const express = require('express');
const axios = require('axios');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Auth service URL - centralized authentication
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://octopus-auth:3002';

// Proxy login to centralized auth service
router.post('/login', async (req, res) => {
    try {
        const response = await axios.post(`${AUTH_SERVICE_URL}/api/auth/login`, req.body, {
            headers: { 'Content-Type': 'application/json' }
        });
        res.json(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            console.error('Auth service error:', error.message);
            res.status(503).json({ success: false, error: 'Authentication service unavailable' });
        }
    }
});

// Proxy register to centralized auth service
router.post('/register', async (req, res) => {
    try {
        const response = await axios.post(`${AUTH_SERVICE_URL}/api/auth/register`, req.body, {
            headers: { 'Content-Type': 'application/json' }
        });
        res.json(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            console.error('Auth service error:', error.message);
            res.status(503).json({ success: false, error: 'Authentication service unavailable' });
        }
    }
});

// Proxy verify to centralized auth service
router.post('/verify', async (req, res) => {
    try {
        const response = await axios.post(`${AUTH_SERVICE_URL}/api/auth/verify`, {}, {
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization
            }
        });
        res.json(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(503).json({ success: false, error: 'Authentication service unavailable' });
        }
    }
});

module.exports = router;
