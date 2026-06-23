const { createAuthMiddleware } = require('@octopus-security/auth-client');

const authenticateToken = createAuthMiddleware();

module.exports = { authenticateToken };
