import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Router, type Request, type Response } from 'express';
import { RoomEvent, type MatrixClient } from 'matrix-js-sdk';
import { clientIp } from './clientIp.js';
import { terminalSafe } from './control.js';
import { RateLimiter } from './webhooks.js';

/**
 * Bug reports: someone types `!bug <project> <what's wrong>` in the app (apps/web
 * matrix/bugReport.ts), the app sends it here instead of into the channel, and the service bot
 * passes it on to the server's admins (docs/bug-reports.md).
 *
 * The app catches the command, not the bot: the bot never reads anyone's messages (membership.ts),
 * and it couldn't in an encrypted room anyway. The sender is proven with a Matrix OpenID token, as
 * the online ping is, so a report always names who sent it. Accounts on this server can send one
 * from anywhere; someone from another server only from a Space this server serves that they're in,
 * whose app sends it here rather than to their own server (apps/web matrix/bugReport.ts).
 *
 * Each report is kept twice: one JSON line appended to `bug-reports.jsonl` in the data volume, for
 * `purrlor bugs`, and a notice from the bot in a private "Bug reports" room it makes and invites
 * the admins in BUG_REPORT_ADMINS to. The file is the record; the room is the doorbell, so a
 * report still counts when the room can't be reached.
 *
 * In that room an admin marks a report resolved by tapping the ✅ the bot puts under it, or by
 * replying "fixed" (or "resolved", "done"); replying "reopen", or taking the ✅ back, reopens it.
 * The bot reads that room only, which it made for the admins, and records each change in the same
 * file, so `purrlor bugs` shows what's still open.
 */

/** What `!bug` files under when BUG_PROJECTS isn't set. */
export const DEFAULT_BUG_PROJECTS = ['purrlor'];
export const MAX_BUG_TEXT = 2000;
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const USER_ID = /^@[^:\s]+:[^\s]+$/;
const ROOM_ID = /^![^\s]{1,254}$/;

/** BUG_PROJECTS: names separated by commas or spaces, lower-cased; bad ones are left out. */
export function parseBugProjects(raw: string | undefined): string[] {
  const names = (raw ?? '')
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => PROJECT_NAME.test(name));
  return names.length ? [...new Set(names)] : DEFAULT_BUG_PROJECTS;
}

/** BUG_REPORT_ADMINS: full Matrix IDs separated by commas or spaces. */
export function parseBugAdmins(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\s,]+/).filter((id) => USER_ID.test(id)))];
}

export type BugReport = {
  id: string;
  /** ISO time it arrived. */
  at: string;
  project: string;
  reporter: string;
  text: string;
  /** The app's build, if it knows it. */
  version?: string;
  /** "mobile", "desktop app" or "browser": the app says which, from what it is running in. */
  platform?: string;
  /** The Space it was sent from, when that's one this server serves. */
  space?: string;
  spaceName?: string;
};

/** No control characters but newlines and tabs, nothing a terminal or a notice could act on. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return terminalSafe(value.replace(/\r\n?/g, '\n'))
    .trim()
    .slice(0, max);
}

/** Checks what the app sent. An unknown project names the ones there are. */
export function checkBugReport(
  body: Record<string, unknown>,
  projects: string[]
): { ok: true; report: Pick<BugReport, 'project' | 'text' | 'version' | 'platform'> } | { ok: false; error: string; code: string } {
  const project = cleanText(body.project, 64).toLowerCase();
  if (!projects.includes(project)) {
    return { ok: false, code: 'unknown_project', error: `There's no project called '${project}'. Try one of: ${projects.join(', ')}.` };
  }
  const text = cleanText(body.text, MAX_BUG_TEXT + 1);
  if (!text) return { ok: false, code: 'empty', error: "Say what's wrong after the project's name." };
  if (text.length > MAX_BUG_TEXT) return { ok: false, code: 'too_long', error: `Keep it under ${MAX_BUG_TEXT} characters.` };
  const version = cleanText(body.version, 64) || undefined;
  const platform = cleanText(body.platform, 32) || undefined;
  return { ok: true, report: { project, text, version, platform } };
}

