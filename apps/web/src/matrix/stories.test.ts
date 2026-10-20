import { describe, expect, it } from 'vitest';
import { cleanSeen, firstUnseenIndex, hasUnseen, isStoryLive, readStory, reelFrom, STORY_EVENT_TYPE, STORY_LIFETIME_MS } from './stories';
import type { FeedSource } from './globalFeed';

const NOW = 1_800_000_000_000;
const OWNER = '@luna:purr.example';
const ROOM = '!profile:purr.example';

function raw(over: Record<string, any> = {}): Record<string, any> {
  return {
    type: STORY_EVENT_TYPE,
    sender: OWNER,
    event_id: '$a',
    origin_server_ts: NOW - 1000,
    content: { body: 'hello' },
    ...over,
  };
}

const source: FeedSource = { roomId: ROOM, owner: OWNER, ownerName: 'Luna', origin: { kind: 'global' }, isPublic: true };

describe('readStory', () => {
  it('reads a live story from the owner', () => {
    expect(readStory(raw(), ROOM, OWNER, NOW)).toEqual({ eventId: '$a', roomId: ROOM, ts: NOW - 1000, content: { body: 'hello' } });
  });

  it('drops anything not a live story by the owner with something to show', () => {
    expect(readStory(raw({ sender: '@mallory:purr.example' }), ROOM, OWNER, NOW)).toBeUndefined();
    expect(readStory(raw({ type: 'xyz.nekous.post' }), ROOM, OWNER, NOW)).toBeUndefined();
    expect(readStory(raw({ origin_server_ts: NOW - STORY_LIFETIME_MS - 1 }), ROOM, OWNER, NOW)).toBeUndefined();
    expect(readStory(raw({ content: {} }), ROOM, OWNER, NOW)).toBeUndefined();
    expect(readStory(raw({ unsigned: { redacted_because: {} } }), ROOM, OWNER, NOW)).toBeUndefined();
  });

  it('keeps one piece of media at most', () => {
    const attachment = (n: number) => ({ kind: 'image', url: `mxc://purr.example/${n}`, info: { mimetype: 'image/png' } });
    const story = readStory(raw({ content: { body: '', 'xyz.nekous.attachments': [attachment(1), attachment(2)] } }), ROOM, OWNER, NOW);
    expect(story?.content.attachments).toHaveLength(1);
  });
});

describe('isStoryLive', () => {
  it('is a day long', () => {
    expect(isStoryLive(NOW - STORY_LIFETIME_MS + 1, NOW)).toBe(true);
    expect(isStoryLive(NOW - STORY_LIFETIME_MS, NOW)).toBe(false);
  });
});

describe('reels and seen', () => {
  const reel = reelFrom(source, [raw({ event_id: '$b', origin_server_ts: NOW - 10 }), raw({ event_id: '$a', origin_server_ts: NOW - 20 })], NOW);

  it('orders a reel oldest first', () => {
    expect(reel.stories.map((story) => story.eventId)).toEqual(['$a', '$b']);
  });

  it('starts at the first unseen story', () => {
    expect(hasUnseen(reel, {})).toBe(true);
    expect(firstUnseenIndex(reel, { $a: NOW - 20 })).toBe(1);
    expect(hasUnseen(reel, { $a: NOW - 20, $b: NOW - 10 })).toBe(false);
    expect(firstUnseenIndex(reel, { $a: NOW - 20, $b: NOW - 10 })).toBe(0);
  });

  it('forgets seen marks for expired stories', () => {
    expect(cleanSeen({ $old: NOW - STORY_LIFETIME_MS - 5, $new: NOW - 5, $bad: 'x' }, NOW)).toEqual({ $new: NOW - 5 });
  });
});
