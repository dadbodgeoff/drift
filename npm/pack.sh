#!/usr/bin/env bash
# `npm pack` every package npm/build.mjs wrote (release.yml's package job,
# npm/dry-run.sh and npm/ci-check.mjs all run this file):
#
#   npm/pack.sh <npm-out-dir> <tarball-dir>
#
# The tarballs are what the install test installs and what the npm job publishes,
# byte for byte: a tarball keeps the binary's executable bit, which a workflow
# artifact of the unpacked directory would lose.
set -euo pipefail
src=${1:?usage: npm/pack.sh <npm-out-dir> <tarball-dir>}
dest=${2:?usage: npm/pack.sh <npm-out-dir> <tarball-dir>}
mkdir -p "$dest"
src=$(cd "$src" && pwd)
dest=$(cd "$dest" && pwd)
for dir in "$src"/*/; do
  (cd "$dest" && npm pack --silent "$dir" >/dev/null)
done
for f in "$dest"/*.tgz; do
  echo "$(basename "$f") ($(wc -c < "$f" | tr -d ' ') bytes): $(tar -tzf "$f" | sed 's|^package/||' | sort | tr '\n' ' ')"
done
