import { useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { selectedSpaceIdAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { UnreadBadge } from '../../components/UnreadBadge';
import { locateInList, usePointerDrag } from '../../components/usePointerDrag';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useSpaceRooms } from '../../matrix/hooks/useSpaceRooms';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import { useAnyRoomHasUnread, useUnreadSummary } from '../../matrix/hooks/useUnreadCounts';
import { describeRoomLevel } from '../../matrix/notificationSettings';
import { moveSpace } from '../../matrix/spaceOrder';
import './ChatSpaces.css';

/** A Space's row in the Chat column: its picture, its name, and what's unread in it. */
function ChatSpaceRow({
  space,
  active,
  onSelect,
  dragging,
  clickAllowed,
  onPointerDown,
}: {
  space: Room;
  active: boolean;
  onSelect: () => void;
  dragging: boolean;
  clickAllowed: () => boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const mx = useMatrixClient();
  const rooms = useSpaceRooms(space.roomId);
  const unread = useUnreadSummary(rooms);
  // Something new the counts don't cover (a webhook's post, a message under "Only @mentions").
  const hasNew = useAnyRoomHasUnread(rooms, mx.getUserId() ?? '', (roomId) => describeRoomLevel(mx, roomId).effective === 'nothing');
  const isUnread = unread.total > 0 || hasNew;
  const className = [
    'nu-chat-spaces__row',
    active && 'nu-chat-spaces__row--active',
    isUnread && 'nu-chat-spaces__row--unread',
    dragging && 'nu-chat-spaces__row--dragging',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={className}
      data-nu-role="chat-space"
      title={space.name}
      aria-label={space.name}
      aria-current={active ? 'page' : undefined}
      data-nu-drag-space={space.roomId}
      onPointerDown={onPointerDown}
      onClick={() => {
        if (clickAllowed()) onSelect();
      }}
    >
      <Avatar name={space.name || '?'} mxcUrl={space.getMxcAvatarUrl()} size={28} />
      <span className="nu-chat-spaces__name">{space.name}</span>
      {unread.total > 0 ? <UnreadBadge total={unread.total} highlight={unread.highlight} /> : hasNew && <span className="nu-chat-spaces__dot" aria-label="Unread" />}
    </button>
  );
}

/** The "Spaces" section at the top level of Chat: one row per joined Space, draggable to reorder
 *  (components/usePointerDrag.ts, matrix/spaceOrder.ts). */
export function ChatSpaces({ onSelect }: { onSelect: (spaceId: string) => void }) {
  const mx = useMatrixClient();
  const storedSpaces = useSpaces();
  const selectedSpaceId = useAtomValue(selectedSpaceIdAtom);
  // Dragging a Space to another place: shown at once, saved behind it.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const storedIds = storedSpaces.map((space) => space.roomId).join('\n');
  useEffect(() => {
    if (!pendingOrder) return undefined;
    if (pendingOrder.join('\n') === storedIds) {
      setPendingOrder(null);
      return undefined;
    }
    const timer = setTimeout(() => setPendingOrder(null), 20_000);
    return () => clearTimeout(timer);
  }, [pendingOrder, storedIds]);
  const spaces = pendingOrder
    ? [
        ...pendingOrder.flatMap((id) => storedSpaces.filter((space) => space.roomId === id)),
        ...storedSpaces.filter((space) => !pendingOrder.includes(space.roomId)),
      ]
    : storedSpaces;
  const listRef = useRef<HTMLDivElement>(null);
  const spaceDrag = usePointerDrag<{ id: string; label: string }, number>({
    containerRef: listRef,
    enabled: true,
    locate: (item, clientY, container) => locateInList(container, 'data-nu-drag-space', item.id, clientY),
    drop: (item, index) => {
      const from = spaces.findIndex((space) => space.roomId === item.id);
      const ids = spaces.map((space) => space.roomId).filter((id) => id !== item.id);
      const at = Math.max(0, Math.min(from < index ? index - 1 : index, ids.length));
      const next = [...ids.slice(0, at), item.id, ...ids.slice(at)];
      if (next.join('\n') === spaces.map((space) => space.roomId).join('\n')) return;
      const before = spaces;
      setPendingOrder(next);
      moveSpace(mx, before, item.id, index).catch((err: unknown) => {
        console.error('Moving a Space failed', err);
        setPendingOrder(null);
      });
    },
  });

  return (
    <div className="nu-channel-list__category" data-nu-role="chat-spaces">
      <div className="nu-channel-list__section-header">Spaces</div>
      <div
        className={spaceDrag.dragging ? 'nu-chat-spaces__list nu-chat-spaces__list--dragging' : 'nu-chat-spaces__list'}
        data-nu-role="chat-space-list"
        ref={listRef}
      >
        {spaceDrag.lineTop !== null && <div className="nu-chat-spaces__drop-line" style={{ top: spaceDrag.lineTop }} aria-hidden="true" />}
        {spaces.map((space) => (
          <ChatSpaceRow
            key={space.roomId}
            space={space}
            active={selectedSpaceId === space.roomId}
            dragging={spaceDrag.dragging?.id === space.roomId}
            clickAllowed={spaceDrag.clickAllowed}
            onPointerDown={(event) => spaceDrag.start({ id: space.roomId, label: space.name }, event)}
            onSelect={() => onSelect(space.roomId)}
          />
        ))}
        {spaces.length === 0 && (
          <div className="nu-channel-list__empty" data-nu-role="chat-spaces-empty">
            No Spaces yet. Use Discover or Create on the rail.
          </div>
        )}
      </div>
      {spaceDrag.dragging && spaceDrag.pointer && (
        <div className="nu-chat-spaces__drag-label" style={{ left: spaceDrag.pointer.x + 14, top: spaceDrag.pointer.y + 14 }} aria-hidden="true">
          {spaceDrag.dragging.label}
        </div>
      )}
    </div>
  );
}
