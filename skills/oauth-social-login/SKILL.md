---
name: oauth-social-login
description: Implement OAuth 2.0 social login with Google, GitHub, and other providers. Handles token exchange, user creation, and account linking.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: auth
  time: 6h
  source: drift-masterguide
---

# OAuth Social Login

Add "Sign in with Google/GitHub" to your app.

## When to Use This Skill

- Adding social login options
- Reducing signup friction
- Linking multiple auth providers to one account
- Enterprise SSO requirements

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    User clicks                       │
│               "Sign in with Google"                  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Redirect to Provider                    │
│                                                     │
│  /auth/google → Google OAuth consent screen         │
│  Include: client_id, redirect_uri, scope, state     │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Provider Callback                       │
│                                                     │
│  /auth/google/callback?code=xxx&state=yyy          │
│  1. Verify state (CSRF protection)                  │
│  2. Exchange code for tokens                        │
│  3. Fetch user profile                              │
│  4. Create/link user account                        │
│  5. Issue session/JWT                               │
└─────────────────────────────────────────────────────┘
```

## TypeScript Implementation

### OAuth Configuration

```typescript
// oauth-config.ts
interface OAuthProvider {
  name: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
}

const providers: Record<string, OAuthProvider> = {
  google: {
    name: 'Google',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  github: {
    name: 'GitHub',
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
};

export { providers, OAuthProvider };
```

### OAuth Service

```typescript
// oauth-service.ts
import crypto from 'crypto';
import { providers, OAuthProvider } from './oauth-config';

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
}

interface OAuthUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  provider: string;
}

class OAuthService {
  private stateStore = new Map<string, { provider: string; redirectTo?: string }>();

  generateAuthUrl(providerName: string, redirectTo?: string): string {
    const provider = providers[providerName];
    if (!provider) throw new Error(`Unknown provider: ${providerName}`);

    // Generate CSRF state token
    const state = crypto.randomBytes(32).toString('hex');
    this.stateStore.set(state, { provider: providerName, redirectTo });

    // Auto-expire state after 10 minutes
    setTimeout(() => this.stateStore.delete(state), 10 * 60 * 1000);

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: this.getCallbackUrl(providerName),
      response_type: 'code',
      scope: provider.scopes.join(' '),
      state,
      access_type: 'offline', // For refresh tokens (Google)
      prompt: 'consent',
    });

    return `${provider.authorizationUrl}?${params}`;
  }

  async handleCallback(
    providerName: string,
    code: string,
    state: string
  ): Promise<{ user: OAuthUserInfo; redirectTo?: string }> {
    // Verify state
    const stateData = this.stateStore.get(state);
    if (!stateData || stateData.provider !== providerName) {
      throw new Error('Invalid state parameter');
    }
    this.stateStore.delete(state);

    const provider = providers[providerName];
    if (!provider) throw new Error(`Unknown provider: ${providerName}`);

    // Exchange code for tokens
    const tokens = await this.exchangeCode(provider, code);

    // Fetch user info
    const userInfo = await this.fetchUserInfo(provider, tokens.accessToken, providerName);

    return { user: userInfo, redirectTo: stateData.redirectTo };
  }

  private async exchangeCode(provider: OAuthProvider, code: string): Promise<OAuthTokens> {
    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.getCallbackUrl(provider.name.toLowerCase()),
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    };
  }

  private async fetchUserInfo(
    provider: OAuthProvider,
    accessToken: string,
    providerName: string
  ): Promise<OAuthUserInfo> {
    const response = await fetch(provider.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.statusText}`);
    }

    const data = await response.json();

    // Normalize user info across providers
    return this.normalizeUserInfo(data, providerName);
  }

  private normalizeUserInfo(data: Record<string, unknown>, provider: string): OAuthUserInfo {
    switch (provider) {
      case 'google':
        return {
          id: data.id as string,
          email: data.email as string,
          name: data.name as string,
          picture: data.picture as string,
          provider: 'google',
        };
      case 'github':
        return {
          id: String(data.id),
          email: data.email as string,
          name: (data.name || data.login) as string,
          picture: data.avatar_url as string,
          provider: 'github',
        };
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  private getCallbackUrl(provider: string): string {
    return `${process.env.APP_URL}/auth/${provider}/callback`;
  }
}

export const oauthService = new OAuthService();
```

### Express Routes

```typescript
// oauth-routes.ts
import { Router, Request, Response } from 'express';
import { oauthService } from './oauth-service';
import { userService } from './user-service';
import { sessionService } from './session-service';

const router = Router();

// Initiate OAuth flow
router.get('/auth/:provider', (req: Request, res: Response) => {
  const { provider } = req.params;
  const { redirect } = req.query;

  try {
    const authUrl = oauthService.generateAuthUrl(provider, redirect as string);
    res.redirect(authUrl);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// OAuth callback
router.get('/auth/:provider/callback', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/login?error=${error}`);
  }

  if (!code || !state) {
    return res.redirect('/login?error=missing_params');
  }

  try {
    const { user: oauthUser, redirectTo } = await oauthService.handleCallback(
      provider,
      code as string,
      state as string
    );

    // Find or create user
    let user = await userService.findByOAuthId(provider, oauthUser.id);

    if (!user) {
      // Check if email already exists
      const existingUser = await userService.findByEmail(oauthUser.email);

      if (existingUser) {
        // Link OAuth to existing account
        user = await userService.linkOAuthAccount(existingUser.id, {
          provider,
          providerId: oauthUser.id,
          email: oauthUser.email,
        });
      } else {
        // Create new user
        user = await userService.createFromOAuth({
          email: oauthUser.email,
          name: oauthUser.name,
          picture: oauthUser.picture,
          provider,
          providerId: oauthUser.id,
        });
      }
    }

    // Create session
    const session = await sessionService.create(user.id);
    res.cookie('session', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.redirect(redirectTo || '/dashboard');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/login?error=oauth_failed');
  }
});

