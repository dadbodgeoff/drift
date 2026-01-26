# Drift MCP Server Docker Image
# Multi-stage build for minimal production image

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/detectors/package.json ./packages/detectors/
COPY packages/cli/package.json ./packages/cli/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/ ./packages/core/
COPY packages/mcp/ ./packages/mcp/
COPY packages/detectors/ ./packages/detectors/
COPY packages/cli/ ./packages/cli/
COPY tsconfig.json ./

# Build packages (core -> detectors -> mcp)
RUN pnpm --filter driftdetect-core build && \
    pnpm --filter driftdetect-detectors build && \
    pnpm --filter driftdetect-mcp build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20-slim AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Create non-root user for security
RUN groupadd --gid 1001 drift && \
    useradd --uid 1001 --gid drift --shell /bin/bash --create-home drift

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/detectors/package.json ./packages/detectors/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=builder /app/packages/detectors/dist ./packages/detectors/dist

# Create directory for mounting projects
RUN mkdir -p /project && chown drift:drift /project

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
CMD ["node", "packages/mcp/dist/bin/http-server.js"]
