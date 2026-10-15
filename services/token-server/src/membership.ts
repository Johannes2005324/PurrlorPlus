import { ClientEvent, EventType, RoomMemberEvent, RoomStateEvent, createClient, type MatrixClient } from 'matrix-js-sdk';
import {
  confirmLocalOrigin,
  isRoomServed,
  mayAcceptInvite,
  servedVoiceChannelIds,
  SPACE_CHILD_CHANNEL_TYPE_KEY,
} from './tenancy.js';

/**
 * A persistent Matrix service-account bot, logged in once at process start, that stays joined
 * to whatever rooms/spaces it serves so it can read membership/power level *locally*
 * instead of doing federation state resolution itself — this mirrors element-hq/lk-jwt-service's
 * approach.
 *
 * Which rooms it will go into is not its own decision: every join here runs through
 * `tenancy.ts`, which admits only local rooms that a Space this deployment serves claims as a
 * child. Anyone at all can send an invite, so an unconditional auto-join made the bot — and the
 * LiveKit deployment behind it — reachable by any user anywhere on the federation.
 *
 * Deliberately skips E2EE setup entirely (no initRustCrypto, no crypto store): the bot only
 * ever reads room state (m.room.member, m.room.power_levels), which Matrix never encrypts —
 * only timeline *messages* in encrypted rooms are, and this bot never reads those. That keeps
 * this service free of the WASM-crypto packaging concerns the browser client has to deal with.
 */
let botClientPromise: Promise<MatrixClient> | null = null;

// Belt-and-braces on top of both the live RoomMemberEvent.Membership listener and the on-demand
// ensureBotJoined() below: acts on any room currently sitting at membership 'invite' regardless
// of whether an event for it was ever actually observed (a bot restart mid-flight, a missed
// event, or any other gap between "the homeserver thinks we're invited" and "we've actually
// acted on it"). Cheap to run — this is just a scan of the bot's own already-synced room list,
// no extra requests unless there's actually a pending invite worth joining.
const RECONCILE_INTERVAL_MS = 60 * 1000;

function joinPendingInvites(mx: MatrixClient): void {
  for (const room of mx.getRooms()) {
    if (room.getMyMembership() !== 'invite') continue;
    joinIfServed(mx, room.roomId).catch((err: unknown) => {
      console.error(`Reconciliation: failed to join pending invite for room ${room.roomId}`, err);
    });
  }
}

/**
 * Walks into every voice channel of every Space it serves that it isn't in yet — no invite
 * needed, since voice channels are restricted to their Space and the bot is a member of the
 * Space. Being there ahead of time is what makes the first person's click connect straight away
 * instead of waiting on an on-demand join, and what lets the channel list show who's in a call.
 * Each join still goes through `joinIfServed`'s tenancy check.
 */
function joinServedVoiceChannels(mx: MatrixClient): void {
  for (const roomId of servedVoiceChannelIds(mx)) {
    const membership = mx.getRoom(roomId)?.getMyMembership();
    if (membership === 'join' || membership === 'ban') continue;
    joinIfServed(mx, roomId).catch((err: unknown) => {
      // An older voice channel created invite-only can't be walked into; the client still invites
      // the bot the first time someone connects (apps/web/src/matrix/voiceBot.ts).
      if (noteRefusedInvite(roomId)) console.warn(`Couldn't join voice channel ${roomId} without an invite`, err);
    });
  }
}

/**
 * Rooms whose invite this deployment won't act on, so refusing one doesn't reprint the same
 * warning every reconciliation pass. Invites the bot ignores are simply left pending — rejecting
 * them would be wrong, since a channel's `m.space.child` link is written a round trip *after*
 * its creation invite goes out, and a refusal in that window is only ever temporary.
 *
 * Bounded, because what goes in it is chosen by whoever sends invites — which is anyone at all.
 * It only exists to keep the log readable, so dropping the oldest entries costs nothing worse
 * than a repeated warning line for a room refused long ago.
 */
const MAX_REFUSED_INVITES = 500;
const refusedInvites = new Set<string>();

function noteRefusedInvite(roomId: string): boolean {
  if (refusedInvites.has(roomId)) return false;
  if (refusedInvites.size >= MAX_REFUSED_INVITES) {
    // Set iterates in insertion order, so the first key is the oldest.
    refusedInvites.delete(refusedInvites.values().next().value as string);
  }
  refusedInvites.add(roomId);
  return true;
}

