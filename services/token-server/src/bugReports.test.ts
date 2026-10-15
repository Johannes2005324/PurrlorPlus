import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  BugReportLog,
  BugRoom,
  bugNotice,
  bugReportsRouter,
  checkBugReport,
  DEFAULT_BUG_PROJECTS,
  parseBugAdmins,
  parseBugProjects,
  type BugReport,
  type BugReportDeps,
} from './bugReports.js';
import { controlApp, type ControlDeps } from './controlServer.js';
import { AdminStore } from './adminStore.js';
import { RateLimiter } from './webhooks.js';

const LUNA = '@luna:purr.example';
const REPORT: BugReport = { id: 'r1', at: '2026-10-14T12:00:00.000Z', project: 'purrlor', reporter: LUNA, text: "emojis don't work on mobile" };

let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bugs-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('settings', () => {
  it('reads projects lower-cased, leaving out bad names, with purrlor when none are set', () => {
    assert.deepEqual(parseBugProjects('Purrlor, ultimit  nte,,bad/name,ultimit'), ['purrlor', 'ultimit', 'nte']);
    assert.deepEqual(parseBugProjects(''), DEFAULT_BUG_PROJECTS);
    assert.deepEqual(parseBugProjects(undefined), ['purrlor']);
  });

  it('reads admins as full Matrix IDs only', () => {
    assert.deepEqual(parseBugAdmins('@mino:purr.example, nobody @a:b @mino:purr.example'), ['@mino:purr.example', '@a:b']);
  });
});

describe('checkBugReport', () => {
  const projects = ['purrlor', 'ultimit'];

  it('takes a known project, any case, and the text', () => {
    assert.deepEqual(checkBugReport({ project: 'Purrlor', text: "  emojis don't work on mobile " }, projects), {
      ok: true,
      report: { project: 'purrlor', text: "emojis don't work on mobile", version: undefined, platform: undefined },
    });
  });

  it('names the projects there are when it is given another', () => {
    const result = checkBugReport({ project: 'nope', text: 'x' }, projects);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /purrlor, ultimit/);
  });

  it('refuses no text and too much of it', () => {
    assert.equal(checkBugReport({ project: 'purrlor', text: '   ' }, projects).ok, false);
    assert.equal(checkBugReport({ project: 'purrlor', text: 'x'.repeat(2001) }, projects).ok, false);
    assert.equal(checkBugReport({ project: 'purrlor', text: 'x'.repeat(2000) }, projects).ok, true);
  });

  it('strips terminal escapes and bidi overrides, keeping newlines', () => {
    const result = checkBugReport({ project: 'purrlor', text: 'a\u001b]52;c;x\u0007b\u202ec\r\nd' }, projects);
    assert.equal(result.ok && result.report.text, 'a]52;c;xbc\nd');
  });
});

describe('bugNotice', () => {
  it('says the project, who sent it and from what', () => {
    assert.equal(
      bugNotice({ ...REPORT, platform: 'mobile', version: 'abc123' }),
      "🐞 Bug report [purrlor] from @luna:purr.example (mobile, version abc123)\nemojis don't work on mobile"
    );
    assert.equal(bugNotice(REPORT), "🐞 Bug report [purrlor] from @luna:purr.example\nemojis don't work on mobile");
  });
});

describe('BugReportLog', () => {
  it('appends and reads back, filtered by project, skipping lines it cannot read', async () => {
    const log = new BugReportLog(join(dir, 'log', 'bug-reports.jsonl'));
    await log.append(REPORT);
    await writeFile(log.file, 'not json\n', { flag: 'a' });
    await log.append({ ...REPORT, id: 'r2', project: 'ultimit', text: 'bar flickers' });
    await log.append({ ...REPORT, id: 'r3' });
    assert.deepEqual((await log.recent(10)).map((r) => r.id), ['r1', 'r2', 'r3']);
    assert.deepEqual((await log.recent(10, 'purrlor')).map((r) => r.id), ['r1', 'r3']);
    assert.deepEqual((await log.recent(1)).map((r) => r.id), ['r3']);
    assert.deepEqual(await new BugReportLog(join(dir, 'none.jsonl')).recent(10), []);
  });
});

