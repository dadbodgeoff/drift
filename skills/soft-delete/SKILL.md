---
name: soft-delete
description: Implement soft delete pattern for data recovery and audit trails. Covers filtering, restoration, and permanent deletion workflows.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: database
  time: 2h
  source: drift-masterguide
---

# Soft Delete

Delete data without actually deleting it.

## When to Use This Skill

- User account deletion (GDPR recovery period)
- Accidental deletion recovery
- Audit trail requirements
- Referential integrity preservation
- Undo functionality

## How It Works

```sql
-- Instead of DELETE
UPDATE users SET deleted_at = NOW() WHERE id = '123';

-- All queries filter out deleted records
SELECT * FROM users WHERE deleted_at IS NULL;
```

## TypeScript Implementation

### Prisma Schema

```prisma
model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String
  deletedAt DateTime? @map("deleted_at")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  @@map("users")
}
```

### Soft Delete Extension

```typescript
// prisma/soft-delete.ts
import { Prisma, PrismaClient } from '@prisma/client';

// Models that support soft delete
const softDeleteModels = ['User', 'Post', 'Comment', 'Organization'];

export function softDeleteExtension(prisma: PrismaClient) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ model, operation, args, query }) {
          if (softDeleteModels.includes(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findFirst({ model, operation, args, query }) {
          if (softDeleteModels.includes(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findUnique({ model, operation, args, query }) {
          if (softDeleteModels.includes(model)) {
            // Convert to findFirst to add deletedAt filter
            const result = await prisma[model].findFirst({
              where: { ...args.where, deletedAt: null },
            });
            return result;
          }
          return query(args);
        },
        async count({ model, operation, args, query }) {
          if (softDeleteModels.includes(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async delete({ model, operation, args, query }) {
          if (softDeleteModels.includes(model)) {
            // Soft delete instead of hard delete
            return prisma[model].update({
              where: args.where,
              data: { deletedAt: new Date() },
            });
          }
          return query(args);
        },
        async deleteMany({ model, operation, args, query }) {
          if (softDeleteModels.includes(model)) {
            return prisma[model].updateMany({
              where: args.where,
              data: { deletedAt: new Date() },
            });
          }
          return query(args);
        },
      },
    },
  });
}

// Usage
const prisma = new PrismaClient();
export const db = softDeleteExtension(prisma);
```

### Service with Soft Delete Operations

```typescript
// services/user-service.ts
class UserService {
  // Normal operations automatically filter deleted
  async findById(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  }

  async findAll(): Promise<User[]> {
    return db.user.findMany();
  }

  // Soft delete
  async delete(id: string): Promise<User> {
    return db.user.delete({ where: { id } });
  }

  // Restore deleted user
  async restore(id: string): Promise<User> {
    return db.$transaction(async (tx) => {
      // Use raw query to find deleted user
      const user = await tx.user.findFirst({
        where: { id, deletedAt: { not: null } },
      });

      if (!user) {
        throw new NotFoundError('User', id);
      }

      return tx.user.update({
        where: { id },
        data: { deletedAt: null },
      });
    });
  }

  // Find deleted users (admin only)
  async findDeleted(): Promise<User[]> {
    return prisma.user.findMany({
      where: { deletedAt: { not: null } },
    });
  }

  // Permanent delete (after retention period)
  async permanentDelete(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }

  // Purge old deleted records
  async purgeDeleted(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await prisma.user.deleteMany({
      where: {
        deletedAt: { lt: cutoff },
      },
    });

    return result.count;
  }
}
```

### API Routes

```typescript
// routes/users.ts
router.delete('/users/:id', async (req, res) => {
  await userService.delete(req.params.id);
  res.status(204).send();
});

router.post('/users/:id/restore', async (req, res) => {
  const user = await userService.restore(req.params.id);
  res.json(user);
});

// Admin: view deleted users
router.get('/admin/users/deleted', adminOnly, async (req, res) => {
  const users = await userService.findDeleted();
  res.json(users);
});

// Admin: permanent delete
router.delete('/admin/users/:id/permanent', adminOnly, async (req, res) => {
  await userService.permanentDelete(req.params.id);
  res.status(204).send();
});
```

