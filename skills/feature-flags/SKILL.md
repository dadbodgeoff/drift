---
name: feature-flags
description: Implement a feature flag system for gradual rollouts, A/B testing, and kill switches. Use when you need to control feature availability without deployments, test features with specific users, or implement percentage-based rollouts.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: foundations
  time: 3h
  source: drift-masterguide
---

# Feature Flags

Control feature availability without deployments.

## When to Use This Skill

- Gradual feature rollouts (1% → 10% → 100%)
- A/B testing different implementations
- Kill switches for problematic features
- Beta features for specific users
- Environment-specific features

## Flag Types

| Type | Use Case | Example |
|------|----------|---------|
| Boolean | Simple on/off | `new_checkout_enabled` |
| Percentage | Gradual rollout | `new_ui: 25%` |
| User List | Beta testers | `beta_users: [id1, id2]` |
| Segment | User groups | `premium_feature: tier=pro` |

## TypeScript Implementation

### Flag Configuration

```typescript
// feature-flags.ts
interface FlagConfig {
  enabled: boolean;
  percentage?: number;        // 0-100 for gradual rollout
  allowedUsers?: string[];    // Specific user IDs
  allowedSegments?: string[]; // User segments (e.g., 'beta', 'pro')
  metadata?: Record<string, unknown>;
}

interface FeatureFlagsConfig {
  flags: Record<string, FlagConfig>;
  defaultEnabled: boolean;
}

interface UserContext {
  id: string;
  segments?: string[];
  attributes?: Record<string, unknown>;
}

class FeatureFlags {
  private config: FeatureFlagsConfig;

  constructor(config: FeatureFlagsConfig) {
    this.config = config;
  }

  isEnabled(flagName: string, user?: UserContext): boolean {
    const flag = this.config.flags[flagName];
    
    if (!flag) {
      return this.config.defaultEnabled;
    }

    if (!flag.enabled) {
      return false;
    }

    // Check user allowlist
    if (flag.allowedUsers?.length && user) {
      if (flag.allowedUsers.includes(user.id)) {
        return true;
      }
    }

    // Check segment allowlist
    if (flag.allowedSegments?.length && user?.segments) {
      const hasSegment = flag.allowedSegments.some(
        segment => user.segments?.includes(segment)
      );
      if (hasSegment) {
        return true;
      }
    }

    // Check percentage rollout
    if (flag.percentage !== undefined && user) {
      return this.isInPercentage(user.id, flagName, flag.percentage);
    }

    // If no specific rules, use enabled status
    return flag.enabled && !flag.percentage && !flag.allowedUsers?.length;
  }

  private isInPercentage(userId: string, flagName: string, percentage: number): boolean {
    // Consistent hashing - same user always gets same result
    const hash = this.hashString(`${userId}:${flagName}`);
    const bucket = hash % 100;
    return bucket < percentage;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  getFlag(flagName: string): FlagConfig | undefined {
    return this.config.flags[flagName];
  }

  getAllFlags(): Record<string, FlagConfig> {
    return { ...this.config.flags };
  }

  // For client-side: get all flags evaluated for a user
  evaluateAll(user?: UserContext): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const flagName of Object.keys(this.config.flags)) {
      result[flagName] = this.isEnabled(flagName, user);
    }
    return result;
  }
}

export { FeatureFlags, FlagConfig, FeatureFlagsConfig, UserContext };
```

### Dynamic Flag Loading

```typescript
// flag-loader.ts
import { Redis } from 'ioredis';
import { FeatureFlags, FeatureFlagsConfig } from './feature-flags';

class DynamicFeatureFlags {
  private flags: FeatureFlags;
  private redis: Redis;
  private refreshInterval: NodeJS.Timeout;

  constructor(redis: Redis, refreshMs = 30000) {
    this.redis = redis;
    this.flags = new FeatureFlags({ flags: {}, defaultEnabled: false });
    
    // Refresh flags periodically
    this.refreshInterval = setInterval(() => this.refresh(), refreshMs);
    this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const configJson = await this.redis.get('feature_flags');
      if (configJson) {
        const config: FeatureFlagsConfig = JSON.parse(configJson);
        this.flags = new FeatureFlags(config);
      }
    } catch (error) {
      console.error('Failed to refresh feature flags:', error);
    }
  }

  isEnabled(flagName: string, user?: UserContext): boolean {
    return this.flags.isEnabled(flagName, user);
  }

  evaluateAll(user?: UserContext): Record<string, boolean> {
    return this.flags.evaluateAll(user);
  }

  async setFlag(flagName: string, config: FlagConfig): Promise<void> {
    const currentConfig = await this.getConfig();
    currentConfig.flags[flagName] = config;
    await this.redis.set('feature_flags', JSON.stringify(currentConfig));
    await this.refresh();
  }

  async deleteFlag(flagName: string): Promise<void> {
    const currentConfig = await this.getConfig();
    delete currentConfig.flags[flagName];
    await this.redis.set('feature_flags', JSON.stringify(currentConfig));
    await this.refresh();
  }

  private async getConfig(): Promise<FeatureFlagsConfig> {
    const configJson = await this.redis.get('feature_flags');
    return configJson 
      ? JSON.parse(configJson) 
      : { flags: {}, defaultEnabled: false };
  }

  close(): void {
    clearInterval(this.refreshInterval);
  }
}

export { DynamicFeatureFlags };
```

