/**
 * One tab at a time runs this browser's session.
 *
 * Every tab of Purrlor in a browser is the same Matrix device: they share its access token and its
 * Rust crypto store (client.ts). Two tabs running at once each keep their own copy of that store's
 * Olm and Megolm state in memory and write it back over each other. Keys one tab received or made
 * are lost when the other saves, and messages sent or received meanwhile come out "[unable to
 * decrypt]" on other people's devices, or on this one. Element locks for the same reason. Opening a
 * link to a post or a profile (target="_blank"), or the installed app beside a browser tab, made a
 * second tab easy to end up with.
 *
 * The newest tab wins: it takes the lock from whichever tab held it, and that tab stops its client
 * and says Purrlor is open somewhere else (App.tsx), with a way to take it back.
 */

const LOCK_NAME = 'purrlor-session';

/** How long a tab that took the lock from another waits before opening the crypto store, so the
 *  other tab has stopped its client and closed the store first. */
export const HANDOVER_MS = 500;

type LockManagerLike = Pick<LockManager, 'request' | 'query'>;

/**
 * Takes the session for this tab, from another tab if one has it, and resolves once it's held.
 * `onLost` runs if a newer tab takes it later. Browsers without Web Locks run unguarded, as before.
 */
export async function claimSession(
  onLost: () => void,
  locks: LockManagerLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks
): Promise<void> {
  if (!locks) return;
  const heldElsewhere = await locks
    .query()
    .then((state) => (state.held ?? []).some((lock) => lock.name === LOCK_NAME))
    .catch(() => false);
  await new Promise<void>((acquired) => {
    // `steal` rather than waiting: the tab holding it may be in the background for hours. The
    // holder's request then rejects with an AbortError, which is how it learns it lost the session.
    locks
      .request(LOCK_NAME, { steal: true }, () => {
        acquired();
        return new Promise<void>(() => {});
      })
      .catch(() => onLost());
  });
  if (heldElsewhere) await new Promise((resolve) => setTimeout(resolve, HANDOVER_MS));
}