/** The bot's notice to the admins. Plain text only, so nothing in a report is ever read as HTML. */
export function bugNotice(report: BugReport, status?: { resolvedBy?: string; reopenedBy?: string }): string {
  const about = [report.platform, report.version && `version ${report.version}`].filter(Boolean).join(', ');
  const head = status?.resolvedBy ? `✅ Resolved by ${status.resolvedBy} · ` : status?.reopenedBy ? `🔁 Reopened by ${status.reopenedBy} · ` : '🐞 ';
  const where = report.spaceName ? ` in ${report.spaceName}` : '';
  return `${head}Bug report [${report.project}] from ${report.reporter}${about ? ` (${about})` : ''}${where}\n${report.text}`;
}

/** What happened to a report after it arrived, one line each beside the reports themselves. */
export type BugStatusRecord =
  /** The bot's notice for it, so a ✅ or a reply to that notice finds the report. */
  | { kind: 'posted'; id: string; eventId: string }
  /** `cause` is the room event that did it, so one seen again after a restart changes nothing. */
  | { kind: 'resolved'; id: string; by: string; at: string; cause: string; reactionId?: string; note?: string }
  | { kind: 'reopened'; id: string; by: string; at: string; cause: string; note?: string };

/** A report with where it stands now. */
export type TrackedBug = BugReport & {
  status: 'open' | 'resolved';
  eventId?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  /** The ✅ that resolved it: taking it back reopens it. */
  reactionId?: string;
  /** What `purrlor bugs resolve --reason` said about it. */
  note?: string;
};

/** `bug-reports.jsonl`: one report or status change per line, only ever appended to. */
export class BugReportLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  append(record: BugReport | BugStatusRecord): Promise<void> {
    const run = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const handle = await open(this.file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.appendFile(`${JSON.stringify(record)}\n`);
      } finally {
        await handle.close();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Every report as it stands, oldest first, and the room events already acted on. */
  async read(): Promise<{ bugs: TrackedBug[]; causes: Set<string> }> {
    let text = '';
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return { bugs: [], causes: new Set() };
    }
    const bugs = new Map<string, TrackedBug>();
    const causes = new Set<string>();
    for (const line of text.split('\n')) {
      let record: (Partial<BugReport> & { kind?: string; eventId?: string; by?: string; at?: string; cause?: string; reactionId?: string; note?: string }) | null;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!record || typeof record.id !== 'string') continue;
      if (!('kind' in record) && typeof record.project === 'string' && typeof record.text === 'string') {
        bugs.set(record.id, { ...(record as BugReport), status: 'open' });
        continue;
      }
      const bug = bugs.get(record.id);
      if (!bug) continue;
      if (typeof record.cause === 'string') causes.add(record.cause);
      if (record.kind === 'posted' && typeof record.eventId === 'string') bug.eventId = record.eventId;
      if (record.kind === 'resolved') Object.assign(bug, { status: 'resolved', resolvedBy: record.by, resolvedAt: record.at, reactionId: record.reactionId, note: record.note });
      if (record.kind === 'reopened') Object.assign(bug, { status: 'open', resolvedBy: undefined, resolvedAt: undefined, reactionId: undefined, note: undefined });
    }
    return { bugs: [...bugs.values()], causes };
  }

  /** The newest `limit` reports, oldest first, for one project or all of them, open ones only if asked. */
  async recent(limit: number, project?: string, openOnly = false): Promise<TrackedBug[]> {
    const { bugs } = await this.read();
    return bugs.filter((bug) => (!project || bug.project === project) && (!openOnly || bug.status === 'open')).slice(-limit);
  }
}

/** Ticks that count as "resolved". The bot's own goes first, so an admin taps the same one. */
export const RESOLVE_KEYS = ['✅', '✔️', '☑️'];
const RESOLVE_REPLY = /^!?(resolved?|fixed|done|closed?)\b/i;
const REOPEN_REPLY = /^!?(re-?open(ed)?|not fixed|unresolved?)\b/i;

