---
name: multi-tenancy
description: Implement multi-tenant architecture with tenant isolation, data separation, and per-tenant configuration. Supports shared database and schema-per-tenant models.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: foundations
  time: 6h
  source: drift-masterguide
---

# Multi-Tenancy

Build SaaS apps that serve multiple organizations securely.

## When to Use This Skill

- B2B SaaS applications
- White-label platforms
- Enterprise software
- Any app serving multiple organizations

## Isolation Models

### 1. Shared Database, Shared Schema (Recommended for most)

```
┌─────────────────────────────────────────────────────┐
│                   Database                           │
│                                                     │
│  users: id, tenant_id, email, ...                   │
│  orders: id, tenant_id, user_id, ...                │
│  products: id, tenant_id, name, ...                 │
│                                                     │
│  All tables have tenant_id column                   │
└─────────────────────────────────────────────────────┘
```

### 2. Shared Database, Schema per Tenant

```
┌─────────────────────────────────────────────────────┐
│                   Database                           │
│                                                     │
│  tenant_acme.users                                  │
│  tenant_acme.orders                                 │
│  tenant_globex.users                                │
│  tenant_globex.orders                               │
└─────────────────────────────────────────────────────┘
```

### 3. Database per Tenant (Enterprise)

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  acme_db     │  │  globex_db   │  │  initech_db  │
│              │  │              │  │              │
│  users       │  │  users       │  │  users       │
│  orders      │  │  orders      │  │  orders      │
└──────────────┘  └──────────────┘  └──────────────┘
```

## TypeScript Implementation

### Tenant Context

```typescript
// tenant-context.ts
import { AsyncLocalStorage } from 'async_hooks';

interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  plan: 'free' | 'pro' | 'enterprise';
  features: string[];
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenant(): TenantContext {
  const tenant = tenantStorage.getStore();
  if (!tenant) {
    throw new Error('No tenant context available');
  }
  return tenant;
}

export function runWithTenant<T>(tenant: TenantContext, fn: () => T): T {
  return tenantStorage.run(tenant, fn);
}

export { tenantStorage, TenantContext };
```

### Tenant Middleware

```typescript
// tenant-middleware.ts
import { Request, Response, NextFunction } from 'express';
import { runWithTenant, TenantContext } from './tenant-context';

interface TenantMiddlewareOptions {
  headerName?: string;
  subdomainExtract?: boolean;
  pathExtract?: boolean;
}

export function tenantMiddleware(options: TenantMiddlewareOptions = {}) {
  const { headerName = 'x-tenant-id', subdomainExtract = true } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    let tenantId: string | undefined;

    // Strategy 1: Header
    tenantId = req.headers[headerName.toLowerCase()] as string;

    // Strategy 2: Subdomain (acme.yourapp.com)
    if (!tenantId && subdomainExtract) {
      const host = req.hostname;
      const subdomain = host.split('.')[0];
      if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
        tenantId = subdomain;
      }
    }

    // Strategy 3: Path (/t/acme/dashboard)
    if (!tenantId && options.pathExtract) {
      const match = req.path.match(/^\/t\/([^/]+)/);
      if (match) {
        tenantId = match[1];
      }
    }

    // Strategy 4: User's default tenant (from JWT)
    if (!tenantId && req.user?.defaultTenantId) {
      tenantId = req.user.defaultTenantId;
    }

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant not specified' });
    }

    // Load tenant from database
    const tenant = await db.tenants.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, plan: true, features: true },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Check user has access to tenant
    if (req.user) {
      const membership = await db.tenantMemberships.findFirst({
        where: { userId: req.user.id, tenantId: tenant.id },
      });
      if (!membership) {
        return res.status(403).json({ error: 'Access denied to tenant' });
      }
      req.userRole = membership.role;
    }

    // Run request with tenant context
    runWithTenant(
      {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        plan: tenant.plan,
        features: tenant.features,
      },
      () => next()
    );
  };
}
```

### Tenant-Scoped Queries

```typescript
// tenant-prisma.ts
import { PrismaClient } from '@prisma/client';
import { getTenant } from './tenant-context';

