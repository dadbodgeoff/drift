---
name: error-handling
description: Implement consistent error handling with custom error classes, error boundaries, and structured error responses. Covers logging, monitoring, and user-friendly messages.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: api
  time: 3h
  source: drift-masterguide
---

# Error Handling

Handle errors gracefully and consistently across your application.

## When to Use This Skill

- API error responses
- Database errors
- External service failures
- Validation errors
- Authentication/authorization errors

## Error Response Format

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "User not found",
    "details": { "userId": "123" },
    "requestId": "req_abc123"
  }
}
```

## TypeScript Implementation

### Custom Error Classes

```typescript
// errors/app-error.ts
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// Common error types
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      'RESOURCE_NOT_FOUND',
      `${resource} not found`,
      404,
      id ? { [`${resource.toLowerCase()}Id`]: id } : undefined
    );
  }
}

export class ValidationError extends AppError {
  constructor(details: Array<{ field: string; message: string }>) {
    super('VALIDATION_ERROR', 'Validation failed', 400, { errors: details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super('FORBIDDEN', message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super('RATE_LIMITED', 'Too many requests', 429, { retryAfter });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: Error) {
    super(
      'EXTERNAL_SERVICE_ERROR',
      `${service} service unavailable`,
      503,
      { service, originalMessage: originalError?.message }
    );
  }
}
```

### Error Handler Middleware

```typescript
// middleware/error-handler.ts
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error';
import { logger } from '../utils/logger';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = req.headers['x-request-id'] as string;

  // Handle known operational errors
  if (err instanceof AppError) {
    logger.warn('Operational error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      requestId,
      path: req.path,
    });

    const response: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    };

    return res.status(err.statusCode).json(response);
  }

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      return res.status(409).json({
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'Resource already exists',
          details: { fields: prismaError.meta?.target },
          requestId,
        },
      });
    }
    if (prismaError.code === 'P2025') {
      return res.status(404).json({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Resource not found',
          requestId,
        },
      });
    }
  }

  // Handle unknown errors (programming errors)
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId,
    path: req.path,
  });

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      requestId,
    },
  });
}
```

### Async Handler Wrapper

```typescript
// utils/async-handler.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Usage
router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await userService.findById(req.params.id);
  if (!user) {
    throw new NotFoundError('User', req.params.id);
  }
  res.json(user);
}));
```

### Service Layer Error Handling

```typescript
// services/user-service.ts
import { NotFoundError, ConflictError } from '../errors/app-error';

class UserService {
  async findById(id: string): Promise<User> {
    const user = await db.users.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError('User', id);
    }
    return user;
  }

  async create(data: CreateUserInput): Promise<User> {
    const existing = await db.users.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new ConflictError('Email already registered', { email: data.email });
    }
    return db.users.create({ data });
  }

  async updateEmail(userId: string, newEmail: string): Promise<User> {
    try {
      return await db.users.update({
        where: { id: userId },
        data: { email: newEmail },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictError('Email already in use');
      }
      throw error;
    }
  }
}
```

## Python Implementation

```python
# errors/app_error.py
from dataclasses import dataclass
from typing import Optional, Any

@dataclass
class AppError(Exception):
    code: str
    message: str
    status_code: int = 500
    details: Optional[dict[str, Any]] = None

class NotFoundError(AppError):
    def __init__(self, resource: str, id: str = None):
        super().__init__(
            code="RESOURCE_NOT_FOUND",
            message=f"{resource} not found",
            status_code=404,
            details={f"{resource.lower()}_id": id} if id else None,
        )

class ValidationError(AppError):
    def __init__(self, errors: list[dict]):
        super().__init__(
            code="VALIDATION_ERROR",
            message="Validation failed",
            status_code=400,
            details={"errors": errors},
        )

class UnauthorizedError(AppError):
    def __init__(self, message: str = "Authentication required"):
        super().__init__(code="UNAUTHORIZED", message=message, status_code=401)

class ForbiddenError(AppError):
    def __init__(self, message: str = "Access denied"):
        super().__init__(code="FORBIDDEN", message=message, status_code=403)
```

### FastAPI Error Handler

```python
# middleware/error_handler.py
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from errors.app_error import AppError

async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
                "requestId": request.headers.get("x-request-id"),
            }
        },
    )

# Register in app
app.add_exception_handler(AppError, app_error_handler)
```

## Frontend Error Handling

```typescript
// api-client.ts
class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const body = await response.json();
    throw new ApiError(
      body.error.code,
      body.error.message,
      response.status,
      body.error.details
    );
  }

  return response.json();
}

// Usage with error handling
try {
  const user = await apiRequest('/api/users/123');
} catch (error) {
  if (error instanceof ApiError) {
    if (error.code === 'RESOURCE_NOT_FOUND') {
      showNotification('User not found');
    } else if (error.code === 'VALIDATION_ERROR') {
      showFormErrors(error.details.errors);
    }
  }
}
```

## Best Practices

1. **Use error codes** - Machine-readable, stable across versions
2. **Include request ID** - Essential for debugging
3. **Log appropriately** - Warn for operational, error for bugs
4. **Don't leak internals** - Hide stack traces in production
5. **Be consistent** - Same format everywhere

## Common Mistakes

- Returning stack traces to users
- Generic "Something went wrong" messages
- Not logging errors
- Inconsistent error formats
- Catching and swallowing errors
