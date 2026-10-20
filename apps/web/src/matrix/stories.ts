import { Direction, EventType, Method, type MatrixClient } from 'matrix-js-sdk';
import { readFreshAccountData } from './freshAccountData';
import { readPostContent, toEventContent, type PostContent } from './feed';
import { loadUserProfileSource, mapWithConcurrency, ownProfileSource, type FeedSource } from './globalFeed';
import { ensureProfileRoom } from './profileFeed';

/**
 * **Stories**: posts that last a day (docs/stories.md). A story is an `xyz.nekous.story` event in its
 * author's profile room (profileFeed.ts), with a post's content shape (text, and at most one picture
 * or video). The profile room is world-readable, so a story is as public as a Global post, and its
 * media is a plain upload.
 *
 * Matrix can't expire an event, so "a day" is kept by both sides: readers only show stories younger
 * than STORY_LIFETIME_MS, and the author's own client redacts its stories once they're older than
 * that (expireOwnStories), so they're gone from the room as well as from view.
 */
export const STORY_EVENT_TYPE = 'xyz.nekous.story';
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** How many of a person's newest story events are read: far more than anyone posts in a day. */
const STORY_PAGE_SIZE = 50;
const STORY_CONCURRENCY = 6;

/** Which stories you've seen (event ID → the story's time), so a ring dims once you've watched it. */
export const STORIES_SEEN_ACCOUNT_DATA = 'xyz.nekous.stories_seen';

export type Story = {
  eventId: string;
  roomId: string;
  ts: number;
  content: PostContent;
};

export type StoryReel = {
  userId: string;
  name: string;
  avatarUrl?: string;
  /** Oldest first, the order they're watched in. */
  stories: Story[];
};

export function isStoryLive(ts: number, now: number): boolean {
  return ts > now - STORY_LIFETIME_MS && ts <= now + 60_000;
}

/**
 * A story off a raw event, or undefined: wrong type, redacted, not sent by the room's owner (power
 * levels gate the type, but an older room may not), expired, or with nothing to show. One piece of
 * media at most; a repost isn't a story.
 */
export function readStory(raw: Record<string, any>, roomId: string, owner: string, now: number): Story | undefined {
  if (raw.type !== STORY_EVENT_TYPE || raw.sender !== owner || typeof raw.event_id !== 'string') return undefined;
  if (raw.unsigned?.redacted_because || typeof raw.origin_server_ts !== 'number') return undefined;
  if (!isStoryLive(raw.origin_server_ts, now)) return undefined;
  const parsed = readPostContent((raw.content ?? {}) as Record<string, unknown>);
  if (!parsed || parsed.repostOf) return undefined;
  const content = parsed.attachments ? { ...parsed, attachments: parsed.attachments.slice(0, 1) } : parsed;
  return { eventId: raw.event_id, roomId, ts: raw.origin_server_ts, content };
}

/** Newest story events in a profile room, filtered server-side so likes and posts don't crowd them out. */
async function fetchStoryEvents(mx: MatrixClient, roomId: string): Promise<Record<string, any>[]> {
  const res = await mx.http.authedRequest<{ chunk?: Record<string, any>[] }>(Method.Get, `/rooms/${encodeURIComponent(roomId)}/messages`, {
    dir: Direction.Backward,
    limit: String(STORY_PAGE_SIZE),
    filter: JSON.stringify({ types: [STORY_EVENT_TYPE] }),
  });
  return res.chunk ?? [];
}

export function reelFrom(source: FeedSource, events: Record<string, any>[], now: number): StoryReel {
  const stories = events
    .map((raw) => readStory(raw, source.roomId, source.owner, now))
    .filter((story): story is Story => !!story)
    .sort((a, b) => a.ts - b.ts);
  return { userId: source.owner, name: source.ownerName, avatarUrl: source.ownerAvatarUrl, stories };
}

/**
 * Your own reel and those of the people you follow who have a live story. Read without joining
 * anything (profile rooms are world-readable), the way the global feed reads posts. Someone without
 * a profile room, or whose room can't be read right now, just has no reel.
 */
export async function loadStoryReels(mx: MatrixClient, following: string[], now = Date.now()): Promise<{ own?: StoryReel; others: StoryReel[] }> {
  const me = mx.getUserId();
  const ownSource = await ownProfileSource(mx);
  const ownEvents = ownSource ? await fetchStoryEvents(mx, ownSource.roomId).catch(() => []) : [];
  if (ownSource) void expireOwnStories(mx, ownSource.roomId, ownEvents, now);

  const people = [...new Set(following)].filter((userId) => userId !== me);
  const reels = await mapWithConcurrency(people, STORY_CONCURRENCY, async (userId) => {
    const source = await loadUserProfileSource(mx, userId).catch(() => undefined);
    if (!source) return undefined;
    const events = await fetchStoryEvents(mx, source.roomId).catch(() => []);
    const reel = reelFrom(source, events, now);
    return reel.stories.length ? reel : undefined;
  });
  const others = reels
    .filter((reel): reel is StoryReel => !!reel)
    // Most recently updated first.
    .sort((a, b) => b.stories[b.stories.length - 1].ts - a.stories[a.stories.length - 1].ts);
  return { own: ownSource ? reelFrom(ownSource, ownEvents, now) : undefined, others };
}

