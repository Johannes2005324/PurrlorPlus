import { MatrixEvent, UserEvent, type MatrixClient } from 'matrix-js-sdk';
import { isAnimatableImageType, setAvatarAnimated, updateExtendedProfile } from './extendedProfile';

export async function updateAccountAvatar(mx: MatrixClient, file: File): Promise<void> {
  const { content_uri: mxcUrl } = await mx.uploadContent(file);
  await mx.setAvatarUrl(mxcUrl);
  // Best-effort: a server without MSC4133 (see extendedProfile.ts) just means avatars from this
  // account never animate for anyone, which is a worse-but-not-broken fallback, not a failure
  // that should stop the avatar itself from being set.
  await setAvatarAnimated(mx, isAnimatableImageType(file.type)).catch(() => {});
}

export async function updateAccountBanner(mx: MatrixClient, file: File): Promise<void> {
  const { content_uri: mxcUrl } = await mx.uploadContent(file);
  await updateExtendedProfile(mx, { bannerUrl: mxcUrl });
}

export async function removeAccountBanner(mx: MatrixClient): Promise<void> {
  await updateExtendedProfile(mx, { bannerUrl: null });
}

export async function updateDisplayName(mx: MatrixClient, name: string): Promise<void> {
  await mx.setDisplayName(name);
}

export type UserPresence = 'online' | 'unavailable' | 'offline';

/**
 * Sets the signed-in user's own presence and/or custom status message (plain
 * `/presence/{userId}/status`). Passing `''` clears the status. Leaving `statusMsg` out keeps the
 * one set before: the server is asked for it and it's sent again, since a homeserver may treat a
 * missing `status_msg` as clearing it, and an Away set from the status menu or by AutoAway wiped
 * the status someone had written.
 */
export async function updateOwnPresence(mx: MatrixClient, presence: UserPresence, statusMsg?: string): Promise<void> {
  const userId = mx.getUserId();
  let keep = statusMsg;
  if (keep === undefined && userId) {
    keep = (await mx.getPresence(userId).catch(() => undefined))?.status_msg ?? mx.getUser(userId)?.presenceStatusMsg;
  }
  await mx.setPresence({ presence, ...(keep !== undefined && { status_msg: keep }) });
  await loadOwnPresence(mx);
}

/**
 * Reads the signed-in user's presence and status from the server into the local `User`, the way
 * an incoming m.presence event would. setPresence() never updates it from its own response, a
 * homeserver won't reliably echo your own presence back over /sync, and after a while away the
 * first sync may carry none at all, which left the status picker and Account Settings showing
 * no status (and saving that). Resolves to what the server has, or undefined if it couldn't say.
 */
export async function loadOwnPresence(mx: MatrixClient): Promise<{ presence: string; statusMsg?: string } | undefined> {
  const userId = mx.getUserId();
  if (!userId) return undefined;
  const stored = await mx.getPresence(userId).catch(() => undefined);
  if (!stored) return undefined;
  const user = mx.getUser(userId);
  if (user) {
    // Deliberately not User.setPresenceEvent(): it only fires UserEvent.Presence when the
    // presence *enum* itself changed, so a status-message-only edit (enum unchanged) would patch
    // presenceStatusMsg locally but never notify useOwnPresence's listener, leaving the UI stale.
    // Setting the fields directly and always emitting covers both cases.
    user.presence = stored.presence;
    user.presenceStatusMsg = stored.status_msg;
    user.emit(UserEvent.Presence, new MatrixEvent({ type: 'm.presence', sender: userId, content: stored }), user);
  }
  return { presence: stored.presence, statusMsg: stored.status_msg };
}