## Python Implementation

```python
# models/soft_delete.py
from sqlalchemy import Column, DateTime, event
from sqlalchemy.orm import Query
from datetime import datetime

class SoftDeleteMixin:
    deleted_at = Column(DateTime, nullable=True, index=True)

    def soft_delete(self):
        self.deleted_at = datetime.utcnow()

    def restore(self):
        self.deleted_at = None

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

# Custom query class that filters deleted by default
class SoftDeleteQuery(Query):
    def __new__(cls, *args, **kwargs):
        obj = super().__new__(cls)
        obj._with_deleted = kwargs.pop('_with_deleted', False)
        return obj

    def __init__(self, *args, **kwargs):
        kwargs.pop('_with_deleted', None)
        super().__init__(*args, **kwargs)

    def with_deleted(self):
        return self.__class__(
            self._entity_from_pre_ent_zero().entity,
            session=self.session,
            _with_deleted=True,
        )

    def _compile_context(self, *args, **kwargs):
        if not self._with_deleted:
            # Auto-filter deleted records
            self = self.filter_by(deleted_at=None)
        return super()._compile_context(*args, **kwargs)
```

### SQLAlchemy Service

```python
# services/user_service.py
class UserService:
    def __init__(self, session: Session):
        self.session = session

    def find_all(self) -> list[User]:
        # Automatically excludes deleted
        return self.session.query(User).all()

    def delete(self, user_id: str) -> None:
        user = self.session.query(User).get(user_id)
        if user:
            user.soft_delete()
            self.session.commit()

    def restore(self, user_id: str) -> User:
        user = self.session.query(User).with_deleted().get(user_id)
        if not user or not user.is_deleted:
            raise NotFoundError("User", user_id)
        user.restore()
        self.session.commit()
        return user

    def find_deleted(self) -> list[User]:
        return self.session.query(User).with_deleted().filter(
            User.deleted_at.isnot(None)
        ).all()

    def permanent_delete(self, user_id: str) -> None:
        self.session.query(User).with_deleted().filter(
            User.id == user_id
        ).delete()
        self.session.commit()
```

## Database Schema

```sql
-- Add soft delete column
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP;
CREATE INDEX idx_users_deleted_at ON users(deleted_at);

-- Partial index for active records (PostgreSQL)
CREATE INDEX idx_users_active ON users(id) WHERE deleted_at IS NULL;
```

## Scheduled Cleanup Job

```typescript
// jobs/purge-deleted.ts
import { CronJob } from 'cron';

// Run daily at 3 AM
const purgeJob = new CronJob('0 3 * * *', async () => {
  const services = [userService, postService, commentService];
  
  for (const service of services) {
    const count = await service.purgeDeleted(30); // 30 day retention
    console.log(`Purged ${count} deleted records from ${service.constructor.name}`);
  }
});

purgeJob.start();
```

## Best Practices

1. **Index deleted_at column** - Queries filter on it constantly
2. **Use partial indexes** - For active records only
3. **Set retention period** - Don't keep deleted data forever
4. **Handle cascades** - What happens to related records?
5. **Consider unique constraints** - Deleted email should be reusable

## Handling Unique Constraints

```sql
-- Option 1: Partial unique index (PostgreSQL)
CREATE UNIQUE INDEX idx_users_email_active 
ON users(email) WHERE deleted_at IS NULL;

-- Option 2: Include deleted_at in unique constraint
ALTER TABLE users ADD CONSTRAINT users_email_unique 
UNIQUE (email, COALESCE(deleted_at, '1970-01-01'));
```

## Common Mistakes

- Forgetting to filter in all queries
- Not handling unique constraints
- Keeping deleted data forever
- Not indexing deleted_at
- Cascading soft deletes incorrectly
