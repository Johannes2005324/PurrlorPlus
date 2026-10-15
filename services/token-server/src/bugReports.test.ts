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
  BugDesk,
  bugActionFrom,
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
    assert.equal(bugNotice(REPORT, { resolvedBy: '@mino:s' }), "✅ Resolved by @mino:s · Bug report [purrlor] from @luna:purr.example\nemojis don't work on mobile");
    assert.match(bugNotice(REPORT, { reopenedBy: '@mino:s' }), /^🔁 Reopened by @mino:s · Bug report/);
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
    async sendMessage(roomId: string, content: { body: string; 'm.mentions'?: object; 'm.relates_to'?: { rel_type: string; event_id: string } }) {
      const edit = content['m.relates_to']?.rel_type === 'm.replace' ? ` (edits ${content['m.relates_to'].event_id})` : '';
      calls.push(`send ${roomId} ${content.body.split('\n')[0]} mentions=${JSON.stringify(content['m.mentions'])}${edit}`);
      return { event_id: `$${calls.length}` };
    },
    async sendEvent(roomId: string, type: string, content: { 'm.relates_to': { event_id: string; key: string } }) {
      calls.push(`${type} ${content['m.relates_to'].key} on ${content['m.relates_to'].event_id}`);
      return { event_id: `$${calls.length}` };
    },
  };
  return { mx: mx as unknown as MatrixClient, calls, members };
}

