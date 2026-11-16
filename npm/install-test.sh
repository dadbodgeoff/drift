#!/usr/bin/env bash
# Install the packed npm tarballs into a fresh project, offline, and run Drift
# through the npm launcher (release.yml's install-test job on each OS, and
# npm/dry-run.sh and npm/ci-check.mjs here):
#
#   npm/install-test.sh <tarball-dir> <version> [<project-dir>]
#
# Installs this machine's platform package and the main package from the
# tarballs (no registry), then `drift --version` through the launcher must print
# `drift <version>`. <project-dir> (default: a new temporary directory) is kept,
# so a caller can put its node_modules/.bin on PATH.
set -euo pipefail
usage="usage: npm/install-test.sh <tarball-dir> <version> [<project-dir>]"
packs=${1:?$usage}
version=${2:?$usage}
project=${3:-$(mktemp -d)}
here=$(cd "$(dirname "$0")" && pwd)
packs=$(cd "$packs" && pwd)
suffix=$(node -p 'process.platform + "-" + process.arch')
name=$(node -p 'require(process.argv[1]).name.replace("@", "").replace("/", "-")' "$here/config.json")
platform="$name-$suffix-$version.tgz"
main="$name-$version.tgz"
for f in "$platform" "$main"; do
  [ -f "$packs/$f" ] || { echo "error: $packs has no $f (this machine is $suffix)"; ls "$packs"; exit 1; }
done
mkdir -p "$project"
# Copied in and installed by relative path: no absolute path crosses into npm,
# which on Windows would be a POSIX path from bash.
cp "$packs/$platform" "$packs/$main" "$project/"
(
  cd "$project"
  [ -f package.json ] || echo '{ "name": "drift-install-test", "private": true }' > package.json
  npm install --offline --no-audit --no-fund --ignore-scripts --silent "./$platform" "./$main"
  said=$(npx --no-install drift --version | tr -d '\r')
  echo "npx drift --version ($suffix): $said"
  [ "$said" = "drift $version" ] || { echo "error: the launcher ran a binary that says '$said', not 'drift $version'"; exit 1; }
)
echo "install test ok: $project"
