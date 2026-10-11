import { useState } from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { mobileSpacesOpenAtom } from '../../app/state/mobile';
import {
  globalFeedOpenAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
} from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useInvites } from '../../matrix/hooks/useInvites';
import { classifyInvite, parentSpaceOf } from '../../matrix/invites';
import { getParentSpace } from '../../matrix/voice';
import { InvitesModal } from './InvitesModal';

/** Goes to what an invite was to, once it's accepted: the Space, the channel in its Space, or the DM. */
function useOpenAcceptedInvite(): (room: Room) => void {
  const mx = useMatrixClient();
  const setMobileSpacesOpen = useSetAtom(mobileSpacesOpenAtom);
  const setGlobalFeedOpen = useSetAtom(globalFeedOpenAtom);
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);

  return (room) => {
    setMobileSpacesOpen(false);
    setGlobalFeedOpen(false);
    setProfileUserId(null);
    setSpaceView(null);
    const kind = classifyInvite(mx, room);
    if (kind === 'space') {
      // A Space opens fresh, with nothing chosen in it (ChannelList lands on its news or first channel).
      setSelectedSpaceId(room.roomId);
      setSelectedRoomId(null);
    } else if (kind === 'channel') {
      setSelectedSpaceId(getParentSpace(mx, room)?.roomId ?? parentSpaceOf(room)?.roomId ?? null);
      setSelectedRoomId(room.roomId);
    } else {
      setSelectedSpaceId(null);
      setSelectedRoomId(room.roomId);
    }
  };
}

/**
 * Invites waiting for an answer, at the top of Notifications: the rail has no Invites entry of its
 * own (as on the Ultimit mockup's rail), so this is where they're found, and Notify's count
 * includes them. Opens the list of invites; accepting one goes there. Nothing when there are none.
 */
export function InvitesWaiting() {
  const invites = useInvites();
  const [open, setOpen] = useState(false);
  const openAccepted = useOpenAcceptedInvite();
  if (invites.length === 0 && !open) return null;

  return (
    <>
      {invites.length > 0 && (
        <button type="button" className="nu-activity__invites" data-nu-role="activity-invites" onClick={() => setOpen(true)}>
          <Icon name="mail" size={16} />
          <span className="nu-activity__invites-text">
            {invites.length === 1 ? '1 invite waiting' : `${invites.length} invites waiting`}
          </span>
          <span className="nu-activity__invites-action">Open</span>
        </button>
      )}
      {open && (
        <InvitesModal
          onClose={() => setOpen(false)}
          onAccepted={(room) => {
            setOpen(false);
            openAccepted(room);
          }}
        />
      )}
    </>
  );
}
