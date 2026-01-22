---
name: jwt-auth
description: Implement secure JWT authentication with refresh token rotation, secure storage, and automatic renewal. Use when building authentication for SPAs, mobile apps, or APIs that need stateless auth with refresh capabilities.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: auth
  time: 4h
  source: drift-masterguide
---

# JWT Authentication with Refresh Token Rotation

Secure, stateless authentication with automatic token refresh.

## When to Use This Skill

- Building authentication for SPAs or mobile apps
- Need stateless authentication for APIs
- Want automatic token refresh without re-login
- Implementing OAuth-style token flows

## Token Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Access Token                       │
│  - Short-lived (15 min)                             │
│  - Contains user claims                             │
│  - Sent with every request                          │
│  - Stored in memory (not localStorage)              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                  Refresh Token                       │
│  - Long-lived (7 days)                              │
│  - Used only to get new access tokens               │
│  - Stored in httpOnly cookie                        │
│  - Rotated on each use (one-time use)              │
└─────────────────────────────────────────────────────┘
```

## Token Rotation Flow

```
1. Login
   Client ──────────────────────────────────▶ Server
          credentials                         
   Client ◀────────────────────────────────── Server
          access_token + refresh_token (cookie)

2. API Request
   Client ──────────────────────────────────▶ Server
          Authorization: Bearer {access_token}
   Client ◀────────────────────────────────── Server
          response

3. Token Refresh (when access token expires)
   Client ──────────────────────────────────▶ Server
          POST /auth/refresh (cookie sent)
   Client ◀────────────────────────────────── Server
          new_access_token + new_refresh_token
          (old refresh token invalidated)
```

## TypeScript Implementation

### Token Service

```typescript
// token-service.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Redis } from 'ioredis';

interface TokenConfig {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenExpiry: string;  // e.g., '15m'
  refreshTokenExpiry: string; // e.g., '7d'
}

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

class TokenService {
  constructor(
    private config: TokenConfig,
    private redis: Redis
  ) {}

  async generateTokenPair(payload: TokenPayload): Promise<TokenPair> {
    // Generate access token
    const accessToken = jwt.sign(payload, this.config.accessTokenSecret, {
      expiresIn: this.config.accessTokenExpiry,
    });

    // Generate refresh token (random + signed)
    const refreshTokenId = crypto.randomUUID();
    const refreshToken = jwt.sign(
      { ...payload, tokenId: refreshTokenId },
      this.config.refreshTokenSecret,
      { expiresIn: this.config.refreshTokenExpiry }
    );

    // Store refresh token in Redis for rotation tracking
    await this.storeRefreshToken(payload.userId, refreshTokenId);

    // Calculate expiry in seconds
    const decoded = jwt.decode(accessToken) as { exp: number };
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

    return { accessToken, refreshToken, expiresIn };
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair | null> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(
        refreshToken,
        this.config.refreshTokenSecret
      ) as TokenPayload & { tokenId: string };

      // Check if token is still valid (not rotated)
      const isValid = await this.validateRefreshToken(
        decoded.userId,
        decoded.tokenId
      );

      if (!isValid) {
        // Token reuse detected - potential theft
        // Invalidate all tokens for this user
        await this.revokeAllUserTokens(decoded.userId);
        return null;
      }

      // Invalidate old refresh token
      await this.invalidateRefreshToken(decoded.userId, decoded.tokenId);

      // Generate new token pair
      return this.generateTokenPair({
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      });
    } catch (error) {
      return null;
    }
  }

  verifyAccessToken(token: string): TokenPayload | null {
    try {
      return jwt.verify(token, this.config.accessTokenSecret) as TokenPayload;
    } catch {
      return null;
    }
  }

  private async storeRefreshToken(userId: string, tokenId: string): Promise<void> {
    const key = `refresh_tokens:${userId}`;
    // Store with expiry matching refresh token
    await this.redis.sadd(key, tokenId);
    await this.redis.expire(key, 7 * 24 * 60 * 60); // 7 days
  }

  private async validateRefreshToken(userId: string, tokenId: string): Promise<boolean> {
    const key = `refresh_tokens:${userId}`;
    return (await this.redis.sismember(key, tokenId)) === 1;
  }

  private async invalidateRefreshToken(userId: string, tokenId: string): Promise<void> {
    const key = `refresh_tokens:${userId}`;
    await this.redis.srem(key, tokenId);
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    const key = `refresh_tokens:${userId}`;
    await this.redis.del(key);
  }
}