/**
 * The single gate every join path shares. Joins the room if `tenancy.ts` vouches for it —
 * whether or not there's a pending invite, since a voice channel restricted to its Space
 * (`roomCreation.ts`) is one the bot can walk into itself, and being a child of a served Space
 * is a stricter test than holding an invite anyone could have sent.
 */
async function joinIfServed(mx: MatrixClient, roomId: string): Promise<boolean> {
  if (!(await mayAcceptInvite(mx, roomId))) {
    if (noteRefusedInvite(roomId)) {
      console.warn(
        `Not joining ${roomId}: it isn't a channel in a space this voice server serves. ` +
          'If that is wrong, check that the space lists it as an m.space.child, that the bot is ' +
          'in that space, and that VOICE_ALLOWED_SPACES (if set) names it.'
      );
    }
    return false;
  }

  refusedInvites.delete(roomId);
  await joinRoomOnce(mx, roomId);
  // A room-version-12 room may have been joined before its origin was knowable (tenancy.ts,
  // roomOriginServer). Now it is: a room created elsewhere is left straight away.
  if (!(await confirmLocalOrigin(mx, roomId))) {
    console.warn(`Left ${roomId}: it was created on another homeserver, which this voice server never serves.`);
    await mx.leave(roomId).catch(() => undefined);
    return false;
  }
  return true;
}

/**
 * De-duplicates concurrent joins of the same room. Without this, a Space whose members all click
 * a freshly created voice channel at once produces one join request per caller — the homeserver
 * copes fine, but they also all race, and a failure in any one of them would surface against
 * every waiting request rather than being retried once.
 */
const inFlightJoins = new Map<string, Promise<void>>();

function joinRoomOnce(mx: MatrixClient, roomId: string): Promise<void> {
  const existing = inFlightJoins.get(roomId);
  if (existing) return existing;

  const join = mx
    .joinRoom(roomId)
    .then(() => undefined)
    .finally(() => inFlightJoins.delete(roomId));
  inFlightJoins.set(roomId, join);
  return join;
}

async function loginBot(homeserverUrl: string): Promise<MatrixClient> {
  const accessToken = process.env.MATRIX_BOT_ACCESS_TOKEN;
  if (accessToken) {
    const userId = process.env.MATRIX_BOT_USER_ID;
    if (!userId) {
      throw new Error('MATRIX_BOT_USER_ID must be set alongside MATRIX_BOT_ACCESS_TOKEN');
    }
    return createClient({ baseUrl: homeserverUrl, accessToken, userId });
  }

  const username = process.env.MATRIX_BOT_USERNAME;
  const password = process.env.MATRIX_BOT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'Set either MATRIX_BOT_ACCESS_TOKEN + MATRIX_BOT_USER_ID, or MATRIX_BOT_USERNAME + MATRIX_BOT_PASSWORD'
    );
  }

  const loginClient = createClient({ baseUrl: homeserverUrl });
  const res = await loginClient.loginRequest({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password,
  });
  return createClient({ baseUrl: homeserverUrl, accessToken: res.access_token, userId: res.user_id });
}

async function createBotClient(): Promise<MatrixClient> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  if (!homeserverUrl) {
    throw new Error('MATRIX_HOMESERVER_URL must be set');
  }

  const mx = await loginBot(homeserverUrl);

  // A voice channel added to a served Space: join it as soon as the link arrives.
  mx.on(RoomStateEvent.Events, (event) => {
    if (event.getType() !== EventType.SpaceChild) return;
    if ((event.getContent() as Record<string, unknown>)[SPACE_CHILD_CHANNEL_TYPE_KEY] !== 'voice') return;
    joinServedVoiceChannels(mx);
  });

  mx.on(RoomMemberEvent.Membership, (_event, member) => {
    if (member.userId === mx.getUserId() && member.membership === 'invite') {
      // A tick later: this fires while the SDK is still applying the invite's stripped state, and
      // until it has, the room has no `m.room.create` — so a Space invite didn't look like one and
      // was refused, leaving the bot out of the Space until the next reconciliation pass (up to a
      // minute). Checked against Continuwuity with the SDK: no type at this moment, "m.space" one
      // tick on.
      setTimeout(() => {
        joinIfServed(mx, member.roomId).catch((err: unknown) => {
          console.error(`Failed to auto-join room ${member.roomId}`, err);
        });
      }, 0);
    }
  });

  await new Promise<void>((resolve) => {
    const onSync = (state: string) => {
      if (state === 'PREPARED') {
        mx.removeListener(ClientEvent.Sync, onSync);
        resolve();
      }
    };
    mx.on(ClientEvent.Sync, onSync);
    void mx.startClient({ lazyLoadMembers: true });
  });

  console.log(`Service bot ${mx.getUserId()} ready.`);

  joinPendingInvites(mx); // catch anything already pending before this process even started
  joinServedVoiceChannels(mx);
  setInterval(() => {
    joinPendingInvites(mx);
    joinServedVoiceChannels(mx);
  }, RECONCILE_INTERVAL_MS);

  return mx;
}

