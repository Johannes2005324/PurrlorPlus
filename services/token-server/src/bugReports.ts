import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { MatrixClient } from 'matrix-js-sdk';
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
 * the online ping is, so a report always names who sent it and only accounts on this server can.
 *
 * Each report is kept twice: one JSON line appended to `bug-reports.jsonl` in the data volume, for
 * `purrlor bugs`, and a notice from the bot in a private "Bug reports" room it makes and invites
 * the admins in BUG_REPORT_ADMINS to. The file is the record; the room is the doorbell, so a
 * report still counts when the room can't be reached.
 */

/** What `!bug` files under when BUG_PROJECTS isn't set. */
export const DEFAULT_BUG_PROJECTS = ['purrlor'];
export const MAX_BUG_TEXT = 2000;
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const USER_ID = /^@[^:\s]+:[^\s]+$/;

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
export function bugNotice(report: BugReport): string {
  const about = [report.platform, report.version && `version ${report.version}`].filter(Boolean).join(', ');
  return `🐞 Bug report [${report.project}] from ${report.reporter}${about ? ` (${about})` : ''}\n${report.text}`;
}

/** `bug-reports.jsonl`: one report per line, only ever appended to. */
export class BugReportLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  append(report: BugReport): Promise<void> {
    const run = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const handle = await open(this.file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.appendFile(`${JSON.stringify(report)}\n`);
      } finally {
        await handle.close();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The newest `limit` reports, oldest first, for one project or all of them. */
  async recent(limit: number, project?: string): Promise<BugReport[]> {
    let text = '';
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const reports = text.split('\n').flatMap((line) => {
      try {
        const report = JSON.parse(line) as BugReport;
        return typeof report?.project === 'string' && typeof report.text === 'string' ? [report] : [];
      } catch {
        return [];
      }
    });
    return reports.filter((report) => !project || report.project === project).slice(-limit);
  }
}

/**
 * The admins' "Bug reports" room: made by the bot the first time a report arrives, its ID kept in
 * `bug-room.json` so a restart finds it again. Not encrypted, since the bot has no keys; a report
 * holds only what its sender typed to be read by the admins. Anyone in BUG_REPORT_ADMINS who isn't
 * in it (or left it) is invited with each report; one who wants out is taken off that list.
 */
export class BugRoom {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly stateFile: string,
    private readonly client: () => Promise<MatrixClient>,
    private readonly admins: string[]
  ) {}

  /** Posts one report. Throws if there's nobody to send it to or the homeserver says no. */
  deliver(report: BugReport): Promise<void> {
    const run = this.queue.then(() => this.send(report));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(report: BugReport): Promise<void> {
    if (!this.admins.length) throw new Error('BUG_REPORT_ADMINS is empty, so there is nobody to tell');
    const mx = await this.client();
    let roomId = await this.storedRoom();
    // A room the bot is no longer in (deleted, or it was removed) is replaced with a new one.
    if (!roomId || !(await this.stillIn(mx, roomId))) {
      roomId = await this.create(mx);
    }
    await this.inviteMissing(mx, roomId);
    // `m.mentions` present and empty: a report saying "@room" doesn't ping anyone.
    await mx.sendMessage(roomId, { msgtype: 'm.notice', body: bugNotice(report), 'm.mentions': {} } as never);
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

export type BugReportDeps = {
  projects: string[];
  log: BugReportLog;
  /** Who sent it, from their OpenID token; throws if it doesn't check out. */
  caller(openIdToken: unknown): Promise<string>;
  /** Whether that account is on this server. */
  isLocal(userId: string): Promise<boolean>;
  /** Tells the admins; a failure here is logged, and the report is kept anyway. */
  deliver(report: BugReport): Promise<void>;
  now?(): Date;
};

// Per account: five at once, then one every two minutes. Per address on top, for many accounts at once.
const accountLimiter = new RateLimiter(5, 0.5);
const addressLimiter = new RateLimiter(20, 5);

/**
 *   GET  /api/public/bugs   { projects } — what `!bug` can file under
 *   POST /api/public/bugs   { openid_token, project, text, version?, platform? } → { id, project, delivered }
 */
export function bugReportsRouter(deps: BugReportDeps, limits = { account: accountLimiter, address: addressLimiter }): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ projects: deps.projects });
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
    if (!(await deps.isLocal(reporter))) return void res.status(403).json({ error: 'Only accounts on this server can send bug reports here', code: 'not_local' });
    const checked = checkBugReport(body, deps.projects);
    if (!checked.ok) return void res.status(400).json({ error: checked.error, code: checked.code, projects: deps.projects });
    if (!limits.account.take(reporter)) return void res.status(429).json({ error: 'Too many bug reports; try again in a few minutes', code: 'rate_limited' });

    const report: BugReport = {
      id: randomBytes(6).toString('hex'),
      at: (deps.now?.() ?? new Date()).toISOString(),
      reporter,
      ...checked.report,
    };
    try {
      await deps.log.append(report);
    } catch (err) {
      console.error('Bug report not saved', err);
      return void res.status(500).json({ error: "The bug report couldn't be saved" });
    }
    let delivered = true;
    try {
      await deps.deliver(report);
    } catch (err) {
      delivered = false;
      console.warn(`Bug report ${report.id} saved but not posted to the admins: ${(err as Error).message}`);
    }
    res.json({ id: report.id, project: report.project, delivered });
  });

  return router;
}