export { router as oauthRoutes };
```

### User Service (Account Linking)

```typescript
// user-service.ts
interface User {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  oauthAccounts: OAuthAccount[];
}

interface OAuthAccount {
  provider: string;
  providerId: string;
  email: string;
}

class UserService {
  async findByOAuthId(provider: string, providerId: string): Promise<User | null> {
    // Find user by OAuth provider ID
    return db.user.findFirst({
      where: {
        oauthAccounts: {
          some: { provider, providerId },
        },
      },
      include: { oauthAccounts: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return db.user.findUnique({
      where: { email },
      include: { oauthAccounts: true },
    });
  }

  async createFromOAuth(data: {
    email: string;
    name?: string;
    picture?: string;
    provider: string;
    providerId: string;
  }): Promise<User> {
    return db.user.create({
      data: {
        email: data.email,
        name: data.name,
        picture: data.picture,
        oauthAccounts: {
          create: {
            provider: data.provider,
            providerId: data.providerId,
            email: data.email,
          },
        },
      },
      include: { oauthAccounts: true },
    });
  }

  async linkOAuthAccount(userId: string, account: OAuthAccount): Promise<User> {
    return db.user.update({
      where: { id: userId },
      data: {
        oauthAccounts: {
          create: account,
        },
      },
      include: { oauthAccounts: true },
    });
  }

  async unlinkOAuthAccount(userId: string, provider: string): Promise<void> {
    const user = await this.findById(userId);
    
    // Ensure user has another way to login
    if (user.oauthAccounts.length <= 1 && !user.passwordHash) {
      throw new Error('Cannot unlink last authentication method');
    }

    await db.oauthAccount.deleteMany({
      where: { userId, provider },
    });
  }
}

export const userService = new UserService();
```

## Python Implementation

```python
# oauth_service.py
import secrets
import httpx
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

@dataclass
class OAuthProvider:
    name: str
    client_id: str
    client_secret: str
    authorization_url: str
    token_url: str
    user_info_url: str
    scopes: list[str]

PROVIDERS = {
    "google": OAuthProvider(
        name="Google",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        authorization_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        user_info_url="https://www.googleapis.com/oauth2/v2/userinfo",
        scopes=["openid", "email", "profile"],
    ),
    "github": OAuthProvider(
        name="GitHub",
        client_id=os.environ["GITHUB_CLIENT_ID"],
        client_secret=os.environ["GITHUB_CLIENT_SECRET"],
        authorization_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        user_info_url="https://api.github.com/user",
        scopes=["read:user", "user:email"],
    ),
}

class OAuthService:
    def __init__(self):
        self._state_store: dict[str, dict] = {}

    def generate_auth_url(self, provider_name: str, redirect_to: Optional[str] = None) -> str:
        provider = PROVIDERS.get(provider_name)
        if not provider:
            raise ValueError(f"Unknown provider: {provider_name}")

        state = secrets.token_hex(32)
        self._state_store[state] = {"provider": provider_name, "redirect_to": redirect_to}

        params = {
            "client_id": provider.client_id,
            "redirect_uri": self._get_callback_url(provider_name),
            "response_type": "code",
            "scope": " ".join(provider.scopes),
            "state": state,
        }

        return f"{provider.authorization_url}?{urlencode(params)}"

    async def handle_callback(self, provider_name: str, code: str, state: str):
        state_data = self._state_store.pop(state, None)
        if not state_data or state_data["provider"] != provider_name:
            raise ValueError("Invalid state")

        provider = PROVIDERS[provider_name]
        tokens = await self._exchange_code(provider, code)
        user_info = await self._fetch_user_info(provider, tokens["access_token"], provider_name)

        return {"user": user_info, "redirect_to": state_data.get("redirect_to")}

    async def _exchange_code(self, provider: OAuthProvider, code: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                provider.token_url,
                data={
                    "client_id": provider.client_id,
                    "client_secret": provider.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": self._get_callback_url(provider.name.lower()),
                },
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            return response.json()

    async def _fetch_user_info(self, provider: OAuthProvider, access_token: str, provider_name: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                provider.user_info_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            data = response.json()

        return self._normalize_user_info(data, provider_name)

    def _normalize_user_info(self, data: dict, provider: str) -> dict:
        if provider == "google":
            return {
                "id": data["id"],
                "email": data["email"],
                "name": data.get("name"),
                "picture": data.get("picture"),
                "provider": "google",
            }
        elif provider == "github":
            return {
                "id": str(data["id"]),
                "email": data["email"],
                "name": data.get("name") or data.get("login"),
                "picture": data.get("avatar_url"),
                "provider": "github",
            }
        raise ValueError(f"Unknown provider: {provider}")

    def _get_callback_url(self, provider: str) -> str:
        return f"{os.environ['APP_URL']}/auth/{provider}/callback"

oauth_service = OAuthService()
```

## Database Schema

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  password_hash VARCHAR(255), -- NULL for OAuth-only users
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- OAuth accounts (one user can have multiple)
CREATE TABLE oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);

CREATE INDEX idx_oauth_accounts_user ON oauth_accounts(user_id);
CREATE INDEX idx_oauth_accounts_provider ON oauth_accounts(provider, provider_id);
```

## Frontend Integration

```typescript
// Login component
function LoginPage() {
  return (
    <div className="login-options">
      <a href="/auth/google" className="oauth-button google">
        <GoogleIcon /> Sign in with Google
      </a>
      <a href="/auth/github" className="oauth-button github">
        <GitHubIcon /> Sign in with GitHub
      </a>
      <div className="divider">or</div>
      <form className="email-login">
        {/* Email/password form */}
      </form>
    </div>
  );
}
```

## Security Considerations

1. **Always verify state parameter** - Prevents CSRF attacks
2. **Use HTTPS in production** - Tokens are sensitive
3. **Validate email ownership** - Some providers don't verify emails
4. **Handle account linking carefully** - Prevent account takeover
5. **Store tokens securely** - Encrypt refresh tokens at rest

## Common Mistakes

- Not validating state parameter
- Storing access tokens in localStorage
- Not handling token refresh
- Allowing unverified email linking
- Missing error handling for revoked tokens
