import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { NowPlayingCard } from '../voice/NowPlayingCard';
import { MusicPlayerBar } from '../music/MusicPlayerBar';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import {
  activeVoiceChannelIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
  channelComposerFocusAtom,
  globalFeedOpenAtom,
  railSectionAtom,
  openPostAtom,
  profileUserIdAtom,
} from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { useConfirm } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { Menu, MenuItem } from '../../components/Menu';
import { UnreadBadge } from '../../components/UnreadBadge';
import { useHasNewPosts } from '../../matrix/hooks/useHasNewPosts';
import { useSpaceNews } from '../../matrix/hooks/useSpaceNews';
import { spaceLanding } from '../../matrix/spaceNews';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { leaveDirectMessage } from '../../matrix/directMessages';
import { CHANNEL_CATEGORIES_EVENT_TYPE, getChannelCategories, reorderCategoryChannels, type ChannelCategory } from '../../matrix/channelCategories';
import { sameLayout, saveChannelLayout, type ChannelLayout } from '../../matrix/channelLayout';
import { useChannelDrag } from './useChannelDrag';
import { useChannelCategories } from '../../matrix/hooks/useChannelCategories';
import { useChannelType } from '../../matrix/hooks/useChannelType';
import { useRoomEncrypted } from '../../matrix/hooks/useRoomEncrypted';
import { usePresence } from '../../matrix/hooks/usePresence';
import { useRoom } from '../../matrix/hooks/useRoom';
import {
  useAnyRoomHasUnread,
  useDirectMessageUnread,
  useRoomHasUnread,
  useRoomUnreadCount,
  useUnreadSummary,
} from '../../matrix/hooks/useUnreadCounts';
import { useRoomNotificationLevel } from '../../matrix/hooks/useNotificationLevel';
import { describeRoomLevel } from '../../matrix/notificationSettings';
import { prepareRoom } from '../../matrix/historyPrefetch';
import { LEVEL_LABELS, RoomNotificationMenu } from '../notifications/NotificationLevelMenu';
import { useSpaceHierarchy, type HierarchyChannel } from '../../matrix/hooks/useSpaceHierarchy';
import { listChildRooms, useSpaceRooms } from '../../matrix/hooks/useSpaceRooms';
import { useSpacelessRooms } from '../../matrix/hooks/useSpacelessRooms';
import { useSpaceVoiceServer } from '../../matrix/hooks/useSpaceVoiceServer';
import { useVoiceChannelParticipants } from '../../matrix/hooks/useVoiceChannelParticipants';
import { byJoinOrder, liveCallAtom } from '../voice/callPresence';
import type { VoiceServerConfig } from '../../matrix/voice';
import { autoJoinSpaceChannels } from '../../matrix/autoJoin';
import { joinPublicRoom } from '../../matrix/directory';
import { canSendStateEvent } from '../../matrix/permissions';
import { isDemoMode } from '../../demo/demoMode';
import { adoptDefaultVoiceServer } from '../../matrix/deploymentDefaults';
import { addVoiceHints, removeRoomFromSpace, reorderSpaceChildren } from '../../matrix/spaceChildren';
import { useVoiceCall } from '../voice/voiceCallContext';
import { UserPanel } from '../account/UserPanel';
import { AddExistingChannelModal } from './AddExistingChannelModal';
import { CreateChannelModal } from './CreateChannelModal';
import { SpaceCard } from './SpaceCard';
import { SocialNav } from '../feed/SocialNav';
import { StartDmModal } from './StartDmModal';
import { SpaceSettingsModal } from '../servers/SpaceSettingsModal';
import { ChannelPermissionsModal } from './ChannelPermissionsModal';
import { WebhooksModal } from './WebhooksModal';
import { canEditChannelSettings, ChannelSettingsModal } from './ChannelSettingsModal';
import { canManageWebhooks } from '../../matrix/webhooks';
import { CHANNEL_SETTINGS_EVENT } from '../../matrix/channelPermissions';
import './ChannelList.css';

/** Where the shell shows one screen at a time (styles/base/shell.css). */
const PHONE_WIDTH = '(max-width: 900px)';

/** For a genuine 1:1 DM (exactly one other joined member), the person on the other end — used
 *  to show a presence dot the way a DM list normally would. Group chats skip it: there's no
 *  single "other person" to represent with one dot. */
function useDmCounterpart(room: Room, isDirectMessage: boolean): string | undefined {
  const mx = useMatrixClient();
  if (!isDirectMessage) return undefined;
  const myUserId = mx.getUserId();
  const others = room.getJoinedMembers().filter((member) => member.userId !== myUserId);
  return others.length === 1 ? others[0].userId : undefined;
}

/** Who's actually connected to a voice channel right now, shown as a short indented list
 *  under its row — the occupancy indicator the README long flagged as deferred. In the order they
 *  joined; for the call you're in, live from the call itself, with whoever's talking lit up. */
