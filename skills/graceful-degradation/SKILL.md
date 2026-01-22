---
name: graceful-degradation
description: Build resilient systems that degrade gracefully under failure. Implement fallbacks, feature flags, and partial responses when dependencies fail.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: resilience
  time: 3h
  source: drift-masterguide
---

# Graceful Degradation

Keep your app running even when things break.

## When to Use This Skill

- External API dependencies
- Non-critical features
- High-availability requirements
- Microservices architecture
- Third-party integrations

## Degradation Strategies

```
┌─────────────────────────────────────────────────────┐
│                  User Request                        │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Primary Service                         │
│                                                     │
│  Try primary implementation                         │
│  ├─ Success → Return result                         │
│  └─ Failure → Try fallback                          │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Fallback Options                        │
│                                                     │
│  1. Cached data (stale but available)               │
│  2. Default values                                  │
│  3. Reduced functionality                           │
│  4. Queue for later                                 │
│  5. Graceful error message                          │
└─────────────────────────────────────────────────────┘
```

## TypeScript Implementation

### Fallback Service

```typescript
// fallback-service.ts
interface FallbackOptions<T> {
  primary: () => Promise<T>;
  fallback: () => Promise<T> | T;
  shouldFallback?: (error: Error) => boolean;
  onFallback?: (error: Error) => void;
  timeout?: number;
}

async function withFallback<T>(options: FallbackOptions<T>): Promise<T> {
  const { primary, fallback, shouldFallback, onFallback, timeout = 5000 } = options;

  try {
    // Add timeout to primary
    const result = await Promise.race([
      primary(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout)
      ),
    ]);
    return result;
  } catch (error) {
    // Check if we should use fallback
    if (shouldFallback && !shouldFallback(error as Error)) {
      throw error;
    }

    // Log fallback usage
    onFallback?.(error as Error);
    console.warn('Using fallback due to:', (error as Error).message);

    // Return fallback value
    const fallbackResult = fallback();
    return fallbackResult instanceof Promise ? await fallbackResult : fallbackResult;
  }
}

export { withFallback, FallbackOptions };
```

### Practical Examples

```typescript
// product-service.ts
class ProductService {
  private cache: Cache;
  private searchClient: SearchClient;

  // Example 1: Cache fallback
  async getProduct(id: string): Promise<Product> {
    return withFallback({
      primary: () => this.fetchFromDatabase(id),
      fallback: () => this.cache.get(`product:${id}`),
      onFallback: (err) => metrics.increment('product.cache_fallback'),
    });
  }

  // Example 2: Search with degraded results
  async searchProducts(query: string): Promise<SearchResult> {
    return withFallback({
      primary: async () => {
        // Full-featured Elasticsearch search
        return this.searchClient.search({
          query,
          facets: true,
          suggestions: true,
          personalization: true,
        });
      },
      fallback: async () => {
        // Degraded: Simple database LIKE query
        const products = await db.products.findMany({
          where: { name: { contains: query } },
          take: 20,
        });
        return {
          results: products,
          facets: null,        // Not available
          suggestions: null,   // Not available
          degraded: true,      // Signal to frontend
        };
      },
      timeout: 2000,
    });
  }

  // Example 3: Recommendations with default fallback
  async getRecommendations(userId: string): Promise<Product[]> {
    return withFallback({
      primary: () => this.mlService.getPersonalizedRecommendations(userId),
      fallback: () => this.getPopularProducts(), // Generic fallback
      shouldFallback: (err) => err.message !== 'User not found',
    });
  }
}
```

### Partial Response Pattern

```typescript
// dashboard-service.ts
interface DashboardData {
  user: User;
  stats: Stats | null;
  notifications: Notification[] | null;
  recommendations: Product[] | null;
  errors: string[];
}

async function getDashboard(userId: string): Promise<DashboardData> {
  const errors: string[] = [];

  // User is required - fail if unavailable
  const user = await userService.getUser(userId);

  // Stats are nice to have
  const stats = await withFallback({
    primary: () => statsService.getUserStats(userId),
    fallback: () => null,
    onFallback: () => errors.push('Stats temporarily unavailable'),
  });

  // Notifications are nice to have
  const notifications = await withFallback({
    primary: () => notificationService.getUnread(userId),
    fallback: () => null,
    onFallback: () => errors.push('Notifications temporarily unavailable'),
  });

  // Recommendations are nice to have
  const recommendations = await withFallback({
    primary: () => recommendationService.getForUser(userId),
    fallback: () => null,
    onFallback: () => errors.push('Recommendations temporarily unavailable'),
  });

  return { user, stats, notifications, recommendations, errors };
}
```

