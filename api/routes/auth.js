const express = require('express');
const axios = require('axios');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Auth service URLs - try internal first, then external
const AUTH_INTERNAL_URL = process.env.AUTH_SERVICE_URL || 'http://octopus-auth:3002';
const AUTH_EXTERNAL_URL = 'https://auth.octopustechnology.net';

// Helper to call auth service with fallback
async function callAuthService(endpoint, data, headers = {}) {
    // Try internal URL first (Docker network)
    try {
        const response = await axios.post(`${AUTH_INTERNAL_URL}${endpoint}`, data, {
            headers: { 'Content-Type': 'application/json', ...headers },
            timeout: 3000
        });
        return response;
    } catch (internalError) {
        console.log('Internal auth failed, trying external URL...');
        // Fall back to external URL
        const response = await axios.post(`${AUTH_EXTERNAL_URL}${endpoint}`, data, {
            headers: { 'Content-Type': 'application/json', ...headers },
            timeout: 5000
        });
        return response;
    }
}

// Proxy login to centralized auth service
router.post('/login', async (req, res) => {
    try {
        const response = await callAuthService('/api/auth/login', req.body);
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
        const response = await callAuthService('/api/auth/register', req.body);
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
        const response = await callAuthService('/api/auth/verify', {}, {
            'Authorization': req.headers.authorization
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
