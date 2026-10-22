import { allowed, describe as describeTraffic, EventBuffer, eventFor, pathClass } from './core';

describe('traffic metadata and destination policy', () => {
  it('allows exact origins only and rejects credentials, subdomains, ports, and other protocols', () => {
    const origins = ['https://backend.example'];
    expect(allowed(new URL('https://backend.example/functions/v1/chat'), origins)).toBe(true);
    for (const url of ['https://backend.example.attacker.com', 'https://other.backend.example', 'https://backend.example:444', 'http://backend.example', 'https://user:secret@backend.example', 'file:///tmp/test']) expect(allowed(new URL(url), origins)).toBe(false);
  });
  it('removes queries, tokens, UUIDs, and arbitrary path segments', () => {
    expect(pathClass('/functions/v1/chat?token=private')).toBe('/functions/v1/chat');
    for (const path of ['/person/1234', '/token-secret', '/functions/v1/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '/functions/v1/chat/secret']) expect(pathClass(path)).toBe('/[redacted]');
  });
  it('bounds newest-first history and clears it', () => {
    const buffer = new EventBuffer(2);
    for (let i = 0; i < 3; i++) buffer.add(eventFor(new URL('https://backend.example'), 'GET', { id: String(i) }));
    expect(buffer.snapshot().map(e => e.id)).toEqual(['2', '1']);
    buffer.clear(); expect(buffer.snapshot()).toEqual([]);
  });
  it('never converts successful HTTP or unknown TLS measurements into security reassurance', () => {
    const event = eventFor(new URL('https://backend.example'), 'GET', { status: 200 });
    expect(describeTraffic(event).severity).toBe('info');
    expect(describeTraffic(event).text).toContain('not verified');
    expect(describeTraffic({ ...event, status: null }).text).toContain('not been verified');
  });
  it('distinguishes blocked, network, and server failures', () => {
    const event = eventFor(new URL('https://backend.example'), 'GET', {});
    expect(describeTraffic({ ...event, destination: 'blocked' }).severity).toBe('alert');
    expect(describeTraffic({ ...event, error: 'network' }).severity).toBe('warn');
    expect(describeTraffic({ ...event, error: 'http', status: 503 }).text).toContain('503');
  });
});
