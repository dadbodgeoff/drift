# Drift MCP Server Docker Image
# Multi-stage build for minimal production image

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-slim AS builder

# Install pnpm and build dependencies for native modules (tree-sitter)
RUN corepack enable && corepack prepare pnpm@8.10.0 --activate && \
    apt-get update && apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all package files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/mcp/package.json packages/mcp/tsconfig.json ./packages/mcp/
COPY packages/detectors/package.json packages/detectors/tsconfig.json ./packages/detectors/
COPY packages/cli/package.json packages/cli/tsconfig.json ./packages/cli/
COPY packages/cortex/package.json packages/cortex/tsconfig.json ./packages/cortex/

# Create minimal workspace config for just the packages we need
RUN echo 'packages:\n  - "packages/core"\n  - "packages/detectors"\n  - "packages/mcp"\n  - "packages/cli"\n  - "packages/cortex"' > pnpm-workspace.yaml

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/src ./packages/core/src
COPY packages/mcp/src ./packages/mcp/src
COPY packages/detectors/src ./packages/detectors/src
COPY packages/cli/src ./packages/cli/src
COPY packages/cortex/src ./packages/cortex/src

# Build detectors first (core and mcp depend on it)
RUN cd packages/detectors && pnpm build

# Build core (depends on detectors)
RUN cd packages/core && pnpm build

# Build cortex
RUN cd packages/cortex && pnpm build

# Build mcp (depends on core, detectors, and cortex)
RUN cd packages/mcp && pnpm build

# Prune dev dependencies after build
RUN pnpm prune --prod

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20-slim AS production

# Install pnpm (no build tools needed - we copy pre-built node_modules)
RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Create non-root user for security
RUN groupadd --gid 1001 drift && \
    useradd --uid 1001 --gid drift --shell /bin/bash --create-home drift

# Set working directory
WORKDIR /app

# Copy package files and pruned node_modules from builder
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/mcp/package.json ./packages/mcp/
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=builder /app/packages/mcp/node_modules ./packages/mcp/node_modules
COPY --from=builder /app/packages/detectors/package.json ./packages/detectors/
COPY --from=builder /app/packages/detectors/dist ./packages/detectors/dist
COPY --from=builder /app/packages/detectors/node_modules ./packages/detectors/node_modules
COPY --from=builder /app/packages/cortex/package.json ./packages/cortex/
COPY --from=builder /app/packages/cortex/dist ./packages/cortex/dist
COPY --from=builder /app/packages/cortex/node_modules ./packages/cortex/node_modules

# Create directory for mounting projects
RUN mkdir -p /project && chown drift:drift /project
RUN mkdir -p /workspace && chown drift:drift /workspace

# Switch to non-root user
USER drift

# Environment variables with defaults
ENV PORT=3000 \
    PROJECT_ROOT=/project \
    ENABLE_CACHE=true \
    ENABLE_RATE_LIMIT=true \
    VERBOSE=false \
    NODE_ENV=production

# Expose HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:${PORT}/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run the HTTP server
CMD ["node", "packages/mcp/dist/bin/http-server.js", "--verbose"]
