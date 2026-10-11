import { describe, expect, it } from 'vitest';
import { byJoinOrder } from './callPresence';

describe('byJoinOrder', () => {
  it('lists whoever joined first, first, whatever order they came in', () => {
    const people = [
      { identity: '@carol:x', joinedAt: 3000 },
      { identity: '@alice:x', joinedAt: 1000 },
      { identity: '@bob:x', joinedAt: 2000 },
    ];
    expect(byJoinOrder(people).map((p) => p.identity)).toEqual(['@alice:x', '@bob:x', '@carol:x']);
    expect(byJoinOrder([...people].reverse()).map((p) => p.identity)).toEqual(['@alice:x', '@bob:x', '@carol:x']);
  });

  it('puts people with no join time last, by user ID, and breaks ties the same way', () => {
    const people = [
      { identity: '@zed:x' },
      { identity: '@bea:x', joinedAt: 1000 },
      { identity: '@amy:x' },
      { identity: '@abe:x', joinedAt: 1000 },
    ];
    expect(byJoinOrder(people).map((p) => p.identity)).toEqual(['@abe:x', '@bea:x', '@amy:x', '@zed:x']);
  });

  it('leaves the list it was given alone', () => {
    const people = [{ identity: '@b:x', joinedAt: 2 }, { identity: '@a:x', joinedAt: 1 }];
    byJoinOrder(people);
    expect(people[0].identity).toBe('@b:x');
  });
});