function getBotClient(): Promise<MatrixClient> {
  if (!botClientPromise) {
    // A login that failed is tried again by the next caller, not kept: a token server started
    // before its bot account exists (a fresh install, the e2e and federation setups) would
    // otherwise go without a bot until restarted.
    botClientPromise = createBotClient().catch((err: unknown) => {
      botClientPromise = null;
      throw err;
    });
  }
  return botClientPromise;
}

/** The service account, for reading what it may read anyway (the public web, publicWebRoutes.ts). */
export function getServiceClient(): Promise<MatrixClient> {
  return getBotClient();
}

/**
 * The bot, in `roomId`, for posting there (webhooks.ts): only for a room this deployment serves,
 * joined first if it has to be (through the same tenancy check as any join). Null otherwise.
 */
export async function botInServedRoom(roomId: string): Promise<MatrixClient | null> {
  const mx = await getBotClient();
  if (!(await isRoomServed(mx, roomId))) return null;
  if (mx.getRoom(roomId)?.getMyMembership() !== 'join' && !(await ensureBotJoined(mx, roomId))) return null;
  return mx;
}

/**
 * The bot's own Matrix ID, served to clients over `GET /api/livekit/config` so a Space admin
 * never has to copy it out of the deployment's `.env` by hand and the web client can invite it
 * into voice channels itself (see apps/web/src/matrix/voiceBot.ts). Read straight from env when
 * it's set there, so the endpoint answers even while the bot is still doing its initial sync.
 */
export async function getBotUserId(): Promise<string> {
  const fromEnv = process.env.MATRIX_BOT_USER_ID;
  if (fromEnv) return fromEnv;
  const mx = await getBotClient();
  const userId = mx.getUserId();
  if (!userId) throw new Error('Service bot has no user ID');
  return userId;
}

/**
 * Gets the bot into the room *right now* rather than waiting for the next sync event or
 * reconciliation pass. This is what makes "create a voice channel, click it, talk" work on the
 * first try: the client connects immediately after creating the channel, which used to land here
 * while the bot was still sitting at membership 'invite' and got a flat 403.
 *
 * `roomId` comes straight off a caller's request body, so what's joined is never decided by that
 * ID alone — `joinIfServed` requires a Space this deployment serves to claim the room as a child
 * before anything happens.
 */
async function ensureBotJoined(mx: MatrixClient, roomId: string): Promise<boolean> {
  if (mx.getRoom(roomId)?.getMyMembership() === 'join') return true;

  try {
    return await joinIfServed(mx, roomId);
  } catch (err) {
    console.error(`Failed to join room ${roomId} on demand`, err);
    return false;
  }
}

export type MembershipResult =
  | { status: 'ok'; powerLevel: number }
  /** The *bot* isn't in the room — nothing the calling user did wrong, and fixable by inviting it. */
  | { status: 'bot-not-in-room' }
  /** Not a channel in a space this deployment serves, so no token is minted for it — see tenancy.ts. */
  | { status: 'room-not-served' }
  /** The bot can see the room, and the user genuinely isn't a joined member of it. */
  | { status: 'not-a-member' };

type PowerLevelsContent = { users?: Record<string, number>; users_default?: number };

