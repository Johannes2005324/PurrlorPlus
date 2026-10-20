import { useEffect, useState, type FormEvent } from 'react';
import { useSetAtom } from 'jotai';
import type { IPublicRoomsChunkRoom, Room } from 'matrix-js-sdk';
import { railSectionAtom, profileUserIdAtom, selectedRoomIdAtom, selectedSpaceIdAtom, selectedSpaceViewAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { browsePublicSpaces } from '../../matrix/directory';
import { joinTarget, parseJoinTarget } from '../../matrix/joinLinks';
import { getParentSpace } from '../../matrix/voice';
import './Onboarding.css';

/** Shows what was just joined: a Space opens on its channels, a channel inside its Space. */
export function useOpenJoined(): (room: Room) => void {
  const mx = useMatrixClient();
  const setSpace = useSetAtom(selectedSpaceIdAtom);
  const setRoom = useSetAtom(selectedRoomIdAtom);
  const setView = useSetAtom(selectedSpaceViewAtom);
  const setFeedOpen = useSetAtom(railSectionAtom);
  const setProfile = useSetAtom(profileUserIdAtom);
  return (room) => {
    setFeedOpen('messages');
    setProfile(null);
    setView(null);
    if (room.isSpaceRoom()) {
      setSpace(room.roomId);
      setRoom(null);
    } else {
      setSpace(getParentSpace(mx, room)?.roomId ?? null);
      setRoom(room.roomId);
    }
  };
}

/**
 * "Paste an invite link or a Space address": a Purrlor invite link from any server, a matrix.to
 * link, or `#space:server` (matrix/joinLinks.ts).
 */
export function JoinWithLink({ onJoined }: { onJoined: (room: Room) => void }) {
  const mx = useMatrixClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (evt: FormEvent) => {
    evt.preventDefault();
    const parsed = parseJoinTarget(text);
    if (!parsed) {
      setError('That doesn’t look like an invite link or a Space address (like #cats:purr.example).');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onJoined(await joinTarget(mx, parsed));
      setText('');
    } catch (err) {
      setError(`Couldn’t join: ${err instanceof Error ? err.message : 'something went wrong'}. The link may have expired, or the Space may be invite-only.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="nu-onboarding__join-link" onSubmit={(evt) => void submit(evt)} data-nu-role="join-with-link">
      <label className="nu-field">
        Got an invite link?
        <span className="nu-onboarding__join-row">
          <input
            className="nu-field__input"
            data-nu-role="join-with-link-input"
            placeholder="Paste an invite link or a Space address"
            value={text}
            disabled={busy}
            onChange={(evt) => setText(evt.target.value)}
          />
          <button type="submit" className="nu-button nu-button--primary" disabled={busy || !text.trim()} data-nu-role="join-with-link-submit">
            {busy ? 'Joining…' : 'Join'}
          </button>
        </span>
      </label>
      {error && (
        <p className="nu-field__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function SpaceRow({ entry, joined, busy, onJoin }: { entry: IPublicRoomsChunkRoom; joined: boolean; busy: boolean; onJoin: () => void }) {
  const name = entry.name || entry.canonical_alias || 'A Space';
  return (
    <li className="nu-onboarding__space" data-nu-role="welcome-space">
      <Avatar name={name} mxcUrl={entry.avatar_url ?? null} size={40} />
      <span className="nu-onboarding__space-text">
        <span className="nu-onboarding__space-name">{name}</span>
        <span className="nu-onboarding__space-meta">
          {entry.num_joined_members} member{entry.num_joined_members === 1 ? '' : 's'}
          {entry.topic ? ` · ${entry.topic}` : ''}
        </span>
      </span>
      <button
        type="button"
        className={joined ? 'nu-button nu-button--secondary' : 'nu-button nu-button--primary'}
        data-nu-role="welcome-space-join"
        disabled={joined || busy}
        onClick={onJoin}
      >
        {joined ? 'Joined' : busy ? 'Joining…' : 'Join'}
      </button>
    </li>
  );
}

/**
 * The public Spaces on this server, biggest first, to join with one click, and a search for one
 * that isn't among the first few (by name or topic, the directory's own search).
 */
export function PublicSpacesToJoin({ onJoined, limit = 6 }: { onJoined: (room: Room) => void; limit?: number }) {
  const mx = useMatrixClient();
  const [spaces, setSpaces] = useState<IPublicRoomsChunkRoom[] | null>(null);
  const [joining, setJoining] = useState<string>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const term = search.trim();
    // Typing waits a moment before asking, so a word is one search, not one per letter.
    const timer = setTimeout(
      () => {
        browsePublicSpaces(mx, term ? { searchTerm: term } : {})
          .then((page) => {
            if (cancelled) return;
            setSpaces([...page.chunk].sort((a, b) => b.num_joined_members - a.num_joined_members));
            setSearched(!!term);
          })
          .catch(() => {
            if (!cancelled) setSpaces([]);
          });
      },
      term ? 300 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mx, search]);

  const join = async (entry: IPublicRoomsChunkRoom) => {
    setJoining(entry.room_id);
    setError(undefined);
    try {
      // Through joinTarget, which waits for the room to be known (a Space, not a channel).
      onJoined(await joinTarget(mx, { target: entry.canonical_alias || entry.room_id, via: [] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t join that Space');
    } finally {
      setJoining(undefined);
    }
  };

  if (spaces === null) return <p className="nu-field__hint">Looking for Spaces…</p>;
  if (spaces.length === 0 && !searched && !search.trim()) {
    return <p className="nu-field__hint">This server doesn’t list any public Spaces yet. Join one with a link, or start your own.</p>;
  }
  const isJoined = (roomId: string) => mx.getRoom(roomId)?.getMyMembership() === 'join';
  return (
    <>
      <input
        className="nu-field__input"
        type="search"
        data-nu-role="welcome-space-search"
        placeholder="Search this server’s Spaces"
        aria-label="Search this server’s Spaces"
        value={search}
        onChange={(evt) => setSearch(evt.target.value)}
      />
      {spaces.length === 0 && <p className="nu-field__hint">No public Space matches “{search.trim()}”.</p>}
      <ul className="nu-onboarding__spaces" data-nu-role="welcome-spaces">
        {spaces.slice(0, limit).map((entry) => (
          <SpaceRow
            key={entry.room_id}
            entry={entry}
            joined={isJoined(entry.room_id)}
            busy={joining === entry.room_id}
            onJoin={() => void join(entry)}
          />
        ))}
      </ul>
      {error && (
        <p className="nu-field__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
