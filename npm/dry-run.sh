#!/usr/bin/env bash
# Release dry run on this machine. Publishes nothing, pushes nothing.
#
#   npm/dry-run.sh [version]        (default: the workspace version in Cargo.toml)
#
# Follows .github/workflows/release.yml for one target (TARGET, default
# x86_64-unknown-linux-musl), running the same scripts its jobs run:
#   1. the versions agree (npm/set-version.mjs --check <version>), as the verify job checks;
#   2. release build, then npm/archive.sh (archives + SHA256SUMS) and `sha256sum -c`
#      (a tampered copy must fail);
#   3. npm/build.mjs and npm/pack.sh, then npm/install-test.sh: the packed tarballs
#      installed offline into a scratch project, and `drift --version` through the npm
#      launcher must print this version;
#   4. through that install: init, review --block, check, census on a small synthetic
#      repository, and each Claude Code plugin hook (integrations/claude-code/hooks/hooks.json)
#      once, with sample hook input on stdin.
# The other four platform packages get stub binaries so that build.mjs, which needs
# all five, can run. Needs: the Rust target (`rustup target add $TARGET`; musl-tools
# on Linux), Node. WORK=<dir> keeps everything in one place (default: a new temp dir).
# BIN=<path to a drift binary> skips the build and packages that binary instead (it
# must report the version; any profile or target this machine can run). CI's
# release-rehearsal job runs this script with no BIN.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
target=${TARGET:-x86_64-unknown-linux-musl}
version=${1:-$(node "$repo/npm/set-version.mjs" --print)}
work=${WORK:-$(mktemp -d)}
echo "dry run: version $version, target $target, in $work"

# 1. The verify job: the tag (here: the version argument) and every place the
#    version is written agree.
node "$repo/npm/set-version.mjs" --check "$version"

exe=drift
case "$target" in *windows*) exe=drift.exe ;; esac
if [ -n "${BIN:-}" ]; then
  echo "BIN=$BIN: not built by the dry run"
  built=$BIN
else
  DRIFT_BUILD_COMMIT=${DRIFT_BUILD_COMMIT:-$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)} \
    cargo build --release --locked -p drift-cli --target "$target" --manifest-path "$repo/Cargo.toml"
  built="${CARGO_TARGET_DIR:-$repo/target}/$target/release/$exe"
fi

# Stage as the build job does; artifacts lose the executable bit, as between jobs.
mkdir -p "$work/dist/$target"
cp "$built" "$work/dist/$target/$exe"
chmod -x "$work/dist/$target/$exe"

# 2. Archive and checksum with the package job's script, then verify as
#    RELEASING.md tells users to.
tag="v$version"
bash "$repo/npm/archive.sh" "$tag" "$work/dist" "$work/out"
(
  cd "$work"
  cat out/SHA256SUMS
  # A tampered archive must fail the same check.
  mkdir -p tampered
  cp out/SHA256SUMS tampered/
  cp "out/drift-${tag}-${target}.tar.gz" tampered/
  printf 'x' >> "tampered/drift-${tag}-${target}.tar.gz"
  if (cd tampered && sha256sum -c SHA256SUMS --ignore-missing >/dev/null 2>&1); then
    echo "error: sha256sum -c accepted a tampered archive"; exit 1
  fi
  echo "tampered archive rejected by sha256sum -c"
  mkdir -p check && tar -C check -xzf "out/drift-${tag}-${target}.tar.gz"
  said=$("./check/$exe" --version)
  echo "extracted binary: $said"
  [ "$said" = "drift $version" ] || { echo "error: the archived binary says '$said', not 'drift $version'"; exit 1; }
)

# Stubs for the targets this machine did not build (after archiving: the stubs are
# for build.mjs, which needs all five, not for the archives).
node -e '
  const c = require(process.argv[1]);
  for (const [t, v] of Object.entries(c.targets)) console.log(t, v.exe);
' "$repo/npm/config.json" | while read -r t e; do
  [ -e "$work/dist/$t/$e" ] && continue
  mkdir -p "$work/dist/$t" && echo "stub: not built by the dry run" > "$work/dist/$t/$e"
done

# 3. npm packages: build and pack as the package job does, install offline from the
#    tarballs and run the launcher as the install-test job does.
node "$repo/npm/build.mjs" "$version" "$work/dist" "$work/npm-out"
bash "$repo/npm/pack.sh" "$work/npm-out" "$work/npm-tarballs"
project="$work/project"
bash "$repo/npm/install-test.sh" "$work/npm-tarballs" "$version" "$project"
export PATH="$project/node_modules/.bin:$PATH"
[ "$(command -v drift)" = "$project/node_modules/.bin/drift" ] || { echo "error: drift on PATH is $(command -v drift)"; exit 1; }

