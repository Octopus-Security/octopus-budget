'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { registerAccount } = require('../registerAccount');

function stub() {
    const calls = [];
    return { calls, _post: async (p, b) => { calls.push([p, b]); return { ok: true, status: 200, data: {} }; } };
}

test('register is sent with ageConfirmed true when the box was ticked', async () => {
    const a = stub();
    await registerAccount(a, { username: 'u', password: 'p', email: 'e', inviteCode: 'c', ageConfirmed: true });
    assert.equal(a.calls[0][0], '/api/auth/register');
    assert.strictEqual(a.calls[0][1].ageConfirmed, true);
    assert.equal(a.calls[0][1].inviteCode, 'c');
});

test('anything but exactly true is sent as false', async () => {
    for (const v of [undefined, false, 'true', 1, 'on']) {
        const a = stub();
        await registerAccount(a, { username: 'u', password: 'p', ageConfirmed: v });
        assert.strictEqual(a.calls[0][1].ageConfirmed, false);
    }
});

test('the registration form has a required 18+ checkbox with a 44px target', async () => {
    const tpl = fs.readFileSync(path.join(__dirname, '../views/login.ejs'), 'utf8');
    const html = ejs.render(tpl, { title: 't', mode: 'register', error: null, asset: (x) => x });
    assert.match(html, /<input type="checkbox" id="ageConfirmed" name="ageConfirmed"[^>]*required/);
    assert.match(html, /I confirm I am 18 or older/);
    assert.match(html, /min-height:44px/);
    assert.match(html, /!document\.getElementById\('ageConfirmed'\)\.checked/);
});
