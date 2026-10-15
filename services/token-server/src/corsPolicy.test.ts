import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import cors from 'cors';
import { corsOptions, openToAnyOrigin, originAllowed, parseAllowedOrigins } from './corsPolicy.js';

describe('originAllowed', () => {
  it('takes the listed origins, a subdomain pattern, or anything with *', () => {
    const allowed = parseAllowedOrigins('https://purr.example, https://*.cats.example');
    assert.equal(originAllowed('https://purr.example', allowed), true);
    assert.equal(originAllowed('https://app.cats.example', allowed), true);
    assert.equal(originAllowed('https://evil.example', allowed), false);
    assert.equal(originAllowed(undefined, allowed), true);
    assert.equal(originAllowed('https://anything.example', parseAllowedOrigins(undefined)), true);
  });

  it('opens voice and bug reports, and nothing else', () => {
    assert.equal(openToAnyOrigin('/api/livekit/token'), true);
    assert.equal(openToAnyOrigin('/api/livekit/rooms/participants'), true);
    assert.equal(openToAnyOrigin('/api/public/bugs'), true);
    assert.equal(openToAnyOrigin('/api/livekitx'), false);
    assert.equal(openToAnyOrigin('/api/public/feed'), false);
    assert.equal(openToAnyOrigin('/api/public/bugsx'), false);
  });
});

describe('the CORS answers a browser gets', () => {
  let server: Server;
  let base: string;
  before(async () => {
    const app = express();
    app.use(cors(corsOptions(parseAllowedOrigins('https://purr.example'))));
    app.post('/api/livekit/token', (_req, res) => void res.json({ ok: true }));
    app.post('/api/public/online', (_req, res) => void res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const preflight = (path: string, origin: string) =>
    fetch(`${base}${path}`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });

  it("lets another server's app ask for voice (a federated member of the Space)", async () => {
    const res = await preflight('/api/livekit/token', 'https://other-instance.example');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://other-instance.example');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    const post = await fetch(`${base}/api/livekit/token`, { method: 'POST', headers: { Origin: 'https://other-instance.example' } });
    assert.equal(post.headers.get('access-control-allow-origin'), 'https://other-instance.example');
  });

  it('keeps everything else to the allowed origins', async () => {
    assert.equal((await preflight('/api/public/online', 'https://other-instance.example')).headers.get('access-control-allow-origin'), null);
    assert.equal((await preflight('/api/public/online', 'https://purr.example')).headers.get('access-control-allow-origin'), 'https://purr.example');
  });
});