describe('BugRoom', () => {
  it('makes the room once, inviting the admins, and remembers it', async () => {
    const state = join(dir, 'room1', 'bug-room.json');
    const bot = fakeBot();
    const room = new BugRoom(state, async () => bot.mx, ['@mino:purr.example']);
    assert.equal(await room.deliver(REPORT), '$2');
    await room.deliver(REPORT);
    assert.deepEqual(bot.calls, [
      'create @mino:purr.example',
      'send !new:purr.example 🐞 Bug report [purrlor] from @luna:purr.example mentions={}',
      'm.reaction ✅ on $2',
      'send !new:purr.example 🐞 Bug report [purrlor] from @luna:purr.example mentions={}',
      'm.reaction ✅ on $4',
    ]);
    await room.edit('$2', '✅ Resolved by @mino:purr.example · Bug report');
    assert.equal(bot.calls.at(-1), 'send !new:purr.example * ✅ Resolved by @mino:purr.example · Bug report mentions={} (edits $2)');
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
      return `$notice-${report.id}`;
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
    assert.deepEqual((await log.recent(5)).map((r) => [r.id, r.eventId, r.status]), [[answer.id, `$notice-${answer.id}`, 'open']]);
  });

  it('keeps a report the admins could not be told about', async () => {
    failDelivery = true;
    const res = await post({ openid_token: { access_token: 'luna' }, project: 'ultimit', text: 'bar flickers' });
    failDelivery = false;
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { delivered: boolean }).delivered, false);
    assert.equal((await log.recent(5)).at(-1)?.text, 'bar flickers');
    assert.equal((await log.recent(5)).at(-1)?.eventId, undefined);
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
    await log.append({ kind: 'resolved', id: 'r2', by: '@mino:s', at: '2026-10-14T13:00:00Z', cause: '$c' });
    const store = new AdminStore(join(dir, 'ctl'));
    const deps = { store, bugs: log, serverName: async () => 'purr.example' } as unknown as ControlDeps;
    const server = controlApp(deps).listen(0);
    await new Promise((done) => server.once('listening', done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/bugs`;
    try {
      const all = await (await fetch(url)).text();
      assert.equal(
        all,
        "r1  2026-10-14 12:00  [purrlor]  open  @luna:purr.example  (mobile)\n    emojis don't work on mobile\n" +
          'r2  2026-10-14 12:00  [ultimit]  resolved by @mino:s 2026-10-14 13:00  @luna:purr.example\n    line one\n    line two\n'
      );
      assert.doesNotMatch(await (await fetch(`${url}?project=PURRLOR`)).text(), /ultimit/);
      assert.equal(await (await fetch(`${url}?project=nte`)).text(), "No bug reports for 'nte'.\n");
      assert.doesNotMatch(await (await fetch(`${url}?open=1`)).text(), /ultimit/);
      assert.equal(await (await fetch(`${url}?open=1&project=ultimit`)).text(), "No open bug reports for 'ultimit'.\n");
    } finally {
      server.close();
    }
  });
});

describe('marking reports resolved', () => {
  const MINO = '@mino:purr.example';
  const admins = [MINO];
  const react = (id: string, on: string, key = '✅', sender = MINO) => ({
    event_id: id,
    type: 'm.reaction',
    sender,
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: on, key } },
  });
  const reply = (id: string, to: string, body: string, sender = MINO) => ({
    event_id: id,
    type: 'm.room.message',
    sender,
    content: { msgtype: 'm.text', body, 'm.relates_to': { 'm.in_reply_to': { event_id: to } } },
  });
  const redact = (id: string, what: string) => ({ event_id: id, type: 'm.room.redaction', sender: MINO, redacts: what, content: {} });

  it('reads ticks, replies and taken-back reactions, from admins only', () => {
    assert.deepEqual(bugActionFrom(react('$r', '$n'), admins), { kind: 'resolve', eventId: '$n', by: MINO, cause: '$r', reactionId: '$r' });
    assert.equal(bugActionFrom(react('$r', '$n', '✔️'), admins)?.kind, 'resolve');
    assert.equal(bugActionFrom(react('$r', '$n', '👍'), admins), undefined);
    assert.equal(bugActionFrom(react('$r', '$n', '✅', '@luna:purr.example'), admins), undefined);
    assert.deepEqual(bugActionFrom(reply('$m', '$n', 'Fixed in 5327572'), admins), { kind: 'resolve', eventId: '$n', by: MINO, cause: '$m' });
    assert.equal(bugActionFrom(reply('$m', '$n', '> <@bot> 🐞 Bug report\n\ndone, thanks'), admins)?.kind, 'resolve');
    assert.equal(bugActionFrom(reply('$m', '$n', 'reopen: still off on iOS'), admins)?.kind, 'reopen');
    assert.equal(bugActionFrom(reply('$m', '$n', 'looking at it'), admins), undefined);
    assert.equal(bugActionFrom({ ...reply('$m', '$n', 'fixed'), content: { msgtype: 'm.text', body: 'fixed' } }, admins), undefined);
    assert.deepEqual(bugActionFrom(redact('$x', '$r'), admins), { kind: 'unreact', reactionId: '$r', by: MINO, cause: '$x' });
  });

  async function desk() {
    const log = new BugReportLog(join(dir, `desk-${Math.random().toString(36).slice(2)}.jsonl`));
    await log.append(REPORT);
    await log.append({ kind: 'posted', id: REPORT.id, eventId: '$n' });
    const edits: string[] = [];
    // '$old' is a notice from before ✅s, its event ID never kept: the room still has its text.
    const notices: Record<string, string> = { $old: bugNotice({ ...REPORT, id: 'r0', text: 'older one' }) };
    const room = {
      edit: async (eventId: string, body: string) => void edits.push(`${eventId} ${body.split('\n')[0]}`),
      noticeText: async (eventId: string) => notices[eventId],
    };
    return { log, edits, desk: new BugDesk(log, room, admins, () => new Date('2026-10-15T09:00:00Z')) };
  }

  it('resolves with a ✅ once, however often the event is seen, and edits the notice', async () => {
    const { log, edits, desk: d } = await desk();
    assert.equal((await d.handle(react('$r', '$n')))?.status, 'resolved');
    assert.equal(await d.handle(react('$r', '$n')), undefined); // seen again after a restart
    assert.equal(await d.handle(react('$r2', '$n')), undefined); // already resolved
    assert.deepEqual(edits, ['$n ✅ Resolved by @mino:purr.example · Bug report [purrlor] from @luna:purr.example']);
    const [bug] = await log.recent(5);
    assert.deepEqual([bug.status, bug.resolvedBy, bug.resolvedAt], ['resolved', MINO, '2026-10-15T09:00:00.000Z']);
    assert.deepEqual(await log.recent(5, undefined, true), []);
  });

  it('reopens when that ✅ is taken back, but not for some other redaction', async () => {
    const { log, edits, desk: d } = await desk();
    await d.handle(react('$r', '$n'));
    assert.equal(await d.handle(redact('$x1', '$other')), undefined);
    assert.equal((await d.handle(redact('$x2', '$r')))?.status, 'open');
    assert.equal(edits.at(-1), '$n 🔁 Reopened by @mino:purr.example · Bug report [purrlor] from @luna:purr.example');
    assert.equal((await log.recent(5))[0].status, 'open');
  });

  it('resolves and reopens by reply, and ignores replies to anything else', async () => {
    const { log, desk: d } = await desk();
    assert.equal(await d.handle(reply('$m0', '$unrelated', 'fixed')), undefined);
    assert.equal(await d.handle(reply('$m1', '$n', 'reopen')), undefined); // already open
    assert.equal((await d.handle(reply('$m2', '$n', 'fixed')))?.status, 'resolved');
    assert.equal((await d.handle(reply('$m3', '$n', 'reopen, still broken')))?.status, 'open');
    assert.equal((await d.handle(reply('$m4', '$n', 'done')))?.status, 'resolved');
    assert.equal((await log.recent(5))[0].resolvedBy, MINO);
  });
});

describe('older reports, and resolving from the command line', () => {
  const MINO = '@mino:purr.example';

  async function setup(editFails = false) {
    const log = new BugReportLog(join(dir, `cli-${Math.random().toString(36).slice(2)}.jsonl`));
    const old = { ...REPORT, id: 'a1b2c3d4e5f6', text: 'emojis are off center on mobile', platform: 'browser', version: '5327571' };
    const linked = { ...REPORT, id: 'b1b2c3d4e5f6' };
    await log.append(old); // from before ✅s: no 'posted' line
    await log.append(linked);
    await log.append({ kind: 'posted', id: linked.id, eventId: '$linked' });
    const edits: string[] = [];
    const room = {
      edit: async (eventId: string, body: string) => {
        if (editFails) throw new Error('room gone');
        edits.push(`${eventId} ${body.split('\n')[0]}`);
      },
      noticeText: async (eventId: string) => (eventId === '$old' ? bugNotice(old) : eventId === '$someone' ? undefined : 'some other notice'),
    };
    return { log, edits, desk: new BugDesk(log, room, [MINO], () => new Date('2026-10-15T09:00:00Z')), old, linked };
  }
  const reply = (id: string, to: string, body: string) => ({
    event_id: id,
    type: 'm.room.message',
    sender: MINO,
    content: { msgtype: 'm.text', body, 'm.relates_to': { 'm.in_reply_to': { event_id: to } } },
  });

  it('finds an older report by its notice when someone replies "fixed" to it, and links it', async () => {
    const { log, edits, desk: d, old } = await setup();
    assert.equal(await d.handle(reply('$m1', '$unknown', 'fixed')), undefined);
    assert.equal((await d.handle(reply('$m2', '$old', 'fixed')))?.status, 'resolved');
    assert.match(edits[0], /^\$old ✅ Resolved by @mino:purr.example · Bug report \[purrlor\]/);
    const bug = (await log.read()).bugs.find((b) => b.id === old.id);
    assert.deepEqual([bug?.eventId, bug?.status], ['$old', 'resolved']);
    // Linked now: reopening by reply finds it straight away.
    assert.equal((await d.handle(reply('$m3', '$old', 'reopen')))?.status, 'open');
  });

  it('resolves and reopens by ID, saying when nothing changed, with the reason on the notice', async () => {
    const { log, edits, desk: d, old, linked } = await setup();
    const first = await d.set(linked.id, 'resolve', 'mino', 'fixed in 1a2b3c');
    assert.deepEqual([first.changed, first.edited, first.bug?.status], [true, true, 'resolved']);
    assert.equal(edits[0], '$linked ✅ Resolved by mino: fixed in 1a2b3c · Bug report [purrlor] from @luna:purr.example');
    assert.deepEqual([(await d.set(linked.id, 'resolve', 'mino')).changed], [false]);
    // One the room never linked: resolved in the list, nothing to edit.
    const older = await d.set(old.id, 'resolve', 'mino');
    assert.deepEqual([older.changed, older.edited], [true, false]);
    assert.equal((await d.set('ffffffffffff', 'resolve', 'mino')).bug, undefined);
    const bugs = await log.recent(10);
    assert.deepEqual(bugs.map((b) => [b.status, b.resolvedBy, b.note]), [['resolved', 'mino', undefined], ['resolved', 'mino', 'fixed in 1a2b3c']]);
    assert.equal((await d.set(linked.id, 'reopen', 'mino')).bug?.status, 'open');
    assert.equal((await log.recent(10, undefined, true)).length, 1);
  });

  it('keeps the change when the notice can’t be edited', async () => {
    const { log, desk: d, linked } = await setup(true);
    assert.deepEqual(await d.set(linked.id, 'resolve', 'mino').then((r) => [r.changed, r.edited]), [true, false]);
    assert.equal((await log.recent(10)).find((b) => b.id === linked.id)?.status, 'resolved');
  });

  it('purrlor bugs resolve/reopen: by ID, in the audit log, with clear answers', async () => {
    const { desk: d, linked } = await setup();
    const store = new AdminStore(join(dir, `ctl-${Math.random().toString(36).slice(2)}`));
    const server = controlApp({ store, bugDesk: d, serverName: async () => 'purr.example' } as unknown as ControlDeps).listen(0);
    await new Promise((done) => server.once('listening', done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/bugs`;
    const post = (path: string, form: Record<string, string> = {}) =>
      fetch(`${base}/${path}`, { method: 'POST', body: new URLSearchParams({ actor: 'mino', ...form }) }).then(async (r) => [r.status, await r.text()]);
    try {
      assert.deepEqual(await post(`${linked.id}/resolve`, { reason: 'fixed in 1a2b3c' }), [
        200,
        `${linked.id} [purrlor] resolved. Its notice in the Bug reports room says so too.\n`,
      ]);
      assert.deepEqual(await post(`${linked.id}/resolve`), [200, `${linked.id} is already resolved (by mino).\n`]);
      assert.deepEqual(await post(`${linked.id}/reopen`), [200, `${linked.id} [purrlor] reopened. Its notice in the Bug reports room says so too.\n`]);
      assert.equal((await post('ffffffffffff/resolve'))[0], 404);
      assert.equal((await post('not-an-id/resolve'))[0], 400);
      const audit = (await store.readAudit(10)).map((line) => JSON.parse(line) as Record<string, string>);
      assert.deepEqual(
        audit.map((a) => [a.actor, a.action, a.target, a.result, a.reason]),
        [
          ['mino', 'bugs.resolve', linked.id, 'resolved', 'fixed in 1a2b3c'],
          ['mino', 'bugs.resolve', linked.id, 'already resolved', undefined],
          ['mino', 'bugs.reopen', linked.id, 'reopened', undefined],
        ]
      );
    } finally {
      server.close();
    }
  });
});
