const jwt = require('jsonwebtoken');

// Shared JWT secret across all Octopus services
const JWT_SECRET = process.env.JWT_SECRET || 'octopus-shared-secret-change-in-production';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ success: false, error: 'Authentication token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
};

module.exports = { authenticateToken, JWT_SECRET };
