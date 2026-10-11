import { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { UserEvent, type RoomMember } from 'matrix-js-sdk';
import { selectedRoomIdAtom } from '../../app/state/selection';
import { useIrcMode } from '../../app/density';
import { mobileMemberListOpenAtom } from '../../app/state/mobile';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { RoleBadge } from '../../components/RoleBadge';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { handleFor, roleFor, type RoleLevel } from '../../matrix/roles';
import { useRoomRoles } from '../../matrix/hooks/useSpaceRoles';
import { UserProfileModal } from '../profile/UserProfileModal';
import './MemberList.css';

type PresenceInfo = { presence: string | undefined; statusMsg: string | undefined };

type MemberGroup = { id: string; label: string; role?: RoleLevel; members: RoomMember[] };

/**
 * A userId -> {presence, statusMsg} map for the given members, recomputed on any presence
 * change. Kept at this level (not one `usePresence` call per row) specifically so the list can
 * group members by presence before rendering rows, rather than each row discovering its own
 * presence independently after the fact.
 */
function useMemberPresenceMap(members: RoomMember[]): Map<string, PresenceInfo> {
  const mx = useMatrixClient();
  const [, forceRender] = useState(0);

  useEffect(() => {
    const onPresence = () => forceRender((n) => n + 1);
    mx.on(UserEvent.Presence, onPresence);
    return () => {
      mx.removeListener(UserEvent.Presence, onPresence);
    };
  }, [mx]);

  const map = new Map<string, PresenceInfo>();
  members.forEach((member) => {
    const user = mx.getUser(member.userId);
    map.set(member.userId, { presence: user?.presence, statusMsg: user?.presenceStatusMsg });
  });
  return map;
}

/** "Online" means anything but offline — an Away member is still around, just idle, and
 *  belongs with the people who are here rather than in the long Offline tail. */
function isHere(info: PresenceInfo | undefined): boolean {
  return !!info?.presence && info.presence !== 'offline';
}

/**
 * Discord's grouping: people who are here, split by role (staff first, then everyone else),
 * then one Offline group for everyone who isn't — whatever their role. Staff keep their role
 * color in the Offline group, so you can still spot a moderator who's away.
 */
function groupMembers(members: RoomMember[], presenceMap: Map<string, PresenceInfo>, roles: RoleLevel[]): MemberGroup[] {
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const here = sorted.filter((member) => isHere(presenceMap.get(member.userId)));
  const offline = sorted.filter((member) => !isHere(presenceMap.get(member.userId)));

  const groups: MemberGroup[] = roles.map((role) => ({
    id: role.id,
    label: role.id === 'member' ? 'Online' : role.pluralLabel,
    role,
    members: here.filter((member) => roleFor(member.powerLevel, roles).id === role.id),
  }));
  groups.push({ id: 'offline', label: 'Offline', members: offline });
  return groups.filter((group) => group.members.length > 0);
}

function MemberRow({
  member,
  presenceInfo,
  roles,
  onOpenProfile,
}: {
  member: RoomMember;
  presenceInfo: PresenceInfo;
  roles: RoleLevel[];
  onOpenProfile: () => void;
}) {
  const role = roleFor(member.powerLevel, roles);
  const roleId = role.custom ? 'custom' : role.id;
  const ircMode = useIrcMode();
  const offline = !isHere(presenceInfo);
  return (
    <button
      type="button"
      className={['nu-member-list__item', `nu-member-list__item--${roleId}`, offline && 'nu-member-list__item--offline']
        .filter(Boolean)
        .join(' ')}
      data-nu-role="member-list-item"
      title={presenceInfo.statusMsg || member.userId}
      onClick={onOpenProfile}
    >
      <Avatar name={member.name} mxcUrl={member.getMxcAvatarUrl()} size={ircMode ? 22 : 34} presence={presenceInfo.presence ?? 'offline'} />
      <span className="nu-member-list__item-text">
        <span className="nu-member-list__item-name-row">
          <span className="nu-member-list__item-name" style={role.color ? { color: role.color } : undefined}>
            {member.name}
          </span>
          <RoleBadge role={role} />
        </span>
        <span className="nu-member-list__item-status">{presenceInfo.statusMsg || handleFor(member.userId)}</span>
      </span>
    </button>
  );
}

/**
 * Right panel — joined members of the selected room, grouped by role and presence (see
 * groupMembers). Presence relies on the homeserver actually sending it — some disable it for
 * privacy/performance, in which case everyone lands in Offline; that's a server-side choice,
 * not a bug here.
 */
export function MemberList() {
  const selectedRoomId = useAtomValue(selectedRoomIdAtom);
  const members = useRoomMembers(selectedRoomId);
  const presenceMap = useMemberPresenceMap(members);
  const [profileMember, setProfileMember] = useState<RoomMember | null>(null);
  const [, setMobileMembersOpen] = useAtom(mobileMemberListOpenAtom);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
    setSearching(false);
  }, [selectedRoomId]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? members.filter((m) => m.name.toLowerCase().includes(needle) || m.userId.toLowerCase().includes(needle))
    : members;
  const roles = useRoomRoles(selectedRoomId);
  const groups = groupMembers(visible, presenceMap, roles);
  const hereCount = members.filter((m) => isHere(presenceMap.get(m.userId))).length;

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="nu-member-list" data-nu-role="member-list">
      <div className="nu-member-list__header" data-nu-role="member-list-header">
        <div className="nu-member-list__header-text">
          <span className="nu-member-list__header-title">Members</span>
          {selectedRoomId && (
            <span className="nu-member-list__header-count">
              {hereCount} online of {members.length}
            </span>
          )}
        </div>
        <button
          type="button"
          className="nu-member-list__header-button"
          data-nu-role="member-list-search-toggle"
          title="Find a member"
          aria-label="Find a member"
          aria-pressed={searching}
          onClick={() => {
            setSearching((open) => !open);
            setQuery('');
          }}
        >
          <Icon name="search" size={16} />
        </button>
        <button
          type="button"
          className="nu-member-list__header-button nu-member-list__close"
          data-nu-role="member-list-close"
          title="Close"
          aria-label="Close"
          onClick={() => setMobileMembersOpen(false)}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      {searching && (
        <div className="nu-member-list__search">
          <input
            className="nu-member-list__search-input"
            data-nu-role="member-list-search"
            type="search"
            placeholder="Find a member"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearching(false);
                setQuery('');
              }
            }}
          />
        </div>
      )}
      <div className="nu-member-list__body" data-nu-role="member-list-body">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          return (
            <section key={group.id} className="nu-member-list__group" data-nu-group={group.id}>
              <button
                type="button"
                className={
                  isCollapsed ? 'nu-member-list__group-label nu-member-list__group-label--collapsed' : 'nu-member-list__group-label'
                }
                data-nu-role="member-list-group"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.id)}
              >
                <Icon name="chevronDown" size={12} className="nu-member-list__group-arrow" />
                {group.role && group.role.id !== 'member' && (
                  <span
                    className={`nu-member-list__group-swatch nu-member-list__group-swatch--${group.role.custom ? 'custom' : group.role.id}`}
                    style={group.role.color ? { background: group.role.color } : undefined}
                    aria-hidden="true"
                  />
                )}
                <span className="nu-member-list__group-name">{group.label}</span>
                <span className="nu-member-list__group-count">{group.members.length}</span>
              </button>
              {!isCollapsed &&
                group.members.map((member) => (
                  <MemberRow
                    key={member.userId}
                    member={member}
                    presenceInfo={presenceMap.get(member.userId) ?? { presence: undefined, statusMsg: undefined }}
                    roles={roles}
                    onOpenProfile={() => setProfileMember(member)}
                  />
                ))}
            </section>
          );
        })}
        {needle && groups.length === 0 && (
          <p className="nu-member-list__empty">No one here matches “{query.trim()}”.</p>
        )}
      </div>
      {profileMember && (
        <UserProfileModal
          userId={profileMember.userId}
          displayName={profileMember.name}
          avatarMxcUrl={profileMember.getMxcAvatarUrl()}
          onClose={() => setProfileMember(null)}
        />
      )}
    </aside>
  );
}