# 4. A synthetic repository: 40 routes (38 wrapped in withAuth, which turns away a
# request with no authorization header; 2 legacy) and 30 helpers.
demo="$work/demo"
mkdir -p "$demo/lib"
export DRIFT_CACHE_DIR="$work/cache"
echo '{ "name": "demo" }' > "$demo/package.json"
echo '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }' > "$demo/tsconfig.json"
printf 'type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get("authorization")) {\n      return new Response("Unauthorized", { status: 401 });\n    }\n    return h(req);\n  };\n}\n' > "$demo/lib/auth.ts"
guarded='import { withAuth } from "@/lib/auth";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n'
unguarded='export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n'
for i in $(seq -w 0 39); do
  mkdir -p "$demo/app/api/r$i"
  if [ "$i" -lt 38 ]; then printf "$guarded" > "$demo/app/api/r$i/route.ts"; else printf "$unguarded" > "$demo/app/api/r$i/route.ts"; fi
done
for i in $(seq -w 0 29); do printf 'export function h%s() {\n  return %s;\n}\n' "$i" "$((10#$i))" > "$demo/lib/h$i.ts"; done
(
  cd "$demo"
  git init -q && git add -A && git -c user.name=dry -c user.email=dry@example.invalid commit -qm demo
  drift census | head -20
  drift init | tail -5
  id=$(node -e '
    const y = require("fs").readFileSync(".drift/conventions.yaml", "utf8");
    const b = y.split("- id: ").slice(1).find((b) => b.includes("withAuth"));
    if (!b) { console.error("no withAuth convention learned"); process.exit(1); }
    console.log(b.slice(0, 8));
  ')
  drift review --block "$id"
  drift check
  echo "check on the baselined repository: exit 0"
  mkdir -p app/api/new && printf "$unguarded" > app/api/new/route.ts
  status=0; drift check || status=$?
  [ "$status" = 1 ] || { echo "error: check on a new unwrapped route exited $status, not 1"; exit 1; }
  echo "check on a new unwrapped route: exit 1"
  rm -r app/api/new
  # A practice from the map made the rule for app/api (advise mode): the two routes
  # that differ are recorded, so the check stays clean.
  pid=$(drift practices promote --list --json | node -e '
    const l = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const c = l.candidates.find((c) => c.candidate.concern === "authn");
    if (!c) { console.error("no sign-in practice may be promoted"); process.exit(1); }
    console.log(c.candidate.ways[0].id);
  ')
  drift practices promote "$pid" --in app/api
  drift check
  echo "check after promoting $pid: exit 0"
)

# The plugin hooks, exactly as hooks.json writes them, with sample input on stdin.
hooks=$(node -e '
  const h = require(process.argv[1]).hooks;
  const seen = new Set();
  for (const [event, groups] of Object.entries(h))
    for (const g of groups) for (const x of g.hooks) if (!seen.has(x.command)) { seen.add(x.command); console.log(event + "\t" + x.command); }
' "$repo/integrations/claude-code/hooks/hooks.json")
new_route="$demo/app/api/hooked/route.ts"
while IFS=$'\t' read -r event cmd; do
  case "$event" in
    SessionStart) extra='"source": "startup"' ;;
    PreToolUse) extra="\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$new_route\"}" ;;
    PostToolUse)
      mkdir -p "$(dirname "$new_route")" && printf "$unguarded" > "$new_route"
      extra="\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$new_route\"}" ;;
    UserPromptSubmit) extra='"prompt": "add a route"' ;;
    Stop) extra='"stop_hook_active": false' ;;
    SessionEnd) extra='"reason": "clear"' ;;
    *) extra='' ;;
  esac
  input="{\"session_id\": \"dry-run\", \"cwd\": \"$demo\", \"hook_event_name\": \"$event\"${extra:+, $extra}}"
  status=0
  out=$(cd "$demo" && echo "$input" | sh -c "$cmd") || status=$?
  [ "$status" = 0 ] || { echo "error: hook '$cmd' exited $status"; exit 1; }
  if [ -n "$out" ]; then
    echo "$out" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' || { echo "error: hook '$cmd' printed non-JSON: $out"; exit 1; }
  fi
  echo "hook $event: exit 0, $(printf %s "$out" | head -c 160)"
  if [ "$event" = Stop ]; then
    echo "$out" | grep -q '"decision":"block"\|"decision": "block"' || { echo "error: Stop did not block the new unwrapped route"; exit 1; }
  fi
done <<<"$hooks"
echo "ok: $work (delete it when done)"
