import { atom } from 'jotai';

/** One person in a call, as the lists of who's in it show them. */
export type CallPerson = {
  /** Their Matrix user ID (LiveKit identities are Matrix user IDs). */
  identity: string;
  /** When they joined, in ms; unknown for a token server older than this field. */
  joinedAt?: number;
  micMuted: boolean;
  deafened: boolean;
  /** Only known for the call you're in: you hear it, the token server's poll doesn't. */
  speaking?: boolean;
};

/**
 * The order everyone in a call is listed in, and the same for everyone in it: who joined first,
 * first. LiveKit hands people out in no set order (each person saw themselves first, the rest in
 * whatever order they reached them, and the channel list's poll could shuffle between answers).
 */
export function byJoinOrder<T extends { identity: string; joinedAt?: number }>(people: readonly T[]): T[] {
  return [...people].sort(
    (a, b) => (a.joinedAt ?? Infinity) - (b.joinedAt ?? Infinity) || a.identity.localeCompare(b.identity)
  );
}

/**
 * The call you're in, live from LiveKit (CallPresenceBridge, inside the call's room): who's in it
 * and who's talking right now. The channel list shows this under the call's channel in place of
 * its 5-second poll, so it keeps up and lights up whoever is speaking. Kept here, not read with
 * LiveKit's hooks, so the channel list doesn't pull LiveKit into the main bundle.
 */
export const liveCallAtom = atom<{ roomId: string; people: CallPerson[] } | null>(null);
