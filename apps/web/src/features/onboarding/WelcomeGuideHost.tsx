import { useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
import { welcomeGuideOpenAtom } from '../../app/state/onboarding';
import { selectedRoomIdAtom, selectedSpaceIdAtom, railSectionAtom } from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import { shouldWelcome } from '../../matrix/onboarding';
import { DiscoverModal } from '../discover/DiscoverModal';
import { CreateSpaceModal } from '../servers/CreateSpaceModal';
import { JoinWithLink, useOpenJoined } from './JoinSpace';
import { WelcomeGuide } from './WelcomeGuide';
import './Onboarding.css';

/**
 * Opens the welcome guide by itself for someone new, once a sync from the server is in (so their
 * account data and Spaces are known, and someone who's seen it on another device isn't shown it
 * again). Not on the copy the app keeps from last time (`fromCache`), which comes first on a reload
 * and can predate joining a Space or closing the guide: deciding on that reopened it. And
 * whenever Account Settings asks for it. Waits while `blocked` (the recovery key prompt is up).
 */
export function WelcomeGuideHost({ blocked }: { blocked: boolean }) {
  const mx = useMatrixClient();
  const [open, setOpen] = useAtom(welcomeGuideOpenAtom);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (checked || blocked) return undefined;
    const decide = () => {
      setChecked(true);
      if (shouldWelcome(mx)) setOpen(true);
    };
    const live = (state: SyncState | null, data: { fromCache?: boolean } | null | undefined) =>
      state === SyncState.Syncing || (state === SyncState.Prepared && !data?.fromCache);
    if (live(mx.getSyncState(), mx.getSyncStateData())) {
      decide();
      return undefined;
    }
    const onSync = (next: SyncState, _prev: SyncState | null, data?: { fromCache?: boolean }) => {
      if (live(next, data)) {
        mx.removeListener(ClientEvent.Sync, onSync);
        decide();
      }
    };
    mx.on(ClientEvent.Sync, onSync);
    return () => {
      mx.removeListener(ClientEvent.Sync, onSync);
    };
  }, [mx, checked, blocked, setOpen]);

  if (!open || blocked) return null;
  return <WelcomeGuide onClose={() => setOpen(false)} />;
}

/**
 * The main pane for someone who isn't in any Space yet, in place of "Nothing open yet": the ways in
 * (find one, join with a link, start one) and the welcome guide again.
 */
export function NoSpacesYet() {
  const [showDiscover, setShowDiscover] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const openGuide = useSetAtom(welcomeGuideOpenAtom);
  const openJoined = useOpenJoined();
  const setSpace = useSetAtom(selectedSpaceIdAtom);
  const setRoom = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  return (
    <div className="nu-no-spaces" data-nu-role="no-spaces-yet">
      <Icon name="paw" size={40} className="nu-main-pane__empty-icon" />
      <h2 className="nu-no-spaces__title">You’re not in any Spaces yet</h2>
      <p className="nu-onboarding__lead">
        Spaces are where the chatting happens: communities with their own channels, voice rooms and posts. Find one, join
        one you were invited to, or start your own.
      </p>
      <div className="nu-no-spaces__actions">
        <button type="button" className="nu-button nu-button--primary" data-nu-role="no-spaces-discover" onClick={() => setShowDiscover(true)}>
          Find a Space
        </button>
        <button type="button" className="nu-button nu-button--secondary" data-nu-role="no-spaces-create" onClick={() => setShowCreate(true)}>
          Start your own
        </button>
        <button type="button" className="nu-button nu-button--secondary" data-nu-role="no-spaces-guide" onClick={() => openGuide(true)}>
          Show me around
        </button>
      </div>
      <JoinWithLink onJoined={openJoined} />
      {showDiscover && (
        <DiscoverModal
          onClose={() => setShowDiscover(false)}
          onJoinedSpace={(roomId) => {
            setShowDiscover(false);
            setSpace(roomId);
            setRoom(null);
            setRailSection('messages');
          }}
        />
      )}
      {showCreate && (
        <CreateSpaceModal
          onClose={() => setShowCreate(false)}
          onCreated={(roomId) => {
            setShowCreate(false);
            setSpace(roomId);
            setRoom(null);
            setRailSection('messages');
          }}
        />
      )}
    </div>
  );
}

/** Whether to show NoSpacesYet: someone in no Space at all. */
export function useInNoSpace(): boolean {
  return useSpaces().length === 0;
}
