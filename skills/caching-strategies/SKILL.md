---
name: caching-strategies
description: Implement multi-layer caching with Redis, in-memory, and HTTP caching. Covers cache invalidation, stampede prevention, and cache-aside patterns.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: performance
  time: 4h
  source: drift-masterguide
---

# Caching Strategies

Speed up your app with smart caching at every layer.

## When to Use This Skill

- Slow database queries
- Expensive computations
- External API responses
- Session data
- Frequently accessed data

## Cache Layers

```
┌─────────────────────────────────────────────────────┐
│                    Request                           │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Layer 1: HTTP Cache (CDN/Browser)                  │
│  - Static assets, public API responses              │
│  - Cache-Control headers                            │
└─────────────────────────────────────────────────────┘
         │ miss
         ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: In-Memory Cache (Node/Process)            │
│  - Hot data, computed values                        │
│  - LRU eviction                                     │
└─────────────────────────────────────────────────────┘
         │ miss
         ▼
┌─────────────────────────────────────────────────────┐
│  Layer 3: Distributed Cache (Redis)                 │
│  - Shared across instances                          │
│  - Session data, rate limits                        │
└─────────────────────────────────────────────────────┘
         │ miss
         ▼
┌─────────────────────────────────────────────────────┐
│  Layer 4: Database                                  │
└─────────────────────────────────────────────────────┘
```

## TypeScript Implementation

### Multi-Layer Cache

```typescript
// cache.ts
import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';

interface CacheOptions {
  ttl?: number;           // Time to live in seconds
  staleWhileRevalidate?: number;
  tags?: string[];        // For invalidation
}

class MultiLayerCache {
  private memory: LRUCache<string, { value: unknown; expires: number }>;
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
    this.memory = new LRUCache({
      max: 1000,
      ttl: 60 * 1000, // 1 minute default
    });
  }

  async get<T>(key: string): Promise<T | null> {
    // Layer 1: Memory
    const memoryHit = this.memory.get(key);
    if (memoryHit && memoryHit.expires > Date.now()) {
      return memoryHit.value as T;
    }

    // Layer 2: Redis
    const redisValue = await this.redis.get(key);
    if (redisValue) {
      const parsed = JSON.parse(redisValue) as T;
      // Populate memory cache
      this.memory.set(key, { value: parsed, expires: Date.now() + 60000 });
      return parsed;
    }

    return null;
  }

  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl || 3600; // 1 hour default

    // Set in Redis
    await this.redis.setex(key, ttl, JSON.stringify(value));

    // Set in memory (shorter TTL)
    this.memory.set(key, {
      value,
      expires: Date.now() + Math.min(ttl * 1000, 60000),
    });

    // Track tags for invalidation
    if (options.tags) {
      for (const tag of options.tags) {
        await this.redis.sadd(`cache:tag:${tag}`, key);
      }
    }
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Prevent cache stampede with lock
    const lockKey = `lock:${key}`;
    const acquired = await this.redis.set(lockKey, '1', 'EX', 10, 'NX');

    if (!acquired) {
      // Another process is fetching, wait and retry
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.getOrSet(key, fetcher, options);
    }

    try {
      const value = await fetcher();
      await this.set(key, value, options);
      return value;
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async invalidate(key: string): Promise<void> {
    this.memory.delete(key);
    await this.redis.del(key);
  }

  async invalidateByTag(tag: string): Promise<void> {
    const keys = await this.redis.smembers(`cache:tag:${tag}`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
      for (const key of keys) {
        this.memory.delete(key);
      }
    }
    await this.redis.del(`cache:tag:${tag}`);
  }
}

export { MultiLayerCache, CacheOptions };
```

### Cache-Aside Pattern

```typescript
// user-service.ts
class UserService {
  constructor(private cache: MultiLayerCache) {}

  async getUser(id: string): Promise<User> {
    return this.cache.getOrSet(
      `user:${id}`,
      async () => {
        return db.users.findUnique({ where: { id } });
      },
      { ttl: 3600, tags: ['users', `user:${id}`] }
    );
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const user = await db.users.update({
      where: { id },
      data,
    });

    // Invalidate cache
    await this.cache.invalidate(`user:${id}`);

    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.users.delete({ where: { id } });
    await this.cache.invalidateByTag(`user:${id}`);
  }
}
```

### HTTP Caching Middleware

