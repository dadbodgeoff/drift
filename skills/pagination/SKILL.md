---
name: pagination
description: Implement cursor-based and offset pagination for APIs. Covers efficient database queries, stable sorting, and pagination metadata.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: api
  time: 2h
  source: drift-masterguide
---

# API Pagination

Return large datasets efficiently without killing your database.

## When to Use This Skill

- List endpoints returning many items
- Infinite scroll UIs
- Data export features
- Any endpoint that could return 100+ items

## Pagination Strategies

### Offset Pagination (Simple)

```
GET /users?page=2&limit=20
```

Pros: Simple, supports "jump to page"
Cons: Slow on large datasets, inconsistent with concurrent writes

### Cursor Pagination (Recommended)

```
GET /users?cursor=eyJpZCI6MTIzfQ&limit=20
```

Pros: Fast, consistent, works with real-time data
Cons: No "jump to page", slightly more complex

## TypeScript Implementation

### Cursor Pagination

```typescript
// pagination.ts
interface PaginationParams {
  cursor?: string;
  limit?: number;
  direction?: 'forward' | 'backward';
}

interface PaginatedResult<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
    total?: number;
  };
}

function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString());
}

async function paginate<T extends { id: string; createdAt: Date }>(
  query: (where: any, orderBy: any, take: number) => Promise<T[]>,
  params: PaginationParams,
  defaultLimit = 20,
  maxLimit = 100
): Promise<PaginatedResult<T>> {
  const limit = Math.min(params.limit || defaultLimit, maxLimit);
  const direction = params.direction || 'forward';

  let where: any = {};
  let orderBy: any = { createdAt: 'desc', id: 'desc' };

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    
    if (direction === 'forward') {
      where = {
        OR: [
          { createdAt: { lt: decoded.createdAt } },
          { createdAt: decoded.createdAt, id: { lt: decoded.id } },
        ],
      };
    } else {
      where = {
        OR: [
          { createdAt: { gt: decoded.createdAt } },
          { createdAt: decoded.createdAt, id: { gt: decoded.id } },
        ],
      };
      orderBy = { createdAt: 'asc', id: 'asc' };
    }
  }

  // Fetch one extra to check if there's more
  const items = await query(where, orderBy, limit + 1);
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  // Reverse if going backward
  if (direction === 'backward') {
    data.reverse();
  }

  return {
    data,
    pagination: {
      hasMore,
      nextCursor: data.length > 0
        ? encodeCursor({ createdAt: data[data.length - 1].createdAt, id: data[data.length - 1].id })
        : null,
      prevCursor: data.length > 0
        ? encodeCursor({ createdAt: data[0].createdAt, id: data[0].id })
        : null,
    },
  };
}

export { paginate, PaginationParams, PaginatedResult, encodeCursor, decodeCursor };
```

### Express Route

```typescript
// users-route.ts
import { paginate } from './pagination';

router.get('/users', async (req, res) => {
  const { cursor, limit } = req.query;

  const result = await paginate(
    (where, orderBy, take) =>
      db.users.findMany({ where, orderBy, take }),
    { cursor: cursor as string, limit: Number(limit) || 20 }
  );

  res.json(result);
});
```

### Response Format

```json
{
  "data": [
    { "id": "user_123", "name": "Alice", "createdAt": "2024-01-15T10:00:00Z" },
    { "id": "user_122", "name": "Bob", "createdAt": "2024-01-14T09:00:00Z" }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTE0VDA5OjAwOjAwWiIsImlkIjoidXNlcl8xMjIifQ",
    "prevCursor": "eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTE1VDEwOjAwOjAwWiIsImlkIjoidXNlcl8xMjMifQ"
  }
}
```

## Python Implementation

```python
# pagination.py
import base64
import json
from dataclasses import dataclass
from typing import TypeVar, Generic, Callable, Optional

T = TypeVar('T')

@dataclass
class PaginatedResult(Generic[T]):
    data: list[T]
    has_more: bool
    next_cursor: Optional[str]
    prev_cursor: Optional[str]

def encode_cursor(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()

def decode_cursor(cursor: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(cursor).decode())

async def paginate(
    query_fn: Callable,
    cursor: Optional[str] = None,
    limit: int = 20,
    max_limit: int = 100,
) -> PaginatedResult:
    limit = min(limit, max_limit)
    
    filters = {}
    if cursor:
        decoded = decode_cursor(cursor)
        filters = {"created_at__lt": decoded["created_at"]}

    items = await query_fn(filters, limit + 1)
    has_more = len(items) > limit
    data = items[:limit] if has_more else items

    return PaginatedResult(
        data=data,
        has_more=has_more,
        next_cursor=encode_cursor({"created_at": data[-1].created_at.isoformat()}) if data else None,
        prev_cursor=encode_cursor({"created_at": data[0].created_at.isoformat()}) if data else None,
    )
```

### FastAPI Route

```python
@router.get("/users")
async def list_users(cursor: str = None, limit: int = 20):
    async def query(filters, take):
        return await db.users.find_many(
            where=filters,
            order_by={"created_at": "desc"},
            take=take,
        )

    result = await paginate(query, cursor=cursor, limit=limit)
    return {
        "data": result.data,
        "pagination": {
            "hasMore": result.has_more,
            "nextCursor": result.next_cursor,
        },
    }
```

## Database Optimization

```sql
-- Essential index for cursor pagination
CREATE INDEX idx_users_pagination ON users(created_at DESC, id DESC);

-- For filtered pagination
CREATE INDEX idx_users_org_pagination ON users(organization_id, created_at DESC, id DESC);
```

## Frontend Integration

```typescript
// useInfiniteQuery with cursor pagination
function useUsers() {
  return useInfiniteQuery({
    queryKey: ['users'],
    queryFn: ({ pageParam }) =>
      fetch(`/api/users?cursor=${pageParam || ''}`).then(r => r.json()),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
  });
}

// Usage
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useUsers();

const allUsers = data?.pages.flatMap(page => page.data) ?? [];
```

## Best Practices

1. **Always use stable sort** - Include ID in sort to handle ties
2. **Index your sort columns** - Pagination is only fast with proper indexes
3. **Limit the limit** - Cap maximum page size (100 is reasonable)
4. **Use cursor for real-time data** - Offset breaks with concurrent writes
5. **Include total count sparingly** - COUNT(*) is expensive on large tables

## Common Mistakes

- Using OFFSET on large tables (scans all skipped rows)
- Not including ID in cursor (unstable with same timestamps)
- Missing index on sort columns
- Returning total count on every request
- Not handling deleted items between pages
