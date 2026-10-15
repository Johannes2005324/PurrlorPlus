import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { forgetBugServers, parseBugCommand, sendBugReport } from './bugReport';

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
    await expect(sendBugReport(mx, 'purrlor', 'emojis')).resolves.toEqual({ project: 'purrlor' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/public/bugs');
    expect(JSON.parse(String(init.body))).toMatchObject({ project: 'purrlor', text: 'emojis', openid_token: { access_token: 't' } });
  });

  it("passes on the server's reason, such as an unknown project", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: "There's no project called 'nope'." }), { status: 400 }));
    await expect(sendBugReport(mx, 'nope', 'x')).rejects.toThrow("There's no project called 'nope'.");
  });
});

describe('sendBugReport from a Space on another server', () => {
  /** A room whose state is `events`, keyed by type then state key. */
  function fakeRoom(roomId: string, events: Record<string, Record<string, { sender?: string; content?: unknown }>>, extra: Partial<Room> = {}): Room {
    const event = (e: { sender?: string; content?: unknown }) => ({ getSender: () => e.sender, getContent: () => e.content ?? {}, getStateKey: () => '' });
    return {
      roomId,
      name: 'Cats',
      isSpaceRoom: () => false,
      getMyMembership: () => 'join',
      currentState: {
        getStateEvents: (type: string, key?: string) => {
          const ofType = events[type] ?? {};
          if (key !== undefined) return ofType[key] ? event(ofType[key]) : null;
          return Object.entries(ofType).map(([stateKey, e]) => ({ ...event(e), getStateKey: () => stateKey }));
        },
      },
      ...extra,
    } as unknown as Room;
  }

  const space = fakeRoom('!cats', { 'm.room.create': { '': { sender: '@admin:purr.example' } } }, { isSpaceRoom: () => true } as Partial<Room>);
  const channel = fakeRoom('!general', { 'm.space.parent': { '!cats': { content: { via: ['purr.example'] } } } });
  const mx = {
    getUserId: () => '@far:elsewhere.example',
    getRoom: (id: string) => ({ '!cats': space, '!general': channel })[id] ?? null,
    getRooms: () => [space, channel],
    getOpenIdToken: async () => ({ access_token: 't', matrix_server_name: 'elsewhere.example', expires_in: 3600 }),
  } as unknown as MatrixClient;

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetBugServers();
  });

  it("goes to the Space's own server, once that server says it's the one, naming the Space", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/public/peers') return new Response(JSON.stringify({ peers: [] }));
      if (url === 'https://purr.example/api/public/bugs' && !init?.method) return new Response(JSON.stringify({ projects: ['purrlor'], serverName: 'purr.example' }));
      return new Response(JSON.stringify({ id: 'x', project: 'purrlor', delivered: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendBugReport(mx, 'purrlor', 'voice drops', '!general')).resolves.toEqual({ project: 'purrlor', server: 'purr.example' });
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [string, RequestInit];
    expect(url).toBe('https://purr.example/api/public/bugs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ project: 'purrlor', text: 'voice drops', space_id: '!cats' });
  });

  it("sends nothing when that server doesn't answer as itself", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/public/peers' ? new Response(JSON.stringify({ peers: [] })) : new Response(JSON.stringify({ projects: ['purrlor'], serverName: 'someone.else' }))
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendBugReport(mx, 'purrlor', 'x', '!general')).rejects.toThrow('Cats is hosted on purr.example, which doesn’t take bug reports.');
    expect(fetchMock.mock.calls.some((call) => (call as unknown as [string, RequestInit?])[1]?.method === 'POST')).toBe(false);
  });
});
