---
name: audit-logging
description: Comprehensive audit logging for compliance and security. Track user actions, data changes, and system events with tamper-proof storage.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: security
  time: 4h
  source: drift-masterguide
---

# Audit Logging

Track every important action for compliance and debugging.

## When to Use This Skill

- SOC 2 / HIPAA compliance
- Financial transaction tracking
- User action history
- Security incident investigation
- Data change tracking

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Application                         │
│                                                     │
│  auditLog.record({                                  │
│    action: "user.login",                            │
│    actor: userId,                                   │
│    resource: "session",                             │
│    details: { ip, userAgent }                       │
│  })                                                 │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Audit Log Service                       │
│                                                     │
│  - Enrich with context                              │
│  - Validate schema                                  │
│  - Queue for async write                            │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Storage (Append-Only)                   │
│                                                     │
│  - PostgreSQL (with triggers)                       │
│  - S3 (immutable objects)                           │
│  - CloudWatch Logs                                  │
└─────────────────────────────────────────────────────┘
```

## TypeScript Implementation

### Audit Log Service

```typescript
// audit-log.ts
import { v4 as uuid } from 'uuid';

interface AuditEvent {
  action: string;           // e.g., "user.login", "order.create"
  actor: {
    id: string;
    type: 'user' | 'system' | 'api_key';
    email?: string;
  };
  resource: {
    type: string;           // e.g., "user", "order", "payment"
    id?: string;
  };
  details?: Record<string, unknown>;
  outcome: 'success' | 'failure';
  reason?: string;          // For failures
}

interface AuditRecord extends AuditEvent {
  id: string;
  timestamp: Date;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  organizationId?: string;
}

class AuditLogService {
  private context: AsyncLocalStorage<{ requestId?: string; ip?: string; userAgent?: string }>;

  constructor() {
    this.context = new AsyncLocalStorage();
  }

  // Set request context (call from middleware)
  setContext(ctx: { requestId?: string; ip?: string; userAgent?: string }) {
    return this.context.run(ctx, () => {});
  }

  async record(event: AuditEvent): Promise<void> {
    const ctx = this.context.getStore() || {};

    const record: AuditRecord = {
      id: uuid(),
      timestamp: new Date(),
      ...event,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    };

    // Write to database (append-only table)
    await db.auditLogs.create({ data: record });

    // Also send to external logging (CloudWatch, DataDog, etc.)
    if (process.env.AUDIT_LOG_STREAM) {
      await this.sendToCloudWatch(record);
    }
  }

  // Convenience methods
  async logLogin(userId: string, success: boolean, details?: Record<string, unknown>) {
    await this.record({
      action: 'user.login',
      actor: { id: userId, type: 'user' },
      resource: { type: 'session' },
      outcome: success ? 'success' : 'failure',
      details,
    });
  }

  async logDataAccess(actorId: string, resourceType: string, resourceId: string) {
    await this.record({
      action: `${resourceType}.read`,
      actor: { id: actorId, type: 'user' },
      resource: { type: resourceType, id: resourceId },
      outcome: 'success',
    });
  }

  async logDataChange(
    actorId: string,
    resourceType: string,
    resourceId: string,
    action: 'create' | 'update' | 'delete',
    changes?: { before?: unknown; after?: unknown }
  ) {
    await this.record({
      action: `${resourceType}.${action}`,
      actor: { id: actorId, type: 'user' },
      resource: { type: resourceType, id: resourceId },
      outcome: 'success',
      details: changes,
    });
  }

  private async sendToCloudWatch(record: AuditRecord) {
    const cloudwatch = new CloudWatchLogsClient({});
    await cloudwatch.send(new PutLogEventsCommand({
      logGroupName: process.env.AUDIT_LOG_GROUP!,
      logStreamName: process.env.AUDIT_LOG_STREAM!,
      logEvents: [{
        timestamp: record.timestamp.getTime(),
        message: JSON.stringify(record),
      }],
    }));
  }
}

