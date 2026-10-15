import { EventType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isDemoMode } from '../demo/demoMode';
import { isDesktopApp } from '../desktop/desktopBridge';
import { getOpenIdTokenCached } from './openIdToken';
import { fetchPeers, peerOf } from './peers';
import { roomOriginServer, serverNameOf } from './roomOrigin';
import { getParentSpace, readVoiceServerConfig } from './voice';

/**
 * `!bug <project> <what's wrong>`: a bug report for the server's admins, typed in any channel.
 * The composer catches it, so it's never sent as a message; it goes to the token server, whose
 * service bot passes it on (services/token-server/src/bugReports.ts, docs/bug-reports.md). The
 * project is the first word, one of the deployment's BUG_PROJECTS.
 *
 * Sent from a Space hosted on another server, it goes to that server's token server, not this
 * one: someone visiting a community reports its bugs to the people who run it. That server takes
 * it because they're a member of the Space (docs/bug-reports.md).
 */
export const BUG_USAGE = '!bug <project> <what’s wrong>, e.g. !bug purrlor emojis don’t work on mobile';

const BUG_API = '/api/public/bugs';
const VERSION: string | undefined = import.meta.env?.VITE_PURRLOR_VERSION || undefined;

export type ParsedBugCommand = { type: 'bug'; project: string; text: string } | { type: 'usage' };

/** A `!bug` message, or null for anything else ("!bugs", or "!bug" mid-message, are messages). */
export function parseBugCommand(body: string): ParsedBugCommand | null {
  const match = /^!bug(?:\s+|$)([\s\S]*)$/i.exec(body.trim());
  if (!match) return null;
  const [, project = '', text = ''] = /^(\S*)\s*([\s\S]*)$/.exec(match[1]) ?? [];
  return project && text.trim() ? { type: 'bug', project: project.toLowerCase(), text: text.trim() } : { type: 'usage' };
}

/** What the report says it was sent from, so the admins needn't ask. */
function platform(): string {
  if (isDesktopApp()) return 'desktop app';
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches ? 'mobile' : 'browser';
}

/** The joined Space a room is in: its `m.space.parent`, or else a Space that lists it as a child. */
function spaceOf(mx: MatrixClient, room: Room): Room | undefined {
  const joined = (space: Room | undefined) => (space?.getMyMembership() === 'join' && space.isSpaceRoom() ? space : undefined);
  const parent = joined(getParentSpace(mx, room));
  if (parent) return parent;
  return mx.getRooms().find((space) => {
    if (!joined(space)) return false;
    const via = (space.currentState.getStateEvents(EventType.SpaceChild, room.roomId) as MatrixEvent | null)?.getContent()?.via;
    return Array.isArray(via) && via.length > 0;
  });
}

const LOOKUP_TIMEOUT_MS = 5000;
/** Where each other server's bug reports go, once found: its `/api/public/bugs`, or null for none. */
const remoteApis = new Map<string, Promise<string | null>>();

/**
 * Another server's bug report address. Tried in turn: the peer list's address for it, its Space's
 * voice token server, and the server name itself. A candidate counts only if its token server
 * says it's that server (GET /api/public/bugs gives `serverName`), so a report never goes
 * somewhere that merely answers.
 */
function remoteBugApi(server: string, space: Room, mx: MatrixClient): Promise<string | null> {
  const known = remoteApis.get(server);
  if (known) return known;
  const lookup = (async () => {
    const peer = peerOf(server, await fetchPeers());
    const voice = readVoiceServerConfig(mx, space)?.tokenEndpoint;
    const bases = [peer?.url, voice, `https://${server}`].flatMap((url) => {
      try {
        return url ? [new URL(url).origin] : [];
      } catch {
        return [];
      }
    });
    for (const base of new Set(bases)) {
      const api = `${base}${BUG_API}`;
      const answer = await fetch(api, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
        .then((response) => (response.ok ? (response.json() as Promise<{ serverName?: unknown }>) : undefined))
        .catch(() => undefined);
      if (answer?.serverName === server) return api;
    }
    return null;
  })();
  remoteApis.set(server, lookup);
  // A miss is asked again next time: the server may just have been slow.
  void lookup.then((api) => api ?? remoteApis.delete(server));
  return lookup;
}

/** Test seam. */
export function forgetBugServers(): void {
  remoteApis.clear();
}

export type SentBugReport = {
  project: string;
  /** The other server it went to, when the Space is hosted there. */
  server?: string;
};

/**
 * Sends one report, from the room it was typed in; resolves with the project it was filed under
 * (and the server, if not this one), or throws what went wrong.
 */
export async function sendBugReport(mx: MatrixClient, project: string, text: string, roomId?: string): Promise<SentBugReport> {
  if (isDemoMode()) throw new Error('Bug reports can’t be sent from the demo.');
  const room = roomId ? mx.getRoom(roomId) : null;
  const space = room ? (room.isSpaceRoom() ? room : spaceOf(mx, room)) : undefined;
  const host = space ? roomOriginServer(space) : undefined;
  const remote = host && host !== serverNameOf(mx.getUserId() ?? '') ? host : undefined;
  let api = BUG_API;
  if (remote && space) {
    const found = await remoteBugApi(remote, space, mx);
    if (!found) throw new Error(`${space.name || 'This Space'} is hosted on ${remote}, which doesn’t take bug reports.`);
    api = found;
  }
  let response: Response;
  try {
    response = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        openid_token: await getOpenIdTokenCached(mx),
        project,
        text,
        platform: platform(),
        ...(VERSION && { version: VERSION }),
        ...(space && { space_id: space.roomId }),
      }),
    });
  } catch {
    throw new Error(`Couldn’t reach ${remote ?? 'the server'} to send the bug report. Try again in a moment.`);
  }
  const answer = (await response.json().catch(() => ({}))) as { error?: unknown; project?: unknown };
  if (response.status === 404) throw new Error(remote ? `${remote} doesn’t take bug reports.` : 'This server doesn’t take bug reports.');
  if (!response.ok) throw new Error(typeof answer.error === 'string' ? answer.error : 'The bug report couldn’t be sent.');
  return { project: typeof answer.project === 'string' ? answer.project : project, ...(remote && { server: remote }) };
}
