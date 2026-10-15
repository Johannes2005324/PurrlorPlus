import { join } from 'node:path';
import express from 'express';
import { ipWatch } from './ipWatch.js';
import cors from 'cors';
import { corsOptions, parseAllowedOrigins } from './corsPolicy.js';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { validateOpenIdToken } from './openid.js';
import { checkMembership, getBotUserId, getServiceClient, mayViewParticipants } from './membership.js';
import { grantsForPowerLevel } from './grants.js';
import { livekitRoomName } from './livekitRoomName.js';
import { handleWebhook } from './webhooks.js';
import { controlDeps, publicWebRouter, serverName } from './publicWebRoutes.js';
import { embedsRouter } from './embedRoutes.js';
import { adminStore } from './adminStore.js';
import { controlApp, listenOnControlSocket } from './controlServer.js';
import { startPeering } from './peering.js';
import { ErrorLog, captureProcessErrors } from './errorLog.js';
import { standardMetrics } from './metrics.js';
import { finalErrorHandler, opsRouter } from './ops.js';
import { clientErrorHandler } from './clientErrors.js';
import { onlineCounter } from './online.js';
import { BugDesk, BugReportLog, BugRoom, bugReportsRouter, parseBugAdmins, parseBugProjects } from './bugReports.js';
import { serverNameOf } from './publicWeb.js';

// The build this is (a commit, set by the image build), for `purrlor metrics` and error reports.
const VERSION = process.env.PURRLOR_VERSION || undefined;

// Errors and metrics for the operator (ops.ts, docs/deployment.md "Errors and metrics"). First, so
// a failure anywhere below is recorded too.
const ops = standardMetrics('purrlor_token_server');
const errorLog = new ErrorLog(process.env.ERRORS_FILE || undefined, (report) => ops.errors.inc({ source: report.source }));
captureProcessErrors(errorLog, VERSION);
const voiceTokens = ops.metrics.counter('voice_tokens_total', 'Voice tokens given out');
ops.metrics.gauge('online_accounts', 'Accounts with the app open now', () => onlineCounter.count());

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
// Server-to-server LiveKit API host (RoomServiceClient), distinct from the wss:// URL clients
// use — same LiveKit deployment, just its plain HTTP endpoint reached over the docker network.
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? 'http://livekit:7880';

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
  process.exit(1);
}

// Which pages may call this from a browser: voice from anywhere, the rest from ALLOWED_ORIGINS
// (corsPolicy.ts).
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

const app = express();
app.use(ops.measure);
// Behind nginx (and Docker's network): the visitor's address is in X-Forwarded-For, which the
// public web's per-address rate limits need. Only proxies on private and loopback addresses are
// believed, so a visitor can't pick their own address by sending the header.
app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
// `purrlor ips`: records nothing unless an admin is watching (ipWatch.ts).
app.use((req, _res, next) => {
  ipWatch.record(req);
  next();
});
app.use(cors(corsOptions(ALLOWED_ORIGINS)));
app.use(express.json());
app.use(opsRouter({ token: process.env.METRICS_TOKEN ?? '', service: 'token server', version: VERSION, metrics: ops, errors: errorLog }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'purrlor-token-server' });
});

/**
 * Self-description for clients: which Matrix account this deployment's membership-checking bot
 * runs as. The web client reads it so a Space admin never has to copy the bot's ID out of this
 * deployment's `.env`, and so new voice channels can invite it themselves at creation time
 * instead of leaving every one of them silently un-joinable (see apps/web/src/matrix/voiceBot.ts).
 * Unauthenticated on purpose — a service account's user ID is public the moment it's in a room.
 */
app.get('/api/livekit/config', async (_req, res) => {
  try {
    res.json({ botUserId: await getBotUserId() });
  } catch (err) {
    console.error('Failed to report bot user ID', err);
    res.status(503).json({ error: 'Service bot is not available' });
  }
});

/** Who's asking. A login on this deployment's own homeserver is checked there directly, as the other
 *  routes do (publicWebRoutes.ts), rather than through its public federation address. */
async function voiceCaller(openIdToken: unknown): Promise<string> {
  const ownServer = await serverName().catch(() => '');
  return validateOpenIdToken(openIdToken as Parameters<typeof validateOpenIdToken>[0], {
    serverName: ownServer,
    baseUrl: process.env.MATRIX_HOMESERVER_URL ?? '',
  });
}

