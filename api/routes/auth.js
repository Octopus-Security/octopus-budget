const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, authDb } = require('../../database');
const getDatabase = require('../../database');
const { JWT_SECRET } = require('../middleware/auth');


const router = express.Router();

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: { success: false, error: 'Too many requests, please try again later.' }
});

// POST /api/auth/login
// In-memory failed login tracker (replace with Redis or DB for production)
const failedLogins = {};
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

const axios = require('axios');
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

router.post('/login', authLimiter, async (req, res) => {
    const { username, password, captchaToken } = req.body;
    const now = Date.now();

    // Always require CAPTCHA
    if (!captchaToken) {
        return res.status(403).json({ success: false, error: 'CAPTCHA required', captchaRequired: true });
    }

    // Verify captchaToken with Google reCAPTCHA API
    try {
        const verifyResponse = await axios.post(
            'https://www.google.com/recaptcha/api/siteverify',
            null,
            {
                params: {
                    secret: RECAPTCHA_SECRET_KEY,
                    response: captchaToken
                }
            }
        );
        if (!verifyResponse.data.success) {
            return res.status(403).json({ success: false, error: 'CAPTCHA verification failed', captchaRequired: true });
        }
    } catch (err) {
        console.error('CAPTCHA verification error:', err);
        return res.status(500).json({ success: false, error: 'CAPTCHA verification error', captchaRequired: true });
    }

    // Check lockout (optional, can keep for extra security)
    if (failedLogins[username] && failedLogins[username].lockedUntil > now) {
        return res.status(429).json({ success: false, error: 'Account locked due to too many failed attempts. Please try again later.', captchaRequired: true });
    }

    try {
        // Validate input
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password are required' });
        }

        // Find user
        const user = await User.findOne({ where: { username } });
        if (!user) {
            // Track failed attempt
            failedLogins[username] = failedLogins[username] || { count: 0, lockedUntil: 0 };
            failedLogins[username].count++;
            /* Lines 95-100 omitted */
        }

        // Validate password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {/* Lines 105-112 omitted */}

        // Reset failed login count on success
        if (failedLogins[username]) {/* Lines 116-117 omitted */}

        // Generate token
        const token = generateToken(username);

        res.json({ success: true, token, username });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

    // Always require CAPTCHA
    if (!captchaToken) {
        return res.status(403).json({ success: false, error: 'CAPTCHA required', captchaRequired: true });
    }
    // TODO: Verify captchaToken with Google reCAPTCHA API

    // Check lockout (optional, can keep for extra security)
    if (failedLogins[username] && failedLogins[username].lockedUntil > now) {
        return res.status(429).json({ success: false, error: 'Account locked due to too many failed attempts. Please try again later.', captchaRequired: true });
    }

    try {
        // Validate input
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password are required' });
        }

        // Find user
        const user = await User.findOne({ where: { username } });
        if (!user) {
            // Track failed attempt
            failedLogins[username] = failedLogins[username] || { count: 0, lockedUntil: 0 };
            failedLogins[username].count++;
            if (failedLogins[username].count >= LOCKOUT_THRESHOLD) {
                failedLogins[username].lockedUntil = now + LOCKOUT_TIME;
                return res.status(429).json({ success: false, error: 'Account locked due to too many failed attempts. Please try again later.', captchaRequired: true });
            }
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Validate password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            failedLogins[username] = failedLogins[username] || { count: 0, lockedUntil: 0 };
            failedLogins[username].count++;
            if (failedLogins[username].count >= LOCKOUT_THRESHOLD) {
                failedLogins[username].lockedUntil = now + LOCKOUT_TIME;
                return res.status(429).json({ success: false, error: 'Account locked due to too many failed attempts. Please try again later.', captchaRequired: true });
            }
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Reset failed login count on success
        if (failedLogins[username]) {
            delete failedLogins[username];
        }

        // Generate token
        const token = generateToken(username);

        res.json({ success: true, token, username });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

module.exports = router;