### Express Middleware

```typescript
// feature-flag-middleware.ts
import { Request, Response, NextFunction } from 'express';
import { DynamicFeatureFlags, UserContext } from './flag-loader';

declare global {
  namespace Express {
    interface Request {
      featureFlags: Record<string, boolean>;
      isFeatureEnabled: (flag: string) => boolean;
    }
  }
}

function featureFlagMiddleware(flags: DynamicFeatureFlags) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Build user context from request
    const user: UserContext | undefined = req.user ? {
      id: req.user.id,
      segments: [req.user.tier, ...(req.user.tags || [])],
      attributes: {
        email: req.user.email,
        createdAt: req.user.createdAt,
      },
    } : undefined;

    // Evaluate all flags for this user
    req.featureFlags = flags.evaluateAll(user);
    
    // Helper function
    req.isFeatureEnabled = (flag: string) => req.featureFlags[flag] ?? false;

    next();
  };
}

export { featureFlagMiddleware };
```

### Usage in Routes

```typescript
// routes.ts
app.get('/checkout', (req, res) => {
  if (req.isFeatureEnabled('new_checkout')) {
    return res.render('checkout-v2');
  }
  return res.render('checkout');
});

app.get('/api/features', (req, res) => {
  // Send evaluated flags to frontend
  res.json({ flags: req.featureFlags });
});
```

## Python Implementation

```python
# feature_flags.py
import hashlib
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
import json
import redis

@dataclass
class FlagConfig:
    enabled: bool
    percentage: Optional[int] = None
    allowed_users: List[str] = field(default_factory=list)
    allowed_segments: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class UserContext:
    id: str
    segments: List[str] = field(default_factory=list)
    attributes: Dict[str, Any] = field(default_factory=dict)

class FeatureFlags:
    def __init__(self, flags: Dict[str, FlagConfig], default_enabled: bool = False):
        self.flags = flags
        self.default_enabled = default_enabled

    def is_enabled(self, flag_name: str, user: Optional[UserContext] = None) -> bool:
        flag = self.flags.get(flag_name)
        
        if not flag:
            return self.default_enabled
        
        if not flag.enabled:
            return False

        # Check user allowlist
        if flag.allowed_users and user:
            if user.id in flag.allowed_users:
                return True

        # Check segment allowlist
        if flag.allowed_segments and user and user.segments:
            if any(seg in flag.allowed_segments for seg in user.segments):
                return True

        # Check percentage rollout
        if flag.percentage is not None and user:
            return self._is_in_percentage(user.id, flag_name, flag.percentage)

        # Default to enabled if no specific rules
        return flag.enabled and not flag.percentage and not flag.allowed_users

    def _is_in_percentage(self, user_id: str, flag_name: str, percentage: int) -> bool:
        hash_input = f"{user_id}:{flag_name}".encode()
        hash_value = int(hashlib.md5(hash_input).hexdigest(), 16)
        bucket = hash_value % 100
        return bucket < percentage

    def evaluate_all(self, user: Optional[UserContext] = None) -> Dict[str, bool]:
        return {
            name: self.is_enabled(name, user)
            for name in self.flags
        }


class DynamicFeatureFlags:
    def __init__(self, redis_client: redis.Redis, key: str = "feature_flags"):
        self.redis = redis_client
        self.key = key
        self._flags: Optional[FeatureFlags] = None
        self.refresh()

    def refresh(self) -> None:
        try:
            data = self.redis.get(self.key)
            if data:
                config = json.loads(data)
                flags = {
                    name: FlagConfig(**flag_config)
                    for name, flag_config in config.get("flags", {}).items()
                }
                self._flags = FeatureFlags(
                    flags=flags,
                    default_enabled=config.get("default_enabled", False)
                )
        except Exception as e:
            print(f"Failed to refresh flags: {e}")

    def is_enabled(self, flag_name: str, user: Optional[UserContext] = None) -> bool:
        if not self._flags:
            return False
        return self._flags.is_enabled(flag_name, user)

    def evaluate_all(self, user: Optional[UserContext] = None) -> Dict[str, bool]:
        if not self._flags:
            return {}
        return self._flags.evaluate_all(user)

    def set_flag(self, flag_name: str, config: FlagConfig) -> None:
        data = self.redis.get(self.key)
        current = json.loads(data) if data else {"flags": {}, "default_enabled": False}
        current["flags"][flag_name] = {
            "enabled": config.enabled,
            "percentage": config.percentage,
            "allowed_users": config.allowed_users,
            "allowed_segments": config.allowed_segments,
            "metadata": config.metadata,
        }
        self.redis.set(self.key, json.dumps(current))
        self.refresh()
```

