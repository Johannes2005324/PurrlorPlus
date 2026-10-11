import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimSession, HANDOVER_MS } from './sessionLock';

/** Just enough of the Web Locks API for one lock name, `steal` included. */
function fakeLocks() {
  let holder: { reject: (err: Error) => void } | null = null;
  return {
    query: vi.fn(async () => ({ held: holder ? [{ name: 'purrlor-session' }] : [], pending: [] })),
    request: vi.fn((_name: string, _options: { steal?: boolean }, callback: () => Promise<void>) => {
      return new Promise<void>((_resolve, reject) => {
        holder?.reject(new DOMException('stolen', 'AbortError'));
        holder = { reject };
        void callback();
      });
    }),
  };
}

describe('claimSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes a free session at once', async () => {
    const locks = fakeLocks();
    const onLost = vi.fn();
    await claimSession(onLost, locks as unknown as LockManager);
    expect(locks.request).toHaveBeenCalledWith('purrlor-session', { steal: true }, expect.any(Function));
    expect(onLost).not.toHaveBeenCalled();
  });

  it('takes the session from an older tab, which is told, then waits for it to stop', async () => {
    const locks = fakeLocks();
    const olderLost = vi.fn();
    await claimSession(olderLost, locks as unknown as LockManager);

    let claimed = false;
    void claimSession(vi.fn(), locks as unknown as LockManager).then(() => (claimed = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(olderLost).toHaveBeenCalledTimes(1);
    expect(claimed).toBe(false);
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    expect(claimed).toBe(true);
  });

  it('runs unguarded where there are no Web Locks', async () => {
    await expect(claimSession(vi.fn(), undefined)).resolves.toBeUndefined();
  });
});