/** An admin's doing in the bug reports room, read off one room event. */
export type BugAction =
  | { kind: 'resolve'; eventId: string; by: string; cause: string; reactionId?: string }
  | { kind: 'reopen'; eventId: string; by: string; cause: string }
  /** A reaction taken back: reopens the report it resolved, if it was that one. */
  | { kind: 'unreact'; reactionId: string; by: string; cause: string };

export type RawRoomEvent = { event_id?: string; type?: string; sender?: string; redacts?: string; content?: Record<string, unknown> };

/** What an event in the bug reports room asks for, if it's from an admin and asks for anything. */
export function bugActionFrom(event: RawRoomEvent, admins: string[]): BugAction | undefined {
  const { event_id: cause, sender: by, content = {} } = event;
  if (!cause || !by || !admins.includes(by)) return undefined;
  const relation = content['m.relates_to'] as { rel_type?: string; event_id?: string; key?: string; 'm.in_reply_to'?: { event_id?: string } } | undefined;
  if (event.type === 'm.reaction') {
    if (relation?.rel_type !== 'm.annotation' || !relation.event_id || !RESOLVE_KEYS.includes(relation.key ?? '')) return undefined;
    return { kind: 'resolve', eventId: relation.event_id, by, cause, reactionId: cause };
  }
  if (event.type === 'm.room.redaction') {
    const reactionId = event.redacts ?? (typeof content.redacts === 'string' ? content.redacts : undefined);
    return reactionId ? { kind: 'unreact', reactionId, by, cause } : undefined;
  }
  if (event.type === 'm.room.message') {
    const target = relation?.['m.in_reply_to']?.event_id;
    if (!target || relation?.rel_type === 'm.replace' || typeof content.body !== 'string') return undefined;
    // Older clients quote what's replied to first, as "> " lines.
    const said = content.body
      .split('\n')
      .filter((line) => !line.startsWith('>'))
      .join('\n')
      .trim();
    if (RESOLVE_REPLY.test(said)) return { kind: 'resolve', eventId: target, by, cause };
    if (REOPEN_REPLY.test(said)) return { kind: 'reopen', eventId: target, by, cause };
  }
  return undefined;
}

/**
 * The admins' "Bug reports" room: made by the bot the first time a report arrives, its ID kept in
 * `bug-room.json` so a restart finds it again. Not encrypted, since the bot has no keys; a report
 * holds only what its sender typed to be read by the admins. Anyone in BUG_REPORT_ADMINS who isn't
 * in it (or left it) is invited with each report; one who wants out is taken off that list.
 */
export class BugRoom {
  private queue: Promise<unknown> = Promise.resolve();
  /** The room's ID once known, for telling its events from every other room's. */
  private roomId: string | undefined;

  constructor(
    private readonly stateFile: string,
    private readonly client: () => Promise<MatrixClient>,
    private readonly admins: string[]
  ) {}

