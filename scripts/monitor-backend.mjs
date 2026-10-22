import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBuffer, pathClass } from '../src/lib/eagle/core.ts';

export function policyOrigins(origin) {
  if (!origin) return [];
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Backend must be a credential-free HTTPS origin');
  return [url.origin];
}

export function securityHeaders(backendOrigins, nonce) {
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${backendOrigins.join(' ')}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  };
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.id) ||
      typeof raw.host !== 'string' || !/^[a-z0-9.:[\]-]{1,253}$/i.test(raw.host) ||
      !['allowlisted', 'blocked'].includes(raw.destination)) throw new Error('Invalid event');
  return {
    id: raw.id, ts: new Date().toISOString(), host: raw.host,
    method: typeof raw.method === 'string' && /^[A-Z]{1,12}$/.test(raw.method) ? raw.method : 'OTHER',
    pathClass: pathClass(typeof raw.pathClass === 'string' ? raw.pathClass : ''),
    status: Number.isInteger(raw.status) && raw.status >= 100 && raw.status <= 599 ? raw.status : null,
    durationMs: typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) ? Math.max(0, Math.min(raw.durationMs, 86400000)) : 0,
    destination: raw.destination, error: ['blocked', 'network', 'http'].includes(raw.error) ? raw.error : null,
  };
}

export function createMonitorHandler({ backendOrigins = [], nonce, buffer = new EventBuffer() } = {}) {
  const startedAt = new Date().toISOString();
  return async (req, res, next = () => { res.writeHead(404); res.end(); }) => {
    for (const [key, value] of Object.entries(securityHeaders(backendOrigins, nonce))) res.setHeader(key, value);
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/monitor/') && url.pathname !== '/api/monitor-check') return next();
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // Loopback server, no CORS, reject foreign origins and DNS rebinding.
    const host = req.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return reply(403, { error: 'Local development access only' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return reply(403, { error: 'Origin denied' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Cross-site access denied' });
    if (req.method === 'GET' && url.pathname === '/api/monitor-check') return reply(200, { status: 'running', checkedAt: new Date().toISOString() });
    if (req.method === 'GET' && url.pathname === '/api/monitor/health') return reply(200, {
      status: 'running', startedAt, checkedAt: new Date().toISOString(), persistence: 'memory',
      policy: { backendOrigins, version: 1 },
      tls: { version: null, keyExchange: null, certificatePinned: null, serverSignatureVerified: null },
      scope: 'This browser app only; no device-wide traffic capture or OS firewall control',
    });
    if (req.method === 'GET' && url.pathname === '/api/monitor/events') return reply(200, { events: buffer.snapshot() });
    if (req.method === 'DELETE' && url.pathname === '/api/monitor/events') { buffer.clear(); return reply(200, { cleared: true }); }
    if (req.method === 'POST' && url.pathname === '/api/monitor/events') {
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'JSON required' });
      try {
        let body = ''; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 32768) { reply(413, { error: 'Event batch too large' }); req.resume(); return; }
          body += chunk;
        }
        const batch = JSON.parse(body);
        if (!Array.isArray(batch) || batch.length > 100) return reply(400, { error: 'Invalid batch' });
        const events = batch.map(sanitize);
        events.forEach(e => buffer.add(e));
        return reply(202, { accepted: events.length });
      } catch { return reply(400, { error: 'Invalid metadata' }); }
    }
    return reply(404, { error: 'Unknown monitor endpoint' });
  };
}

// Standalone local backend + built frontend. No database, credentials, or outbound calls.
export function createAppServer({ backendOrigins = [], root = resolve('dist') } = {}) {
  const handler = createMonitorHandler({ backendOrigins });
  return http.createServer((req, res) => handler(req, res, async () => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
      try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html'); }
      catch { file = resolve(root, 'index.html'); }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(503); res.end('Build the frontend with npm run build first.'); }
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile('.env.local'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const server = createAppServer({ backendOrigins: policyOrigins(process.env.VITE_SUPABASE_URL) });
  server.requestTimeout = 10000;
  server.listen(Number(process.env.MONITOR_PORT ?? 8787), '127.0.0.1', () => console.log('Local traffic backend running; database disabled'));
}