/** A bot that records what it was asked to do. */
function fakeBot(members: Record<string, Record<string, string>> = {}) {
  const calls: string[] = [];
  const mx = {
    getUserId: () => '@bot:purr.example',
    async getStateEvent(roomId: string, _type: string, userId: string) {
      const membership = members[roomId]?.[userId];
      if (!membership) throw new Error('404');
      return { membership };
    },
    async createRoom(options: { invite: string[] }) {
      calls.push(`create ${options.invite.join(',')}`);
      members['!new:purr.example'] = { '@bot:purr.example': 'join', ...Object.fromEntries(options.invite.map((id) => [id, 'invite'])) };
      return { room_id: '!new:purr.example' };
    },
    async invite(roomId: string, userId: string) {
      calls.push(`invite ${roomId} ${userId}`);
    },
    async sendMessage(roomId: string, content: { body: string; 'm.mentions'?: object }) {
      calls.push(`send ${roomId} ${content.body.split('\n')[0]} mentions=${JSON.stringify(content['m.mentions'])}`);
    },
  };
  return { mx: mx as unknown as MatrixClient, calls, members };
}

describe('BugRoom', () => {
  it('makes the room once, inviting the admins, and remembers it', async () => {
    const state = join(dir, 'room1', 'bug-room.json');
    const bot = fakeBot();
    const room = new BugRoom(state, async () => bot.mx, ['@mino:purr.example']);
    await room.deliver(REPORT);
    await room.deliver(REPORT);
    assert.deepEqual(bot.calls, [
      'create @mino:purr.example',
      'send !new:purr.example 🐞 Bug report [purrlor] from @luna:purr.example mentions={}',
      'send !new:purr.example 🐞 Bug report [purrlor] from @luna:purr.example mentions={}',
    ]);
    assert.deepEqual(JSON.parse(await readFile(state, 'utf8')), { roomId: '!new:purr.example' });
  });

  it('invites an admin added later or who left, but not one banned', async () => {
    const state = join(dir, 'room2.json');
    await writeFile(state, JSON.stringify({ roomId: '!old:purr.example' }));
    const bot = fakeBot({ '!old:purr.example': { '@bot:purr.example': 'join', '@a:s': 'join', '@b:s': 'leave', '@c:s': 'ban' } });
    await new BugRoom(state, async () => bot.mx, ['@a:s', '@b:s', '@c:s', '@d:s']).deliver(REPORT);
    assert.deepEqual(bot.calls.slice(0, 2), ['invite !old:purr.example @b:s', 'invite !old:purr.example @d:s']);
    assert.match(bot.calls[2], /^send !old:purr.example/);
  });

  it('makes a new room when the bot is no longer in the old one', async () => {
    const state = join(dir, 'room3.json');
    await writeFile(state, JSON.stringify({ roomId: '!gone:purr.example' }));
    const bot = fakeBot({ '!gone:purr.example': { '@bot:purr.example': 'leave' } });
    await new BugRoom(state, async () => bot.mx, ['@a:s']).deliver(REPORT);
    assert.equal(bot.calls[0], 'create @a:s');
  });

  it('refuses when there are no admins', async () => {
    const bot = fakeBot();
    await assert.rejects(new BugRoom(join(dir, 'room4.json'), async () => bot.mx, []).deliver(REPORT), /BUG_REPORT_ADMINS/);
    assert.deepEqual(bot.calls, []);
  });
});