export const auditLog = new AuditLogService();
```

### Express Middleware

```typescript
// audit-middleware.ts
import { Request, Response, NextFunction } from 'express';
import { auditLog } from './audit-log';
import { v4 as uuid } from 'uuid';

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string || uuid();
  const ip = req.ip || req.headers['x-forwarded-for'] as string;
  const userAgent = req.headers['user-agent'];

  // Set context for all audit logs in this request
  auditLog.setContext({ requestId, ip, userAgent });

  // Add request ID to response headers
  res.setHeader('x-request-id', requestId);

  next();
}
```

### Database Schema

```sql
-- Append-only audit log table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action VARCHAR(100) NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  actor_type VARCHAR(50) NOT NULL,
  actor_email VARCHAR(255),
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(255),
  outcome VARCHAR(20) NOT NULL,
  reason TEXT,
  details JSONB,
  request_id VARCHAR(255),
  ip INET,
  user_agent TEXT,
  organization_id UUID
);

-- Indexes for common queries
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, timestamp DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id, timestamp DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, timestamp DESC);
CREATE INDEX idx_audit_org ON audit_logs(organization_id, timestamp DESC);

-- Prevent updates/deletes (append-only)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
```

## Python Implementation

```python
# audit_log.py
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Optional, Literal
from contextvars import ContextVar
import uuid
import json

request_context: ContextVar[dict] = ContextVar("request_context", default={})

@dataclass
class AuditEvent:
    action: str
    actor_id: str
    actor_type: Literal["user", "system", "api_key"]
    resource_type: str
    outcome: Literal["success", "failure"]
    resource_id: Optional[str] = None
    details: Optional[dict] = None
    reason: Optional[str] = None

class AuditLogService:
    async def record(self, event: AuditEvent) -> None:
        ctx = request_context.get()
        
        record = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat(),
            **asdict(event),
            "request_id": ctx.get("request_id"),
            "ip": ctx.get("ip"),
            "user_agent": ctx.get("user_agent"),
        }
        
        # Write to database
        await db.execute(
            """INSERT INTO audit_logs 
               (id, timestamp, action, actor_id, actor_type, resource_type, 
                resource_id, outcome, details, request_id, ip, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
            record["id"], record["timestamp"], record["action"],
            record["actor_id"], record["actor_type"], record["resource_type"],
            record["resource_id"], record["outcome"], json.dumps(record["details"]),
            record["request_id"], record["ip"], record["user_agent"]
        )

    async def log_login(self, user_id: str, success: bool, details: dict = None):
        await self.record(AuditEvent(
            action="user.login",
            actor_id=user_id,
            actor_type="user",
            resource_type="session",
            outcome="success" if success else "failure",
            details=details,
        ))

audit_log = AuditLogService()
```

### FastAPI Middleware

```python
# audit_middleware.py
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import uuid

class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")

        token = request_context.set({
            "request_id": request_id,
            "ip": ip,
            "user_agent": user_agent,
        })

        response = await call_next(request)
        response.headers["x-request-id"] = request_id

        request_context.reset(token)
        return response
```

## Query Examples

```sql
-- User's recent activity
SELECT * FROM audit_logs 
WHERE actor_id = 'user-123' 
ORDER BY timestamp DESC 
LIMIT 50;

-- All changes to a specific resource
SELECT * FROM audit_logs 
WHERE resource_type = 'order' AND resource_id = 'order-456'
ORDER BY timestamp;

-- Failed login attempts in last hour
SELECT * FROM audit_logs 
WHERE action = 'user.login' 
  AND outcome = 'failure'
  AND timestamp > NOW() - INTERVAL '1 hour';

-- Data exports (for compliance)
SELECT * FROM audit_logs 
WHERE action LIKE '%.export%'
  AND timestamp BETWEEN '2024-01-01' AND '2024-12-31';
```

## Best Practices

1. **Never delete audit logs** - Use append-only tables
2. **Include enough context** - IP, user agent, request ID
3. **Log both success and failure** - Failures are often more important
4. **Use structured actions** - `resource.verb` format
5. **Separate from application logs** - Different retention, access

## Compliance Notes

- **SOC 2**: Requires logging of access to sensitive data
- **HIPAA**: Must log all PHI access
- **GDPR**: Log data exports and deletions
- **PCI DSS**: Log all access to cardholder data
