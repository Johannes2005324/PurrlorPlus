import { useAtom, useSetAtom } from 'jotai';
import { selectedRoomIdAtom, selectedSpaceIdAtom, railSectionAtom } from '../../app/state/selection';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useSavedMessages } from '../../matrix/hooks/useSavedMessages';
import { unsaveMessage } from '../../matrix/savedMessages';
import { getParentSpace } from '../../matrix/voice';
import './SavedMessagesModal.css';

/**
 * Everything you've starred via a message's "Save Message" hover action, across every room —
 * private to you (plain account data, see matrix/savedMessages.ts), separate from Pinned
 * Messages (room-wide, everyone sees those). Only shows what's actually loaded in memory for
 * that room right now (`room.findEventById`) — same "recent, not a complete archive" limitation
 * as the audit log, since fetching an arbitrary old event needing extra pagination isn't
 * something this modal does on your behalf.
 */
export function SavedMessagesModal({ onClose }: { onClose: () => void }) {
  const mx = useMatrixClient();
  const saved = useSavedMessages();
  const [, setSelectedSpaceId] = useAtom(selectedSpaceIdAtom);
  const [, setSelectedRoomId] = useAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);

  const sorted = [...saved].sort((a, b) => b.savedAt - a.savedAt);

  const openRoom = (roomId: string) => {
    const room = mx.getRoom(roomId);
    if (!room) return;
    setSelectedSpaceId(getParentSpace(mx, room)?.roomId ?? null);
    setSelectedRoomId(roomId);
    setRailSection('messages');
    onClose();
  };

  return (
    <Modal title="Saved Messages" onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="nu-saved-messages__empty" data-nu-role="saved-messages-empty">
          Nothing saved yet — use a message's 📑 action to save it here.
        </p>
      ) : (
        <div className="nu-saved-messages__list" data-nu-role="saved-messages-list">
          {sorted.map((item) => {
            const room = mx.getRoom(item.roomId);
            const event = room?.findEventById(item.eventId);
            const senderName = event?.sender?.name ?? event?.getSender() ?? '?';
            const body = event ? String(event.getContent().body ?? '') : null;
            return (
              <div className="nu-saved-messages__item" data-nu-role="saved-messages-item" key={`${item.roomId}:${item.eventId}`}>
                <button
                  type="button"
                  className="nu-saved-messages__item-open"
                  data-nu-role="saved-messages-open"
                  disabled={!room}
                  onClick={() => openRoom(item.roomId)}
                >
                  <span className="nu-saved-messages__item-room">{room?.name ?? 'Unknown channel'}</span>
                  {body ? (
                    <span className="nu-saved-messages__item-preview">
                      <strong>{senderName}:</strong> {body}
                    </span>
                  ) : (
                    <span className="nu-saved-messages__item-preview nu-saved-messages__item-preview--missing">
                      Message no longer available
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="nu-saved-messages__item-remove"
                  data-nu-role="saved-messages-remove"
                  title="Unsave"
                  onClick={() => void unsaveMessage(mx, item.roomId, item.eventId)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