### FastAPI Integration

```python
# fastapi_flags.py
from fastapi import Request, Depends
from functools import lru_cache

@lru_cache()
def get_feature_flags() -> DynamicFeatureFlags:
    return DynamicFeatureFlags(redis_client)

def get_user_context(request: Request) -> Optional[UserContext]:
    user = getattr(request.state, "user", None)
    if not user:
        return None
    return UserContext(
        id=user.id,
        segments=[user.tier] + (user.tags or []),
        attributes={"email": user.email},
    )

@app.get("/checkout")
async def checkout(
    flags: DynamicFeatureFlags = Depends(get_feature_flags),
    user: Optional[UserContext] = Depends(get_user_context),
):
    if flags.is_enabled("new_checkout", user):
        return {"template": "checkout-v2"}
    return {"template": "checkout"}

@app.get("/api/features")
async def get_features(
    flags: DynamicFeatureFlags = Depends(get_feature_flags),
    user: Optional[UserContext] = Depends(get_user_context),
):
    return {"flags": flags.evaluate_all(user)}
```

## React Integration

```typescript
// FeatureFlagProvider.tsx
import { createContext, useContext, useEffect, useState } from 'react';

interface FeatureFlagContextValue {
  flags: Record<string, boolean>;
  isEnabled: (flag: string) => boolean;
  loading: boolean;
}

const FeatureFlagContext = createContext<FeatureFlagContextValue>({
  flags: {},
  isEnabled: () => false,
  loading: true,
});

export function FeatureFlagProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/features')
      .then(res => res.json())
      .then(data => {
        setFlags(data.flags);
        setLoading(false);
      });
  }, []);

  const isEnabled = (flag: string) => flags[flag] ?? false;

  return (
    <FeatureFlagContext.Provider value={{ flags, isEnabled, loading }}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlag(flag: string): boolean {
  const { isEnabled } = useContext(FeatureFlagContext);
  return isEnabled(flag);
}

// Usage
function CheckoutButton() {
  const newCheckout = useFeatureFlag('new_checkout');
  
  if (newCheckout) {
    return <NewCheckoutButton />;
  }
  return <LegacyCheckoutButton />;
}
```

## Admin API

```typescript
// admin-routes.ts
router.get('/admin/flags', async (req, res) => {
  const flags = await featureFlags.getAllFlags();
  res.json({ flags });
});

router.put('/admin/flags/:name', async (req, res) => {
  const { name } = req.params;
  const config: FlagConfig = req.body;
  
  await featureFlags.setFlag(name, config);
  res.json({ success: true });
});

router.delete('/admin/flags/:name', async (req, res) => {
  const { name } = req.params;
  await featureFlags.deleteFlag(name);
  res.json({ success: true });
});

// Gradual rollout helper
router.post('/admin/flags/:name/rollout', async (req, res) => {
  const { name } = req.params;
  const { percentage } = req.body;
  
  const current = await featureFlags.getFlag(name);
  if (!current) {
    return res.status(404).json({ error: 'Flag not found' });
  }
  
  await featureFlags.setFlag(name, {
    ...current,
    percentage,
  });
  
  res.json({ success: true, percentage });
});
```

## Best Practices

1. **Use consistent hashing**: Same user always gets same result
2. **Default to disabled**: New flags should be off by default
3. **Clean up old flags**: Remove flags after full rollout
4. **Log flag evaluations**: Track which users see which features
5. **Cache flag config**: Don't hit Redis on every request

## Common Mistakes

- Random percentage (user sees different result each request)
- Not cleaning up old flags (config bloat)
- Hardcoding flag names (use constants)
- Not testing both paths
- Forgetting to remove flag checks after rollout
