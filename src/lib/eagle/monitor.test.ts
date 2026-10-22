import { vi } from 'vitest';

it('blocks before network I/O, records only redacted metadata, and fails closed when the backend disappears', async () => {
  vi.useFakeTimers();
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const websocket = window.WebSocket; const eventsource = window.EventSource;
  let healthy = true;
  const sent: unknown[] = [];
  const fetcher = vi.fn(async (input: unknown, opts?: RequestInit) => {
    if (input === '/api/monitor/health') return healthy ? new Response(JSON.stringify({ status: 'running', checkedAt: new Date().toISOString(), policy: { backendOrigins: ['https://backend.example'], version: 1 } })) : new Response('{}', { status: 503 });
    if (input === '/api/monitor/events') { if (opts?.body) sent.push(JSON.parse(String(opts.body))); return new Response('{}', { status: 202 }); }
    return new Response('{}', { status: 200 });
  });
  window.fetch = fetcher;
  try {
    const monitor = await import('./monitor');
    await monitor.startTrafficMonitor();
    expect(monitor.getSnapshot().error).toBeNull();
    const before = fetcher.mock.calls.length;
    await expect(window.fetch('https://unexpected.invalid/?token=secret')).rejects.toThrow('Destination blocked');
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('unexpected.invalid'))).toBe(false);
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(before);
    await window.fetch('https://backend.example/functions/v1/chat?key=secret', { method: 'POST', headers: { Authorization: 'secret' }, body: 'secret' });
    await Promise.resolve();
    const exported = JSON.stringify(monitor.getSnapshot().events);
    expect(exported).not.toMatch(/secret|Authorization|\?key/);
    expect(exported).toContain('/functions/v1/chat');
    expect(monitor.getSnapshot().events.some(e => e.destination === 'blocked')).toBe(true);
    healthy = false; await monitor.refreshPolicy();
    expect(monitor.getSnapshot().health).toBeNull();
    await expect(window.fetch('https://backend.example/functions/v1/chat')).rejects.toThrow('Destination blocked');
  } finally {
    window.fetch = originalFetch; XMLHttpRequest.prototype.open = originalOpen;
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: websocket });
    Object.defineProperty(window, 'EventSource', { configurable: true, value: eventsource });
    vi.useRealTimers();
  }
});
