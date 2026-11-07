'use strict';

// Auth refuses registration unless the body carries ageConfirmed === true.
// auth-client's register() only forwards that from v1.6.0 (not yet tagged), and
// the installed 1.5.x silently drops a 5th argument, so this posts the body
// itself through the client's own transport. Once budget pins ^1.6.0 this can
// become auth.register(u, p, e, code, { ageConfirmed }).
//
// ageConfirmed is true only when the caller sent exactly true; anything else
// (missing, "true", 1) is sent as false so auth refuses it with its own message.
async function registerAccount(auth, body = {}) {
    return auth._post('/api/auth/register', {
        username: body.username,
        password: body.password,
        email: body.email,
        inviteCode: body.inviteCode,
        ageConfirmed: body.ageConfirmed === true,
    });
}

module.exports = { registerAccount };