```typescript
// http-cache-middleware.ts
import { Request, Response, NextFunction } from 'express';

interface HttpCacheOptions {
  maxAge?: number;
  sMaxAge?: number;
  staleWhileRevalidate?: number;
  private?: boolean;
  vary?: string[];
}

function httpCache(options: HttpCacheOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const directives: string[] = [];

    if (options.private) {
      directives.push('private');
    } else {
      directives.push('public');
    }

    if (options.maxAge !== undefined) {
      directives.push(`max-age=${options.maxAge}`);
    }

    if (options.sMaxAge !== undefined) {
      directives.push(`s-maxage=${options.sMaxAge}`);
    }

    if (options.staleWhileRevalidate !== undefined) {
      directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
    }

    res.setHeader('Cache-Control', directives.join(', '));

    if (options.vary) {
      res.setHeader('Vary', options.vary.join(', '));
    }

    next();
  };
}

// Usage
app.get('/api/products',
  httpCache({ maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 86400 }),
  async (req, res) => {
    const products = await getProducts();
    res.json(products);
  }
);
```

## Python Implementation

```python
# cache.py
import json
import time
from typing import TypeVar, Callable, Optional
from functools import lru_cache
import redis

T = TypeVar('T')

class MultiLayerCache:
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self._memory: dict[str, tuple[any, float]] = {}

    def get(self, key: str) -> Optional[any]:
        # Layer 1: Memory
        if key in self._memory:
            value, expires = self._memory[key]
            if expires > time.time():
                return value
            del self._memory[key]

        # Layer 2: Redis
        redis_value = self.redis.get(key)
        if redis_value:
            parsed = json.loads(redis_value)
            self._memory[key] = (parsed, time.time() + 60)
            return parsed

        return None

    def set(self, key: str, value: any, ttl: int = 3600, tags: list[str] = None):
        self.redis.setex(key, ttl, json.dumps(value))
        self._memory[key] = (value, time.time() + min(ttl, 60))

        if tags:
            for tag in tags:
                self.redis.sadd(f"cache:tag:{tag}", key)

    async def get_or_set(
        self,
        key: str,
        fetcher: Callable[[], T],
        ttl: int = 3600,
    ) -> T:
        cached = self.get(key)
        if cached is not None:
            return cached

        # Simple lock for stampede prevention
        lock_key = f"lock:{key}"
        if not self.redis.set(lock_key, "1", ex=10, nx=True):
            await asyncio.sleep(0.1)
            return await self.get_or_set(key, fetcher, ttl)

        try:
            value = await fetcher()
            self.set(key, value, ttl)
            return value
        finally:
            self.redis.delete(lock_key)

    def invalidate_by_tag(self, tag: str):
        keys = self.redis.smembers(f"cache:tag:{tag}")
        if keys:
            self.redis.delete(*keys)
            for key in keys:
                self._memory.pop(key.decode(), None)
        self.redis.delete(f"cache:tag:{tag}")
```

### Decorator Pattern

```python
# cache_decorator.py
from functools import wraps

def cached(key_template: str, ttl: int = 3600, tags: list[str] = None):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Build cache key from template
            key = key_template.format(*args, **kwargs)
            
            cached_value = cache.get(key)
            if cached_value is not None:
                return cached_value

            result = await func(*args, **kwargs)
            cache.set(key, result, ttl=ttl, tags=tags)
            return result
        return wrapper
    return decorator

# Usage
@cached("user:{user_id}", ttl=3600, tags=["users"])
async def get_user(user_id: str) -> User:
    return await db.users.find_unique(where={"id": user_id})
```

## Cache Invalidation Strategies

### 1. Time-Based (TTL)

```typescript
await cache.set('key', value, { ttl: 3600 }); // Expires in 1 hour
```

### 2. Event-Based

```typescript
// On data change
eventBus.on('user.updated', async (userId) => {
  await cache.invalidate(`user:${userId}`);
});
```

### 3. Tag-Based

```typescript
// Set with tags
await cache.set(`product:${id}`, product, { tags: ['products', `category:${categoryId}`] });

// Invalidate all products in category
await cache.invalidateByTag(`category:${categoryId}`);
```

### 4. Write-Through

```typescript
async function updateUser(id: string, data: Partial<User>) {
  const user = await db.users.update({ where: { id }, data });
  await cache.set(`user:${id}`, user); // Update cache immediately
  return user;
}
```

## Best Practices

1. **Cache at the right layer** - Don't cache everything in Redis
2. **Use appropriate TTLs** - Balance freshness vs performance
3. **Prevent stampedes** - Use locks or stale-while-revalidate
4. **Monitor hit rates** - Track cache effectiveness
5. **Plan for invalidation** - Use tags for related data

## Common Mistakes

- Caching user-specific data without proper keys
- No cache invalidation strategy
- TTLs too long (stale data) or too short (no benefit)
- Caching errors or null values
- Not handling cache failures gracefully
