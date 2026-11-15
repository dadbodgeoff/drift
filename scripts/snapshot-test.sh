#!/bin/sh
# Tests of scripts/snapshot.sh, on throwaway repositories in a temporary
# directory (invented names only; nothing here reads this repository's lists):
#
#   scripts/snapshot-test.sh [SCRIPT]
#
# SCRIPT defaults to scripts/snapshot.sh beside this file. Prints one PASS/FAIL
# line per case and exits non-zero if any failed. POSIX sh; needs git.
set -u

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
script=${1:-$here/snapshot.sh}
case "$script" in /*) ;; *) script=$(pwd)/$script ;; esac
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT
real_grep=$(command -v grep)
# Secret-shaped test data, built here so this file holds none.
aws_key="AKIA""QQQQQQQQQQQQQQQQ"
failures=0
cases=0

# A new repository in $base/$1 with one tracked file, and the deny list
# `zorblax` (untracked, as the script reads it from the working tree).
repo() {
  r="$base/$1"
  mkdir -p "$r/scripts" "$r/docs"
  git -C "$r" init -q
  git -C "$r" config user.email t@example.invalid
  git -C "$r" config user.name t
  printf 'plain text\n' > "$r/docs/readme.md"
  printf '# names\nzorblax\n' > "$r/scripts/snapshot-deny.txt"
}

commit() {
  git -C "$r" add -A -- . ':!scripts/snapshot-deny.txt' ':!scripts/snapshot-exclude.txt' ':!scripts/snapshot-fake-secrets.txt'
  git -C "$r" commit -qm c
}

# expect <name> <pass|fail> [text the output must hold]: runs the script in $r.
expect() {
  cases=$((cases + 1))
  out="$base/out-$cases"
  said=$(cd "$r" && PATH=${fake_path:-$PATH} sh "$script" "$out" 2>&1)
  code=$?
  ok=1
  case "$2" in
    pass) [ "$code" -eq 0 ] && [ -d "$out" ] || ok=0 ;;
    fail) [ "$code" -ne 0 ] && [ ! -e "$out" ] || ok=0 ;;
  esac
  if [ $# -ge 3 ]; then
    case "$said" in *"$3"*) ;; *) ok=0 ;; esac
  fi
  if [ "$ok" -eq 1 ]; then
    echo "PASS $1"
  else
    echo "FAIL $1 (exit $code): $said"
    failures=$((failures + 1))
  fi
}

repo clean
commit
expect "a clean tree is exported" pass

repo binary
printf 'header\000zorblax customer list\n' > "$r/docs/blob.bin"
commit
expect "a denied name in a binary file fails" fail "docs/blob.bin"

repo filename
printf 'nothing\n' > "$r/docs/zorblax-onboarding.md"
commit
expect "a denied name in a file name fails" fail "docs/zorblax-onboarding.md"

repo dirname
mkdir -p "$r/Zorblax"
printf 'nothing\n' > "$r/Zorblax/a.md"
commit
expect "a denied name in a directory name fails, ignoring case" fail "Zorblax"

repo link
ln -s /home/zorblax/secrets "$r/docs/link"
commit
expect "a denied name in a link's target fails" fail "docs/link -> /home/zorblax/secrets"

repo empty
printf '# no names yet\n\n' > "$r/scripts/snapshot-deny.txt"
commit
expect "a deny list with no name fails" fail "lists no name"

repo glob
printf 'zorblax\n' > "$r/docs/private-a.md"
printf 'zorblax\n' > "$r/docs/private b.md"
mkdir -p "$r/app/[id]"
printf 'zorblax\n' > "$r/app/[id]/page.tsx"
printf 'docs/private-*.md\ndocs/private b.md\napp/[id]/page.tsx\n' > "$r/scripts/snapshot-exclude.txt"
commit
expect "an exclude glob, a path with a space and one with brackets leave the files out" pass
if [ -e "$out/docs/private-a.md" ] || [ -e "$out/docs/private b.md" ] || [ -e "$out/app/[id]/page.tsx" ] || [ ! -e "$out/docs/readme.md" ]; then
  echo "FAIL the excluded files are left out and the rest stays"
  failures=$((failures + 1))
fi

repo dots
printf '.*\n' > "$r/scripts/snapshot-exclude.txt"
commit
expect "an exclude glob that matches . or .. is refused" fail "must stay inside"

repo fakes
printf 'id = "%s"\n' "$aws_key" > "$r/docs/a"
printf 'docs/a\n' > "$r/scripts/snapshot-fake-secrets.txt"
commit
expect "a listed file of fake secrets is not secret-checked" pass
if ! "$real_grep" -q "$aws_key" "$out/docs/a"; then
  echo "FAIL the file of fake secrets is exported whole"
  failures=$((failures + 1))
fi

repo exact
printf 'id = "%s"\n' "$aws_key" > "$r/docs/a"
printf 'id = "%s"\n' "$aws_key" > "$r/docs/a:b"
printf 'docs/a\n' > "$r/scripts/snapshot-fake-secrets.txt"
commit
expect "a fake-secrets entry exempts that exact path only" fail "docs/a:b"

repo binsecret
printf 'k\000%s\n' "$aws_key" > "$r/docs/key.bin"
commit
expect "a secret in a binary file fails" fail "docs/key.bin"

repo grepfails
commit
mkdir "$base/bin"
cat > "$base/bin/grep" <<EOF
#!/bin/sh
case " \$* " in *" -r"*) exit 2 ;; esac
exec "$real_grep" "\$@"
EOF
chmod +x "$base/bin/grep"
fake_path="$base/bin:$PATH"
expect "a check that cannot run fails" fail "could not run"
fake_path=

echo "$cases cases, $failures failure(s)"
[ "$failures" -eq 0 ]
