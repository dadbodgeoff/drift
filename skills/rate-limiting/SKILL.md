---
name: rate-limiting
description: Implement subscription-tier aware API rate limiting with sliding window algorithm. Use when building SaaS APIs that need per-user or per-tier rate limits with Redis or in-memory storage.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: api
  time: 4h
  source: drift-masterguide
---

# Rate Limiting

Protect your API with subscription-tier aware rate limiting.

## When to Use This Skill

- Building a SaaS API with different subscription tiers
- Protecting endpoints from abuse
- Implementing fair usage policies
- Adding rate limits to existing APIs

## Core Concepts

### Sliding Window Algorithm

More accurate than fixed windows, prevents burst at window boundaries:

```
Window: [----older----][----current----]
Weight:      30%             70%
```

### Tier-Based Limits

| Tier | Requests/min | Burst |
|------|-------------|-------|
| Free | 60 | 10 |
| Pro | 600 | 100 |
| Enterprise | 6000 | 1000 |

## TypeScript Implementation

```typescript
// rate-limiter.ts
import { Redis } from 'ioredis';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  burstLimit?: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

const TIER_LIMITS: Record<string, RateLimitConfig> = {
  free: { windowMs: 60000, maxRequests: 60, burstLimit: 10 },
  pro: { windowMs: 60000, maxRequests: 600, burstLimit: 100 },
  enterprise: { windowMs: 60000, maxRequests: 6000, burstLimit: 1000 },
};

class RateLimiter {
  constructor(private redis: Redis) {}

  async check(key: string, tier: string = 'free'): Promise<RateLimitResult> {
    const config = TIER_LIMITS[tier] || TIER_LIMITS.free;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const multi = this.redis.multi();
    
    // Remove old entries
    multi.zremrangebyscore(key, 0, windowStart);
    // Count current window
    multi.zcard(key);
    // Add current request
    multi.zadd(key, now.toString(), `${now}-${Math.random()}`);
    // Set expiry
    multi.expire(key, Math.ceil(config.windowMs / 1000) + 1);

    const results = await multi.exec();
    const currentCount = (results?.[1]?.[1] as number) || 0;

    const allowed = currentCount < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - currentCount - 1);
    const resetAt = now + config.windowMs;

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : Math.ceil(config.windowMs / 1000),
    };
  }
}

export { RateLimiter, RateLimitConfig, RateLimitResult, TIER_LIMITS };
```

## Express Middleware

```typescript
// rate-limit-middleware.ts
import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from './rate-limiter';

interface RateLimitOptions {
  keyGenerator?: (req: Request) => string;
  tierResolver?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

function createRateLimitMiddleware(
  limiter: RateLimiter,
  options: RateLimitOptions = {}
) {
  const {
    keyGenerator = (req) => req.ip || 'unknown',
    tierResolver = (req) => (req as any).user?.tier || 'free',
    skip = () => false,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) return next();

    const key = `ratelimit:${keyGenerator(req)}`;
    const tier = tierResolver(req);
    const result = await limiter.check(key, tier);

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': TIER_LIMITS[tier]?.maxRequests || 60,
      'X-RateLimit-Remaining': result.remaining,
      'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000),
    });

    if (!result.allowed) {
      res.set('Retry-After', result.retryAfter?.toString() || '60');
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${result.retryAfter} seconds.`,
        retryAfter: result.retryAfter,
      });
    }

    next();
  };
}

export { createRateLimitMiddleware };
```

## Python Implementation

```python
# rate_limiter.py
import time
from typing import Optional, NamedTuple
from redis import Redis

class RateLimitResult(NamedTuple):
    allowed: bool
    remaining: int
    reset_at: float
    retry_after: Optional[int] = None

TIER_LIMITS = {
    "free": {"window_ms": 60000, "max_requests": 60, "burst_limit": 10},
    "pro": {"window_ms": 60000, "max_requests": 600, "burst_limit": 100},
    "enterprise": {"window_ms": 60000, "max_requests": 6000, "burst_limit": 1000},
}

class RateLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    def check(self, key: str, tier: str = "free") -> RateLimitResult:
        config = TIER_LIMITS.get(tier, TIER_LIMITS["free"])
        now = time.time() * 1000
        window_start = now - config["window_ms"]

        pipe = self.redis.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zcard(key)
        pipe.zadd(key, {f"{now}-{id(object())}": now})
        pipe.expire(key, int(config["window_ms"] / 1000) + 1)
        
        results = pipe.execute()
        current_count = results[1]

        allowed = current_count < config["max_requests"]
        remaining = max(0, config["max_requests"] - current_count - 1)
        reset_at = now + config["window_ms"]

        return RateLimitResult(
            allowed=allowed,
            remaining=remaining,
            reset_at=reset_at,
            retry_after=None if allowed else int(config["window_ms"] / 1000),
        )
```

## FastAPI Middleware

```python
# fastapi_middleware.py
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, limiter: RateLimiter):
        super().__init__(app)
        self.limiter = limiter

    async def dispatch(self, request: Request, call_next):
        # Get user tier from request (customize based on your auth)
        tier = getattr(request.state, "user_tier", "free")
        key = f"ratelimit:{request.client.host}"
        
        result = self.limiter.check(key, tier)
        
        if not result.allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Too Many Requests",
                    "retry_after": result.retry_after,
                },
                headers={
                    "Retry-After": str(result.retry_after),
                    "X-RateLimit-Remaining": "0",
                },
            )
        
        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(result.remaining)
        response.headers["X-RateLimit-Reset"] = str(int(result.reset_at / 1000))
        return response
```

## In-Memory Alternative (No Redis)

```typescript
// memory-rate-limiter.ts
class InMemoryRateLimiter {
  private windows = new Map<string, number[]>();

  check(key: string, tier: string = 'free'): RateLimitResult {
    const config = TIER_LIMITS[tier] || TIER_LIMITS.free;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get or create window
    let timestamps = this.windows.get(key) || [];
    
    // Remove old entries
    timestamps = timestamps.filter(t => t > windowStart);
    
    const allowed = timestamps.length < config.maxRequests;
    
    if (allowed) {
      timestamps.push(now);
      this.windows.set(key, timestamps);
    }

    return {
      allowed,
      remaining: Math.max(0, config.maxRequests - timestamps.length),
      resetAt: now + config.windowMs,
      retryAfter: allowed ? undefined : Math.ceil(config.windowMs / 1000),
    };
  }

  // Cleanup old entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.windows) {
      const filtered = timestamps.filter(t => t > now - 60000);
      if (filtered.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, filtered);
      }
    }
  }
}
```

## Best Practices

1. **Use Redis for distributed systems**: In-memory only works for single instances
2. **Set appropriate headers**: Clients need `X-RateLimit-*` and `Retry-After`
3. **Return 429 status**: Standard HTTP status for rate limiting
4. **Consider burst limits**: Allow short bursts above sustained rate
5. **Key by user, not just IP**: Authenticated users should have their own limits

## Common Mistakes

- Using fixed windows (causes burst at boundaries)
- Not handling Redis failures gracefully
- Forgetting to set response headers
- Rate limiting health check endpoints
- Not differentiating authenticated vs anonymous users

## Integration with Stripe Tiers

```typescript
// Resolve tier from Stripe subscription
const tierResolver = async (req: Request): Promise<string> => {
  const user = req.user;
  if (!user?.stripeSubscriptionId) return 'free';
  
  const subscription = await stripe.subscriptions.retrieve(
    user.stripeSubscriptionId
  );
  
  const priceId = subscription.items.data[0]?.price.id;
  return PRICE_TO_TIER[priceId] || 'free';
};
```
