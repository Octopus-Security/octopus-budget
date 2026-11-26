'use strict';
// A data-changing GET link is refused when it was followed from another site.
const { test, before, after } = require('node:test');
const assert  = require('node:assert');
const fs      = require('node:fs');
const path    = require('node:path');
const express = require('express');
const { refuseCrossSiteChange } = require('../lib/same-site-guard');

let server, base, hits;
before(async () => {
  const app = express();
  app.use(refuseCrossSiteChange);
  app.get('/debts/delete/:id', (req, res) => { hits++; res.send('deleted'); });
  app.get('/installments/paid/:id', (req, res) => { hits++; res.send('paid'); });
  app.get('/graphs', (req, res) => res.send('page'));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (p, headers = {}) => fetch(base + p, { headers });

test('a cross-site or same-site-other-host navigation is refused and changes nothing', async () => {
  hits = 0;
  for (const site of ['cross-site', 'same-site']) {
    assert.strictEqual((await get('/debts/delete/1', { 'sec-fetch-site': site })).status, 403);
    assert.strictEqual((await get('/installments/paid/1', { 'sec-fetch-site': site })).status, 403);
  }
  assert.strictEqual(hits, 0);
});

test('a click inside the app and a typed address still work', async () => {
  hits = 0;
  assert.strictEqual((await get('/debts/delete/1', { 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.strictEqual((await get('/installments/paid/1', { 'sec-fetch-site': 'none' })).status, 200);
  assert.strictEqual(hits, 2);
});

test('without the header, a Referer from another host is refused and none or the same host passes', async () => {
  const host = base.replace('http://', '');
  assert.strictEqual((await get('/debts/delete/1', { referer: 'https://elsewhere.example/x' })).status, 403);
  assert.strictEqual((await get('/debts/delete/1', { referer: `http://${host}/` })).status, 200);
  assert.strictEqual((await get('/debts/delete/1')).status, 200);
});

test('ordinary pages are not affected', async () => {
  assert.strictEqual((await get('/graphs', { 'sec-fetch-site': 'cross-site' })).status, 200);
});

test('index.js mounts the guard', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(src, /app\.use\(refuseCrossSiteChange\)/);
});
