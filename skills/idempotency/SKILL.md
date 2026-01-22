---
name: idempotency
description: Implement idempotent API operations to safely handle retries and prevent duplicate processing. Use when building payment APIs, order systems, or any operation that must not be executed twice.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: api
  time: 4h
  source: drift-masterguide
---

# Idempotent API Operations

Safely handle retries without duplicate side effects.

## When to Use This Skill

- Payment processing (charges, refunds)
- Order creation and fulfillment
- Any operation with side effects
- APIs that may be retried by clients
- Webhook handlers

## What is Idempotency?

An operation is idempotent if executing it multiple times produces the same result as executing it once.

```
Request 1: POST /orders {item: "book"}  → Order #123 created
Request 2: POST /orders {item: "book"}  → Order #123 returned (not #124)
                                          (same idempotency key)
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Client Request                    │
│              Idempotency-Key: abc-123               │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Check Idempotency Store                │
│                                                     │
│  Key exists?                                        │
│  ├─ Yes, completed → Return cached response         │
│  ├─ Yes, in-progress → Return 409 Conflict          │
│  └─ No → Continue processing                        │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Lock & Process Request                 │
│                                                     │
│  1. Acquire lock (set key as "processing")          │
│  2. Execute operation                               │
│  3. Store response                                  │
│  4. Return response                                 │
└─────────────────────────────────────────────────────┘
```

## TypeScript Implementation

### Idempotency Store

```typescript
// idempotency-store.ts
import { Redis } from 'ioredis';

interface IdempotencyRecord {
  status: 'processing' | 'completed';
  response?: {
    statusCode: number;
    body: unknown;
    headers?: Record<string, string>;
  };
  createdAt: number;
  completedAt?: number;
}

interface IdempotencyConfig {
  redis: Redis;
  keyPrefix?: string;
  lockTtlMs?: number;      // How long to hold processing lock
  responseTtlMs?: number;  // How long to cache completed responses
}

class IdempotencyStore {
  private redis: Redis;
  private keyPrefix: string;
  private lockTtl: number;
  private responseTtl: number;

  constructor(config: IdempotencyConfig) {
    this.redis = config.redis;
    this.keyPrefix = config.keyPrefix || 'idempotency:';
    this.lockTtl = config.lockTtlMs || 60000;      // 1 minute
    this.responseTtl = config.responseTtlMs || 86400000; // 24 hours
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const data = await this.redis.get(this.keyPrefix + key);
    return data ? JSON.parse(data) : null;
  }

  async acquireLock(key: string): Promise<boolean> {
    const record: IdempotencyRecord = {
      status: 'processing',
      createdAt: Date.now(),
    };

    // SET NX = only set if not exists
    const result = await this.redis.set(
      this.keyPrefix + key,
      JSON.stringify(record),
      'PX',
      this.lockTtl,
      'NX'
    );

    return result === 'OK';
  }

  async complete(
    key: string,
    response: IdempotencyRecord['response']
  ): Promise<void> {
    const record: IdempotencyRecord = {
      status: 'completed',
      response,
      createdAt: Date.now(),
      completedAt: Date.now(),
    };

    await this.redis.set(
      this.keyPrefix + key,
      JSON.stringify(record),
      'PX',
      this.responseTtl
    );
  }

  async release(key: string): Promise<void> {
    await this.redis.del(this.keyPrefix + key);
  }
}

export { IdempotencyStore, IdempotencyRecord, IdempotencyConfig };
```

### Express Middleware

