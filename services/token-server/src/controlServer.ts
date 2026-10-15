import { chmod, lstat, mkdir, readdir, unlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { basename, dirname } from 'node:path';
import express, { type Request, type Response } from 'express';
import { mediaDeleteCommand, withAdminSession, type AdminCredentials, type AdminSession } from './adminRoom.js';
import type { AdminStore } from './adminStore.js';
import type { BugReportLog } from './bugReports.js';
import {
  cleanActor,
  cleanReason,
  countRegisteredPeople,
  deletionSucceeded,
  parseMediaTarget,
  parseReportNotice,
  queueDeletions,
  terminalSafe,
  type Report,
} from './control.js';
import { REAL_IP_FROM } from './clientIp.js';
import { diagnose, ipWatch, MAX_WATCH_SECONDS, type IpWatch } from './ipWatch.js';
import { isMxc, pageMedia, PROFILE_PAGE_EVENT, type RawEvent } from './publicWeb.js';
import { knownUserId, normalizePeerUrl, parseInstanceInfo, type Peer } from './peers.js';

/**
 * The admin control channel: an HTTP API on a Unix socket, for the `purrlor` command on the host
 * (docs/admin-control.md). It is never on a network: no port, nothing nginx could proxy. The
 * socket's directory and the socket itself belong to root and nobody else may open them, so being
 * able to connect at all is the authentication, the same trust as root on the host already has
 * over the whole install. There's no password or token to leak.
 *
 * Everything that changes something needs a reason, and every action is appended to the audit log
 * with the sudo user who ran it.
 */

export type PageState = {
  /** The person has a profile room this service can read. */
  profileRoom: boolean;
  /** Their own switch: show my page to people who aren't signed in. */
  optedIn: boolean;
  /** They've published a page (as opposed to a plain profile). */
  hasPage: boolean;
  /** The stored page and its event ID, for album takedowns and telling reports apart. */
  content?: Record<string, unknown>;
  pageEventId?: string;
};

export type ControlDeps = {
  store: AdminStore;
  serverName(): Promise<string>;
  /** Where the token server reaches the homeserver (MATRIX_HOMESERVER_URL), for the admin room. */
  homeserverUrl(): string;
  pageState(userId: string): Promise<PageState>;
  /** Every file the public web serves for this person now: posts, page, avatar, banner. */
  publicMediaOf(userId: string): Promise<string[]>;
  profileRoomOwner(roomId: string): Promise<string | undefined>;
  /** Drops the local copy of a file (the media route's cache) at once. */
  forgetCopy(mxc: string): Promise<void>;
  adminSession?: <T>(credentials: AdminCredentials, fn: (session: AdminSession) => Promise<T>) => Promise<T>;
  /** `purrlor ips`: the watch and REAL_IP_FROM (the service's own unless a test gives them). */
  ipWatch?: IpWatch;
  realIpFrom?: Set<string>;
  /** Counts for `purrlor stats`: totals only, never who. */
  counts?(): Promise<{ online: number; publicPages: number; profiles: number; serviceAccounts: string[] }>;
  /** Approved peers' server names: their people can be hidden and taken down here too. */
  peerServers?(): Promise<Set<string>>;
  /** Peering (peering.ts): what `purrlor peers` drives. */
  peering?: PeeringDeps;
  /** Bug reports sent with `!bug` (bugReports.ts): what `purrlor bugs` reads. */
  bugs?: BugReportLog;
};

export type PeeringDeps = {
  /** Asks an instance's GET /api/public/instance. */
  fetchInstance(url: string): Promise<unknown>;
  /** One sync pass over one peer; resolves with what the bot is in afterwards. */
  sync(peer: Peer): Promise<{ profiles: number; spaces: number; feeds: number; lastError?: string }>;
  /** Leaves every room of that server; resolves with how many. */
  leave(serverName: string): Promise<number>;
  status(serverName: string): { lastSync?: string; lastError?: string; profiles: number; spaces: number; feeds: number } | undefined;
};

class ControlError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Plain text for the command line, JSON for anything that asks for it. */
function reply(req: Request, res: Response, status: number, message: string, data: Record<string, unknown> = {}): void {
  if ((req.get('accept') ?? '').includes('application/json')) {
    res.status(status).json({ ok: status < 400, message, ...data });
  } else {
    const text = terminalSafe(message);
    res.status(status).type('text/plain').send(text.endsWith('\n') ? text : `${text}\n`);
  }
}

/** A field that may be given once or repeated (`target=a&target=b`). */
function many(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.filter((item): item is string => typeof item === 'string').slice(0, 500);
}

function one(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function needReason(body: Record<string, unknown>): string {
  const reason = cleanReason(body.reason);
  if (!reason) throw new ControlError(400, 'This needs a reason (reason=…): it goes in the audit log.');
  return reason;
}

function credentials(body: Record<string, unknown>): AdminCredentials {
  const user = one(body.adminUser)?.trim();
  const password = one(body.adminPassword);
  if (!user || !password) throw new ControlError(400, "This needs the homeserver admin's account and password (adminUser=…, adminPassword=…).");
  return { user, password };
}

function formatTime(ts: number | string): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? '?' : date.toISOString().replace('T', ' ').slice(0, 16);
}

/** Art or music albums, and gallery or music blocks, on a page matching `name` (an ID or a title, any case). */
export function albumMedia(content: Record<string, unknown> | undefined, name: string): { label: string; urls: string[] }[] {
  const wanted = name.trim().toLowerCase();
  if (!content || !wanted || !Array.isArray(content.blocks)) return [];
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  const matches = (item: Record<string, unknown>) =>
    (typeof item.id === 'string' && item.id.toLowerCase() === wanted) || (typeof item.title === 'string' && item.title.trim().toLowerCase() === wanted);
  const found: { label: string; urls: string[] }[] = [];
  for (const block of content.blocks.filter(isRecord)) {
    if ((block.type === 'art' || block.type === 'gallery') && Array.isArray(block.albums)) {
      for (const album of block.albums.filter(isRecord)) {
        if (!matches(album)) continue;
        const urls = pageMedia({ blocks: [{ type: 'gallery', albums: [album] }] }, { includeMature: true });
        found.push({ label: `album "${String(album.title ?? album.id)}"`, urls: [...urls] });
      }
    } else if (block.type === 'music' && Array.isArray(block.albums) && !matches(block)) {
      for (const album of block.albums.filter(isRecord)) {
        if (!matches(album)) continue;
        const urls = pageMedia({ blocks: [{ type: 'music', albums: [album] }] });
        found.push({ label: `album "${String(album.title ?? album.id)}"`, urls: [...urls] });
      }
    } else if ((block.type === 'gallery' || block.type === 'music') && matches(block)) {
      found.push({ label: `${block.type} "${String(block.title ?? block.id)}"`, urls: [...pageMedia({ blocks: [block] }, { includeMature: true })] });
    }
  }
  return found.filter((match) => match.urls.length > 0);
}

export function controlApp(deps: ControlDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));
  const session = deps.adminSession ?? (async (creds, fn) => withAdminSession(deps.homeserverUrl(), await deps.serverName(), creds, fn));

  type Handler = (req: Request, res: Response, actor: string, body: Record<string, unknown>) => Promise<void>;
  const route = (handler: Handler) => async (req: Request, res: Response) => {
    const body = (typeof req.body === 'object' && req.body) || {};
    const actor = cleanActor(one(body.actor) ?? one(req.query.actor));
    try {
      await handler(req, res, actor, body);
    } catch (err) {
      if (err instanceof ControlError) return reply(req, res, err.status, err.message);
      console.error('Control action failed', err);
      reply(req, res, 500, `That failed: ${(err as Error).message}`);
    }
  };

  const userOf = async (raw: string): Promise<string> => {
    const userId = knownUserId(raw, await deps.serverName(), (await deps.peerServers?.()) ?? new Set());
    if (!userId) throw new ControlError(400, `'${raw}' isn't a user name on this server or a peer's.`);
    return userId;
  };

  app.get('/health', (req, res) => reply(req, res, 200, 'ok'));

  // --- Pages ------------------------------------------------------------------------------------

  app.get(
    '/pages',
    route(async (req, res) => {
      const lists = await deps.store.lists();
      const hidden = [...lists.hidden].sort();
      const publicOff = [...lists.publicOff].sort();
      const text = [
        hidden.length ? `Hidden (page and public posts):\n${hidden.map((id) => `  ${id}`).join('\n')}` : 'No pages are hidden.',
        publicOff.length ? `Public page switched off by an admin:\n${publicOff.map((id) => `  ${id}`).join('\n')}` : 'No public pages are switched off.',
      ].join('\n');
      reply(req, res, 200, text, { hidden, publicOff });
    })
  );

  app.get(
    '/pages/:user',
    route(async (req, res) => {
      const userId = await userOf(req.params.user);
      const [state, lists] = await Promise.all([deps.pageState(userId), deps.store.lists()]);
      const hidden = lists.hidden.has(userId);
      const publicOff = lists.publicOff.has(userId);
      const publicNow = state.profileRoom && state.optedIn && !hidden && !publicOff;
      const lines = [
        userId,
        `  profile room:       ${state.profileRoom ? 'yes' : 'none (they have never posted or built a page)'}`,
        `  page built:         ${state.hasPage ? 'yes' : 'no'}`,
        `  their public switch: ${state.optedIn ? 'on' : 'off'}`,
        `  hidden by an admin: ${hidden ? 'yes' : 'no'}`,
        `  switched off by an admin: ${publicOff ? 'yes' : 'no'}`,
        `  signed-out visitors see the page: ${publicNow ? 'yes' : 'no'}`,
      ];
      reply(req, res, 200, lines.join('\n'), { userId, ...state, content: undefined, hidden, publicOff, public: publicNow });
    })
  );

  const pageAction = (action: 'hide' | 'unhide' | 'public-off' | 'public-on') =>
    route(async (req, res, actor, body) => {
      const userId = await userOf(req.params.user);
      const destructive = action === 'hide' || action === 'public-off';
      const reason = destructive ? needReason(body) : cleanReason(body.reason);
      const list = action === 'hide' || action === 'unhide' ? 'hidden' : 'publicOff';
      const [changed] = await deps.store.update(list, [userId], destructive);
      await deps.store.audit({ actor, action: `pages.${action}`, target: userId, reason, result: changed ? 'ok' : 'no change' });
      const messages = {
        hide: changed ? `Hidden: ${userId}. Their page and public posts are gone for signed-out visitors now.` : `${userId} was already hidden.`,
        unhide: changed ? `Shown again: ${userId}.` : `${userId} wasn't hidden.`,
        'public-off': changed
          ? `${userId}'s page is off the public web now, whatever their own switch says. Their Global posts stay public.`
          : `${userId}'s public page was already switched off.`,
        'public-on': changed ? `${userId}'s own switch decides again whether their page is public.` : `${userId}'s public page wasn't switched off.`,
      };
      reply(req, res, 200, messages[action], { userId, changed });
    });

  app.post('/pages/:user/hide', pageAction('hide'));
  app.post('/pages/:user/unhide', pageAction('unhide'));
  app.post('/pages/:user/public-off', pageAction('public-off'));
  app.post('/pages/:user/public-on', pageAction('public-on'));

  // --- Takedowns --------------------------------------------------------------------------------

  /** Blocks files on the public route now, drops their local copies, and queues their deletion. */
  const takeDown = async (mxcs: string[], actor: string, reason: string, action: string, target: string) => {
    const unique = [...new Set(mxcs.filter(isMxc))];
    const changed = await deps.store.update('blockedMedia', unique, true);
    await Promise.all(unique.map((mxc) => deps.forgetCopy(mxc)));
    const queued = await deps.store.updateDeletions((entries) => queueDeletions(entries, unique, actor, reason, new Date().toISOString()));
    await deps.store.audit({ actor, action, target: `${target}${unique.length ? ` (${unique.join(' ')})` : ''}`, reason, result: 'ok' });
    return { files: unique, newlyBlocked: unique.filter((_, index) => changed[index]), queued };
  };

  const takedownText = (what: string, result: { files: string[]; newlyBlocked: string[]; queued: string[] }) =>
    [
      `Blocked ${result.files.length} file(s) from ${what} on the public web, effective now${result.files.length > result.newlyBlocked.length ? ` (${result.files.length - result.newlyBlocked.length} already were)` : ''}:`,
      ...result.files.map((mxc) => `  ${mxc}`),
      result.queued.length
        ? `${result.queued.length} queued for deletion from the homeserver. To delete them: purrlor takedown delete`
        : 'Nothing new to delete from the homeserver.',
    ].join('\n');

  app.post(
    '/takedown/media',
    route(async (req, res, actor, body) => {
      const targets = many(body.target);
      const reason = needReason(body);
      const mxcs = targets.map(parseMediaTarget);
      const unknown = targets.filter((_, index) => !mxcs[index]);
      if (targets.length === 0 || unknown.length > 0) {
        throw new ControlError(400, `Give each file as an mxc:// URL or its link (target=…).${unknown.length ? ` Not a file: ${unknown.join(', ')}` : ''}`);
      }
      const result = await takeDown(mxcs as string[], actor, reason, 'takedown.media', 'files');
      reply(req, res, 200, takedownText('the list', result), result);
    })
  );

  app.post(
    '/takedown/user/:user',
    route(async (req, res, actor, body) => {
      const userId = await userOf(req.params.user);
      const reason = needReason(body);
      const files = await deps.publicMediaOf(userId);
      if (files.length === 0) {
        await deps.store.audit({ actor, action: 'takedown.user', target: userId, reason, result: 'nothing public' });
        return reply(req, res, 200, `${userId} has no files on the public web right now.`, { files: [] });
      }
      const result = await takeDown(files, actor, reason, 'takedown.user', userId);
      reply(
        req,
        res,
        200,
        `${takedownText(`everything ${userId} has made public`, result)}\nTheir page and posts are still up; to hide those too: purrlor pages hide ${userId}`,
        result
      );
    })
  );

  app.post(
    '/takedown/album/:user',
    route(async (req, res, actor, body) => {
      const userId = await userOf(req.params.user);
      const name = one(body.album) ?? '';
      const reason = needReason(body);
      const state = await deps.pageState(userId);
      const found = albumMedia(state.content, name);
      if (found.length === 0) throw new ControlError(404, `${userId}'s page has no album, gallery or music block called "${cleanReason(name)}".`);
      const label = found.map((match) => match.label).join(', ');
      const result = await takeDown(
        found.flatMap((match) => match.urls),
        actor,
        reason,
        'takedown.album',
        `${userId} ${label}`
      );
      reply(req, res, 200, takedownText(`${userId}'s ${label}`, result), result);
    })
  );

  app.post(
    '/media/unblock',
    route(async (req, res, actor, body) => {
      const targets = many(body.target);
      const parsed = targets.map(parseMediaTarget);
      const unknown = targets.filter((_, index) => !parsed[index]);
      // As with a takedown: one target it can't read and nothing changes, rather than a partial undo.
      if (targets.length === 0 || unknown.length > 0) {
        throw new ControlError(400, `Give each file as an mxc:// URL or its link (target=…).${unknown.length ? ` Not a file: ${unknown.join(', ')}` : ''}`);
      }
      const mxcs = parsed as string[];
      const reason = needReason(body);
      const deleted = new Set((await deps.store.deletions()).filter((entry) => entry.status === 'deleted').map((entry) => entry.mxc));
      const changed = await deps.store.update('blockedMedia', mxcs, false);
      // Nothing to delete any more: out of the queue, unless the homeserver already did it.
      await deps.store.updateDeletions((entries) => ({ entries: entries.filter((entry) => entry.status === 'deleted' || !mxcs.includes(entry.mxc)), result: undefined }));
      await deps.store.audit({ actor, action: 'media.unblock', target: mxcs.join(' '), reason, result: 'ok' });
      const lines = mxcs.map((mxc, index) =>
        deleted.has(mxc) ? `  ${mxc}: unblocked, but it was deleted from the homeserver already` : `  ${mxc}: ${changed[index] ? 'unblocked' : "wasn't blocked"}`
      );
      reply(req, res, 200, ['The public media route serves these again where a public page or post names them:', ...lines].join('\n'), { files: mxcs });
    })
  );

  app.get(
    '/media',
    route(async (req, res) => {
      const [lists, deletions] = await Promise.all([deps.store.lists(), deps.store.deletions()]);
      const blocked = [...lists.blockedMedia].sort();
      const status = new Map(deletions.map((entry) => [entry.mxc, entry]));
      const lines = blocked.length
        ? [
            `Blocked on the public web (${blocked.length}):`,
            ...blocked.map((mxc) => {
              const entry = status.get(mxc);
              const state = !entry ? '' : entry.status === 'deleted' ? '  deleted from the homeserver' : entry.status === 'failed' ? `  deletion failed: ${entry.note ?? '?'}` : '  queued for deletion';
              return `  ${mxc}${state}`;
            }),
          ]
        : ['No files are blocked.'];
      reply(req, res, 200, lines.join('\n'), { blocked, deletions });
    })
  );

  app.post(
    '/deletions/run',
    route(async (req, res, actor, body) => {
      const creds = credentials(body);
      const pending = (await deps.store.deletions()).filter((entry) => entry.status !== 'deleted');
      if (pending.length === 0) return reply(req, res, 200, 'Nothing is waiting to be deleted from the homeserver.', { results: [] });
      const results: { mxc: string; deleted: boolean; note?: string }[] = [];
      try {
        await session(creds, async (admin) => {
          for (const entry of pending) {
            try {
              const answer = await admin.command(mediaDeleteCommand(entry.mxc));
              results.push({ mxc: entry.mxc, deleted: deletionSucceeded(answer), ...(!deletionSucceeded(answer) && { note: cleanReason(answer) }) });
            } catch (err) {
              results.push({ mxc: entry.mxc, deleted: false, note: (err as Error).message });
            }
          }
        });
      } catch (err) {
        await deps.store.audit({ actor, action: 'deletions.run', target: `${pending.length} file(s)`, result: `failed: ${(err as Error).message}` });
        throw new ControlError(502, (err as Error).message);
      }
      const now = new Date().toISOString();
      await deps.store.updateDeletions((entries) => ({
        entries: entries.map((entry) => {
          const result = results.find((item) => item.mxc === entry.mxc);
          if (!result) return entry;
          return { ...entry, status: result.deleted ? 'deleted' : 'failed', doneAt: now, ...(result.note ? { note: result.note } : {}) };
        }),
        result: undefined,
      }));
      for (const result of results) {
        await deps.store.audit({ actor, action: 'deletions.delete', target: result.mxc, result: result.deleted ? 'ok' : `failed: ${result.note ?? '?'}` });
      }
      const failed = results.filter((result) => !result.deleted);
      const text = [
        `Deleted ${results.length - failed.length} of ${results.length} file(s) from the homeserver.`,
        ...failed.map((result) => `  not deleted: ${result.mxc}: ${result.note ?? '?'}`),
        ...(failed.length ? ['They stay blocked on the public web; run it again to retry.'] : []),
      ].join('\n');
      reply(req, res, failed.length ? 207 : 200, text, { results });
    })
  );

  // --- What addresses the token server sees -----------------------------------------------------

  // Records for a while (only then: ipWatch.ts), then says what came through each hop and what it
  // means. The addresses go to the admin's terminal and aren't kept; the audit log notes the watch.
  app.post(
    '/ips/watch',
    route(async (req, res, actor, body) => {
      const seconds = Math.min(Math.max(Number(one(body.seconds)) || 60, 1), MAX_WATCH_SECONDS);
      const watch = deps.ipWatch ?? ipWatch;
      const realIpFrom = deps.realIpFrom ?? REAL_IP_FROM;
      const seen = await watch.watch(seconds);
      await deps.store.audit({ actor, action: 'ips.watch', target: `${seconds}s`, result: `ok (${seen.length} distinct)` });
      const time = (ts: number) => new Date(ts).toISOString().slice(11, 19);
      const rows = seen.map((s) =>
        [
          `${s.decided}  (${s.requests} request${s.requests === 1 ? '' : 's'}, last ${time(s.lastSeen)})`,
          `    connected from  ${s.peer}${realIpFrom.has(s.peer) ? '  (REAL_IP_FROM)' : ''}`,
          `    X-Real-IP       ${s.realIp ?? '-'}`,
          `    X-Forwarded-For ${s.forwardedFor ?? '-'}`,
        ].join('\n')
      );
      const text = [
        `What the token server saw in ${seconds}s, by the address it counted (the one its rate limits use):`,
        `REAL_IP_FROM: ${realIpFrom.size ? [...realIpFrom].join(', ') : '(not set)'}`,
        '',
        ...(rows.length ? rows : ['(nothing)']),
        '',
        ...diagnose(seen, realIpFrom),
        '',
        'Recorded only while watching, in memory; not kept.',
      ].join('\n');
      reply(req, res, 200, text, { seconds, seen });
    })
  );

  // --- Stats ------------------------------------------------------------------------------------

  // How many people have accounts (from the homeserver, so it needs its admin), have the app open,
  // and show a page to everyone. Totals only: nothing here names anyone.
  app.post(
    '/stats',
    route(async (req, res, actor, body) => {
      const creds = credentials(body);
      const counts = (await deps.counts?.()) ?? { online: 0, publicPages: 0, profiles: 0, serviceAccounts: [] };
      let registered: number | undefined;
      try {
        registered = await session(creds, async (admin) => countRegisteredPeople(await admin.command('users list-users'), counts.serviceAccounts));
      } catch (err) {
        await deps.store.audit({ actor, action: 'stats', result: `failed: ${(err as Error).message}` });
        throw new ControlError(502, (err as Error).message);
      }
      await deps.store.audit({ actor, action: 'stats', result: 'ok' });
      const text = [
        `Registered accounts:     ${registered ?? '? (the homeserver gave an answer this can’t read)'}`,
        `Online now:              ${counts.online}   (the app open in the last few minutes)`,
        `With a profile feed:     ${counts.profiles}   (posted to Global or made a page)`,
        `Page shown to everyone:  ${counts.publicPages}`,
        '',
        'Accounts don’t include the server’s own or the service bot. Totals only: nothing is kept about who.',
      ].join('\n');
      const { serviceAccounts: _bots, ...totals } = counts;
      reply(req, res, 200, text, { registered: registered ?? null, ...totals });
    })
  );

  // --- Reports ----------------------------------------------------------------------------------

  app.post(
    '/reports',
    route(async (req, res, actor, body) => {
      const creds = credentials(body);
      const limit = Math.min(Math.max(Number(one(body.limit) ?? body.limit) || 300, 1), 2000);
      const pagesOnly = one(body.only) === 'pages';
      const serverName = await deps.serverName();
      let reports: Report[];
      try {
        reports = await session(creds, async (admin) =>
          (await admin.messages(limit)).map((event) => parseReportNotice(event, serverName)).filter((report): report is Report => !!report)
        );
      } catch (err) {
        await deps.store.audit({ actor, action: 'reports.list', result: `failed: ${(err as Error).message}` });
        throw new ControlError(502, (err as Error).message);
      }
      await deps.store.audit({ actor, action: 'reports.list', result: `ok (${reports.length})` });

      const described = await Promise.all(
        reports.map(async (report) => {
          const owner = report.roomId ? await deps.profileRoomOwner(report.roomId) : undefined;
          const page = owner ? await deps.pageState(owner) : undefined;
          const about = !owner
            ? 'other'
            : report.eventId && report.eventId === page?.pageEventId
              ? 'page'
              : report.eventId
                ? 'profile-post'
                : 'profile';
          return { ...report, about, ...(owner && { owner }) };
        })
      );
      const shown = pagesOnly ? described.filter((report) => report.about !== 'other') : described;
      const what = { page: 'the page of', 'profile-post': 'a post, comment or guestbook entry by or on', profile: 'the profile room of', other: '' };
      const text = shown.length
        ? shown
            .map((report) =>
              [
                `${formatTime(report.ts)}  ${report.about === 'other' ? `${report.kind === 'event' ? 'an' : 'a'} ${report.kind} report (not a profile)` : `${what[report.about as keyof typeof what]} ${report.owner}`}, from ${report.reporter}`,
                `  reason: ${cleanReason(report.reason) || '(none given)'}`,
                ...(report.roomId ? [`  room ${report.roomId}${report.eventId ? `  event ${report.eventId}` : ''}`] : []),
              ].join('\n')
            )
            .join('\n')
        : pagesOnly
          ? 'No reports about profile pages in the admin room.'
          : 'No reports in the admin room.';
      reply(req, res, 200, text, { reports: shown });
    })
  );

  // --- Peers (docs/federation.md) -----------------------------------------------------------------

  const peering = (): PeeringDeps => {
    if (!deps.peering) throw new ControlError(503, 'Peering is not available in this token server.');
    return deps.peering;
  };

  app.get(
    '/peers',
    route(async (req, res) => {
      const peers = await deps.store.peers();
      const rows = peers.map((peer) => {
        const status = deps.peering?.status(peer.serverName);
        const reading = status ? `reading ${status.profiles} profile(s), ${status.spaces} Space(s), ${status.feeds} feed(s)` : 'not synced yet';
        const last = status?.lastError ? `last sync failed: ${status.lastError}` : status?.lastSync ? `last synced ${formatTime(status.lastSync)}` : '';
        return [`${peer.name} (${peer.serverName})  ${peer.url}`, `  added ${formatTime(peer.addedAt)} by ${peer.addedBy || '?'}; ${reading}${last ? `; ${last}` : ''}`].join('\n');
      });
      const text = rows.length ? [`Peers (${rows.length}):`, ...rows].join('\n') : 'No peers. Add one: purrlor peers add <its address>';
      reply(req, res, 200, text, { peers: peers.map((peer) => ({ ...peer, status: deps.peering?.status(peer.serverName) ?? null })) });
    })
  );

  app.post(
    '/peers/add',
    route(async (req, res, actor, body) => {
      const raw = one(body.url) ?? '';
      const url = normalizePeerUrl(raw);
      if (!url) throw new ControlError(400, `'${cleanReason(raw)}' isn't an instance's address: give its https:// address (or just its name), nothing after it.`);
      const reason = needReason(body);
      let answer: unknown;
      try {
        answer = await peering().fetchInstance(url);
      } catch (err) {
        throw new ControlError(502, `Couldn't reach ${url}: ${cleanReason((err as Error).message)}`);
      }
      const info = parseInstanceInfo(answer, url);
      if ('error' in info) throw new ControlError(400, `${url}: ${info.error}`);
      const own = await deps.serverName();
      if (info.serverName === own) throw new ControlError(400, `${url} is this instance.`);
      const peer: Peer = { serverName: info.serverName, url: info.url, name: info.name, addedAt: new Date().toISOString(), addedBy: actor };
      const added = await deps.store.updatePeers((peers) => {
        const existing = peers.find((p) => p.serverName === info.serverName);
        // Added again: its address and name are refreshed, its history kept.
        if (existing) return { peers: peers.map((p) => (p === existing ? { ...existing, url: info.url, name: info.name } : p)), result: false };
        return { peers: [...peers, peer], result: true };
      });
      await deps.store.audit({ actor, action: 'peers.add', target: `${info.serverName} (${info.url})`, reason, result: added ? 'ok' : 'updated' });
      // The first sync runs on its own; `purrlor peers` shows how it went.
      void peering()
        .sync(peer)
        .catch((err: unknown) => console.error(`Peering: first sync of ${info.serverName} failed`, err));
      reply(
        req,
        res,
        200,
        [
          added ? `Added ${info.name} (${info.serverName}) as a peer.` : `${info.serverName} was already a peer; its address and name are updated.`,
          'The bot is joining its public profile rooms and Spaces now; `purrlor peers` shows how far it got.',
          "For its people to see this instance's too, an admin there adds this one: purrlor peers add <this instance's address>",
        ].join('\n'),
        { peer: info, added }
      );
    })
  );

  app.post(
    '/peers/remove/:server',
    route(async (req, res, actor, body) => {
      const server = req.params.server;
      const reason = needReason(body);
      const removed = await deps.store.updatePeers((peers) => {
        const kept = peers.filter((peer) => peer.serverName !== server);
        return { peers: kept, result: kept.length !== peers.length };
      });
      if (!removed) throw new ControlError(404, `${server} isn't a peer ('purrlor peers' lists them).`);
      const left = await peering().leave(server);
      await deps.store.audit({ actor, action: 'peers.remove', target: server, reason, result: `ok (left ${left} room(s))` });
      reply(
        req,
        res,
        200,
        `Removed ${server}. The bot left ${left} of its room(s); its people and Spaces are gone from Everyone, Discover and the public web here.`,
        { server, left }
      );
    })
  );

  app.post(
    '/peers/sync',
    route(async (req, res, actor) => {
      const peers = await deps.store.peers();
      if (peers.length === 0) return reply(req, res, 200, 'No peers to sync.', { results: [] });
      const results = [];
      for (const peer of peers) results.push({ serverName: peer.serverName, ...(await peering().sync(peer)) });
      await deps.store.audit({ actor, action: 'peers.sync', target: `${peers.length} peer(s)`, result: 'ok' });
      const text = results
        .map((r) => `${r.serverName}: reading ${r.profiles} profile(s), ${r.spaces} Space(s), ${r.feeds} feed(s)${r.lastError ? `; failed: ${r.lastError}` : ''}`)
        .join('\n');
      reply(req, res, results.some((r) => r.lastError) ? 207 : 200, text, { results });
    })
  );

  // --- Bug reports ------------------------------------------------------------------------------

  // What people sent with `!bug <project> <text>`, newest last. Reading them changes nothing, so no
  // reason is asked for, as with the audit log.
  app.get(
    '/bugs',
    route(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 5000);
      const project = one(req.query.project)?.trim().toLowerCase() || undefined;
      const reports = (await deps.bugs?.recent(limit, project)) ?? [];
      const line = (r: (typeof reports)[number]) => {
        const about = [r.platform, r.version && `version ${r.version}`].filter(Boolean).join(', ');
        return `${formatTime(r.at)}  [${r.project}]  ${r.reporter}${about ? `  (${about})` : ''}\n    ${r.text.replace(/\n/g, '\n    ')}`;
      };
      const text = reports.length
        ? reports.map(line).join('\n')
        : project
          ? `No bug reports for '${project}'.`
          : 'No bug reports yet.';
      reply(req, res, 200, text, { reports });
    })
  );

  // --- The audit log ----------------------------------------------------------------------------

  app.get(
    '/audit',
    route(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 5000);
      const lines = await deps.store.readAudit(limit);
      const entries = lines.flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, string>];
        } catch {
          return [];
        }
      });
      const text = entries.length
        ? entries
            .map((entry) => `${formatTime(entry.at)}  ${entry.actor}  ${entry.action}${entry.target ? `  ${entry.target}` : ''}  ${entry.result}${entry.reason ? `\n    reason: ${entry.reason}` : ''}`)
            .join('\n')
        : 'The audit log is empty.';
      reply(req, res, 200, text, { entries });
    })
  );

  app.use((req, res) => reply(req, res, 404, `No such control action: ${req.method} ${req.path}`));
  return app;
}