export { TokenService, TokenConfig, TokenPayload, TokenPair };
```

### Auth Routes

```typescript
// auth-routes.ts
import { Router, Request, Response } from 'express';
import { TokenService } from './token-service';

const router = Router();

// Cookie options for refresh token
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth', // Only sent to auth routes
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Validate credentials (implement your own)
  const user = await validateCredentials(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Generate tokens
  const tokens = await tokenService.generateTokenPair({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  // Set refresh token as httpOnly cookie
  res.cookie('refresh_token', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

  // Return access token in response body
  res.json({
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
});

router.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  const tokens = await tokenService.refreshTokens(refreshToken);

  if (!tokens) {
    // Clear invalid cookie
    res.clearCookie('refresh_token', { path: '/auth' });
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  // Set new refresh token
  res.cookie('refresh_token', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

  res.json({
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
  });
});

router.post('/logout', async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refresh_token;

  if (refreshToken) {
    // Invalidate the refresh token
    try {
      const decoded = jwt.decode(refreshToken) as { userId: string };
      if (decoded?.userId) {
        await tokenService.revokeAllUserTokens(decoded.userId);
      }
    } catch {
      // Ignore decode errors
    }
  }

  res.clearCookie('refresh_token', { path: '/auth' });
  res.json({ success: true });
});

export { router as authRouter };
```

### Auth Middleware

```typescript
// auth-middleware.ts
import { Request, Response, NextFunction } from 'express';
import { TokenService, TokenPayload } from './token-service';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

function authMiddleware(tokenService: TokenService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.slice(7);
    const payload = tokenService.verifyAccessToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = payload;
    next();
  };
}

export { authMiddleware };
```

## Python Implementation

```python
# token_service.py
import jwt
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from dataclasses import dataclass
import redis

@dataclass
class TokenPayload:
    user_id: str
    email: str
    role: str

@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int

class TokenService:
    def __init__(
        self,
        access_secret: str,
        refresh_secret: str,
        redis_client: redis.Redis,
        access_expiry_minutes: int = 15,
        refresh_expiry_days: int = 7,
    ):
        self.access_secret = access_secret
        self.refresh_secret = refresh_secret
        self.redis = redis_client
        self.access_expiry = timedelta(minutes=access_expiry_minutes)
        self.refresh_expiry = timedelta(days=refresh_expiry_days)

    def generate_token_pair(self, payload: TokenPayload) -> TokenPair:
        now = datetime.utcnow()
        
        # Access token
        access_payload = {
            "user_id": payload.user_id,
            "email": payload.email,
            "role": payload.role,
            "exp": now + self.access_expiry,
            "iat": now,
        }
        access_token = jwt.encode(access_payload, self.access_secret, algorithm="HS256")

        # Refresh token with unique ID
        token_id = str(uuid.uuid4())
        refresh_payload = {
            **access_payload,
            "token_id": token_id,
            "exp": now + self.refresh_expiry,
        }
        refresh_token = jwt.encode(refresh_payload, self.refresh_secret, algorithm="HS256")

        # Store refresh token ID
        self._store_refresh_token(payload.user_id, token_id)

        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=int(self.access_expiry.total_seconds()),
        )

    def refresh_tokens(self, refresh_token: str) -> Optional[TokenPair]:
        try:
            decoded = jwt.decode(refresh_token, self.refresh_secret, algorithms=["HS256"])
            
            # Validate token is still valid
            if not self._validate_refresh_token(decoded["user_id"], decoded["token_id"]):
                # Token reuse detected - revoke all
                self.revoke_all_user_tokens(decoded["user_id"])
                return None

            # Invalidate old token
            self._invalidate_refresh_token(decoded["user_id"], decoded["token_id"])

            # Generate new pair
            return self.generate_token_pair(TokenPayload(
                user_id=decoded["user_id"],
                email=decoded["email"],
                role=decoded["role"],
            ))
        except jwt.InvalidTokenError:
            return None

    def verify_access_token(self, token: str) -> Optional[TokenPayload]:
        try:
            decoded = jwt.decode(token, self.access_secret, algorithms=["HS256"])
            return TokenPayload(
                user_id=decoded["user_id"],
                email=decoded["email"],
                role=decoded["role"],
            )
        except jwt.InvalidTokenError:
            return None

    def _store_refresh_token(self, user_id: str, token_id: str) -> None:
        key = f"refresh_tokens:{user_id}"
        self.redis.sadd(key, token_id)
        self.redis.expire(key, int(self.refresh_expiry.total_seconds()))

    def _validate_refresh_token(self, user_id: str, token_id: str) -> bool:
        key = f"refresh_tokens:{user_id}"
        return self.redis.sismember(key, token_id)

    def _invalidate_refresh_token(self, user_id: str, token_id: str) -> None:
        key = f"refresh_tokens:{user_id}"
        self.redis.srem(key, token_id)

    def revoke_all_user_tokens(self, user_id: str) -> None:
        key = f"refresh_tokens:{user_id}"
        self.redis.delete(key)
```

## Frontend Integration

```typescript
// auth-client.ts
class AuthClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  async login(email: string, password: string): Promise<boolean> {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Important for cookies
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    this.accessToken = data.accessToken;
    
    // Schedule refresh before expiry
    this.scheduleRefresh(data.expiresIn);
    
    return true;
  }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    // Ensure we have a valid token
    if (!this.accessToken) {
      await this.refresh();
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    // If 401, try refresh and retry
    if (response.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${this.accessToken}`,
          },
        });
      }
    }

    return response;
  }

  private async refresh(): Promise<boolean> {
    // Deduplicate concurrent refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  private async doRefresh(): Promise<boolean> {
    const response = await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      this.accessToken = null;
      return false;
    }

    const data = await response.json();
    this.accessToken = data.accessToken;
    this.scheduleRefresh(data.expiresIn);
    return true;
  }

  private scheduleRefresh(expiresIn: number): void {
    // Refresh 1 minute before expiry
    const refreshIn = (expiresIn - 60) * 1000;
    setTimeout(() => this.refresh(), refreshIn);
  }

  async logout(): Promise<void> {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    this.accessToken = null;
  }
}

export const authClient = new AuthClient();
```

## Best Practices

1. **Short access token expiry**: 15 minutes max
2. **Rotate refresh tokens**: One-time use prevents theft
3. **Store refresh token in httpOnly cookie**: Not accessible to JS
4. **Store access token in memory**: Not localStorage
5. **Detect token reuse**: Revoke all tokens if detected

## Common Mistakes

- Storing tokens in localStorage (XSS vulnerable)
- Long access token expiry (increases attack window)
- Not rotating refresh tokens (stolen token = permanent access)
- Not detecting refresh token reuse
- Sending refresh token with every request

## Security Checklist

- [ ] Access token expiry ≤ 15 minutes
- [ ] Refresh token in httpOnly cookie
- [ ] Access token in memory only
- [ ] Refresh token rotation on each use
- [ ] Token reuse detection
- [ ] Secure cookie flags (httpOnly, secure, sameSite)
- [ ] HTTPS only in production
