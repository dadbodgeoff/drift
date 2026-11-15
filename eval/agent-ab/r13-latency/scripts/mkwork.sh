#!/bin/bash
# Writable work copy of a read-only dev clone: hardlinked working tree (files are
# only ever replaced by rename, never written in place) and a fresh .git whose
# objects come from the source through alternates (read-only).
set -euo pipefail
src=$1
dst=$2
[ -d "$dst/.git" ] && exit 0
mkdir -p "$dst"
for e in "$src"/* "$src"/.[!.]* "$src"/..?*; do
  [ -e "$e" ] || continue
  [ "$(basename "$e")" = .git ] && continue
  cp -al "$e" "$dst/"
done
git init -q "$dst"
echo "$src/.git/objects" > "$dst/.git/objects/info/alternates"
[ -f "$src/.git/shallow" ] && cp "$src/.git/shallow" "$dst/.git/shallow"
sha=$(git -C "$src" rev-parse HEAD)
git -C "$dst" update-ref HEAD "$sha"
git -C "$dst" read-tree HEAD
git -C "$dst" update-index -q --refresh >/dev/null || true
