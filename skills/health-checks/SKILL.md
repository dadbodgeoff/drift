---
name: health-checks
description: Implement health check endpoints for load balancers, Kubernetes, and monitoring. Covers liveness, readiness, and dependency checks.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: operations
  time: 2h
  source: drift-masterguide
---

# Health Checks

Let your infrastructure know when your app is healthy.

## When to Use This Skill

- Kubernetes deployments (liveness/readiness probes)
- Load balancer health checks
- Monitoring and alerting
- Zero-downtime deployments
- Auto-scaling decisions

## Health Check Types

### Liveness Check

"Is the process alive?" - Restart if failing

```
GET /health/live → 200 OK
```

### Readiness Check

"Can it handle traffic?" - Remove from load balancer if failing

```
GET /health/ready → 200 OK or 503 Service Unavailable
```

### Detailed Health Check

"What's the status of each dependency?"

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy", "latency": 5 },
    "redis": { "status": "healthy", "latency": 2 },
    "stripe": { "status": "degraded", "latency": 500 }
  }
}
```

## TypeScript Implementation

```typescript
// health/health-service.ts
interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckResult>;
  critical?: boolean; // If critical, failure = not ready
}

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  message?: string;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, HealthCheckResult>;
  timestamp: string;
  version?: string;
}

class HealthService {
  private checks: HealthCheck[] = [];

  register(check: HealthCheck): void {
    this.checks.push(check);
  }

  async checkLiveness(): Promise<boolean> {
    // Simple check - is the process responsive?
    return true;
  }

  async checkReadiness(): Promise<{ ready: boolean; status: HealthStatus }> {
    const status = await this.getDetailedStatus();
    
    // Ready if all critical checks pass
    const criticalFailed = this.checks
      .filter(c => c.critical)
      .some(c => status.checks[c.name]?.status === 'unhealthy');

    return {
      ready: !criticalFailed && status.status !== 'unhealthy',
      status,
    };
  }

  async getDetailedStatus(): Promise<HealthStatus> {
    const results: Record<string, HealthCheckResult> = {};

    await Promise.all(
      this.checks.map(async (check) => {
        const start = Date.now();
        try {
          const result = await Promise.race([
            check.check(),
            new Promise<HealthCheckResult>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 5000)
            ),
          ]);
          results[check.name] = {
            ...result,
            latency: Date.now() - start,
          };
        } catch (error) {
          results[check.name] = {
            status: 'unhealthy',
            latency: Date.now() - start,
            message: (error as Error).message,
          };
        }
      })
    );

    // Overall status
    const statuses = Object.values(results).map(r => r.status);
    let overallStatus: HealthStatus['status'] = 'healthy';
    if (statuses.includes('unhealthy')) {
      overallStatus = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      checks: results,
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION,
    };
  }
}

export const healthService = new HealthService();
```

### Register Health Checks

```typescript
// health/checks.ts
import { healthService } from './health-service';
import { db } from '../db';
import { redis } from '../redis';

// Database check (critical)
healthService.register({
  name: 'database',
  critical: true,
  check: async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: 'healthy' };
  },
});

// Redis check (critical for sessions)
healthService.register({
  name: 'redis',
  critical: true,
  check: async () => {
    await redis.ping();
    return { status: 'healthy' };
  },
});

// External API check (non-critical)
healthService.register({
  name: 'stripe',
  critical: false,
  check: async () => {
    try {
      await stripe.balance.retrieve();
      return { status: 'healthy' };
    } catch {
      return { status: 'degraded', message: 'Stripe API slow or unavailable' };
    }
  },
});

// Disk space check
healthService.register({
  name: 'disk',
  critical: false,
  check: async () => {
    const { available, total } = await checkDiskSpace('/');
    const percentFree = (available / total) * 100;
    
    if (percentFree < 5) {
      return { status: 'unhealthy', message: `Only ${percentFree.toFixed(1)}% disk free` };
    }
    if (percentFree < 20) {
      return { status: 'degraded', message: `${percentFree.toFixed(1)}% disk free` };
    }
    return { status: 'healthy' };
  },
});
```

### Express Routes

```typescript
// routes/health.ts
import { Router } from 'express';
import { healthService } from '../health/health-service';

const router = Router();

// Liveness probe - is the process alive?
router.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness probe - can it handle traffic?
router.get('/health/ready', async (req, res) => {
  const { ready, status } = await healthService.checkReadiness();
  res.status(ready ? 200 : 503).json(status);
});

// Detailed health - for monitoring dashboards
router.get('/health', async (req, res) => {
  const status = await healthService.getDetailedStatus();
  const httpStatus = status.status === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json(status);
});

export { router as healthRoutes };
```

## Python Implementation

```python
# health/health_service.py
from dataclasses import dataclass
from typing import Callable, Awaitable, Optional
from datetime import datetime
import asyncio

@dataclass
class HealthCheckResult:
    status: str  # healthy, degraded, unhealthy
    latency: Optional[float] = None
    message: Optional[str] = None

@dataclass
class HealthCheck:
    name: str
    check: Callable[[], Awaitable[HealthCheckResult]]
    critical: bool = False

class HealthService:
    def __init__(self):
        self.checks: list[HealthCheck] = []

    def register(self, check: HealthCheck):
        self.checks.append(check)

    async def check_readiness(self) -> tuple[bool, dict]:
        status = await self.get_detailed_status()
        
        critical_failed = any(
            status["checks"].get(c.name, {}).get("status") == "unhealthy"
            for c in self.checks if c.critical
        )
        
        return not critical_failed, status

    async def get_detailed_status(self) -> dict:
        results = {}

        async def run_check(check: HealthCheck):
            start = datetime.now()
            try:
                result = await asyncio.wait_for(check.check(), timeout=5.0)
                results[check.name] = {
                    "status": result.status,
                    "latency": (datetime.now() - start).total_seconds() * 1000,
                    "message": result.message,
                }
            except Exception as e:
                results[check.name] = {
                    "status": "unhealthy",
                    "latency": (datetime.now() - start).total_seconds() * 1000,
                    "message": str(e),
                }

        await asyncio.gather(*[run_check(c) for c in self.checks])

        statuses = [r["status"] for r in results.values()]
        if "unhealthy" in statuses:
            overall = "unhealthy"
        elif "degraded" in statuses:
            overall = "degraded"
        else:
            overall = "healthy"

        return {
            "status": overall,
            "checks": results,
            "timestamp": datetime.utcnow().isoformat(),
        }

health_service = HealthService()
```

### FastAPI Routes

```python
from fastapi import APIRouter, Response

router = APIRouter()

@router.get("/health/live")
async def liveness():
    return {"status": "ok"}

@router.get("/health/ready")
async def readiness(response: Response):
    ready, status = await health_service.check_readiness()
    if not ready:
        response.status_code = 503
    return status

@router.get("/health")
async def detailed_health(response: Response):
    status = await health_service.get_detailed_status()
    if status["status"] == "unhealthy":
        response.status_code = 503
    return status
```

## Kubernetes Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: app
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 0
            periodSeconds: 5
            failureThreshold: 30
```

## Best Practices

1. **Separate liveness from readiness** - Different purposes
2. **Keep liveness simple** - Don't check dependencies
3. **Timeout health checks** - Don't hang forever
4. **Mark critical dependencies** - Database yes, analytics no
5. **Include version info** - Helps debugging

## Common Mistakes

- Checking external services in liveness probe
- No timeout on health checks
- All dependencies marked as critical
- Health endpoint requires authentication
- Not caching expensive checks