function VoiceChannelOccupants({ room, voiceServer }: { room: Room; voiceServer: VoiceServerConfig | undefined }) {
  const polled = useVoiceChannelParticipants(room.roomId, voiceServer);
  const liveCall = useAtomValue(liveCallAtom);
  const participants = byJoinOrder(liveCall?.roomId === room.roomId ? liveCall.people : polled);

  if (participants.length === 0) return null;

  return (
    <ul className="nu-channel-list__occupants" data-nu-role="channel-list-occupants">
      {participants.map((p) => {
        const { identity, micMuted, deafened } = p;
        const speaking = 'speaking' in p && !!p.speaking;
        const member = room.getMember(identity);
        const name = member?.name || identity;
        return (
          <li
            key={identity}
            className={speaking ? 'nu-channel-list__occupant nu-channel-list__occupant--speaking' : 'nu-channel-list__occupant'}
            data-nu-role="channel-list-occupant"
            data-nu-speaking={speaking || undefined}
          >
            <span className="nu-channel-list__occupant-avatar">
              <Avatar name={name} mxcUrl={member?.getMxcAvatarUrl() ?? null} size={16} />
            </span>
            <span className="nu-channel-list__occupant-name">{name}</span>
            {micMuted && (
              <span className="nu-channel-list__occupant-icon" aria-label="Muted" title="Muted">
                <Icon name="micOff" size={13} />
              </span>
            )}
            {deafened && (
              <span className="nu-channel-list__occupant-icon" aria-label="Deafened" title="Deafened">
                <Icon name="headphonesOff" size={13} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A channel row's place, for dragging it (useChannelDrag.ts). */
type RowDrag = {
  categoryId: string | null;
  index: number;
  dragging: boolean;
  clickAllowed: () => boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

function ChannelListRow({
  room,
  isDirectMessage,
  active,
  voiceServer,
  onSelect,
  canManageSpace,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemoveFromSpace,
  onOpenPermissions,
  onOpenWebhooks,
  onOpenSettings,
  onLeave,
  drag,
}: {
  room: Room;
  isDirectMessage: boolean;
  active: boolean;
  voiceServer: VoiceServerConfig | undefined;
  onSelect: () => void;
  canManageSpace: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveFromSpace: () => void;
  /** Channels of a Space only; shown to whoever can change any of the channel's permissions. */
  onOpenPermissions?: () => void;
  /** Same, for a channel's webhooks (matrix/webhooks.ts). */
  onOpenWebhooks?: () => void;
  /** A channel's name, topic and avatar. */
  onOpenSettings?: () => void;
  /** DMs and group chats only: leave it, which takes it off your list (leaveDirectMessage). */
  onLeave?: () => void;
  /** Where it sits, for dragging (useChannelDrag.ts); absent where channels can't be dragged. */
  drag?: RowDrag;
}) {
  const counterpartId = useDmCounterpart(room, isDirectMessage);
  const presence = usePresence(counterpartId ?? '');
  const channelType = useChannelType(room);
  const encrypted = useRoomEncrypted(room);
  const setActiveVoiceChannelId = useSetAtom(activeVoiceChannelIdAtom);
  const mx = useMatrixClient();
  const unread = useRoomUnreadCount(room);
  const { effective: level } = useRoomNotificationLevel(room.roomId);
  // The counts follow push rules, so they miss plain messages under "Only @mentions" and
  // notices (webhooks, bots) under any level; read receipts don't. A muted channel stays quiet.
  const hasNewMessages = useRoomHasUnread(room, mx.getUserId() ?? '', level !== 'nothing');
  const myUserId = mx.getUserId() ?? '';
  // In a DM every message is for you, so each one counts the way a mention does in a channel:
  // a red number (Discord's DMs work the same way). Set to "Only @mentions", it's back to mentions.
  const dmUnread = useDirectMessageUnread(room, myUserId, isDirectMessage && level === 'all');
  const isUnread = level !== 'nothing' && (unread.total > 0 || hasNewMessages || dmUnread > 0);
  const canEditWebhooks = !!onOpenWebhooks && canManageWebhooks(room, myUserId);
  const canEditSettings = !!onOpenSettings && canEditChannelSettings(room, myUserId);
  const canEditPermissions =
    !!onOpenPermissions &&
    (canSendStateEvent(room, myUserId, 'm.room.power_levels') || canSendStateEvent(room, myUserId, CHANNEL_SETTINGS_EVENT));

  const handleSelect = () => {
    if (drag && !drag.clickAllowed()) return;
    onSelect();
    // Clicking a voice channel joins it immediately — Discord's model, no separate "Join
    // voice" click required when you're getting there via the channel list.
    if (channelType === 'voice') setActiveVoiceChannelId(room.roomId);
  };

  return (
    <div
      className={['nu-channel-list__row', drag && 'nu-channel-list__row--draggable', drag?.dragging && 'nu-channel-list__row--dragging']
        .filter(Boolean)
        .join(' ')}
      data-nu-role="channel-list-row"
      {...(drag && {
        'data-nu-drag-channel': room.roomId,
        'data-nu-drag-category': drag.categoryId ?? '',
        'data-nu-drag-index': drag.index,
        onPointerDown: drag.onPointerDown,
      })}
    >
      <button
        type="button"
        className={[
          'nu-channel-list__item',
          active && 'nu-channel-list__item--active',
          isUnread && 'nu-channel-list__item--unread',
          level === 'nothing' && 'nu-channel-list__item--muted',
        ]
          .filter(Boolean)
          .join(' ')}
        data-nu-role="channel-list-item"
        aria-current={active ? 'page' : undefined}
        onClick={handleSelect}
        // About to open it, probably: have its history and media ready (matrix/historyPrefetch.ts).
        onPointerEnter={() => prepareRoom(mx, room)}
        onFocus={() => prepareRoom(mx, room)}
      >
        {isDirectMessage ? (
          <Avatar
            name={room.name}
            mxcUrl={room.getMxcAvatarUrl()}
            size={20}
            presence={counterpartId ? presence ?? 'offline' : undefined}
          />
        ) : (
          <span className="nu-channel-list__item-icon" aria-hidden="true">
            <Icon name={channelType === 'voice' ? 'volume' : 'hash'} size={18} />
          </span>
        )}
        <span className={isUnread ? 'nu-channel-list__item-name nu-channel-list__item-name--unread' : 'nu-channel-list__item-name'}>
          {room.name}
        </span>
        {encrypted && (
          <span className="nu-channel-list__item-level" title="End-to-end encrypted" data-nu-role="channel-list-item-encrypted">
            <Icon name="lock" size={12} />
          </span>
        )}
        {level !== 'all' && (
          <span
            className="nu-channel-list__item-level"
            title={`Notifications: ${LEVEL_LABELS[level]}`}
            data-nu-role="channel-list-item-level"
          >
            <Icon name={level === 'nothing' ? 'bellOff' : 'at'} size={12} />
          </span>
        )}
        {dmUnread > 0 ? (
          <UnreadBadge total={dmUnread} highlight={dmUnread} />
        ) : (
          <UnreadBadge total={unread.total} highlight={unread.highlight} />
        )}
      </button>
      <div className="nu-channel-list__row-actions" data-nu-role="channel-list-row-actions" data-nu-drag-ignore="">
        <RoomNotificationMenu roomId={room.roomId} triggerClassName="nu-channel-list__row-action" />
        {/* One "⋯" for everything else, so a hovered row keeps most of its name clickable. */}
        {(canEditSettings || canEditPermissions || canEditWebhooks || (!isDirectMessage && canManageSpace) || !!onLeave) && (
          <Menu
            label="Channel options"
            trigger={<Icon name="more" size={13} />}
            triggerClassName="nu-channel-list__row-action"
            role="channel-list-row-menu"
            align="end"
          >
            {canEditSettings && (
              <MenuItem icon="settings" role="channel-list-settings" onSelect={() => onOpenSettings?.()}>
                Settings
              </MenuItem>
            )}
            {canEditPermissions && (
              <MenuItem icon="shield" role="channel-list-permissions" onSelect={() => onOpenPermissions?.()}>
                Permissions
              </MenuItem>
            )}
            {canEditWebhooks && (
              <MenuItem icon="link" role="channel-list-webhooks" onSelect={() => onOpenWebhooks?.()}>
                Webhooks
              </MenuItem>
            )}
            {!isDirectMessage && canManageSpace && canMoveUp && (
              <MenuItem icon="arrowUp" role="channel-list-move-up" onSelect={onMoveUp}>
                Move up
              </MenuItem>
            )}
            {!isDirectMessage && canManageSpace && canMoveDown && (
              <MenuItem icon="arrowDown" role="channel-list-move-down" onSelect={onMoveDown}>
                Move down
              </MenuItem>
            )}
            {!isDirectMessage && canManageSpace && (
              <MenuItem icon="x" role="channel-list-remove-from-space" danger onSelect={onRemoveFromSpace}>
                Remove from Space
              </MenuItem>
            )}
            {onLeave && (
              <MenuItem icon="logOut" role="channel-list-leave" danger onSelect={onLeave}>
                Leave conversation
              </MenuItem>
            )}
          </Menu>
        )}
      </div>
      {!isDirectMessage && channelType === 'voice' && (
        <VoiceChannelOccupants room={room} voiceServer={voiceServer} />
      )}
    </div>
  );
}

/**
 * A channel that exists in the Space's hierarchy (`GET /rooms/{spaceId}/hierarchy`) but isn't
 * one of this client's already-known/joined rooms — otherwise entirely invisible, since every
 * other list here (`useSpaceRooms`) only ever sees children it already has a local `Room` object
 * for. Text/voice can't be told apart before joining (the hierarchy summary doesn't carry this
 * app's custom `xyz.nekous.channel_type` state event), so every row gets a plain "#" regardless —
 * resolves to the right icon automatically once joined and rendered as a normal ChannelListRow.
 */
function UnjoinedChannelRow({ entry, onJoined }: { entry: HierarchyChannel; onJoined: (roomId: string) => void }) {
  const mx = useMatrixClient();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();
  const name = entry.name || entry.canonical_alias || entry.room_id;

  const handleJoin = async () => {
    setJoining(true);
    setError(undefined);
    try {
      const roomId = await joinPublicRoom(mx, entry.canonical_alias || entry.room_id);
      onJoined(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
      setJoining(false);
    }
  };

  return (
    <div className="nu-channel-list__unjoined-row" data-nu-role="channel-list-unjoined-row" title={error}>
      <span className="nu-channel-list__item-icon" aria-hidden="true">
        <Icon name="hash" size={18} />
      </span>
      <span className="nu-channel-list__unjoined-name">{name}</span>
      <button
        type="button"
        className="nu-channel-list__unjoined-join"
        data-nu-role="channel-list-unjoined-join"
        disabled={joining}
        onClick={handleJoin}
      >
        {joining ? 'Joining…' : error ? 'Retry' : 'Join'}
      </button>
    </div>
  );
}

/**
 * Joins every channel listed under "More channels" that doesn't need an invite — for a Space you
 * were in before joining a Space started joining its channels for you (matrix/autoJoin.ts).
 * Includes channels you once left: clicking this asks for all of them.
 */
function JoinAllButton({ spaceId, count }: { spaceId: string; count: number }) {
  const mx = useMatrixClient();
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState(false);
  if (count < 2) return null;
  return (
    <button
      type="button"
      className="nu-channel-list__join-all"
      data-nu-role="channel-list-join-all"
      disabled={joining}
      title={failed ? 'Some channels couldn’t be joined. They may need an invite.' : `Join all ${count} channels`}
      onClick={() => {
        setJoining(true);
        setFailed(false);
        autoJoinSpaceChannels(mx, spaceId, { includeLeft: true })
          .then((joined) => setFailed(joined.length < count))
          .catch(() => setFailed(true))
          .finally(() => setJoining(false));
      }}
    >
      {joining ? 'Joining…' : 'Join all'}
    </button>
  );
}

/** Persistent bar showing the active voice call regardless of what's selected/viewed — lets
 *  you mute/deafen/leave while looking at an unrelated text channel instead of the call UI.
 *
 *  Shown for every stage of a call, not just a connected one: a join that's still negotiating
 *  (or that failed) is just as much "the channel you're currently in", and hiding the bar until
 *  `ready` meant navigating away mid-connect left no indication a call was in progress at all —
 *  and no way to abandon a failed one without going back to find the channel by hand. */
function ActiveCallBar() {
  const call = useVoiceCall();
  const room = useRoom(call?.roomId ?? null);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);

  if (!call || call.state.status === 'idle' || !room) return null;

  const status = call.state.status;
  const label =
    status === 'ready' ? room.name : status === 'error' ? `${room.name} — couldn't connect` : `${room.name} — connecting…`;

  return (
    <div
      className="nu-channel-list__active-call"
      data-nu-role="active-call-bar"
      data-nu-call-status={status}
    >
      <button
        type="button"
        className="nu-channel-list__active-call-info"
        onClick={() => setSelectedRoomId(room.roomId)}
        title={status === 'ready' ? `Back to call in ${label}` : label}
      >
        <span className={`nu-channel-list__active-call-status nu-channel-list__active-call-status--${status}`}>
          {status === 'ready' ? 'Voice connected' : status === 'error' ? 'Couldn’t connect' : 'Connecting…'}
        </span>
        <span className="nu-channel-list__active-call-name">{room.name}</span>
      </button>
      <button
        type="button"
        className="nu-channel-list__active-call-leave"
        onClick={call.leave}
        title="Leave voice"
        aria-label="Leave voice"
      >
        <Icon name="phoneOff" size={18} />
      </button>
    </div>
  );
}

/** A category's collapsible header. Collapsed, it still owes you a signal: an unread dot if any
 *  channel inside has something new, and how many channels it's hiding. */
function CategoryHeader({
  categoryId,
  name,
  rooms,
  collapsed,
  onToggle,
  drag,
}: {
  categoryId: string;
  name: string;
  rooms: Room[];
  collapsed: boolean;
  onToggle: () => void;
  /** Dragging the header moves the category (useChannelDrag.ts); absent where it can't be dragged. */
  drag?: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void; clickAllowed: () => boolean };
}) {
  const mx = useMatrixClient();
  const unread = useUnreadSummary(rooms);
  const hasNew = useAnyRoomHasUnread(rooms, mx.getUserId() ?? '', (roomId) => describeRoomLevel(mx, roomId).effective === 'nothing');
  return (
    <button
      type="button"
      className={[
        'nu-channel-list__category-header',
        collapsed && 'nu-channel-list__category-header--collapsed',
        drag && 'nu-channel-list__category-header--draggable',
      ]
        .filter(Boolean)
        .join(' ')}
      data-nu-role="channel-list-category-header"
      data-nu-drag-header={categoryId}
      data-nu-drag-count={rooms.length}
      aria-expanded={!collapsed}
      onPointerDown={drag?.onPointerDown}
      onClick={() => {
        if (!drag || drag.clickAllowed()) onToggle();
      }}
    >
      <Icon name="chevronDown" size={12} className="nu-channel-list__category-arrow" />
      <span className="nu-channel-list__category-name">{name}</span>
      {collapsed && (
        <span className="nu-channel-list__category-count">
          {(unread.total > 0 || hasNew) && <span className="nu-channel-list__category-unread" aria-label="Unread" />}
          {rooms.length}
        </span>
      )}
    </button>
  );
}

/** Which categories are collapsed, per-Space — purely local display state (not synced to other
 *  members or even this account's other devices, unlike the categories themselves), persisted
 *  to localStorage the same lightweight way theme.ts persists the custom-theme override. */
function useCollapsedCategories(spaceId: string | null): [Set<string>, (categoryId: string) => void] {
  const storageKey = spaceId ? `nekous_collapsed_categories:${spaceId}` : null;

  const readStored = (key: string | null): Set<string> => {
    if (!key) return new Set();
    try {
      const raw = localStorage.getItem(key);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  };

  const [collapsed, setCollapsed] = useState<Set<string>>(() => readStored(storageKey));

  useEffect(() => {
    setCollapsed(readStored(storageKey));
     
  }, [storageKey]);

  const toggle = (categoryId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // Best-effort — a full/blocked localStorage just means collapse state won't survive
          // a reload, not that toggling it right now should fail.
        }
      }
      return next;
    });
  };

  return [collapsed, toggle];
}

/** Spaces whose voice links this session has already checked (see the effect in ChannelList). */
const voiceHintedSpaces = new Set<string>();
/** Spaces already offered this deployment's voice server this session (deploymentDefaults.ts). */
const voiceDefaultedSpaces = new Set<string>();

/**
 * Second column. Two modes, toggled by the server rail's pinned Home/DM icon
 * (selectedSpaceId === null): the Direct Messages list (1:1s and group chats alike — see
 * useSpacelessRooms), or the selected Space's channels. While the social side is open (the
 * rail's globe or bell) it's the social side's own navigation instead (SocialNav).
 */
export function ChannelList() {
  const mx = useMatrixClient();
  const selectedSpaceId = useAtomValue(selectedSpaceIdAtom);
  const [selectedRoomId, setSelectedRoomId] = useAtom(selectedRoomIdAtom);
  const [spaceView, setSpaceView] = useAtom(selectedSpaceViewAtom);
  const [globalFeedOpen, setGlobalFeedOpen] = useAtom(globalFeedOpenAtom);
  const section = useAtomValue(railSectionAtom);
  const [profileUserId, setProfileUserId] = useAtom(profileUserIdAtom);
  const openPost = useAtomValue(openPostAtom);
  const space = useRoom(selectedSpaceId);
  const newPosts = useHasNewPosts(space ?? null);
  const spaceNews = useSpaceNews(space ?? null);
  const spaceRooms = useSpaceRooms(selectedSpaceId);
  const categories = useChannelCategories(space);
  const [collapsedCategories, toggleCategoryCollapsed] = useCollapsedCategories(selectedSpaceId);
  const directMessages = useSpacelessRooms();
  const hierarchy = useSpaceHierarchy(selectedSpaceId);
  const joinedChannelIds = new Set(spaceRooms.map((r) => r.roomId));
  // A channel you're already invited to (not just a discoverable stranger channel) gets a real
  // Accept/Decline through the Invites flow instead — no need to also list it here with a plain
  // Join button that skips past the "who invited you" context that flow has.
  const unjoinedChannels = hierarchy.filter(
    (entry) => !joinedChannelIds.has(entry.room_id) && mx.getRoom(entry.room_id)?.getMyMembership() !== 'invite'
  );
  const voiceServer = useSpaceVoiceServer(space);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showSpaceSettings, setShowSpaceSettings] = useState(false);
  const [permissionsRoom, setPermissionsRoom] = useState<Room | null>(null);
  const [webhooksRoom, setWebhooksRoom] = useState<Room | null>(null);
  const [settingsRoom, setSettingsRoom] = useState<Room | null>(null);
  const [showStartDm, setShowStartDm] = useState(false);
  const [showAddExistingChannel, setShowAddExistingChannel] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Picking a channel also leaves the Posts view, which sits alongside channels rather than
  // being one of them — otherwise the feed would stay on screen over a channel that now looks
  // selected in this list.
  const requestComposerFocus = useSetAtom(channelComposerFocusAtom);
  const selectChannel = (roomId: string) => {
    requestComposerFocus((n) => n + 1);
    setSelectedRoomId(roomId);
    setSpaceView(null);
    setGlobalFeedOpen(false);
    setProfileUserId(null);
  };

  // Opening a Space leaves nothing selected in it (the rail's selectSpace). Its unseen news comes
  // first, else its first text channel from the top of this list (matrix/spaceNews.ts), so a Space
  // never opens onto an empty page. Anything already chosen — a channel, Posts, Events, a jump to
  // a message from a notification — is left alone.
  // Not on a phone: there the page is this channel list until something is picked, and Back from a
  // chat leaves nothing chosen, so landing would put you straight back in the chat you just left.
  const nothingChosen = section === 'messages' && !!space && !selectedRoomId && spaceView === null && !globalFeedOpen && !profileUserId && !openPost;
  useEffect(() => {
    if (!space || !nothingChosen || window.matchMedia?.(PHONE_WIDTH).matches) return;
    // Read fresh, not from spaceRooms/categories: right after switching Spaces those still hold the
    // last Space's lists for a render (their hooks catch up in an effect), and landing on them sent
    // you to the last Space's first channel. They're still deps, so a Space whose channels are
    // still loading gets its landing once they arrive.
    const landing = spaceLanding(mx, space, listChildRooms(mx, space.roomId), getChannelCategories(space));
    if (landing.kind === 'news') setSpaceView('news');
    else if (landing.kind === 'channel') setSelectedRoomId(landing.roomId);
  }, [mx, space, nothingChosen, spaceRooms, categories, setSpaceView, setSelectedRoomId]);

  const isDirectMessagesView = selectedSpaceId === null;
  const canManageSpace = space ? canSendStateEvent(space, mx.getUserId() ?? '', 'm.room.name') : false;
  const canLinkChannels = space ? canSendStateEvent(space, mx.getUserId() ?? '', 'm.space.child') : false;

  // Voice channels made before their Space link said "voice" get the marker the first time an
  // admin opens the Space, so the voice bot can find and join them (spaceChildren.ts).
  useEffect(() => {
    if (!space || !canLinkChannels || voiceHintedSpaces.has(space.roomId)) return;
    voiceHintedSpaces.add(space.roomId);
    addVoiceHints(mx, space, spaceRooms).catch(() => voiceHintedSpaces.delete(space.roomId));
  }, [mx, space, canLinkChannels, spaceRooms]);

  // A Space on a fresh install gets this deployment's voice server the first time an admin opens
  // it, so voice channels just work — nobody has to find and paste the LiveKit URLs.
  useEffect(() => {
    if (!space || isDemoMode() || voiceDefaultedSpaces.has(space.roomId)) return;
    voiceDefaultedSpaces.add(space.roomId);
    adoptDefaultVoiceServer(mx, space).catch(() => voiceDefaultedSpaces.delete(space.roomId));
  }, [mx, space]);

  // A channel belongs to at most one category (Discord's own model) — anything not listed in
  // any category's channelIds renders flat, above the categories, exactly like every Space
  // looked before categories existed (see channelCategories.ts).
  const categorizedIds = new Set(categories.flatMap((c) => c.channelIds));
  const uncategorizedRooms = spaceRooms.filter((r) => !categorizedIds.has(r.roomId));
  const roomById = new Map(spaceRooms.map((r) => [r.roomId, r]));
  const categoryRooms = categories.map((category) => ({
    category,
    // A category can reference a channel that's since been removed from the Space entirely
    // (deleteCategory-style — membership is derived from listing, not a back-reference kept in
    // sync) — filter those out rather than rendering a dead row.
    rooms: category.channelIds.map((id) => roomById.get(id)).filter((r): r is Room => !!r),
  }));

  // Dragging (useChannelDrag.ts): the order as stored, and the one just dropped, shown at once while
  // it's saved (a move to the top rewrites several channel links one by one).
  const storedLayout: ChannelLayout = {
    uncategorized: uncategorizedRooms.map((r) => r.roomId),
    categories: categoryRooms.map(({ category, rooms }) => ({ id: category.id, channelIds: rooms.map((r) => r.roomId) })),
  };
  const [pendingLayout, setPendingLayout] = useState<{ spaceId: string; layout: ChannelLayout } | null>(null);
  const [dragError, setDragError] = useState<string>();
  const shownLayout = pendingLayout && pendingLayout.spaceId === selectedSpaceId ? pendingLayout.layout : storedLayout;
  // Once the stored order catches up with the drop, there's nothing pending; if it never does
  // (someone else moved things meanwhile), the stored one wins after a while.
  const storedKey = JSON.stringify(storedLayout);
  useEffect(() => {
    if (!pendingLayout) return undefined;
    if (sameLayout(pendingLayout.layout, JSON.parse(storedKey) as ChannelLayout)) {
      setPendingLayout(null);
      return undefined;
    }
    const timer = setTimeout(() => setPendingLayout(null), 20_000);
    return () => clearTimeout(timer);
  }, [pendingLayout, storedKey]);
  const canArrange = !!space && canLinkChannels && canSendStateEvent(space, mx.getUserId() ?? '', CHANNEL_CATEGORIES_EVENT_TYPE);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useChannelDrag({
    containerRef: bodyRef,
    enabled: canArrange,
    layout: shownLayout,
    onDrop: (next) => {
      if (!space) return;
      const before = shownLayout;
      setDragError(undefined);
      setPendingLayout({ spaceId: space.roomId, layout: next });
      saveChannelLayout(mx, space, before, next).catch((err: unknown) => {
        console.error('Moving a channel failed', err);
        setPendingLayout(null);
        setDragError('Couldn’t move that. Check your connection and try again.');
      });
    },
  });
  const shownUncategorized = shownLayout.uncategorized.map((id) => roomById.get(id)).filter((r): r is Room => !!r);
  const shownCategories = shownLayout.categories.flatMap(({ id, channelIds }) => {
    const found = categoryRooms.find((entry) => entry.category.id === id);
    return found ? [{ category: found.category, rooms: channelIds.map((roomId) => roomById.get(roomId)).filter((r): r is Room => !!r) }] : [];
  });
  const rowDrag = (room: Room, categoryId: string | null, index: number): RowDrag | undefined =>
    canArrange
      ? {
          categoryId,
          index,
          dragging: drag.dragging?.kind === 'channel' && drag.dragging.id === room.roomId,
          clickAllowed: drag.clickAllowed,
          onPointerDown: (event) => drag.start({ kind: 'channel', id: room.roomId, label: room.name }, event),
        }
      : undefined;

  const handleMoveInUncategorized = (index: number, direction: -1 | 1) => {
    if (!space) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= uncategorizedRooms.length) return;
    const newOrder = uncategorizedRooms.map((r) => r.roomId);
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
    reorderSpaceChildren(mx, space, newOrder).catch(console.error);
  };

  const handleMoveInCategory = (category: ChannelCategory, rooms: Room[], index: number, direction: -1 | 1) => {
    if (!space) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rooms.length) return;
    const newOrder = rooms.map((r) => r.roomId);
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
    reorderCategoryChannels(mx, space, category.id, newOrder).catch(console.error);
  };

  const handleRemoveFromSpace = (roomId: string) => {
    if (!selectedSpaceId) return;
    removeRoomFromSpace(mx, selectedSpaceId, roomId).catch(console.error);
    if (selectedRoomId === roomId) setSelectedRoomId(null);
  };

  const handleLeaveConversation = async (room: Room) => {
    const others = room.getJoinedMemberCount() + room.getInvitedMemberCount() - 1;
    const ok = await confirm({
      title: 'Leave conversation',
      message:
        others > 0
          ? `“${room.name}” and its messages will be gone from your list. The others keep their copy, and messaging them again starts a new conversation.`
          : `No one else is in “${room.name}”, so leaving deletes it.`,
      confirmLabel: 'Leave',
    });
    if (!ok) return;
    if (selectedRoomId === room.roomId) setSelectedRoomId(null);
    await leaveDirectMessage(mx, room.roomId).catch(console.error);
  };

  // The social side has its own places to go; a Space's channels or your DMs aren't among them.
  if (globalFeedOpen) {
    return (
      <aside className="nu-channel-list" data-nu-role="channel-list">
        <SocialNav />
        <NowPlayingCard />
        <MusicPlayerBar variant="card" />
        <ActiveCallBar />
        <UserPanel />
      </aside>
    );
  }

  // Home is a page of its own; this column only has a small nav for it (no DM list: that's Messages).
  if (section === 'home') {
    return (
      <aside className="nu-channel-list" data-nu-role="channel-list">
        <div className="nu-channel-list__header" data-nu-role="channel-list-header">
          <span className="nu-channel-list__header-title">Home</span>
        </div>
        <div className="nu-channel-list__body" data-nu-role="channel-list-body">
          <div className="nu-channel-list__row">
            <button type="button" className="nu-channel-list__item nu-channel-list__item--active" data-nu-role="home-nav-overview" aria-current="page">
              <span className="nu-channel-list__item-icon" aria-hidden="true">
                <Icon name="paw" size={18} />
              </span>
              <span className="nu-channel-list__item-name">What’s happening</span>
            </button>
          </div>
        </div>
        <NowPlayingCard />
        <MusicPlayerBar variant="card" />
        <ActiveCallBar />
        <UserPanel />
      </aside>
    );
  }

  return (
    <aside className="nu-channel-list" data-nu-role="channel-list">
      {!isDirectMessagesView && space ? (
        <SpaceCard
          space={space}
          canManageSpace={canManageSpace}
          onOpenSettings={() => setShowSpaceSettings(true)}
          onAddExisting={() => setShowAddExistingChannel(true)}
          onCreateChannel={() => setShowCreateChannel(true)}
        />
      ) : (
        <div className="nu-channel-list__header" data-nu-role="channel-list-header">
          <span className="nu-channel-list__header-title">{isDirectMessagesView ? 'Direct messages' : 'Select a space'}</span>
          {isDirectMessagesView && (
            <button
              type="button"
              className="nu-channel-list__header-action"
              data-nu-role="channel-list-start-dm"
              title="Start a direct message"
              aria-label="Start a direct message"
              onClick={() => setShowStartDm(true)}
            >
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
      )}
      <div
        className={drag.dragging ? 'nu-channel-list__body nu-channel-list__body--dragging' : 'nu-channel-list__body'}
        data-nu-role="channel-list-body"
        ref={bodyRef}
      >
        {drag.lineTop !== null && <div className="nu-channel-list__drop-line" style={{ top: drag.lineTop }} aria-hidden="true" />}
        {dragError && (
          <p className="nu-channel-list__drag-error" role="alert" data-nu-role="channel-list-drag-error">
            {dragError}
          </p>
        )}
        {isDirectMessagesView
          ? directMessages.map((room) => (
              <ChannelListRow
                key={room.roomId}
                room={room}
                isDirectMessage
                active={selectedRoomId === room.roomId}
                voiceServer={voiceServer}
                onSelect={() => selectChannel(room.roomId)}
                canManageSpace={false}
                canMoveUp={false}
                canMoveDown={false}
                onMoveUp={() => {}}
                onMoveDown={() => {}}
                onRemoveFromSpace={() => {}}
                onLeave={() => void handleLeaveConversation(room)}
              />
            ))
          : (
              <>
                {(spaceNews.news || spaceNews.canEdit) && (
                  <div className="nu-channel-list__row">
                    <button
                      type="button"
                      className={[
                        'nu-channel-list__item',
                        spaceView === 'news' && 'nu-channel-list__item--active',
                        spaceNews.unseen && 'nu-channel-list__item--unread',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-nu-role="channel-list-news"
                      onClick={() => {
                        setGlobalFeedOpen(false);
                        setProfileUserId(null);
                        setSpaceView('news');
                      }}
                    >
                      <span className="nu-channel-list__item-icon" aria-hidden="true">
                        <Icon name="megaphone" size={18} />
                      </span>
                      <span className={spaceNews.unseen ? 'nu-channel-list__item-name nu-channel-list__item-name--unread' : 'nu-channel-list__item-name'}>
                        News
                      </span>
                      {/* Updated since you last read it (matrix/spaceNews.ts). */}
                      <UnreadBadge total={spaceNews.unseen ? 1 : 0} highlight={0} />
                    </button>
                  </div>
                )}
                <div className="nu-channel-list__row">
                  <button
                    type="button"
                    className={['nu-channel-list__item', spaceView === 'feed' && 'nu-channel-list__item--active', newPosts && 'nu-channel-list__item--unread']
                      .filter(Boolean)
                      .join(' ')}
                    data-nu-role="channel-list-feed"
                    onClick={() => {
                      setGlobalFeedOpen(false);
                      setProfileUserId(null);
                      setSpaceView('feed');
                    }}
                  >
                    <span className="nu-channel-list__item-icon" aria-hidden="true">
                      <Icon name="posts" size={18} />
                    </span>
                    <span className={newPosts ? 'nu-channel-list__item-name nu-channel-list__item-name--unread' : 'nu-channel-list__item-name'}>
                      Posts
                    </span>
                    {/* Someone posted since you last looked (matrix/postsSeen.ts). */}
                    <UnreadBadge total={newPosts ? 1 : 0} highlight={0} />
                  </button>
                </div>
                <div className="nu-channel-list__row">
                  <button
                    type="button"
                    className={spaceView === 'events' ? 'nu-channel-list__item nu-channel-list__item--active' : 'nu-channel-list__item'}
                    data-nu-role="channel-list-events"
                    onClick={() => {
                      setGlobalFeedOpen(false);
                      setProfileUserId(null);
                      setSpaceView('events');
                    }}
                  >
                    <span className="nu-channel-list__item-icon" aria-hidden="true">
                      <Icon name="calendar" size={18} />
                    </span>
                    <span className="nu-channel-list__item-name">Events</span>
                  </button>
                </div>
                {shownUncategorized.map((room, index) => (
                  <ChannelListRow
                    key={room.roomId}
                    drag={rowDrag(room, null, index)}
                    room={room}
                    isDirectMessage={false}
                    active={selectedRoomId === room.roomId}
                    voiceServer={voiceServer}
                    onSelect={() => selectChannel(room.roomId)}
                    canManageSpace={canManageSpace}
                    canMoveUp={index > 0}
                    canMoveDown={index < shownUncategorized.length - 1}
                    onMoveUp={() => handleMoveInUncategorized(index, -1)}
                    onMoveDown={() => handleMoveInUncategorized(index, 1)}
                    onRemoveFromSpace={() => handleRemoveFromSpace(room.roomId)}
                    onOpenPermissions={() => setPermissionsRoom(room)}
                    onOpenWebhooks={() => setWebhooksRoom(room)}
                    onOpenSettings={() => setSettingsRoom(room)}
                  />
                ))}
                {shownCategories.map(({ category, rooms }, categoryIndex) => (
                  <div
                    key={category.id}
                    className={
                      drag.dragging?.kind === 'category' && drag.dragging.id === category.id
                        ? 'nu-channel-list__category nu-channel-list__category--dragging'
                        : 'nu-channel-list__category'
                    }
                    data-nu-drag-block={category.id}
                    data-nu-drag-index={categoryIndex}
                  >
                    <CategoryHeader
                      categoryId={category.id}
                      drag={
                        canArrange
                          ? {
                              clickAllowed: drag.clickAllowed,
                              onPointerDown: (event) => drag.start({ kind: 'category', id: category.id, label: category.name }, event),
                            }
                          : undefined
                      }
                      name={category.name}
                      rooms={rooms}
                      collapsed={collapsedCategories.has(category.id)}
                      onToggle={() => toggleCategoryCollapsed(category.id)}
                    />
                    {!collapsedCategories.has(category.id) &&
                      rooms.map((room, index) => (
                        <ChannelListRow
                          key={room.roomId}
                          drag={rowDrag(room, category.id, index)}
                          room={room}
                          isDirectMessage={false}
                          active={selectedRoomId === room.roomId}
                          voiceServer={voiceServer}
                          onSelect={() => selectChannel(room.roomId)}
                          canManageSpace={canManageSpace}
                          canMoveUp={index > 0}
                          canMoveDown={index < rooms.length - 1}
                          onMoveUp={() => handleMoveInCategory(category, rooms, index, -1)}
                          onMoveDown={() => handleMoveInCategory(category, rooms, index, 1)}
                          onRemoveFromSpace={() => handleRemoveFromSpace(room.roomId)}
                          onOpenPermissions={() => setPermissionsRoom(room)}
                          onOpenWebhooks={() => setWebhooksRoom(room)}
                          onOpenSettings={() => setSettingsRoom(room)}
                        />
                      ))}
                  </div>
                ))}
                {unjoinedChannels.length > 0 && (
                  <div className="nu-channel-list__category" data-nu-role="channel-list-unjoined-section">
                    <div className="nu-channel-list__section-header nu-channel-list__section-header--with-action">
                      More channels
                      {selectedSpaceId && <JoinAllButton spaceId={selectedSpaceId} count={unjoinedChannels.length} />}
                    </div>
                    {unjoinedChannels.map((entry) => (
                      <UnjoinedChannelRow
                        key={entry.room_id}
                        entry={entry}
                        onJoined={selectChannel}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
        {isDirectMessagesView && directMessages.length === 0 && (
          <div className="nu-channel-list__empty" data-nu-role="channel-list-empty">
            No conversations yet. Use + above to message someone.
          </div>
        )}
        {!isDirectMessagesView && selectedSpaceId && spaceRooms.length === 0 && (
          <div className="nu-channel-list__empty" data-nu-role="channel-list-empty">
            No channels yet. Use + on the card above to create one.
          </div>
        )}
      </div>
      {drag.dragging && drag.pointer && (
        <div className="nu-channel-list__drag-label" style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12 }} aria-hidden="true">
          {drag.dragging.kind === 'category' ? drag.dragging.label.toUpperCase() : `# ${drag.dragging.label}`}
        </div>
      )}
      <NowPlayingCard />
      <MusicPlayerBar variant="card" />
      <ActiveCallBar />
      <UserPanel />
      {showCreateChannel && space && (
        <CreateChannelModal
          space={space}
          onClose={() => setShowCreateChannel(false)}
          onCreated={(roomId) => {
            setShowCreateChannel(false);
            setSelectedRoomId(roomId);
          }}
        />
      )}
      {showSpaceSettings && space && (
        <SpaceSettingsModal space={space} onClose={() => setShowSpaceSettings(false)} />
      )}
      {settingsRoom && <ChannelSettingsModal channel={settingsRoom} onClose={() => setSettingsRoom(null)} />}
      {webhooksRoom && space && <WebhooksModal channel={webhooksRoom} space={space} onClose={() => setWebhooksRoom(null)} />}
      {permissionsRoom && space && (
        <ChannelPermissionsModal channel={permissionsRoom} space={space} onClose={() => setPermissionsRoom(null)} />
      )}
      {showAddExistingChannel && space && (
        <AddExistingChannelModal
          space={space}
          existingRoomIds={new Set(spaceRooms.map((r) => r.roomId))}
          onClose={() => setShowAddExistingChannel(false)}
        />
      )}
      {confirmDialog}
      {showStartDm && (
        <StartDmModal
          onClose={() => setShowStartDm(false)}
          onCreated={(roomId) => {
            setShowStartDm(false);
            setSelectedRoomId(roomId);
          }}
        />
      )}
    </aside>
  );
}