/**
 * Redacts your own stories that are past their day. Best-effort and quiet: it runs again every
 * time stories are read, so one that fails now goes next time.
 */
export async function expireOwnStories(mx: MatrixClient, roomId: string, events: Record<string, any>[], now = Date.now()): Promise<void> {
  const me = mx.getUserId();
  const expired = events.filter(
    (raw) =>
      raw.type === STORY_EVENT_TYPE &&
      raw.sender === me &&
      typeof raw.event_id === 'string' &&
      !raw.unsigned?.redacted_because &&
      Object.keys(raw.content ?? {}).length > 0 &&
      typeof raw.origin_server_ts === 'number' &&
      raw.origin_server_ts <= now - STORY_LIFETIME_MS
  );
  for (const raw of expired) {
    await mx.redactEvent(roomId, raw.event_id, undefined, { reason: 'Story expired' }).catch(() => undefined);
  }
}

/**
 * Only the owner may post a story: profile rooms made before stories gate only posts, so the first
 * story raises the story type to 100 as well. Readers check the sender anyway (readStory).
 */
async function gateStoryEvents(mx: MatrixClient, roomId: string): Promise<void> {
  const room = mx.getRoom(roomId);
  const current = room?.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent<Record<string, any>>();
  if (!current) return;
  const events = (current.events ?? {}) as Record<string, number>;
  if (events[STORY_EVENT_TYPE] === 100) return;
  await mx.sendStateEvent(roomId, EventType.RoomPowerLevels, { ...current, events: { ...events, [STORY_EVENT_TYPE]: 100 } } as any, '');
}

/** Posts a story to your profile room, creating the room if this is your first public anything. */
export async function publishStory(mx: MatrixClient, displayName: string, content: PostContent): Promise<string> {
  const roomId = await ensureProfileRoom(mx, displayName);
  await gateStoryEvents(mx, roomId).catch(() => undefined);
  const { event_id: eventId } = await mx.sendEvent(roomId, STORY_EVENT_TYPE as any, toEventContent(content) as any);
  return eventId;
}

export async function deleteStory(mx: MatrixClient, roomId: string, eventId: string): Promise<void> {
  await mx.redactEvent(roomId, eventId);
}

// ---------------------------------------------------------------------------
// Seen
// ---------------------------------------------------------------------------

export type StoriesSeen = Record<string, number>;

export function readStoriesSeen(mx: MatrixClient): StoriesSeen {
  const content = mx.getAccountData(STORIES_SEEN_ACCOUNT_DATA as any)?.getContent<{ seen?: unknown }>();
  return cleanSeen(content?.seen, 0);
}

/** Valid entries only; with `now`, also drops stories past their day, so the list stays small. */
export function cleanSeen(raw: unknown, now: number): StoriesSeen {
  if (!raw || typeof raw !== 'object') return {};
  const seen: StoriesSeen = {};
  for (const [eventId, ts] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof ts === 'number' && (!now || isStoryLive(ts, now))) seen[eventId] = ts;
  }
  return seen;
}

/** Marks stories seen, against the server's current list so another device's marks aren't lost. */
export async function markStoriesSeen(mx: MatrixClient, stories: Story[], now = Date.now()): Promise<void> {
  const fresh = await readFreshAccountData<{ seen?: unknown }>(mx, STORIES_SEEN_ACCOUNT_DATA).catch(() => undefined);
  const seen = cleanSeen(fresh?.seen ?? readStoriesSeen(mx), now);
  const unseen = stories.filter((story) => !(story.eventId in seen));
  if (unseen.length === 0) return;
  for (const story of unseen) seen[story.eventId] = story.ts;
  await mx.setAccountData(STORIES_SEEN_ACCOUNT_DATA as any, { seen } as any);
}

/** Whether a reel has anything you haven't watched. */
export function hasUnseen(reel: StoryReel, seen: StoriesSeen): boolean {
  return reel.stories.some((story) => !(story.eventId in seen));
}

/** Where to start watching a reel: its first story you haven't seen, or the start if you've seen them all. */
export function firstUnseenIndex(reel: StoryReel, seen: StoriesSeen): number {
  const index = reel.stories.findIndex((story) => !(story.eventId in seen));
  return index < 0 ? 0 : index;
}
