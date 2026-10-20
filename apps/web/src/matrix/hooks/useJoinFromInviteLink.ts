import { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { selectedRoomIdAtom, selectedSpaceIdAtom, railSectionAtom } from '../../app/state/selection';
import { useMatrixClient } from '../MatrixClientContext';
import { getParentSpace } from '../voice';
import { joinTarget } from '../joinLinks';

export type JoinFromInviteLinkState =
  | { status: 'idle' }
  | { status: 'joining' }
  | { status: 'error'; message: string };

/**
 * The other half of inviteLinks.ts's buildInviteLink: on mount, checks for `?invite=<roomId>` in
 * the URL (the same query-param convention useOpenRoomFromNotification.ts uses for `?openRoom=`)
 * and, if present, actually JOINS that room — unlike openRoom, which assumes membership already
 * exists, an invite link visitor usually isn't a member yet. Strips the param from the URL
 * immediately, before the join even resolves, so a page refresh can't trigger a duplicate attempt
 * — this also means the param survives LoginScreen's onLoggedIn full-page reload for an
 * unauthenticated visitor (the URL is untouched until this effect itself runs, which only happens
 * once the app has a live MatrixClient to join with, i.e. after login/registration completes).
 *
 * Tries a plain join first, THEN retries with the link's `?via=` hint only if that fails — not the
 * other way around. Confirmed live against a real (disposable) Continuwuity homeserver that these
 * two cases both really happen and pull in opposite directions:
 * - A join with no via hint at all can fail outright — M_UNKNOWN "no servers that are in the room
 *   have been provided" — when the joining user's own homeserver has no resident member left in
 *   the room (e.g. the room's only-ever member on that homeserver already left it). `via` fixes
 *   this by pointing at a server that's actually still in the room.
 * - But unconditionally sending a `via` for a room the joining user's OWN homeserver already knows
 *   about in full (the common case — same homeserver as an existing member) can make Continuwuity
 *   specifically route the request through its federated-join code path instead of joining
 *   locally, attempting real outbound federation traffic for what was actually a fully local
 *   join, which fails in this project's own test environment (bare `http://`/`localhost`, no
 *   working self-federation) — and is a plausible cost even in production (a real federation round
 *   trip where none was needed). Plain-first avoids that cost whenever it isn't actually necessary.
 */
export function useJoinFromInviteLink(): JoinFromInviteLinkState {
  const mx = useMatrixClient();
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const [state, setState] = useState<JoinFromInviteLinkState>({ status: 'idle' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteRoomId = params.get('invite');
    if (!inviteRoomId) return undefined;

    // buildInviteLink always sets `via`. Falling back to the room ID's own `:server` suffix is
    // only for a hand-edited or older link — and only when the ID has one: from room version 12
    // on it doesn't, and taking "everything after the last colon" of such an ID used the whole ID
    // as a server name.
    const viaServer = params.get('via') ?? (inviteRoomId.includes(':') ? inviteRoomId.split(':').pop() : undefined);

    params.delete('invite');
    params.delete('via');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);

    let cancelled = false;
    setState({ status: 'joining' });
    void joinTarget(mx, { target: inviteRoomId, via: viaServer ? [viaServer] : [] })
      .then((room) => {
        if (cancelled) return;
        if (room.isSpaceRoom()) {
          setSelectedSpaceId(room.roomId);
          setSelectedRoomId(null);
          setRailSection('messages');
        } else {
          setSelectedSpaceId(getParentSpace(mx, room)?.roomId ?? null);
          setSelectedRoomId(room.roomId);
          setRailSection('messages');
        }
        setState({ status: 'idle' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to join.' });
      });
    return () => {
      cancelled = true;
    };
  }, [mx, setSelectedSpaceId, setSelectedRoomId, setRailSection]);

  return state;
}