  /** Posts one report, with a ✅ under it to tap; resolves with the notice's event ID. Throws if
   *  there's nobody to send it to or the homeserver says no. */
  deliver(report: BugReport): Promise<string> {
    const run = this.queue.then(() => this.send(report));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Rewrites a notice the bot posted (to say it's resolved, or open again). */
  async edit(eventId: string, body: string): Promise<void> {
    const roomId = this.roomId ?? (await this.storedRoom());
    if (!roomId) return;
    const notice = { msgtype: 'm.notice', body, 'm.mentions': {} };
    await (await this.client()).sendMessage(roomId, {
      ...notice,
      body: `* ${body}`,
      'm.new_content': notice,
      'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
    } as never);
  }

  /** The text of a notice the bot itself posted in the room; undefined for anyone else's event. */
  async noticeText(eventId: string): Promise<string | undefined> {
    const roomId = this.roomId ?? (await this.storedRoom());
    if (!roomId) return undefined;
    const mx = await this.client();
    const event = (await mx.fetchRoomEvent(roomId, eventId)) as RawRoomEvent;
    return event.sender === mx.getUserId() && typeof event.content?.body === 'string' ? event.content.body : undefined;
  }

  /** Calls `onEvent` with each new event in the bug reports room, and nothing from any other room. */
  async watch(onEvent: (event: RawRoomEvent) => void): Promise<void> {
    const mx = await this.client();
    this.roomId ??= await this.storedRoom();
    mx.on(RoomEvent.Timeline, (event, _room, toStartOfTimeline, removed) => {
      // Older history being paged in, or an event taken out again, isn't something new to act on.
      if (toStartOfTimeline || removed || !this.roomId || event.getRoomId() !== this.roomId) return;
      onEvent(event.getEffectiveEvent() as RawRoomEvent);
    });
  }

  private async send(report: BugReport): Promise<string> {
    if (!this.admins.length) throw new Error('BUG_REPORT_ADMINS is empty, so there is nobody to tell');
    const mx = await this.client();
    let roomId = await this.storedRoom();
    // A room the bot is no longer in (deleted, or it was removed) is replaced with a new one.
    if (!roomId || !(await this.stillIn(mx, roomId))) {
      roomId = await this.create(mx);
    }
    this.roomId = roomId;
    await this.inviteMissing(mx, roomId);
    // `m.mentions` present and empty: a report saying "@room" doesn't ping anyone.
    const { event_id: eventId } = await mx.sendMessage(roomId, { msgtype: 'm.notice', body: bugNotice(report), 'm.mentions': {} } as never);
    // The "button": tapping the same reaction is one touch in any Matrix app.
    await mx.sendEvent(roomId, 'm.reaction' as never, { 'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: RESOLVE_KEYS[0] } } as never).catch((err: unknown) => {
      console.warn(`Couldn't put the ✅ under bug report ${report.id}`, err);
    });
    return eventId;
  }

  private async storedRoom(): Promise<string | undefined> {
    try {
      const roomId = (JSON.parse(await readFile(this.stateFile, 'utf8')) as { roomId?: unknown }).roomId;
      return typeof roomId === 'string' && roomId.startsWith('!') ? roomId : undefined;
    } catch {
      return undefined;
    }
  }

  private async stillIn(mx: MatrixClient, roomId: string): Promise<boolean> {
    try {
      const own = (await mx.getStateEvent(roomId, 'm.room.member', mx.getUserId() ?? '')) as { membership?: string };
      return own?.membership === 'join';
    } catch {
      return false;
    }
  }

  private async create(mx: MatrixClient): Promise<string> {
    const { room_id: roomId } = await mx.createRoom({
      name: 'Bug reports',
      topic: 'Bug reports sent with !bug in Purrlor. Also listed by `sudo purrlor bugs` on the server.',
      preset: 'private_chat' as never,
      invite: this.admins,
    });
    await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temp = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify({ roomId })}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temp, this.stateFile);
    return roomId;
  }

  private async inviteMissing(mx: MatrixClient, roomId: string): Promise<void> {
    for (const admin of this.admins) {
      let membership: string | undefined;
      try {
        membership = ((await mx.getStateEvent(roomId, 'm.room.member', admin)) as { membership?: string })?.membership;
      } catch {
        // No member event: never invited.
      }
      if (membership === 'join' || membership === 'invite' || membership === 'ban') continue;
      await mx.invite(roomId, admin).catch((err: unknown) => console.warn(`Couldn't invite ${admin} to the bug reports room`, err));
    }
  }
}

/** The report a change made, or undefined if it already stood that way. */
const changed = (result: { bug: TrackedBug; changed: boolean }): TrackedBug | undefined => (result.changed ? result.bug : undefined);

/** What BugDesk needs of the room: rewriting a notice, and reading one the log doesn't know. */
export type BugDeskRoom = {
  edit(eventId: string, body: string): Promise<void>;
  /** The text of a notice the bot posted in the room, or undefined for anything else. */
  noticeText(eventId: string): Promise<string | undefined>;
};

