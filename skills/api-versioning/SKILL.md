---
name: api-versioning
description: Implement API versioning strategies for backward compatibility. Covers URL versioning, header versioning, and deprecation workflows.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: api
  time: 3h
  source: drift-masterguide
---

# API Versioning

Evolve your API without breaking existing clients.

## When to Use This Skill

- Public APIs with external consumers
- Mobile apps (can't force updates)
- Breaking changes to existing endpoints
- Long-term API maintenance

## Versioning Strategies

### 1. URL Path Versioning (Recommended)

```
GET /api/v1/users
GET /api/v2/users
```

Pros: Clear, cacheable, easy to route
Cons: URL pollution

### 2. Header Versioning

```
GET /api/users
Accept: application/vnd.myapp.v2+json
```

Pros: Clean URLs
Cons: Harder to test, not cacheable by URL

### 3. Query Parameter

```
GET /api/users?version=2
```

Pros: Simple
Cons: Easy to forget, caching issues

## TypeScript Implementation

### Version Router

```typescript
// version-router.ts
import { Router, Request, Response, NextFunction } from 'express';

type VersionHandler = (req: Request, res: Response, next: NextFunction) => void;

interface VersionedRoute {
  v1?: VersionHandler;
  v2?: VersionHandler;
  v3?: VersionHandler;
  default: VersionHandler;
}

class VersionRouter {
  private router = Router();
  private currentVersion = 'v2';
  private supportedVersions = ['v1', 'v2'];
  private deprecatedVersions = ['v1'];

  constructor() {
    // Add version detection middleware
    this.router.use(this.detectVersion.bind(this));
  }

  private detectVersion(req: Request, res: Response, next: NextFunction) {
    // Extract version from URL path
    const match = req.path.match(/^\/v(\d+)\//);
    if (match) {
      req.apiVersion = `v${match[1]}`;
    } else {
      req.apiVersion = this.currentVersion;
    }

    // Check if version is supported
    if (!this.supportedVersions.includes(req.apiVersion)) {
      return res.status(400).json({
        error: 'Unsupported API version',
        supportedVersions: this.supportedVersions,
      });
    }

    // Add deprecation warning header
    if (this.deprecatedVersions.includes(req.apiVersion)) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', '2025-01-01');
      res.setHeader('Link', '</api/v2>; rel="successor-version"');
    }

    next();
  }

  versioned(path: string, handlers: VersionedRoute) {
    this.router.all(path, (req: Request, res: Response, next: NextFunction) => {
      const version = req.apiVersion as keyof VersionedRoute;
      const handler = handlers[version] || handlers.default;
      handler(req, res, next);
    });
  }

  getRouter() {
    return this.router;
  }
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      apiVersion?: string;
    }
  }
}

export { VersionRouter };
```

### Usage Example

```typescript
// routes/users.ts
import { VersionRouter } from './version-router';

const versionRouter = new VersionRouter();

// Different implementations per version
versionRouter.versioned('/users', {
  v1: async (req, res) => {
    // V1: Returns flat user object
    const users = await db.users.findMany();
    res.json(users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
    })));
  },
  v2: async (req, res) => {
    // V2: Returns nested structure with metadata
    const users = await db.users.findMany({ include: { profile: true } });
    res.json({
      data: users.map(u => ({
        id: u.id,
        attributes: {
          name: u.name,
          email: u.email,
          profile: u.profile,
        },
      })),
      meta: { total: users.length },
    });
  },
  default: async (req, res) => {
    // Default to latest
    res.redirect(307, `/api/v2${req.path}`);
  },
});

export const userRoutes = versionRouter.getRouter();
```

### Version Middleware (Header-based)

```typescript
// header-version-middleware.ts
function headerVersionMiddleware(req: Request, res: Response, next: NextFunction) {
  const acceptHeader = req.headers.accept || '';
  
  // Parse: application/vnd.myapp.v2+json
  const match = acceptHeader.match(/application\/vnd\.myapp\.v(\d+)\+json/);
  
  if (match) {
    req.apiVersion = `v${match[1]}`;
  } else {
    req.apiVersion = 'v2'; // Default
  }
  
  next();
}
```

## Python Implementation

```python
# version_router.py
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from typing import Callable, Dict

class VersionedRouter:
    def __init__(self):
        self.router = APIRouter()
        self.current_version = "v2"
        self.supported_versions = ["v1", "v2"]
        self.deprecated_versions = ["v1"]

    def versioned_route(
        self,
        path: str,
        methods: list[str],
        handlers: Dict[str, Callable],
    ):
        async def route_handler(request: Request):
            # Extract version from path
            version = self._extract_version(request.url.path)
            
            if version not in self.supported_versions:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported version. Supported: {self.supported_versions}"
                )

            handler = handlers.get(version, handlers.get("default"))
            if not handler:
                raise HTTPException(status_code=404)

            response = await handler(request)
            
            # Add deprecation headers
            if version in self.deprecated_versions:
                response.headers["Deprecation"] = "true"
                response.headers["Sunset"] = "2025-01-01"
            
            return response

        for method in methods:
            self.router.add_api_route(path, route_handler, methods=[method])

    def _extract_version(self, path: str) -> str:
        import re
        match = re.search(r"/v(\d+)/", path)
        return f"v{match.group(1)}" if match else self.current_version
```

### FastAPI Usage

```python
# routes/users.py
from version_router import VersionedRouter

router = VersionedRouter()

async def get_users_v1(request: Request):
    users = await db.users.find_many()
    return JSONResponse([{"id": u.id, "name": u.name} for u in users])

async def get_users_v2(request: Request):
    users = await db.users.find_many(include={"profile": True})
    return JSONResponse({
        "data": [{"id": u.id, "attributes": {"name": u.name}} for u in users],
        "meta": {"total": len(users)},
    })

router.versioned_route(
    "/users",
    methods=["GET"],
    handlers={
        "v1": get_users_v1,
        "v2": get_users_v2,
        "default": get_users_v2,
    },
)
```

## Deprecation Workflow

### 1. Announce Deprecation

```typescript
// Add to all v1 responses
res.setHeader('Deprecation', 'true');
res.setHeader('Sunset', '2025-06-01T00:00:00Z');
res.setHeader('Link', '</api/v2/docs>; rel="successor-version"');
```

### 2. Log Usage

```typescript
// Track v1 usage for migration planning
if (req.apiVersion === 'v1') {
  metrics.increment('api.v1.requests', {
    endpoint: req.path,
    client: req.headers['x-client-id'],
  });
}
```

### 3. Gradual Sunset

```typescript
// Phase 1: Warnings (3 months)
// Phase 2: Rate limit v1 (1 month)
if (req.apiVersion === 'v1') {
  await rateLimiter.consume(req.ip, { points: 10 }); // 10x cost
}

// Phase 3: Return 410 Gone
if (req.apiVersion === 'v1' && Date.now() > SUNSET_DATE) {
  return res.status(410).json({
    error: 'API version v1 has been sunset',
    migration: 'https://docs.example.com/v2-migration',
  });
}
```

## Response Format Evolution

```typescript
// V1 Response (flat)
{
  "id": "123",
  "name": "John",
  "email": "john@example.com"
}

// V2 Response (JSON:API style)
{
  "data": {
    "id": "123",
    "type": "user",
    "attributes": {
      "name": "John",
      "email": "john@example.com"
    }
  },
  "meta": {
    "version": "v2"
  }
}
```

## Best Practices

1. **Support at least 2 versions** - Give clients time to migrate
2. **Use semantic versioning** - Major version = breaking changes
3. **Document all changes** - Changelog per version
4. **Provide migration guides** - Help clients upgrade
5. **Monitor version usage** - Know when to sunset

## Common Mistakes

- Breaking changes without version bump
- No deprecation period
- Removing versions without notice
- Inconsistent versioning across endpoints
- Not tracking version usage metrics