```typescript
// idempotency-middleware.ts
import { Request, Response, NextFunction } from 'express';
import { IdempotencyStore } from './idempotency-store';

interface IdempotencyOptions {
  store: IdempotencyStore;
  headerName?: string;
  methods?: string[];
  paths?: RegExp[];
}

function idempotencyMiddleware(options: IdempotencyOptions) {
  const {
    store,
    headerName = 'Idempotency-Key',
    methods = ['POST', 'PUT', 'PATCH'],
    paths = [/.*/],
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only apply to specified methods
    if (!methods.includes(req.method)) {
      return next();
    }

    // Only apply to specified paths
    if (!paths.some(p => p.test(req.path))) {
      return next();
    }

    const idempotencyKey = req.headers[headerName.toLowerCase()] as string;

    // No key provided - proceed without idempotency
    if (!idempotencyKey) {
      return next();
    }

    // Create a unique key combining the idempotency key with request details
    const fullKey = `${req.method}:${req.path}:${idempotencyKey}`;

    // Check for existing record
    const existing = await store.get(fullKey);

    if (existing) {
      if (existing.status === 'processing') {
        // Request is still being processed
        return res.status(409).json({
          error: 'Conflict',
          message: 'A request with this idempotency key is already being processed',
        });
      }

      if (existing.status === 'completed' && existing.response) {
        // Return cached response
        res.status(existing.response.statusCode);
        if (existing.response.headers) {
          for (const [key, value] of Object.entries(existing.response.headers)) {
            res.setHeader(key, value);
          }
        }
        res.setHeader('X-Idempotent-Replayed', 'true');
        return res.json(existing.response.body);
      }
    }

    // Try to acquire lock
    const acquired = await store.acquireLock(fullKey);

    if (!acquired) {
      // Another request just acquired the lock
      return res.status(409).json({
        error: 'Conflict',
        message: 'A request with this idempotency key is already being processed',
      });
    }

    // Capture the response
    const originalJson = res.json.bind(res);
    let responseBody: unknown;

    res.json = (body: unknown) => {
      responseBody = body;
      return originalJson(body);
    };

    // Store response after it's sent
    res.on('finish', async () => {
      if (res.statusCode >= 200 && res.statusCode < 500) {
        // Store successful responses and client errors (but not server errors)
        await store.complete(fullKey, {
          statusCode: res.statusCode,
          body: responseBody,
        });
      } else {
        // Release lock for server errors (allow retry)
        await store.release(fullKey);
      }
    });

    next();
  };
}

export { idempotencyMiddleware, IdempotencyOptions };
```

### Usage

```typescript
// app.ts
import express from 'express';
import { Redis } from 'ioredis';
import { IdempotencyStore } from './idempotency-store';
import { idempotencyMiddleware } from './idempotency-middleware';

const app = express();
const redis = new Redis();

const idempotencyStore = new IdempotencyStore({ redis });

// Apply to all POST/PUT/PATCH requests
app.use(idempotencyMiddleware({
  store: idempotencyStore,
  methods: ['POST', 'PUT', 'PATCH'],
}));

// Or apply to specific routes
app.post('/orders',
  idempotencyMiddleware({
    store: idempotencyStore,
    paths: [/^\/orders$/],
  }),
  async (req, res) => {
    const order = await createOrder(req.body);
    res.status(201).json(order);
  }
);
```

## Python Implementation

```python
# idempotency.py
import json
import time
from typing import Optional, Dict, Any
from dataclasses import dataclass
import redis
from functools import wraps

@dataclass
class IdempotencyRecord:
    status: str  # 'processing' | 'completed'
    response: Optional[Dict[str, Any]] = None
    created_at: float = 0
    completed_at: Optional[float] = None

class IdempotencyStore:
    def __init__(
        self,
        redis_client: redis.Redis,
        key_prefix: str = "idempotency:",
        lock_ttl_ms: int = 60000,
        response_ttl_ms: int = 86400000,
    ):
        self.redis = redis_client
        self.key_prefix = key_prefix
        self.lock_ttl = lock_ttl_ms
        self.response_ttl = response_ttl_ms

    def get(self, key: str) -> Optional[IdempotencyRecord]:
        data = self.redis.get(self.key_prefix + key)
        if not data:
            return None
        parsed = json.loads(data)
        return IdempotencyRecord(**parsed)

    def acquire_lock(self, key: str) -> bool:
        record = {
            "status": "processing",
            "created_at": time.time(),
        }
        result = self.redis.set(
            self.key_prefix + key,
            json.dumps(record),
            px=self.lock_ttl,
            nx=True,
        )
        return result is True

    def complete(self, key: str, response: Dict[str, Any]) -> None:
        record = {
            "status": "completed",
            "response": response,
            "created_at": time.time(),
            "completed_at": time.time(),
        }
        self.redis.set(
            self.key_prefix + key,
            json.dumps(record),
            px=self.response_ttl,
        )

    def release(self, key: str) -> None:
        self.redis.delete(self.key_prefix + key)
```

### FastAPI Middleware

