# Drift Skills

Production-ready Agent Skills for building enterprise SaaS applications.

## What are Agent Skills?

Agent Skills are folders of instructions, scripts, and resources that AI agents (GitHub Copilot, Claude, etc.) can load to perform specialized tasks. They follow the [Agent Skills open standard](https://agentskills.io).

## Available Skills (24)

### 🛡️ Resilience
| Skill | Description | Time |
|-------|-------------|------|
| [circuit-breaker](./circuit-breaker/) | Prevent cascade failures with circuit breaker pattern | ~4h |
| [graceful-degradation](./graceful-degradation/) | Keep systems running when dependencies fail | ~3h |

### 🔌 API
| Skill | Description | Time |
|-------|-------------|------|
| [rate-limiting](./rate-limiting/) | Subscription-aware API rate limiting | ~4h |
| [idempotency](./idempotency/) | Safe retry handling for critical operations | ~4h |
| [api-versioning](./api-versioning/) | Backward-compatible API evolution | ~3h |
| [file-uploads](./file-uploads/) | Secure file uploads with presigned URLs | ~4h |
| [pagination](./pagination/) | Cursor-based pagination for large datasets | ~2h |
| [request-validation](./request-validation/) | Schema validation with Zod/Pydantic | ~2h |
| [error-handling](./error-handling/) | Consistent error responses and logging | ~3h |

### 🔐 Auth & Security
| Skill | Description | Time |
|-------|-------------|------|
| [jwt-auth](./jwt-auth/) | JWT authentication with refresh tokens | ~4h |
| [row-level-security](./row-level-security/) | PostgreSQL RLS for multi-tenant apps | ~4h |
| [oauth-social-login](./oauth-social-login/) | Google/GitHub OAuth integration | ~6h |
| [webhook-security](./webhook-security/) | Secure webhook signature verification | ~3h |
| [audit-logging](./audit-logging/) | Compliance-ready audit trails | ~4h |

### 💳 Integrations
| Skill | Description | Time |
|-------|-------------|------|
| [stripe-integration](./stripe-integration/) | Complete Stripe payments integration | ~6h |
| [email-service](./email-service/) | Transactional email with templates | ~4h |

### ⚙️ Workers & Background
| Skill | Description | Time |
|-------|-------------|------|
| [background-jobs](./background-jobs/) | Robust background job processing with DLQ | ~4h |

### 🚀 Performance
| Skill | Description | Time |
|-------|-------------|------|
| [caching-strategies](./caching-strategies/) | Multi-layer caching with Redis | ~4h |

### 🗄️ Database
| Skill | Description | Time |
|-------|-------------|------|
| [database-migrations](./database-migrations/) | Zero-downtime schema changes | ~3h |
| [soft-delete](./soft-delete/) | Recoverable deletion with audit trails | ~2h |

### 🏗️ Foundations
| Skill | Description | Time |
|-------|-------------|------|
| [feature-flags](./feature-flags/) | Feature flag system for safe rollouts | ~4h |
| [sse-streaming](./sse-streaming/) | Server-sent events for real-time updates | ~3h |
| [multi-tenancy](./multi-tenancy/) | Multi-tenant SaaS architecture | ~6h |

### 🔧 Operations
| Skill | Description | Time |
|-------|-------------|------|
| [health-checks](./health-checks/) | Kubernetes-ready health endpoints | ~2h |

## Installation

### Option 1: Drift CLI (Recommended)

```bash
# Install a single skill
drift skills install circuit-breaker

# Install multiple skills
drift skills install circuit-breaker rate-limiting stripe-integration

# List available skills
drift skills list

# Search skills
drift skills search auth

# Get skill details
drift skills info jwt-auth
```

### Option 2: Manual Copy

Copy the skill folder to your project's `.github/skills/` directory:

```bash
cp -r drift/skills/circuit-breaker .github/skills/
```

## Usage

Once installed, skills are automatically discovered by compatible agents:

- **GitHub Copilot**: Skills in `.github/skills/` are loaded when relevant
- **Claude Code**: Register as a plugin marketplace
- **VS Code**: Works with Copilot agent mode

Just ask naturally:
- "Add circuit breaker to my API client"
- "Implement rate limiting for my endpoints"
- "Set up Stripe subscription billing"
- "Add OAuth login with Google"
- "Implement cursor pagination for my list endpoints"

## Creating Custom Skills

Use the template:

```bash
cp -r drift/skills/_template drift/skills/my-skill
```

Then edit `SKILL.md` with your instructions.

## Philosophy

- **Real Code > Theory**: Every skill includes working code from production
- **Minimal Dependencies**: Prefer stdlib and simple abstractions
- **Production-First**: Error handling, edge cases, observability built-in
- **48-Hour Rule**: Each skill should be implementable in under 48 hours

## License

MIT - Use these skills freely in your projects.
