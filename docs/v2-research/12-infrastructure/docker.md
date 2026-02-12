# Docker Deployment

## Location
- `Dockerfile` — Multi-stage build
- `docker-compose.yml` — Service configuration
- `.dockerignore` — Build exclusions

## What It Is
Containerized deployment of the Drift MCP server as an HTTP service with SSE transport. Designed for running Drift analysis as a service that AI agents connect to remotely.

## Dockerfile — Multi-Stage Build

### Stage 1: Builder
- Base: `node:20-slim`
- Installs: pnpm 8.10.0, python3, make, g++ (for native modules)
- Copies package files first (layer caching)
- Creates minimal workspace (core, mcp, detectors, cli, cortex)
- Builds in dependency order: detectors → core → cortex → mcp
- Prunes dev dependencies

### Stage 2: Production
- Base: `node:20-slim`
- Installs: pnpm only (no build tools)
- Creates non-root user `drift` (uid 1001)
- Copies built artifacts + pruned node_modules
- Creates `/workspace` mount point

### Configuration
```dockerfile
ENV PORT=3000
ENV PROJECT_ROOT=/workspace
ENV ENABLE_CACHE=true
ENV ENABLE_RATE_LIMIT=true
ENV VERBOSE=false
ENV NODE_ENV=production
```

### Health Check
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3
  CMD node -e "fetch('http://localhost:${PORT}/health')..."
```

### Entry Point
```dockerfile
CMD ["node", "packages/mcp/dist/bin/http-server.js", "--verbose"]
```

## docker-compose.yml

### Service: `drift-mcp`
```yaml
ports: "${DRIFT_PORT:-3000}:3000"
volumes:
  - "${PROJECT_PATH:-.}:/project:ro"    # Read-only project mount
  - drift-cache:/project/.drift          # Persistent cache
environment:
  - PORT=3000
  - PROJECT_ROOT=/project
  - NODE_OPTIONS=--max-old-space-size=4096
resources:
  limits: { memory: 4G }
  reservations: { memory: 1G }
```

### Endpoints
| URL | Purpose |
|-----|---------|
| `http://localhost:3000/health` | Health check |
| `http://localhost:3000/sse` | SSE endpoint for MCP |
| `http://localhost:3000/message` | POST endpoint for MCP messages |

### Usage
```bash
# Default (current directory)
docker compose up -d

# Custom project
PROJECT_PATH=/path/to/project docker compose up -d

# View logs
docker compose logs -f
```

## v2 Considerations
- Dockerfile needs Rust toolchain for v2 native compilation
- Consider multi-arch builds (linux/amd64 + linux/arm64)
- Pre-built native binaries could skip Rust compilation in Docker
- Memory limits may need increasing for large Rust analysis
- Consider Alpine-based image for smaller footprint
- Add `cargo build --release` stage for Rust components