### Feature Degradation with Flags

```typescript
// feature-degradation.ts
class FeatureDegradation {
  private degradedFeatures = new Set<string>();

  async execute<T>(
    feature: string,
    primary: () => Promise<T>,
    fallback: () => T | Promise<T>
  ): Promise<T> {
    // Check if feature is already degraded
    if (this.degradedFeatures.has(feature)) {
      return fallback instanceof Function ? fallback() : fallback;
    }

    try {
      return await primary();
    } catch (error) {
      // Auto-degrade feature after failures
      this.degradedFeatures.add(feature);
      
      // Schedule recovery check
      setTimeout(() => this.checkRecovery(feature, primary), 30000);
      
      return fallback instanceof Function ? fallback() : fallback;
    }
  }

  private async checkRecovery(feature: string, healthCheck: () => Promise<unknown>) {
    try {
      await healthCheck();
      this.degradedFeatures.delete(feature);
      console.log(`Feature ${feature} recovered`);
    } catch {
      // Still failing, check again later
      setTimeout(() => this.checkRecovery(feature, healthCheck), 60000);
    }
  }
}

const degradation = new FeatureDegradation();

// Usage
const searchResults = await degradation.execute(
  'elasticsearch',
  () => elasticSearch.query(term),
  () => sqlSearch.query(term)
);
```

## Python Implementation

```python
# fallback.py
from typing import TypeVar, Callable, Optional
import asyncio

T = TypeVar('T')

async def with_fallback(
    primary: Callable[[], T],
    fallback: Callable[[], T],
    timeout: float = 5.0,
    on_fallback: Optional[Callable[[Exception], None]] = None,
) -> T:
    try:
        result = await asyncio.wait_for(primary(), timeout=timeout)
        return result
    except Exception as e:
        if on_fallback:
            on_fallback(e)
        return await fallback() if asyncio.iscoroutinefunction(fallback) else fallback()

# Usage
async def get_product(product_id: str) -> Product:
    return await with_fallback(
        primary=lambda: fetch_from_database(product_id),
        fallback=lambda: cache.get(f"product:{product_id}"),
        timeout=2.0,
        on_fallback=lambda e: logger.warning(f"Using cache fallback: {e}"),
    )
```

### Decorator Pattern

```python
# degradable.py
from functools import wraps

def degradable(fallback_value=None, fallback_func=None, timeout=5.0):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await asyncio.wait_for(
                    func(*args, **kwargs),
                    timeout=timeout
                )
            except Exception as e:
                logger.warning(f"{func.__name__} degraded: {e}")
                if fallback_func:
                    return await fallback_func(*args, **kwargs)
                return fallback_value
        return wrapper
    return decorator

# Usage
@degradable(fallback_value=[], timeout=2.0)
async def get_recommendations(user_id: str) -> list[Product]:
    return await ml_service.get_recommendations(user_id)
```

## Frontend Handling

```typescript
// React component handling degraded responses
function Dashboard({ data }: { data: DashboardData }) {
  return (
    <div>
      <UserProfile user={data.user} />
      
      {data.stats ? (
        <StatsPanel stats={data.stats} />
      ) : (
        <DegradedNotice message="Stats temporarily unavailable" />
      )}
      
      {data.recommendations ? (
        <Recommendations items={data.recommendations} />
      ) : (
        <PopularProducts /> // Fallback UI
      )}
      
      {data.errors.length > 0 && (
        <SystemNotice errors={data.errors} />
      )}
    </div>
  );
}
```

## Best Practices

1. **Identify critical vs non-critical** - Know what can fail
2. **Always have a fallback** - Even if it's just an error message
3. **Signal degradation to users** - Don't hide failures
4. **Monitor fallback usage** - Track when degradation happens
5. **Test failure scenarios** - Chaos engineering

## Common Mistakes

- No fallback for external dependencies
- Hiding degradation from users
- Fallback that's also likely to fail
- Not monitoring fallback frequency
- Cascading failures from one service
