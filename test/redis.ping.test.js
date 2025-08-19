import { describe, it, expect } from 'vitest';
import Redis from 'ioredis';

describe('redis connectivity', () => {
  it('responds to PING', async () => {
    const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
    const res = await redis.ping();
    await redis.quit();
    expect(res).toBe('PONG');
  });
});