/**
 * Membership check straight against the homeserver, used when the bot's locally synced copy of
 * the room carries no member event for this user. That's a routine outcome rather than an error:
 * the bot syncs with `lazyLoadMembers: true`, so its local room state only holds the members the
 * homeserver considered relevant to *it* — an ordinary member of a busy room can legitimately be
 * missing from it, and treating that as "not a member" locked real members out of voice. Also
 * covers the moment right after an on-demand join, before room state has finished syncing.
 */
async function checkMembershipOverApi(
  mx: MatrixClient,
  userId: string,
  roomId: string
): Promise<MembershipResult> {
  let memberContent: { membership?: string } | undefined;
  try {
    memberContent = (await mx.getStateEvent(roomId, 'm.room.member', userId)) as { membership?: string };
  } catch {
    return { status: 'not-a-member' }; // 404 from the homeserver: no member event at all
  }
  if (memberContent?.membership !== 'join') return { status: 'not-a-member' };

  // The full state rather than just the power levels: on room version 12 the creator outranks
  // everyone without being listed there, and only the create event's sender says who that is.
  const state = ((await mx.roomState(roomId).catch(() => [])) ?? []) as RawStateEvent[];
  const find = (type: string) => state.find((event) => event.type === type && event.state_key === '');
  if (isPrivilegedCreator(find('m.room.create'), userId)) return { status: 'ok', powerLevel: Infinity };
  const content = (find('m.room.power_levels')?.content ?? {}) as PowerLevelsContent;
  return { status: 'ok', powerLevel: content.users?.[userId] ?? content.users_default ?? 0 };
}

type RawStateEvent = { type?: string; state_key?: string; sender?: string; content?: Record<string, unknown> };

/**
 * Room version 12 gives a room's creators — the create event's sender, plus any
 * `additional_creators` — unlimited power without listing them in the power levels (the spec
 * forbids it). The SDK's RoomMember.powerLevel already reflects that; a raw read must too.
 */
export function isPrivilegedCreator(create: RawStateEvent | undefined, userId: string): boolean {
  const version = create?.content?.room_version;
  if (typeof version !== 'string' || !(version === '12' || version.startsWith('org.matrix.hydra'))) return false;
  const extra = create?.content?.additional_creators;
  return create?.sender === userId || (Array.isArray(extra) && extra.includes(userId));
}

/**
 * Whether this user may see who's in a voice channel right now: it's a channel this deployment
 * serves, the bot is in it, and the user is a joined member. The same answer checkMembership
 * gives for a token, but read-only — asking never makes the bot join anything, since this is
 * polled constantly and a caller chooses the room IDs.
 */
export async function mayViewParticipants(userId: string, roomId: string): Promise<boolean> {
  const mx = await getBotClient();
  if (!(await isRoomServed(mx, roomId))) return false;
  const room = mx.getRoom(roomId);
  if (room?.getMyMembership() !== 'join') return false;
  const member = room.getMember(userId);
  if (member) return member.membership === 'join';
  return (await checkMembershipOverApi(mx, userId, roomId)).status === 'ok';
}

export async function checkMembership(userId: string, roomId: string): Promise<MembershipResult> {
  const mx = await getBotClient();

  // Asked *before* anything is attempted in the room, so a room this deployment will never
  // serve is answered as exactly that. Ordering this after the join attempt reported the far
  // more specific "the bot isn't in the room" instead, which the client reasonably responds to
  // by inviting the bot and waiting — a retry loop that could only ever time out, against a
  // room whose problem an invite cannot fix. It's also re-checked here on every request rather
  // than trusted from join time alone, so a channel since unlinked from its Space (or one the
  // bot was walked into before this gate existed) stops being authorized on its own.
  if (!(await isRoomServed(mx, roomId))) {
    console.warn(`Refusing to authorize ${roomId}: not a channel in a space this voice server serves.`);
    return { status: 'room-not-served' };
  }

  if (!(await ensureBotJoined(mx, roomId))) {
    console.warn(`Bot is not joined to room ${roomId} — invite it there so voice auth can work.`);
    return { status: 'bot-not-in-room' };
  }

  const member = mx.getRoom(roomId)?.getMember(userId);
  if (!member) return checkMembershipOverApi(mx, userId, roomId);
  if (member.membership !== 'join') return { status: 'not-a-member' };

  return { status: 'ok', powerLevel: member.powerLevel };
}
