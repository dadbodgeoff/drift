#!/bin/sh
# Export a snapshot of this repository for a public copy: the tracked files at
# one commit, with no history, checked before anything is written.
#
#   scripts/snapshot.sh [--rev REV] OUTDIR
#
# What it does, in order:
#
#   1. Exports the files git tracks at REV (default HEAD) with `git archive`, so
#      untracked and ignored files (worktrees, caches, local .drift/ state)
#      never reach the snapshot, and no history does.
#   2. Leaves out every path listed in scripts/snapshot-exclude.txt (a path,
#      or a shell glob such as docs/private-*.md), and that file,
#      scripts/snapshot-deny.txt and scripts/snapshot-fake-secrets.txt
#      themselves (they stay private).
#   3. Fails if any file still contains a name listed in
#      scripts/snapshot-deny.txt (one per line, matched as plain text, ignoring
#      case; `#` starts a comment), binary files included, or if a file or
#      directory name or a link's target does; or if any file holds a string
#      shaped like a secret (an AWS key id, a private key block, a GitHub, Slack
#      or OpenAI-style token). A deny file that lists no name fails: no name
#      check would be made. The secret check is a basic one: run a dedicated
#      scanner too. Files listed in scripts/snapshot-fake-secrets.txt (each
#      path exactly) hold known fake secrets (test data for Drift's redaction)
#      and are not secret-checked; every other file is. A check that cannot
#      run (grep fails) fails the snapshot.
#   4. Only when every check passes, moves the snapshot to OUTDIR, which must
#      not exist yet, and writes SNAPSHOT.txt there with the commit it came from
#      for your own records (it is not part of the tree: delete it or keep it).
#
# Nothing here commits, pushes or changes this repository: you commit OUTDIR to
# the public repository yourself.
set -eu

die() { echo "snapshot: $*" >&2; exit 2; }

rev=HEAD
out=
while [ $# -gt 0 ]; do
  case "$1" in
    --rev) [ $# -ge 2 ] || die "--rev needs a commit"; rev=$2; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$out" ] || die "one OUTDIR only"; out=$1; shift ;;
  esac
done
[ -n "$out" ] || die "usage: scripts/snapshot.sh [--rev REV] OUTDIR"
[ ! -e "$out" ] || die "$out already exists"

root=$(git rev-parse --show-toplevel)
commit=$(git -C "$root" rev-parse --verify --quiet "$rev^{commit}") || die "no commit $rev"
deny="$root/scripts/snapshot-deny.txt"
exclude="$root/scripts/snapshot-exclude.txt"
fakes="$root/scripts/snapshot-fake-secrets.txt"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tree="$work/tree"
mkdir "$tree"
git -C "$root" archive --format=tar "$commit" | tar -x -C "$tree"

rm -f "$tree/scripts/snapshot-deny.txt" "$tree/scripts/snapshot-exclude.txt" "$tree/scripts/snapshot-fake-secrets.txt"
if [ -f "$exclude" ]; then
  grep -v '^[[:space:]]*#' "$exclude" | grep -v '^[[:space:]]*$' > "$work/exclude" || true
  # The path as written goes, and so does every match of it as a shell glob (a
  # name such as app/[id] is both); no field splitting of a path with spaces. A
  # match through `.` or `..` would leave the tree: refused.
  oldifs=$IFS
  IFS=
  while read -r p; do
    case "$p" in /*|*..*) die "exclude path must be relative and stay inside: $p" ;; esac
    rm -rf "$tree/$p"
    for m in "$tree"/$p; do
      case "$m/" in */./*|*/../*) die "exclude path must stay inside: $p" ;; esac
      rm -rf "$m"
    done
  done < "$work/exclude"
  IFS=$oldifs
fi

# grep's status: 0 a match, 1 none; anything else is an error, never "clean".
found() {
  st=0
  "$@" || st=$?
  [ "$st" -le 1 ] || die "a check could not run (grep exit $st); nothing written"
  [ "$st" -eq 0 ]
}
# At most 50 lines of a report, each cut short, with no control characters.
show() {
  sed "s#^$tree/##" "$1" | head -50 | cut -c1-200 | tr -c '[:print:]\t\n' '?' >&2
}

failed=0
if [ -f "$deny" ]; then
  grep -v '^[[:space:]]*#' "$deny" | grep -v '^[[:space:]]*$' > "$work/deny" || true
  [ -s "$work/deny" ] || die "scripts/snapshot-deny.txt lists no name, so no name check would be made; nothing written"
  if found grep -rainF -f "$work/deny" "$tree" > "$work/hits"; then
    echo "snapshot: names that must not be published, $(wc -l < "$work/hits") line(s):" >&2
    show "$work/hits"
    failed=1
  fi
  # What a commit publishes besides contents: every path, and where each link points.
  (cd "$tree" && find . -mindepth 1 -print) | sed 's#^\./##' > "$work/paths"
  (cd "$tree" && find . -type l -print) | sed 's#^\./##' | while IFS= read -r l; do
    printf '%s -> %s\n' "$l" "$(readlink "$tree/$l")"
  done > "$work/links"
  if found grep -hiF -f "$work/deny" "$work/paths" "$work/links" > "$work/names"; then
    echo "snapshot: paths or link targets with names that must not be published, $(wc -l < "$work/names") line(s):" >&2
    show "$work/names"
    failed=1
  fi
else
  echo "snapshot: no scripts/snapshot-deny.txt, so no name check was made" >&2
fi

# The files of known fake secrets, each by its exact path, are held aside while
# every other file is secret-checked, then put back.
held="$work/held"
mkdir "$held"
n=0
if [ -f "$fakes" ]; then
  grep -v '^[[:space:]]*#' "$fakes" | grep -v '^[[:space:]]*$' > "$work/fakes" || true
  while IFS= read -r p; do
    case "$p" in /*|*..*) die "fake-secrets path must be relative and stay inside: $p" ;; esac
    if [ -f "$tree/$p" ] && [ ! -L "$tree/$p" ]; then
      n=$((n + 1))
      mv "$tree/$p" "$held/$n"
      printf '%s' "$p" > "$held/$n.path"
    fi
  done < "$work/fakes"
fi
if found grep -raEn \
  -e 'AKIA[0-9A-Z]{16}' \
  -e '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----' \
  -e 'gh[pousr]_[A-Za-z0-9]{36}' \
  -e 'github_pat_[A-Za-z0-9_]{40,}' \
  -e 'xox[abprs]-[A-Za-z0-9-]{10,}' \
  -e 'sk-[A-Za-z0-9]{32,}' \
  "$tree" > "$work/secrets"; then
  echo "snapshot: strings shaped like secrets, $(wc -l < "$work/secrets") line(s):" >&2
  show "$work/secrets"
  failed=1
fi
while [ "$n" -gt 0 ]; do
  mv "$held/$n" "$tree/$(cat "$held/$n.path")"
  n=$((n - 1))
done

[ "$failed" -eq 0 ] || die "nothing written; fix the lines above (or list a path in scripts/snapshot-exclude.txt) and run again"

mv "$tree" "$out"
printf 'Snapshot of %s (commit %s), exported by scripts/snapshot.sh.\n' "$rev" "$commit" > "$out/SNAPSHOT.txt"
echo "snapshot: $(find "$out" -type f | wc -l) files in $out, from $commit"