/**
 * Listens on `socketPath`, making sure first that its directory belongs to this process's user
 * (root, in the container) and nobody else can enter it, and that the socket itself is 0600.
 * Refuses to start rather than listen somewhere others could reach.
 */
export async function listenOnControlSocket(socketPath: string, app: express.Express): Promise<Server> {
  const dir = dirname(socketPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${dir} isn't a plain directory`);
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`${dir} belongs to uid ${info.uid}, not this service's (${process.getuid()})`);
  }
  // The directory is the socket's alone. It comes from the host (PURRLOR_CONTROL_DIR), so a mistake
  // there (`/etc`, `/var`) must not end with this service making a system directory root-only.
  const others = (await readdir(dir)).filter((name) => name !== basename(socketPath));
  if (others.length > 0) throw new Error(`${dir} has other things in it (${others.slice(0, 3).join(', ')}); the control socket needs a directory of its own`);
  await chmod(dir, 0o700);
  if (((await lstat(dir)).mode & 0o077) !== 0) throw new Error(`couldn't make ${dir} private`);

  try {
    const existing = await lstat(socketPath);
    // A socket left by the last run goes; anything else there is a mistake not to paper over.
    if (!existing.isSocket()) throw new Error(`${socketPath} exists and isn't a socket`);
    await unlink(socketPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const server = createServer(app);
  // Deleting a long takedown list waits on the homeserver for each file.
  server.requestTimeout = 15 * 60_000;
  server.headersTimeout = 60_000;
  const previous = process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } finally {
    process.umask(previous);
  }
  await chmod(socketPath, 0o600);
  return server;
}

/** The page facts the control actions need, from a profile room's state. */
export function pageStateFromRoom(state: RawEvent[] | undefined, optedIn: boolean): PageState {
  if (!state) return { profileRoom: false, optedIn: false, hasPage: false };
  const page = state.find((event) => event.type === PROFILE_PAGE_EVENT && event.state_key === '');
  const content = page?.content && typeof page.content.version === 'number' ? page.content : undefined;
  return { profileRoom: true, optedIn, hasPage: !!content, ...(content && { content }), ...(page?.event_id && { pageEventId: page.event_id }) };
}
