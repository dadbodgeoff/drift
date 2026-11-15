#!/bin/sh
# Run every local gate in one command, in order:
#
#   1. fmt       cargo fmt --all --check
#   2. clippy    cargo clippy --all-targets --locked -- -D warnings
#   3. test      RUSTFLAGS="-D warnings" INSTA_UPDATE=no cargo test --all --locked
#   4. study     node --test eval/study/*.test.mjs
#
# With --studio, also in apps/studio: npm ci --ignore-scripts, then typecheck,
# lint, vitest and build. With --fast, clippy is skipped.
#
# Every gate runs even when an earlier one fails, so one run shows every
# failure. The Studio steps after a failed `npm ci` are reported as SKIP and
# count as a failure. The script ends with one PASS/FAIL/SKIP line per gate and
# exits non-zero if any gate failed.
#
# Builds use the lean dev profile unless the caller overrides it:
# CARGO_PROFILE_DEV_DEBUG=0 and CARGO_INCREMENTAL=0. CARGO_TARGET_DIR is
# honoured when set.
#
# POSIX sh; no bashisms.

set -u

usage() {
	cat <<'EOF'
usage: scripts/gates.sh [--studio] [--fast]

  --studio  also run the Studio gates in apps/studio
            (npm ci --ignore-scripts, typecheck, lint, vitest, build)
  --fast    skip clippy
  -h, --help  show this help

Runs: cargo fmt check, clippy (-D warnings), cargo test (RUSTFLAGS=-D warnings,
INSTA_UPDATE=no), node --test eval/study/*.test.mjs. Exits non-zero if any
gate fails. Honours CARGO_TARGET_DIR; defaults CARGO_PROFILE_DEV_DEBUG=0 and
CARGO_INCREMENTAL=0.
EOF
}

studio=0
fast=0
for arg in "$@"; do
	case "$arg" in
	--studio) studio=1 ;;
	--fast) fast=1 ;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "gates.sh: unknown option: $arg" >&2
		usage >&2
		exit 2
		;;
	esac
done

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 2
cd "$root" || exit 2

: "${CARGO_PROFILE_DEV_DEBUG:=0}"
: "${CARGO_INCREMENTAL:=0}"
export CARGO_PROFILE_DEV_DEBUG CARGO_INCREMENTAL
if [ -n "${CARGO_TARGET_DIR:-}" ]; then
	export CARGO_TARGET_DIR
fi

logs=$(mktemp -d "${TMPDIR:-/tmp}/drift-gates.XXXXXX") || exit 2
trap 'rm -rf "$logs"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

summary="$logs/summary"
: >"$summary"
failed=0
n=0

# run NAME CMD...: run CMD with output shown and saved to $logs/NAME.log;
# the exit status lands in $status.
run() {
	name=$1
	shift
	n=$((n + 1))
	printf '\n==> [%s] %s\n' "$name" "$*"
	{
		"$@"
		echo $? >"$logs/$name.status"
	} 2>&1 | tee "$logs/$name.log"
	status=$(cat "$logs/$name.status" 2>/dev/null || echo 1)
	log="$logs/$name.log"
}

# record NAME DETAIL: print and store the PASS/FAIL line for the last gate.
record() {
	if [ "$status" -eq 0 ]; then
		result=PASS
	else
		result=FAIL
		failed=$((failed + 1))
	fi
	line=$(printf '%-4s %-16s %s' "$result" "$1" "$2")
	printf '%s\n' "$line" >>"$summary"
	printf -- '--- %s\n' "$line"
}

skip() {
	failed=$((failed + 1))
	line=$(printf '%-4s %-16s %s' SKIP "$1" "$2")
	printf '%s\n' "$line" >>"$summary"
	printf -- '--- %s\n' "$line"
}

# count PATTERN: number of lines in $log matching the extended regex.
count() {
	grep -Ec -- "$1" "$log" 2>/dev/null || true
}

# cargo_diags: "E errors, W warnings" from a cargo log (rustc/clippy lines).
cargo_diags() {
	e=$(count '^error(\[[A-Z0-9]+\])?: ')
	# The "aborting due to" and "could not compile" lines are not diagnostics.
	e_meta=$(count '^error: (aborting due to|could not compile)')
	w=$(count '^warning(\[[A-Za-z0-9_]+\])?: ')
	w_meta=$(count '^warning: .* generated [0-9]+ warnings?')
	printf '%s errors, %s warnings' "$((e - e_meta))" "$((w - w_meta))"
}

# 1. fmt
run fmt cargo fmt --all --check
files=$(grep -E '^Diff in ' "$log" 2>/dev/null | sed -E -e 's/ at line [0-9]+:?$//' -e 's/:[0-9]+:?$//' -e 's/^Diff in //' | sort -u | wc -l | tr -d ' ')
record fmt "$files files need formatting"

# 2. clippy
if [ "$fast" -eq 1 ]; then
	line=$(printf '%-4s %-16s %s' SKIP clippy "skipped by --fast")
	printf '%s\n' "$line" >>"$summary"
	printf '\n--- %s\n' "$line"
else
	run clippy cargo clippy --all-targets --locked -- -D warnings
	record clippy "$(cargo_diags)"
fi

# 3. cargo test
run test env RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-D warnings" INSTA_UPDATE=no \
	cargo test --all --locked
tests=$(grep -E '^test result: ' "$log" 2>/dev/null | awk '
	{
		for (i = 1; i <= NF; i++) {
			v = $(i - 1) + 0
			if ($i ~ /^passed/) p += v
			else if ($i ~ /^failed/) f += v
			else if ($i ~ /^ignored/) g += v
		}
		s++
	}
	END { printf "%d passed, %d failed, %d ignored (%d suites)", p, f, g, s }')
if ! grep -q '^test result: ' "$log"; then
	if [ "$status" -ne 0 ]; then
		tests="build failed: $(cargo_diags)"
	else
		# A test run that reports no suites ran nothing: treat it as a failure.
		status=1
		tests="no test results found"
	fi
fi
record test "$tests"

# Node's test runner prints its totals as "# pass N" (TAP) or "ℹ pass N" (spec).
node_totals() {
	p=$(sed -n 's/^[#ℹ ]*pass \([0-9][0-9]*\)$/\1/p' "$log" | tail -n 1)
	f=$(sed -n 's/^[#ℹ ]*fail \([0-9][0-9]*\)$/\1/p' "$log" | tail -n 1)
	printf '%s passed, %s failed' "${p:-?}" "${f:-?}"
}

# 4. study node tests
set -- eval/study/*.test.mjs
run study node --test "$@"
totals=$(node_totals)
case "$totals" in
*'?'*)
	# No totals means the runner did not report: treat it as a failure.
	status=1
	;;
esac
record study "$totals ($# files)"

# 5. Studio
if [ "$studio" -eq 1 ]; then
	if [ ! -d apps/studio ]; then
		echo "gates.sh: apps/studio not found" >&2
		exit 2
	fi
	run studio-ci sh -c 'cd apps/studio && npm ci --ignore-scripts'
	added=$(sed -n 's/^added \([0-9][0-9]*\) packages.*/\1/p' "$log" | tail -n 1)
	record studio-ci "${added:-?} packages"
	if [ "$status" -ne 0 ]; then
		for g in studio-typecheck studio-lint studio-vitest studio-build; do
			skip "$g" "npm ci failed"
		done
	else
		run studio-typecheck sh -c 'cd apps/studio && npm run typecheck'
		record studio-typecheck "$(count 'error TS[0-9]+') errors"

		run studio-lint sh -c 'cd apps/studio && npm run lint'
		problems=$(sed -n 's/^✖ \([0-9][0-9]*\) problems\{0,1\}.*/\1/p' "$log" | tail -n 1)
		record studio-lint "${problems:-0} problems"

		run studio-vitest sh -c 'cd apps/studio && npm run test'
		# "Tests  12 passed | 1 failed (13)"; strip colour codes first.
		esc=$(printf '\033')
		vt=$(sed "s/$esc\[[0-9;]*m//g" "$log" | sed -n 's/^ *Tests  *\(.*\)$/\1/p' | tail -n 1)
		vf=$(sed "s/$esc\[[0-9;]*m//g" "$log" | sed -n 's/^ *Test Files  *\(.*\)$/\1/p' | tail -n 1)
		record studio-vitest "tests ${vt:-?}; files ${vf:-?}"

		run studio-build sh -c 'cd apps/studio && npm run build'
		record studio-build "exit $status"
	fi
fi

printf '\n==> summary (%s gates run, %s failed)\n' "$n" "$failed"
cat "$summary"
if [ "$failed" -ne 0 ]; then
	printf 'gates: FAIL\n'
	exit 1
fi
printf 'gates: PASS\n'
exit 0
