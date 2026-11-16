#!/usr/bin/env bash
# Archive release binaries and write SHA256SUMS (release.yml's package job,
# npm/dry-run.sh and npm/ci-check.mjs all run this file, so they cannot differ):
#
#   npm/archive.sh <tag> <dist-dir> <out-dir>
#
# <dist-dir>/<rust-target>/drift[.exe] -> <out-dir>/drift-<tag>-<rust-target>.tar.gz
# and <out-dir>/SHA256SUMS. The names are what users and the GitHub Action
# download: do not change them without changing action.yml and RELEASING.md.
set -euo pipefail
tag=${1:?usage: npm/archive.sh <tag> <dist-dir> <out-dir>}
dist=${2:?usage: npm/archive.sh <tag> <dist-dir> <out-dir>}
out=${3:?usage: npm/archive.sh <tag> <dist-dir> <out-dir>}
mkdir -p "$out"
out=$(cd "$out" && pwd)
# Workflow artifacts lose the executable bit between jobs; restore it before archiving.
find "$dist" -type f -exec chmod +x {} +
n=0
for dir in "$dist"/*/; do
  target=$(basename "$dir")
  tar -C "$dir" -czf "$out/drift-${tag}-${target}.tar.gz" .
  n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "error: no target directories in $dist"; exit 1; }
(cd "$out" && sha256sum -- *.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS)
