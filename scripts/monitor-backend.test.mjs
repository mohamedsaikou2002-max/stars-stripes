import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createAppServer } from './monitor-backend.mjs';

async function app(t) {
  const server = createAppServer({ backendOrigins: ['https://backend.example'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const event = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', host: 'backend.example', method: 'POST', pathClass: '/functions/v1/chat', status: 200, durationMs: 10, destination: 'allowlisted', error: null };

test('health is a live backend response with unknown security measurements and restrictive CSP', async t => {
  const base = await app(t); const r = await fetch(base + '/api/monitor/health');
  assert.equal(r.status, 200); const body = await r.json();
  assert.equal(body.status, 'running'); assert.equal(body.persistence, 'memory');
  assert.deepEqual(Object.values(body.tls), [null, null, null, null]);
  assert.deepEqual(body.policy.backendOrigins, ['https://backend.example']);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self' https:\/\/backend.example/);
  assert.doesNotMatch(csp, /unsafe-eval|connect-src[^;]*\*/);
});

test('metadata ingestion discards headers, bodies, URLs, and unmeasured assurance fields', async t => {
  const base = await app(t);
  const r = await fetch(base + '/api/monitor/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ ...event, pathClass: '/token-secret?api_key=secret', body: 'secret', headers: { Authorization: 'secret', cookie: 'secret', 'x-sa-session': 'secret' }, tls: { pqHybrid: true }, url: 'https://backend.example/?secret' }]) });
  assert.equal(r.status, 202);
  const stored = await (await fetch(base + '/api/monitor/events')).text();
  assert.doesNotMatch(stored, /secret|Authorization|cookie|x-sa-session|pqHybrid/);
  assert.equal(JSON.parse(stored).events[0].pathClass, '/[redacted]');
});

test('foreign origins and DNS rebinding cannot access the local monitor', async t => {
  const base = await app(t);
  assert.equal((await fetch(base + '/api/monitor/health', { headers: { Origin: 'https://foreign.example' } })).status, 403);
  const reboundStatus = await new Promise((resolve, reject) => {
    const req = http.get(base + '/api/monitor/health', { headers: { Host: 'foreign.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(reboundStatus, 403);
});

test('invalid and oversized batches fail without storing partial events', async t => {
  const base = await app(t);
  const post = body => fetch(base + '/api/monitor/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal((await post(JSON.stringify([event, { ...event, host: 'https://leaky.example/?secret' }]))).status, 400);
  assert.deepEqual((await (await fetch(base + '/api/monitor/events')).json()).events, []);
  assert.equal((await post(JSON.stringify({ payload: 'x'.repeat(40000) }))).status, 413);
});

test('clear removes retained metadata and unknown API routes are errors', async t => {
  const base = await app(t);
  await fetch(base + '/api/monitor/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([event]) });
  assert.equal((await fetch(base + '/api/monitor/events', { method: 'DELETE' })).status, 200);
  assert.deepEqual((await (await fetch(base + '/api/monitor/events')).json()).events, []);
  assert.equal((await fetch(base + '/api/monitor/unknown')).status, 404);
});
