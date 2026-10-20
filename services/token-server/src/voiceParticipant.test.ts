import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrackSource } from 'livekit-server-sdk';
import { toVoiceParticipant } from './voiceParticipant.js';

const base = { identity: '@a:example.org', attributes: {}, joinedAt: 100 };

describe('toVoiceParticipant', () => {
  it('flags a participant with a screen-share track', () => {
    const p = toVoiceParticipant({
      ...base,
      tracks: [{ source: TrackSource.MICROPHONE, muted: false }, { source: TrackSource.SCREEN_SHARE }] as never,
    });
    assert.equal(p.screenSharing, true);
    assert.equal(p.micMuted, false);
  });

  it('does not flag one with only a microphone', () => {
    const p = toVoiceParticipant({ ...base, tracks: [{ source: TrackSource.MICROPHONE, muted: true }] as never });
    assert.equal(p.screenSharing, false);
    assert.equal(p.micMuted, true);
  });

  it('reads deafened and join time', () => {
    const p = toVoiceParticipant({ ...base, attributes: { deafened: 'true' }, tracks: [], joinedAtMs: 5000n });
    assert.equal(p.deafened, true);
    assert.equal(p.joinedAt, 5000);
    assert.equal(toVoiceParticipant({ ...base, tracks: [] }).joinedAt, 100000);
  });
});