```python
# fastapi_idempotency.py
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

class IdempotencyMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        store: IdempotencyStore,
        header_name: str = "Idempotency-Key",
        methods: list = None,
    ):
        super().__init__(app)
        self.store = store
        self.header_name = header_name
        self.methods = methods or ["POST", "PUT", "PATCH"]

    async def dispatch(self, request: Request, call_next):
        if request.method not in self.methods:
            return await call_next(request)

        idempotency_key = request.headers.get(self.header_name)
        if not idempotency_key:
            return await call_next(request)

        full_key = f"{request.method}:{request.url.path}:{idempotency_key}"

        # Check existing
        existing = self.store.get(full_key)
        if existing:
            if existing.status == "processing":
                raise HTTPException(
                    status_code=409,
                    detail="Request with this idempotency key is being processed",
                )
            if existing.status == "completed" and existing.response:
                return JSONResponse(
                    content=existing.response["body"],
                    status_code=existing.response["status_code"],
                    headers={"X-Idempotent-Replayed": "true"},
                )

        # Acquire lock
        if not self.store.acquire_lock(full_key):
            raise HTTPException(
                status_code=409,
                detail="Request with this idempotency key is being processed",
            )

        try:
            response = await call_next(request)
            
            # Cache successful responses
            if 200 <= response.status_code < 500:
                body = b""
                async for chunk in response.body_iterator:
                    body += chunk
                
                self.store.complete(full_key, {
                    "status_code": response.status_code,
                    "body": json.loads(body),
                })
                
                return JSONResponse(
                    content=json.loads(body),
                    status_code=response.status_code,
                )
            else:
                self.store.release(full_key)
                return response
        except Exception:
            self.store.release(full_key)
            raise
```

### Decorator Pattern

```python
# idempotent_decorator.py
from functools import wraps

def idempotent(store: IdempotencyStore, key_func=None):
    """
    Decorator for idempotent functions.
    
    @idempotent(store, key_func=lambda args: args[0].order_id)
    async def process_order(order: Order):
        ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate key
            if key_func:
                key = key_func(args, kwargs)
            else:
                key = f"{func.__name__}:{hash(str(args) + str(kwargs))}"

            # Check existing
            existing = store.get(key)
            if existing and existing.status == "completed":
                return existing.response["result"]

            # Acquire lock
            if not store.acquire_lock(key):
                raise Exception("Operation already in progress")

            try:
                result = await func(*args, **kwargs)
                store.complete(key, {"result": result})
                return result
            except Exception:
                store.release(key)
                raise

        return wrapper
    return decorator

# Usage
@idempotent(store, key_func=lambda args, kwargs: f"order:{kwargs.get('order_id')}")
async def process_payment(order_id: str, amount: float):
    return await stripe.charges.create(amount=amount)
```

## Client-Side Implementation

```typescript
// idempotent-client.ts
class IdempotentClient {
  private generateKey(): string {
    return crypto.randomUUID();
  }

  async post<T>(url: string, data: unknown, options?: RequestInit): Promise<T> {
    const idempotencyKey = this.generateKey();
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...options?.headers,
      },
      body: JSON.stringify(data),
      ...options,
    });

    if (response.status === 409) {
      // Request in progress, wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      return this.postWithKey(url, data, idempotencyKey, options);
    }

    return response.json();
  }

  private async postWithKey<T>(
    url: string,
    data: unknown,
    idempotencyKey: string,
    options?: RequestInit,
    retries = 3
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...options?.headers,
      },
      body: JSON.stringify(data),
      ...options,
    });

    if (response.status === 409 && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return this.postWithKey(url, data, idempotencyKey, options, retries - 1);
    }

    return response.json();
  }
}
```

## Best Practices

1. **Include request details in key**: Method + path + idempotency key
2. **Set appropriate TTLs**: Lock TTL < Response TTL
3. **Handle 409 gracefully**: Client should wait and retry
4. **Don't cache server errors**: Allow retry on 5xx
5. **Use UUIDs for keys**: Clients should generate unique keys

## Common Mistakes

- Using sequential IDs (collisions across users)
- Caching server errors (prevents retry)
- Too short response TTL (client retries get new result)
- Not including request path in key (different endpoints collide)
- Forgetting to release lock on error

## Security Considerations

- Validate idempotency key format
- Rate limit by idempotency key
- Don't expose internal state in 409 responses
- Consider per-user key namespacing