type BugChange = { kind: 'resolve' | 'reopen'; by: string; cause: string; reactionId?: string; note?: string };

/**
 * Applies admins' ✅s and replies, and `purrlor bugs resolve`/`reopen`, to the log and the notices.
 * One at a time, and each room event only once (its ID is kept with the change), so seeing the
 * room's history again after a restart changes nothing.
 */
export class BugDesk {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: BugReportLog,
    private readonly room: BugDeskRoom,
    private readonly admins: string[],
    private readonly now: () => Date = () => new Date()
  ) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Handles one event from the bug reports room; resolves with the report it changed, if any. */
  handle(event: RawRoomEvent): Promise<TrackedBug | undefined> {
    const action = bugActionFrom(event, this.admins);
    if (!action) return Promise.resolve(undefined);
    return this.serial(async () => {
      const { bugs, causes } = await this.log.read();
      if (causes.has(action.cause)) return undefined;
      if (action.kind === 'unreact') {
        const bug = bugs.find((b) => b.status === 'resolved' && b.reactionId === action.reactionId);
        return bug && changed(await this.change(bug, { kind: 'reopen', by: action.by, cause: action.cause }));
      }
      const bug = bugs.find((b) => b.eventId === action.eventId) ?? (await this.linkOlder(bugs, action.eventId));
      return bug && changed(await this.change(bug, action));
    });
  }

  /**
   * `purrlor bugs resolve <id>` / `reopen <id>`: by the server's admin, so no ✅ is needed and it
   * works for a report the room never had one for. `changed` is false if it already was.
   */
  set(id: string, kind: 'resolve' | 'reopen', by: string, note?: string): Promise<{ bug?: TrackedBug; changed: boolean; edited: boolean }> {
    return this.serial(async () => {
      const bug = (await this.log.read()).bugs.find((b) => b.id === id);
      if (!bug) return { changed: false, edited: false };
      return this.change(bug, { kind, by, note, cause: `cli-${randomBytes(6).toString('hex')}` });
    });
  }

  /**
   * A report posted before its notice's event ID was kept (before ✅s existed): found by its
   * notice's text, which is exactly what bugNotice made of it, and linked from now on.
   */
  private async linkOlder(bugs: TrackedBug[], eventId: string): Promise<TrackedBug | undefined> {
    const text = await this.room.noticeText(eventId).catch(() => undefined);
    const bug = text ? bugs.find((b) => !b.eventId && bugNotice(b) === text) : undefined;
    if (!bug) return undefined;
    await this.log.append({ kind: 'posted', id: bug.id, eventId });
    bug.eventId = eventId;
    return bug;
  }

  private async change(bug: TrackedBug, change: BugChange): Promise<{ bug: TrackedBug; changed: boolean; edited: boolean }> {
    const resolving = change.kind === 'resolve';
    if ((bug.status === 'resolved') === resolving) return { bug, changed: false, edited: false };
    const at = this.now().toISOString();
    const { by, cause, note } = change;
    await this.log.append(
      resolving ? { kind: 'resolved', id: bug.id, by, at, cause, reactionId: change.reactionId, note } : { kind: 'reopened', id: bug.id, by, at, cause, note }
    );
    const updated: TrackedBug = resolving
      ? { ...bug, status: 'resolved', resolvedBy: by, resolvedAt: at, reactionId: change.reactionId, note }
      : { ...bug, status: 'open', resolvedBy: undefined, resolvedAt: undefined, reactionId: undefined, note: undefined };
    // The log is the record: a notice that can't be edited (the room's gone) leaves it right.
    let edited = false;
    if (bug.eventId) {
      const shown = note ? `${by}: ${note}` : by;
      edited = await this.room
        .edit(bug.eventId, bugNotice(bug, resolving ? { resolvedBy: shown } : { reopenedBy: shown }))
        .then(() => true)
        .catch((err: unknown) => (console.warn(`Couldn't edit the notice for bug report ${bug.id}`, err), false));
    }
    return { bug: updated, changed: true, edited };
  }
}

