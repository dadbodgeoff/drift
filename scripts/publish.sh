#!/bin/bash
# Publish script for driftdetect packages
# Publishes packages in dependency order with proper workspace protocol conversion

set -e

echo "🚀 Publishing driftdetect packages..."

# Build all packages first
echo "📦 Building all packages..."
pnpm run build

# Publish in dependency order:
# 1. core (no internal deps)
# 2. detectors (depends on core)
# 3. galaxy (no internal deps)
# 4. dashboard (depends on core, galaxy)
# 5. cli (depends on core, detectors, dashboard)
# 6. mcp (depends on core)

echo ""
echo "📤 Publishing driftdetect-core..."
cd packages/core
pnpm publish --access public --no-git-checks
cd ../..

echo ""
echo "📤 Publishing driftdetect-detectors..."
cd packages/detectors
pnpm publish --access public --no-git-checks
cd ../..

echo ""
echo "📤 Publishing driftdetect-galaxy..."
cd packages/galaxy
pnpm publish --access public --no-git-checks
cd ../..

echo ""
echo "📤 Publishing driftdetect-dashboard..."
cd packages/dashboard
pnpm publish --access public --no-git-checks
cd ../..

echo ""
echo "📤 Publishing driftdetect (CLI)..."
cd packages/cli
pnpm publish --access public --no-git-checks
cd ../..

echo ""
echo "📤 Publishing driftdetect-mcp..."
cd packages/mcp
pnpm publish --access public --no-git-checks
cd ../..

echo ""
echo "✅ All packages published successfully!"