describe('POST /api/public/bugs', () => {
  let server: Server;
  let base: string;
  const delivered: BugReport[] = [];
  let failDelivery = false;
  const log = new BugReportLog(join(tmpdir(), `bugs-route-${process.pid}-${Date.now()}.jsonl`));
  const deps: BugReportDeps = {
    projects: ['purrlor', 'ultimit'],
    log,
    async caller(token) {
      const t = token as { access_token?: string } | undefined;
      if (t?.access_token === 'luna') return LUNA;
      if (t?.access_token === 'far') return '@far:elsewhere.example';
      throw new Error('bad token');
    },
    isLocal: async (userId) => userId.endsWith(':purr.example'),
    async deliver(report) {
      if (failDelivery) throw new Error('homeserver down');
      delivered.push(report);
    },
    now: () => new Date('2026-10-14T12:00:00Z'),
  };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/public/bugs', bugReportsRouter(deps, { account: new RateLimiter(2, 0), address: new RateLimiter(100, 0) }));
    server = app.listen(0);
    await new Promise((done) => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/bugs`;
  });
  after(async () => {
    server.close();
    await rm(log.file, { force: true });
  });

  const post = (body: unknown) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('lists the projects', async () => {
    assert.deepEqual(await (await fetch(base)).json(), { projects: ['purrlor', 'ultimit'] });
  });

  it('files a report under its project, saved and passed on', async () => {
    const res = await post({ openid_token: { access_token: 'luna' }, project: 'purrlor', text: "emojis don't work on mobile", platform: 'mobile' });
    assert.equal(res.status, 200);
    const answer = (await res.json()) as { id: string; project: string; delivered: boolean };
    assert.equal(answer.project, 'purrlor');
    assert.equal(answer.delivered, true);
    assert.equal(delivered.at(-1)?.reporter, LUNA);
    assert.equal(delivered.at(-1)?.platform, 'mobile');
    assert.deepEqual((await log.recent(5)).map((r) => r.id), [answer.id]);
  });

  it('keeps a report the admins could not be told about', async () => {
    failDelivery = true;
    const res = await post({ openid_token: { access_token: 'luna' }, project: 'ultimit', text: 'bar flickers' });
    failDelivery = false;
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { delivered: boolean }).delivered, false);
    assert.equal((await log.recent(5)).at(-1)?.text, 'bar flickers');
  });

  it('refuses a bad login, another server, and an unknown project', async () => {
    assert.equal((await post({ openid_token: { access_token: 'x' }, project: 'purrlor', text: 'a' })).status, 401);
    assert.equal((await post({ openid_token: { access_token: 'far' }, project: 'purrlor', text: 'a' })).status, 403);
    const unknown = await post({ openid_token: { access_token: 'luna' }, project: 'nope', text: 'a' });
    assert.equal(unknown.status, 400);
    assert.deepEqual(((await unknown.json()) as { projects: string[] }).projects, ['purrlor', 'ultimit']);
  });

  it('limits how many one account sends', async () => {
    // Two allowed in all, both used above.
    assert.equal((await post({ openid_token: { access_token: 'luna' }, project: 'purrlor', text: 'again' })).status, 429);
  });
});

describe('purrlor bugs (the control socket)', () => {
  it('lists reports, by project, with the text indented under each', async () => {
    const log = new BugReportLog(join(dir, 'ctl', 'bug-reports.jsonl'));
    await log.append({ ...REPORT, platform: 'mobile' });
    await log.append({ ...REPORT, id: 'r2', project: 'ultimit', text: 'line one\nline two' });
    const store = new AdminStore(join(dir, 'ctl'));
    const deps = { store, bugs: log, serverName: async () => 'purr.example' } as unknown as ControlDeps;
    const server = controlApp(deps).listen(0);
    await new Promise((done) => server.once('listening', done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/bugs`;
    try {
      const all = await (await fetch(url)).text();
      assert.equal(
        all,
        "2026-10-14 12:00  [purrlor]  @luna:purr.example  (mobile)\n    emojis don't work on mobile\n" +
          '2026-10-14 12:00  [ultimit]  @luna:purr.example\n    line one\n    line two\n'
      );
      assert.doesNotMatch(await (await fetch(`${url}?project=PURRLOR`)).text(), /ultimit/);
      assert.equal(await (await fetch(`${url}?project=nte`)).text(), "No bug reports for 'nte'.\n");
    } finally {
      server.close();
    }
  });
});