// Extend Prisma with automatic tenant filtering
export function createTenantPrisma(prisma: PrismaClient) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ model, operation, args, query }) {
          // Auto-add tenant filter
          args.where = { ...args.where, tenantId: getTenant().tenantId };
          return query(args);
        },
        async findFirst({ model, operation, args, query }) {
          args.where = { ...args.where, tenantId: getTenant().tenantId };
          return query(args);
        },
        async findUnique({ model, operation, args, query }) {
          // For unique queries, verify tenant after fetch
          const result = await query(args);
          if (result && result.tenantId !== getTenant().tenantId) {
            return null; // Hide cross-tenant data
          }
          return result;
        },
        async create({ model, operation, args, query }) {
          // Auto-set tenant on create
          args.data = { ...args.data, tenantId: getTenant().tenantId };
          return query(args);
        },
        async update({ model, operation, args, query }) {
          // Ensure update is scoped to tenant
          args.where = { ...args.where, tenantId: getTenant().tenantId };
          return query(args);
        },
        async delete({ model, operation, args, query }) {
          args.where = { ...args.where, tenantId: getTenant().tenantId };
          return query(args);
        },
      },
    },
  });
}

// Usage
const tenantDb = createTenantPrisma(prisma);

// These are automatically scoped to current tenant
const users = await tenantDb.user.findMany();
const order = await tenantDb.order.create({ data: { ... } });
```

### Per-Tenant Configuration

```typescript
// tenant-config.ts
interface TenantConfig {
  branding: {
    logo?: string;
    primaryColor?: string;
    companyName?: string;
  };
  features: {
    maxUsers: number;
    maxStorage: number;
    apiAccess: boolean;
    sso: boolean;
  };
  integrations: {
    slack?: { webhookUrl: string };
    stripe?: { customerId: string };
  };
}

class TenantConfigService {
  private cache = new Map<string, TenantConfig>();

  async getConfig(tenantId: string): Promise<TenantConfig> {
    if (this.cache.has(tenantId)) {
      return this.cache.get(tenantId)!;
    }

    const tenant = await db.tenants.findUnique({
      where: { id: tenantId },
      include: { config: true },
    });

    const config = this.buildConfig(tenant);
    this.cache.set(tenantId, config);
    return config;
  }

  private buildConfig(tenant: Tenant): TenantConfig {
    // Merge plan defaults with tenant overrides
    const planDefaults = PLAN_CONFIGS[tenant.plan];
    return {
      branding: { ...tenant.config?.branding },
      features: { ...planDefaults.features, ...tenant.config?.features },
      integrations: { ...tenant.config?.integrations },
    };
  }

  invalidateCache(tenantId: string) {
    this.cache.delete(tenantId);
  }
}
```

## Database Schema

```sql
-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) DEFAULT 'free',
  features TEXT[] DEFAULT '{}',
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Users belong to tenants via memberships
CREATE TABLE tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

-- All data tables have tenant_id
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  -- ... other columns
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for tenant queries
CREATE INDEX idx_orders_tenant ON orders(tenant_id);

-- Row Level Security (optional, extra protection)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

## Python Implementation

```python
# tenant_context.py
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional

@dataclass
class TenantContext:
    tenant_id: str
    tenant_slug: str
    plan: str
    features: list[str]

_tenant_context: ContextVar[Optional[TenantContext]] = ContextVar(
    "tenant_context", default=None
)

def get_tenant() -> TenantContext:
    tenant = _tenant_context.get()
    if not tenant:
        raise RuntimeError("No tenant context")
    return tenant

def set_tenant(tenant: TenantContext):
    return _tenant_context.set(tenant)
```

### FastAPI Middleware

```python
# tenant_middleware.py
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        tenant_id = request.headers.get("x-tenant-id")
        
        if not tenant_id:
            # Try subdomain
            host = request.headers.get("host", "")
            subdomain = host.split(".")[0]
            if subdomain not in ["www", "app", "api"]:
                tenant_id = subdomain

        if not tenant_id:
            raise HTTPException(400, "Tenant not specified")

        tenant = await db.tenants.find_unique(where={"id": tenant_id})
        if not tenant:
            raise HTTPException(404, "Tenant not found")

        token = set_tenant(TenantContext(
            tenant_id=tenant.id,
            tenant_slug=tenant.slug,
            plan=tenant.plan,
            features=tenant.features,
        ))

        try:
            response = await call_next(request)
            return response
        finally:
            _tenant_context.reset(token)
```

## Best Practices

1. **Always filter by tenant_id** - Never trust client-provided IDs alone
2. **Use middleware** - Centralize tenant resolution
3. **Index tenant_id** - Every tenant-scoped table needs this index
4. **Consider RLS** - Extra protection layer in PostgreSQL
5. **Cache tenant config** - Avoid repeated lookups

## Common Mistakes

- Forgetting tenant filter on queries (data leak!)
- Not validating user's tenant access
- Hardcoding tenant-specific logic
- No index on tenant_id columns
- Allowing cross-tenant references
