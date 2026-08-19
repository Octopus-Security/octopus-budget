const { createAuthMiddleware } = require('@octopus-security/auth-client');

// THIS FILE DOES NOT RUN. `api/` is a legacy mobile REST scaffold and index.js
// never requires it — see CLAUDE.md, "api/ … NOT mounted in index.js".
//
// Recorded here because the AUTH_REMOTE_VERIFY startup check was first written
// into this file, and a correctly rebuilt octopus_budget_tracker then logged
// nothing at all — which looks exactly like a stack that was redeployed instead
// of rebuilt. Twenty minutes went into the wrong question. A check placed in
// dead code does not fail loudly; it fails absent, which is worse, because
// silence is also what a working system looks like.
//
// The live gate is `authenticateJWT` in index.js, feeding 17 /api/* routes, and
// the check lives beside it. If this scaffold is ever mounted, copy it here too.
const authenticateToken = createAuthMiddleware();

module.exports = { authenticateToken };
