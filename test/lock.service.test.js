// test/lock.service.test.js
import { describe, it, expect } from 'vitest';
import { acquireLock, releaseLock } from '../src/services/lock.service.js';

describe('lock.service', () => {
  it('second acquirer waits until the lock is released', async () => {
    const t0 = Date.now();
    await acquireLock(); // take the lock

    const waiter = (async () => {
      await acquireLock(); // should wait ~2s (poll interval)
      releaseLock();
      return Date.now() - t0;
    })();

    // release after 300ms to force at least one poll cycle
    setTimeout(() => releaseLock(), 300);

    const elapsed = await waiter;
    expect(elapsed).toBeGreaterThanOrEqual(1800); // >= ~2s minus drift
  }, 20000);
});