export type BugReportDeps = {
  projects: string[];
  log: BugReportLog;
  /** Who sent it, from their OpenID token; throws if it doesn't check out. */
  caller(openIdToken: unknown): Promise<string>;
  /** This server's name, so an app elsewhere can tell it reached the server it meant to. */
  serverName(): Promise<string>;
  /** Whether that account is on this server. */
  isLocal(userId: string): Promise<boolean>;
  /** A Space this server serves that the account is in, with its name; undefined otherwise. */
  spaceOf(userId: string, spaceId: string): Promise<{ name?: string } | undefined>;
  /** Tells the admins, resolving with the notice's event ID; a failure here is logged, and the report is kept anyway. */
  deliver(report: BugReport): Promise<string | undefined>;
  now?(): Date;
};

// Per account: five at once, then one every two minutes. Per address on top, for many accounts at once.
const accountLimiter = new RateLimiter(5, 0.5);
const addressLimiter = new RateLimiter(20, 5);

/**
 *   GET  /api/public/bugs   { projects, serverName } — what `!bug` can file under, and whose this is
 *   POST /api/public/bugs   { openid_token, project, text, version?, platform?, space_id? } → { id, project, delivered }
 *
 * Someone from another server must give `space_id`, a Space served here that they're in: that's
 * the only reason this server's admins would want their report, and it keeps the federation at
 * large from filing here. Open to any page (corsPolicy.ts), since their app is at another address.
 */
export function bugReportsRouter(deps: BugReportDeps, limits = { account: accountLimiter, address: addressLimiter }): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const serverName = await deps.serverName().catch(() => undefined);
    res.set('Cache-Control', 'no-store').json({ projects: deps.projects, ...(serverName && { serverName }) });
  });

  router.post('/', async (req: Request, res: Response) => {
    if (!limits.address.take(clientIp(req))) return void res.status(429).json({ error: 'Too many bug reports; try again in a few minutes', code: 'rate_limited' });
    const body = (typeof req.body === 'object' && req.body) || {};
    let reporter: string;
    try {
      reporter = await deps.caller(body.openid_token);
    } catch {
      return void res.status(401).json({ error: 'Authentication failed' });
    }
    const spaceId = typeof body.space_id === 'string' && ROOM_ID.test(body.space_id) ? body.space_id : undefined;
    const space = spaceId ? await deps.spaceOf(reporter, spaceId).catch(() => undefined) : undefined;
    const local = await deps.isLocal(reporter);
    if (!local && !space) {
      return void res.status(403).json({ error: 'Only accounts on this server, or members of its Spaces, can send bug reports here', code: 'not_local' });
    }
    const checked = checkBugReport(body, deps.projects);
    if (!checked.ok) return void res.status(400).json({ error: checked.error, code: checked.code, projects: deps.projects });
    if (!limits.account.take(reporter)) return void res.status(429).json({ error: 'Too many bug reports; try again in a few minutes', code: 'rate_limited' });

    const report: BugReport = {
      id: randomBytes(6).toString('hex'),
      at: (deps.now?.() ?? new Date()).toISOString(),
      reporter,
      ...checked.report,
      space: space ? spaceId : undefined,
      spaceName: space?.name ? cleanText(space.name.replace(/\s+/g, ' '), 100) || undefined : undefined,
    };
    try {
      await deps.log.append(report);
    } catch (err) {
      console.error('Bug report not saved', err);
      return void res.status(500).json({ error: "The bug report couldn't be saved" });
    }
    let delivered = true;
    try {
      const eventId = await deps.deliver(report);
      if (eventId) await deps.log.append({ kind: 'posted', id: report.id, eventId });
    } catch (err) {
      delivered = false;
      console.warn(`Bug report ${report.id} saved but not posted to the admins: ${(err as Error).message}`);
    }
    res.json({ id: report.id, project: report.project, delivered });
  });

  return router;
}
