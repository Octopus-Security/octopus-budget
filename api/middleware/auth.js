const { createAuthMiddleware } = require('@octopus-security/auth-client');

const authenticateToken = createAuthMiddleware();

// AUTH_REMOTE_VERIFY is a security control, and an unsupported one is SILENT.
// See the identical block in octopus-health for the full reasoning.
//
// Short version: remote verification arrived in auth-client 1.2.0, this service
// resolves the dependency at BUILD time and has no lockfile entry for it, so an
// older image ignores the variable and keeps waving revoked sessions through
// with nothing in the log. Ask the middleware what it built rather than
// trusting the environment. Warn rather than exit — a stack that cannot see
// revocation still beats a stack that is down.
//
// index.js builds a second createAuthMiddleware() for the page routes. Same
// package, same answer, so one check covers both.
if (/^(1|true|yes)$/i.test(process.env.AUTH_REMOTE_VERIFY || '') && !authenticateToken.remote) {
  console.error(
    '[auth] AUTH_REMOTE_VERIFY is set, but this build of @octopus-security/auth-client\n'
    + '       does not support it (needs >=1.2.0, and the compose asks for it).\n'
    + '       Bearer routes are verifying LOCALLY and CANNOT see revocation — a revoked\n'
    + '       session keeps working here until it expires, up to seven days.\n'
    + '       REBUILD this stack. A redeploy alone will not change the installed package.'
  );
} else if (authenticateToken.remote) {
  console.log('[auth] Bearer routes verify remotely against octopus-auth — revocation is visible.');
}

module.exports = { authenticateToken };
