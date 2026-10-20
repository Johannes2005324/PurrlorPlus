import { describe, expect, it } from 'vitest';
import { buildLiveChannels, groupByVoiceServer, type VoiceChannelRef } from './liveVoice';

const server = (host: string) => ({ url: `wss://${host}`, tokenEndpoint: `https://${host}/api/livekit/token` });
const ch = (roomId: string, host: string, spaceName = 'S', name = roomId): VoiceChannelRef => ({
  roomId,
  name,
  spaceId: `!space-${host}`,
  spaceName,
  server: server(host),
});
const person = (identity: string, extra: object = {}) => ({ identity, micMuted: false, deafened: false, ...extra });

describe('groupByVoiceServer', () => {
  it('makes one group per token server origin', () => {
    const groups = groupByVoiceServer([ch('!a', 'one.example'), ch('!b', 'one.example'), ch('!c', 'two.example')]);
    expect([...groups]).toEqual([
      ['https://one.example/api/livekit/rooms/participants', ['!a', '!b']],
      ['https://two.example/api/livekit/rooms/participants', ['!c']],
    ]);
  });

  it('skips a broken endpoint and repeated rooms', () => {
    const bad = { ...ch('!x', 'a'), server: { url: 'x', tokenEndpoint: 'not a url' } };
    expect(groupByVoiceServer([bad, ch('!a', 'a'), ch('!a', 'a')]).size).toBe(1);
  });
});

describe('buildLiveChannels', () => {
  it('leaves out empty channels and puts the busiest first', () => {
    const live = buildLiveChannels(
      [ch('!a', 'h'), ch('!b', 'h'), ch('!c', 'h')],
      { '!a': [person('@1:x')], '!b': [person('@1:x'), person('@2:x')], '!c': [] },
      null
    );
    expect(live.map((c) => c.roomId)).toEqual(['!b', '!a']);
  });

  it('flags a channel when anyone shares their screen, and orders by join time', () => {
    const [live] = buildLiveChannels(
      [ch('!a', 'h')],
      { '!a': [person('@late:x', { joinedAt: 20 }), person('@early:x', { joinedAt: 10, screenSharing: true })] },
      null
    );
    expect(live.screenSharing).toBe(true);
    expect(live.participants.map((p) => p.identity)).toEqual(['@early:x', '@late:x']);
  });

  it('takes the call you are in from liveCall, keeping the polled screen-share flag', () => {
    const live = buildLiveChannels(
      [ch('!a', 'h')],
      { '!a': [person('@me:x', { screenSharing: true })] },
      { roomId: '!a', people: [{ identity: '@me:x', micMuted: true, deafened: false }, { identity: '@you:x', micMuted: false, deafened: false }] }
    );
    expect(live[0].participants).toHaveLength(2);
    expect(live[0].screenSharing).toBe(true);
  });

  it('shows the call you are in even if the poll has not seen it yet', () => {
    const live = buildLiveChannels([ch('!a', 'h')], {}, { roomId: '!a', people: [{ identity: '@me:x', micMuted: false, deafened: false }] });
    expect(live).toHaveLength(1);
  });
});