app.post('/api/livekit/token', async (req, res) => {
  const openIdToken = req.body?.openid_token;
  const roomId = req.body?.room_id;
  if (!openIdToken || !roomId) {
    res.status(400).json({ error: 'openid_token and room_id are required' });
    return;
  }

  let userId: string;
  try {
    userId = await voiceCaller(openIdToken);
  } catch (err) {
    // An expired or unconfirmed login is the caller's, not a fault here: a warning, so it isn't
    // counted in `purrlor errors` or the alerts.
    console.warn(`Voice token refused: the OpenID token didn't check out (${(err as Error).message})`);
    res.status(401).json({ error: 'Authentication failed' });
    return;
  }

  try {
    const membership = await checkMembership(userId, roomId);

    // Two very different failures that used to collapse into the same "Not a member of this
    // room" 403 — which was actively misleading in the common case, where the caller *is* a
    // member and it's the service bot that was never invited. Split so the client can tell them
    // apart: one is fixed by inviting the bot (which the client does itself, then retries), the
    // other is a genuine permission answer.
    if (membership.status === 'bot-not-in-room') {
      res.status(409).json({
        error: 'The voice service bot has not been invited to this channel yet',
        code: 'voice_bot_not_in_room',
        botUserId: await getBotUserId().catch(() => undefined),
      });
      return;
    }
    // A valid OpenID token proves identity, not entitlement, and it validates for a user on any
    // federated homeserver — so "who are you" can't be the only question asked. This is "is this
    // room one of ours": a channel in a space this deployment actually serves (see tenancy.ts).
    // Without it, anyone could point the endpoint at a room of their own and be answered.
    if (membership.status === 'room-not-served') {
      res.status(403).json({
        error: 'This room is not a voice channel in a space served by this voice server',
        code: 'room_not_served',
      });
      return;
    }
    if (membership.status !== 'ok') {
      res.status(403).json({ error: 'Not a member of this room', code: 'not_a_member' });
      return;
    }

    const roomName = livekitRoomName(roomId);
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      name: userId,
      ttl: '24h',
    });
    at.addGrant({ room: roomName, roomJoin: true, ...grantsForPowerLevel(membership.powerLevel) });

    const token = await at.toJwt();
    voiceTokens.inc();
    res.json({ token, roomName });
  } catch (err) {
    console.error('Failed to mint token', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// Live participant tracking — queried on demand from LiveKit itself (RoomServiceClient) rather
// than cached from webhooks, so it's always current and can report per-participant mic/deafen
// state (which webhooks can't: LiveKit doesn't send a webhook when a track's mute state changes
// after publish, only on publish/unpublish — a client that reliably needs before-and-after mute
// state on every toggle would need webhooks anyway, but "what's true right now" is simpler and
// more reliable to just ask for than to keep a hand-rolled cache in sync).
const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

type VoiceParticipant = { identity: string; micMuted: boolean; deafened: boolean; joinedAt: number };

/** One request can ask about this many channels at most — the channel list asks about one. */
const MAX_PARTICIPANT_ROOMS = 50;

// The unauthenticated GET this replaces told anyone who knew a room ID who was in its call.
// Answered explicitly so an old client gets a clear reason rather than a bare 404.
app.get('/api/livekit/rooms/participants', (_req, res) => {
  res.status(401).json({
    error: 'Participants now require authentication: POST openid_token and room_ids.',
    code: 'auth_required',
  });
});

/**
 * Who's in each voice channel right now, for the channel list — only for channels the caller is
 * a joined member of. Proven the same way a token request is (a Matrix OpenID token, so no
 * Matrix credentials ever reach this server); rooms the caller may not see are simply left out,
 * so the response never confirms whether a room ID the caller made up exists.
 */
app.post('/api/livekit/rooms/participants', async (req, res) => {
  const openIdToken = req.body?.openid_token;
  const requested = req.body?.room_ids;
  if (!openIdToken || !Array.isArray(requested)) {
    res.status(400).json({ error: 'openid_token and room_ids are required' });
    return;
  }
  const roomIds = [...new Set(requested.filter((id: unknown): id is string => typeof id === 'string' && !!id))].slice(
    0,
    MAX_PARTICIPANT_ROOMS
  );

  let userId: string;
  try {
    userId = await voiceCaller(openIdToken);
  } catch {
    res.status(401).json({ error: 'Authentication failed' });
    return;
  }

  const result: Record<string, VoiceParticipant[]> = {};
  await Promise.all(
    roomIds.map(async (roomId) => {
      if (!(await mayViewParticipants(userId, roomId).catch(() => false))) return;
      try {
        const participants = await roomService.listParticipants(livekitRoomName(roomId));
        result[roomId] = participants.map((p) => {
          const micTrack = p.tracks.find((t) => t.source === TrackSource.MICROPHONE);
          return {
            identity: p.identity,
            micMuted: micTrack?.muted ?? true,
            // Broadcast by the client itself via localParticipant.setAttributes — LiveKit has
            // no built-in "deafened" concept (muting your own playback of others isn't
            // something the server can see), see VoiceChannelPanel.tsx's toggleDeafen.
            deafened: p.attributes.deafened === 'true',
            // So the channel list can show people in the order they joined; LiveKit's own order isn't fixed.
            joinedAt: Number(p.joinedAtMs) || Number(p.joinedAt) * 1000,
          };
        });
      } catch {
        result[roomId] = []; // No LiveKit room yet (nobody's joined) — not an error.
      }
    })
  );

  res.json(result);
});

/**
 * Incoming webhooks (webhooks.ts): an outside service posts into a channel. The token in the path
 * is the credential, so this is deliberately not behind CORS or a login — it's called by servers,
 * not browsers.
 */
app.post('/api/webhooks/:roomId/:webhookId/:token', (req, res) => {
  void handleWebhook(req, res);
});

/**
 * The public web (publicWeb.ts): Global posts, opted-in profile pages, and their link previews,
 * for people who aren't signed in. Read-only.
 */
/** Errors the web app hit in someone's browser (clientErrors.ts). Before the router, which limits per page. */
app.post('/api/public/client-errors', clientErrorHandler(errorLog));
/** `!bug <project> <text>` from the app, passed on to the server's admins (bugReports.ts, docs/bug-reports.md). */
const DATA_DIR = process.env.PURRLOR_DATA_DIR ?? '/data';
const bugLog = new BugReportLog(join(DATA_DIR, 'bug-reports.jsonl'));
const bugRoom = new BugRoom(join(DATA_DIR, 'bug-room.json'), getServiceClient, parseBugAdmins(process.env.BUG_REPORT_ADMINS));
// ✅s and "fixed" replies in that room mark reports resolved (bugReports.ts, BugDesk).
const bugDesk = new BugDesk(bugLog, bugRoom, parseBugAdmins(process.env.BUG_REPORT_ADMINS));
bugRoom
  .watch((event) => void bugDesk.handle(event).catch((err: unknown) => console.warn('Bug report status not updated', err)))
  .catch((err: unknown) => console.warn(`Not watching the bug reports room: ${(err as Error).message}`));
app.use(
  '/api/public/bugs',
  bugReportsRouter({
    projects: parseBugProjects(process.env.BUG_PROJECTS),
    log: bugLog,
    caller: voiceCaller,
    isLocal: async (userId) => serverNameOf(userId) === (await serverName()),
    deliver: (report) => bugRoom.deliver(report),
  })
);
app.use('/api/public/embeds', embedsRouter());
app.use('/api/public', publicWebRouter());

app.use(finalErrorHandler);

app.listen(PORT, () => {
  console.log(`purrlor-token-server listening on :${PORT}`);
});

/** Joining approved peers' public rooms, so their people read like this server's (peering.ts). */
startPeering();

/**
 * The admin control channel (controlServer.ts, docs/admin-control.md): a root-only Unix socket the
 * `purrlor` command talks to. Never on the network. CONTROL_SOCKET= (empty) turns it off; if it
 * can't be made private, it isn't started and the rest of the service carries on.
 */
const CONTROL_SOCKET = process.env.CONTROL_SOCKET ?? (process.platform === 'win32' ? '' : '/control/purrlor.sock');
if (CONTROL_SOCKET) {
  listenOnControlSocket(CONTROL_SOCKET, controlApp({ store: adminStore, bugs: bugLog, ...controlDeps() })).then(
    () => console.log(`Admin control socket at ${CONTROL_SOCKET}`),
    (err) => console.error(`Admin control socket not started: ${(err as Error).message}`)
  );
}
