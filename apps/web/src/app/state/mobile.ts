import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * Whether the member list is open as a slide-in drawer on narrow (mobile-width) viewports. Has
 * no effect above the responsive breakpoint (styles/base/shell.css), where the member list is
 * always visible as its own column. Lives in its own atom (rather than local component state)
 * because the toggle button (MainPane's header) and the drawer itself (MemberList) are sibling
 * components, not parent/child.
 */
export const mobileMemberListOpenAtom = atom<boolean>(false);

/**
 * Whether the member list column is hidden on the desktop layout — the header's Members button
 * toggles it (on mobile that same button opens the drawer above instead). Persisted, since
 * someone who prefers a wider timeline wants that every time, not just until the next reload.
 */
export const desktopMemberListHiddenAtom = atomWithStorage<boolean>('nekous_member_list_hidden', false);

/**
 * Whether the phone layout is showing its Spaces screen: the server rail laid out as a grid, opened
 * from the bottom tab bar's Spaces tab (MobileTabBar.tsx). Choosing a Space or a DM there closes it.
 * Has no effect above the responsive breakpoint.
 */
export const mobileSpacesOpenAtom = atom<boolean>(false);
