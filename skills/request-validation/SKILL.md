---
name: request-validation
description: Validate API requests with schemas, sanitization, and helpful error messages. Covers Zod, Joi, and Pydantic patterns.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: api
  time: 2h
  source: drift-masterguide
---

# Request Validation

Never trust user input. Validate everything.

## When to Use This Skill

- All API endpoints accepting user input
- Form submissions
- File uploads
- Query parameters
- Webhook payloads

## TypeScript Implementation (Zod)

### Schema Definition

```typescript
// schemas/user.ts
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  name: z.string().min(1).max(100).trim(),
  role: z.enum(['user', 'admin']).default('user'),
  metadata: z.record(z.string()).optional(),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true });

export const userIdSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  role: z.enum(['user', 'admin']).optional(),
  sortBy: z.enum(['name', 'createdAt', 'email']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Infer types from schemas
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersSchema>;
```

### Validation Middleware

```typescript
// middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

function validate(schemas: ValidationSchemas) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const errors: Array<{ field: string; message: string }> = [];

    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        return res.status(400).json({
          error: 'Validation failed',
          details: formattedErrors,
        });
      }
      next(error);
    }
  };
}

export { validate };
```

### Route Usage

```typescript
// routes/users.ts
import { validate } from '../middleware/validate';
import { createUserSchema, userIdSchema, listUsersSchema } from '../schemas/user';

router.post(
  '/users',
  validate({ body: createUserSchema }),
  async (req, res) => {
    // req.body is typed and validated
    const user = await userService.create(req.body);
    res.status(201).json(user);
  }
);

router.get(
  '/users/:id',
  validate({ params: userIdSchema }),
  async (req, res) => {
    const user = await userService.findById(req.params.id);
    res.json(user);
  }
);

router.get(
  '/users',
  validate({ query: listUsersSchema }),
  async (req, res) => {
    // req.query is typed with defaults applied
    const users = await userService.list(req.query);
    res.json(users);
  }
);
```

### Custom Validators

```typescript
// schemas/custom.ts
import { z } from 'zod';

// Phone number with formatting
export const phoneSchema = z
  .string()
  .transform(val => val.replace(/\D/g, ''))
  .refine(val => val.length >= 10 && val.length <= 15, 'Invalid phone number');

// Slug (URL-safe string)
export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format');

// Date string to Date object
export const dateSchema = z
  .string()
  .datetime()
  .transform(val => new Date(val));

// Sanitized HTML (strip dangerous tags)
export const safeHtmlSchema = z
  .string()
  .transform(val => sanitizeHtml(val, { allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p'] }));

// File upload validation
export const fileSchema = z.object({
  mimetype: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  size: z.number().max(10 * 1024 * 1024, 'File too large (max 10MB)'),
  originalname: z.string(),
});
```

## Python Implementation (Pydantic)

```python
# schemas/user.py
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from enum import Enum

class UserRole(str, Enum):
    user = "user"
    admin = "admin"

class CreateUserInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=100)
    role: UserRole = UserRole.user
    metadata: Optional[dict[str, str]] = None

    @field_validator('password')
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain uppercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain a number')
        return v

    @field_validator('name')
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()

class UpdateUserInput(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    role: Optional[UserRole] = None

class ListUsersQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    search: Optional[str] = Field(None, max_length=100)
    role: Optional[UserRole] = None
```

### FastAPI Usage

```python
# routes/users.py
from fastapi import APIRouter, Query, Path, HTTPException
from schemas.user import CreateUserInput, UpdateUserInput, ListUsersQuery

router = APIRouter()

@router.post("/users", status_code=201)
async def create_user(data: CreateUserInput):
    # data is validated and typed
    user = await user_service.create(data.model_dump())
    return user

@router.get("/users/{user_id}")
async def get_user(user_id: str = Path(pattern=r'^[0-9a-f-]{36}$')):
    user = await user_service.find_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user

@router.get("/users")
async def list_users(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    search: str = Query(default=None, max_length=100),
):
    return await user_service.list(page=page, limit=limit, search=search)
```

## Error Response Format

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email address" },
    { "field": "password", "message": "Password must be at least 8 characters" }
  ]
}
```

## Best Practices

1. **Validate at the edge** - Before any business logic
2. **Use schema inference** - Don't duplicate types
3. **Provide helpful messages** - Tell users how to fix errors
4. **Sanitize strings** - Trim whitespace, escape HTML
5. **Set sensible defaults** - Reduce required fields

## Common Mistakes

- Validating after database operations
- Generic error messages ("Invalid input")
- Not validating query parameters
- Missing max length on strings (DoS vector)
- Not sanitizing HTML content
