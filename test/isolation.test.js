'use strict';

/**
 * The isolation boundary, made explicit.
 *
 * This service uses the database-per-user style: there is no owner column, and
 * an unfiltered query inside one user's database is CORRECT because the file is
 * the boundary. That only holds while two different people can never resolve to
 * the same file — and the file is chosen by interpolating the username straight
 * into a path:
 *
 *     path.join(__dirname, 'data', `${username}_database.sqlite`)
 *
 * So the safety of every query in this service rests on that one expression, and
 * on a validation rule enforced in a DIFFERENT REPO. octopus-auth restricts
 * usernames to /^[A-Za-z0-9_.-]+$/ at registration; nothing here checks anything.
 * That dependency is invisible from this file, which is why it is written down
 * as a test rather than left as a comment nobody reads.
 *
 * The estate already has an account whose username is a SQL injection probe,
 * stored literally, so "usernames are always tame" has never been true.
 *
 * Run: node --test test/isolation.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const path     = require('node:path');

const getDatabase = require('../database');

const dataDir = path.resolve(__dirname, '..', 'data');
const storageFor = username => path.resolve(getDatabase(username).sequelize.options.storage);

test('two different users never resolve to the same database file', () => {
  assert.notStrictEqual(storageFor('alice'), storageFor('bob'),
    'two users share one database — the isolation boundary is gone');
});

test('the same user resolves to the same file every time', () => {
  assert.strictEqual(storageFor('alice'), storageFor('alice'));
});

// A username differing only by case must not silently become a second account's
// data. This pins the CURRENT behaviour so a change is a deliberate decision.
test('case is preserved in the filename, so the mapping is exact', () => {
  assert.notStrictEqual(storageFor('alice'), storageFor('Alice'));
});

// This is the test that found the bug it now guards. Before 2026-09-05 these
// were accepted and `../..` resolved to <root>/.._database.sqlite — outside the
// data directory. Unreachable through registration, because octopus-auth
// rejects them, which is exactly why it survived: the only control was in
// another repo and invisible from here.
test('a username that could escape data/ is refused outright', () => {
  const hostile = ['../..', '../../etc/passwd', 'a/../../b', 'a/b', '/etc/passwd', 'a b', ''];
  for (const username of hostile) {
    assert.throws(() => getDatabase(username), /unsafe username|outside data/,
      `username ${JSON.stringify(username)} was accepted`);
  }
});

test('ordinary usernames still resolve, and stay inside data/', () => {
  for (const username of ['alice', 'a.b', 'a_b', 'a-b', '..', '.', 'psychopathy']) {
    const resolved = storageFor(username);
    assert.ok(resolved.startsWith(dataDir + path.sep),
      `username ${JSON.stringify(username)} escaped the data directory: ${resolved}`);
  }
});

test('distinct usernames never collapse onto one file', () => {
  // Guards the opposite failure: a sanitiser that strips everything would pass
  // the containment test above while being far worse than the traversal it
  // prevented — several people silently sharing one database.
  const names = ['alice', 'bob', 'carol', 'a.b', 'a_b', 'a-b'];
  assert.strictEqual(new Set(names.map(storageFor)).size, names.length,
    'distinct usernames collapsed onto the same file');
});
