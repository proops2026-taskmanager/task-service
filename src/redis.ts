import Redis from 'ioredis';

// Lazy, best-effort Redis client — task operations succeed even if Redis is down.
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[redis] Connection error:', err.message);
});

export default redis;
