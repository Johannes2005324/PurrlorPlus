import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { parseBugCommand, sendBugReport } from './bugReport';

describe('parseBugCommand', () => {
  it('takes the first word as the project and the rest as the report', () => {
    expect(parseBugCommand("!bug purrlor emojis don't work on mobile")).toEqual({
      type: 'bug',
      project: 'purrlor',
      text: "emojis don't work on mobile",
    });
    expect(parseBugCommand('!BUG Ultimit  the bar\nflickers ')).toEqual({ type: 'bug', project: 'ultimit', text: 'the bar\nflickers' });
  });

  it('asks for the usage when the project or the text is missing', () => {
    expect(parseBugCommand('!bug')).toEqual({ type: 'usage' });
    expect(parseBugCommand('!bug purrlor')).toEqual({ type: 'usage' });
    expect(parseBugCommand('!bug purrlor   ')).toEqual({ type: 'usage' });
  });

  it('leaves ordinary messages alone', () => {
    expect(parseBugCommand('!bugs are everywhere')).toBeNull();
    expect(parseBugCommand('found a !bug purrlor thing')).toBeNull();
    expect(parseBugCommand('hello')).toBeNull();
  });
});

describe('sendBugReport', () => {
  const mx = { getOpenIdToken: async () => ({ access_token: 't', matrix_server_name: 's', expires_in: 3600 }) } as unknown as MatrixClient;
  afterEach(() => vi.unstubAllGlobals());

  it('sends the project and text with a login proof, and returns the project it was filed under', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'x', project: 'purrlor', delivered: true })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendBugReport(mx, 'purrlor', 'emojis')).resolves.toBe('purrlor');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/public/bugs');
    expect(JSON.parse(String(init.body))).toMatchObject({ project: 'purrlor', text: 'emojis', openid_token: { access_token: 't' } });
  });

  it("passes on the server's reason, such as an unknown project", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: "There's no project called 'nope'." }), { status: 400 }));
    await expect(sendBugReport(mx, 'nope', 'x')).rejects.toThrow("There's no project called 'nope'.");
  });
});
