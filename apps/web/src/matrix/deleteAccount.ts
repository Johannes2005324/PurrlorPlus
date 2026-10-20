import { AuthType, MatrixError, type MatrixClient, type Room } from 'matrix-js-sdk';
import { listOwnFeedRoomIds, POST_EVENT_TYPE } from './feed';
import { isRedacted, readOwnEvents, redactWithRetry } from './ownEvents';
import { roomAdmins } from './permissions';
import { getOwnProfileRoomId } from './profileFeed';
import { unpublishProfilePage } from './profilePageStore';
import { disableBackgroundPush, readPushGatewayUrl } from './push';
import { readPublicWebEnabled, setPublicWebEnabled } from './publicWebSwitch';
import { clearGatewayReminders } from './reminderPush';
import { STORY_EVENT_TYPE } from './stories';

/**
 * Deleting your account (Account Settings → Your data). Matrix calls it deactivating: the account
 * can never sign in again, its name can't be taken by anyone else, it leaves every room and its
 * display name and picture are removed.
 *
 * What the homeserver keeps (checked against Continuwuity): everything already sent. Its `erase`
 * option is accepted and does nothing, so messages stay readable by the people who have them, as
 * they would in any chat app. Purrlor's own things are tidied up here first, while the account
 * still can: the public page is switched off, and (unless the person chose to keep them) every
 * post is deleted and the profile page unpublished. Notifications and reminders are stopped at
 * the push gateway, which otherwise doesn't know the account is gone. Whatever the cleanup misses,
 * the public web and the Global feed stop showing someone who has left their profile room
 * (globalFeed.ts, the token server's ownerStillThere).
 */

export class WrongPasswordError extends Error {
  constructor() {
    super('That password isn’t right.');
  }
}

export type DeleteStep = 'checking' | 'page' | 'posts' | 'notifications' | 'deleting';
export type DeleteProgress = { step: DeleteStep; done?: number; total?: number };

/**
 * Whether `password` is this account's, checked by signing in with it (a fresh session, signed
 * out again at once) — before anything is changed, since the deactivation itself is the last step
 * and would otherwise find out only after the posts were gone.
 */
export async function checkPassword(mx: MatrixClient, password: string): Promise<boolean> {
  const user = mx.getUserId();
  if (!user) return false;
  const base = mx.getHomeserverUrl().replace(/\/$/, '');
  const res = await fetch(`${base}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user },
      password,
      initial_device_display_name: 'Purrlor password check',
    }),
  });
  if (res.status === 403 || res.status === 401) return false;
  if (!res.ok) throw new Error(`Couldn’t check the password (the server answered ${res.status}).`);
  const { access_token: token } = (await res.json()) as { access_token?: string };
  if (token) {
    await fetch(`${base}/_matrix/client/v3/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  return true;
}

/**
 * Spaces that would be left with nobody able to run them: you're their only admin (or privileged
 * creator) still in them, and other people are. Deleting the account doesn't stop anyone else, but
 * they should hand the Space over first.
 */
export function spacesOnlyYouRun(mx: MatrixClient): Room[] {
  const me = mx.getUserId();
  if (!me) return [];
  return mx.getRooms().filter((room) => {
    if (!room.isSpaceRoom() || room.getMyMembership() !== 'join') return false;
    const joined = new Set(room.getJoinedMembers().map((member) => member.userId));
    const admins = roomAdmins(room).filter((userId) => joined.has(userId));
    return admins.length === 1 && admins[0] === me && joined.size > 1;
  });
}

/** Deletes every post you made, in your profile room and in each Space's feed. */
async function deleteAllPosts(mx: MatrixClient, onProgress: (progress: DeleteProgress) => void, signal?: AbortSignal): Promise<void> {
  const roomIds = [...new Set([getOwnProfileRoomId(mx), ...listOwnFeedRoomIds(mx)].filter((id): id is string => !!id))];
  const targets: { roomId: string; eventId: string }[] = [];
  for (const roomId of roomIds) {
    const events = await readOwnEvents(mx, roomId, { types: [POST_EVENT_TYPE, STORY_EVENT_TYPE], signal }).catch(() => []);
    for (const event of events) {
      const eventId = event.getId();
      if (eventId && !isRedacted(event)) targets.push({ roomId, eventId });
    }
  }
  for (const [index, { roomId, eventId }] of targets.entries()) {
    onProgress({ step: 'posts', done: index, total: targets.length });
    await redactWithRetry(mx, roomId, eventId, 'Account deleted', signal);
  }
}

/** The account deletion itself: Matrix's deactivate, confirming with the password it asks for. */
async function deactivate(mx: MatrixClient, password: string): Promise<void> {
  try {
    await mx.deactivateAccount(undefined, true);
  } catch (err) {
    if (!(err instanceof MatrixError) || err.httpStatus !== 401 || !err.data?.flows) throw err;
    const flows = err.data.flows as { stages: string[] }[];
    if (!flows.some((flow) => flow.stages.includes(AuthType.Password))) {
      throw new Error('This homeserver asks for a way of confirming that Purrlor doesn’t support. Ask its admin to delete the account.');
    }
    await mx.deactivateAccount(
      {
        type: AuthType.Password,
        identifier: { type: 'm.id.user', user: mx.getUserId() ?? '' },
        password,
        session: err.data.session,
      } as Parameters<MatrixClient['deactivateAccount']>[0],
      true
    );
  }
}

export async function deleteAccount(
  mx: MatrixClient,
  password: string,
  { deletePosts, displayName }: { deletePosts: boolean; displayName: string },
  onProgress: (progress: DeleteProgress) => void = () => undefined
): Promise<void> {
  onProgress({ step: 'checking' });
  if (!(await checkPassword(mx, password))) throw new WrongPasswordError();

  onProgress({ step: 'page' });
  if (readPublicWebEnabled(mx)) await setPublicWebEnabled(mx, false, displayName);
  if (deletePosts && getOwnProfileRoomId(mx)) await unpublishProfilePage(mx).catch(() => undefined);

  if (deletePosts) await deleteAllPosts(mx, onProgress);

  // Best effort: none of this may stop the account from being deleted.
  onProgress({ step: 'notifications' });
  const gateway = readPushGatewayUrl(mx);
  if (gateway) {
    await clearGatewayReminders(mx).catch(() => undefined);
    await disableBackgroundPush(mx, gateway).catch(() => undefined);
  }

  onProgress({ step: 'deleting' });
  await deactivate(mx, password);
}
