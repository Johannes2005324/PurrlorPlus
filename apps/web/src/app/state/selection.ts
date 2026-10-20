import { atom } from 'jotai';
import type { RoomMember } from 'matrix-js-sdk';
import type { Emote } from '../../matrix/emotes';
import type { PostContent, PostOrigin } from '../../matrix/feed';
import type { PostAuthor } from '../../features/feed/PostCard';

/** Currently selected Space (server). `null` = no space selected (e.g. a future "Home"/DM view). */
export const selectedSpaceIdAtom = atom<string | null>(null);

/** Currently selected room (channel) within the selected space. */
export const selectedRoomIdAtom = atom<string | null>(null);

/** Bumped when a channel is picked in the list: its message box takes focus, even when that channel
 *  was already open (opening a Space may already have landed on it, matrix/spaceNews.ts). */
export const channelComposerFocusAtom = atom(0);

/**
 * A Space-level view that isn't a channel. `'feed'` is the hub's Posts timeline, which is a
 * merge across many rooms (`feed.ts`) rather than any one of them, so it can't be expressed as a
 * `selectedRoomIdAtom` value. `'news'` is the Space's news page (matrix/spaceNews.ts). `null`
 * means an ordinary channel is selected.
 */
export const selectedSpaceViewAtom = atom<'feed' | 'events' | 'news' | null>(null);

/**
 * The app's three top-level sections, picked in the server rail: the Home dashboard, the social
 * Feed, and Messages (DMs and Spaces). Each keeps its own place in the atoms below: going Home and
 * back to Messages returns to the same Space and room.
 */
export type RailSection = 'home' | 'feed' | 'messages';
export const railSectionAtom = atom<RailSection>('home');

/**
 * Whether the global feed (public posts from every public Space, see matrix/globalFeed.ts) is
 * open in the main pane. It isn't tied to any Space, so it sits outside `selectedSpaceViewAtom`;
 * picking a Space, a channel, or a Space's own Posts closes it.
 */
export const globalFeedOpenAtom = atom(
  (get) => get(railSectionAtom) === 'feed',
  (get, set, open: boolean) => {
    if (open) set(railSectionAtom, 'feed');
    else if (get(railSectionAtom) === 'feed') set(railSectionAtom, 'messages');
  }
);

/**
 * Which page of the social side is showing while `globalFeedOpenAtom` is set: the Everyone or
 * Following timeline, or Notifications (everything people did with your posts and profile, and
 * every mention of you, chat included). Picked from the social sidebar (SocialNav), the rail's
 * bell, or on a phone the header's tabs.
 */
export type SocialView = 'everyone' | 'following' | 'notifications';
export const socialViewAtom = atom<SocialView>('everyone');

/**
 * A Space whose Posts page is showing inside the social side (SocialNav's "Posts in your spaces"),
 * in place of the Everyone / Following / Notifications page. Null when none is. Cleared whenever the
 * social side closes or another of its pages opens, so it never lingers.
 */
export const socialSpaceIdAtom = atom<string | null>(null);

/**
 * Whose profile is open in the main pane (ProfileView), over whatever else is selected. Set from
 * any author name on a post or from a member's profile card; opening a room closes it.
 */
export const profileUserIdAtom = atom<string | null>(null);

/**
 * One post opened on its own page (features/feed/PostPage.tsx), over whatever else is showing —
 * where a long thread is read in full, since timelines only show a post's newest few comments.
 * Carries what the page needs to show the post without looking it up again; going anywhere else
 * closes it, and Back returns to what was underneath.
 */
export type OpenPost = {
  roomId: string;
  postId: string;
  isPublic: boolean;
  canInteract: boolean;
  cannotInteractReason?: string;
  content: PostContent;
  author: PostAuthor;
  ts: number;
  edited?: boolean;
  /** Where the post lives. */
  sourceOrigin: PostOrigin;
  /** Whether the card showed its place as a chip (timelines that mix places do). */
  showOrigin: boolean;
  emotes?: Emote[];
  members?: RoomMember[];
};
export const openPostAtom = atom<OpenPost | null>(null);

/**
 * The voice channel actually connected via LiveKit right now — independent of
 * `selectedRoomIdAtom`. Discord's model: you can be in a voice call while looking at (and
 * `selectedRoomIdAtom`-selecting) a different, unrelated text channel. `null` = not in a call.
 */
export const activeVoiceChannelIdAtom = atom<string | null>(null);

/**
 * A message the UI should scroll to and highlight the moment its room's timeline can show it —
 * set by anything that jumps to a specific message rather than just a room (currently only
 * search results; see MessageSearchModal/MessageTimeline). `null` once consumed or abandoned.
 */
export type PendingJumpTarget = { roomId: string; eventId: string };
export const pendingJumpTargetAtom = atom<PendingJumpTarget | null>(null);
