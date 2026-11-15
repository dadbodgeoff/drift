#!/usr/bin/env bash
# Release dry run on this machine. Publishes nothing, pushes nothing.
#
#   npm/dry-run.sh [version]        (default: the workspace version in Cargo.toml)
#
# Follows .github/workflows/release.yml for one target (TARGET, default
# x86_64-unknown-linux-musl):
#   1. the versions agree (the tag version, Cargo.toml, plugin.json), as the verify job checks;
#   2. release build, archive + SHA256SUMS, and `sha256sum -c` (a tampered copy must fail);
#   3. npm/build.mjs, `npm pack`, then the packed tarballs installed into a scratch
#      project: `drift --version` through the npm launcher must print this version;
#   4. through that install: init, review --block, check, census on a small synthetic
#      repository, and each Claude Code plugin hook (integrations/claude-code/hooks/hooks.json)
#      once, with sample hook input on stdin.
# The other four platform packages get stub binaries so that build.mjs, which needs
# all five, can run. Needs: the Rust target (`rustup target add $TARGET`; musl-tools
# on Linux), Node. WORK=<dir> keeps everything in one place (default: a new temp dir).
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
target=${TARGET:-x86_64-unknown-linux-musl}
cargo_version=$(sed -n '/^\[workspace.package\]/,/^\[/s/^version = "\(.*\)"/\1/p' "$repo/Cargo.toml")
plugin_version=$(node -p 'require(process.argv[1]).version' "$repo/integrations/claude-code/.claude-plugin/plugin.json")
version=${1:-$cargo_version}
work=${WORK:-$(mktemp -d)}
echo "dry run: version $version, target $target, in $work"

# 1. The verify job: the tag (here: the version argument), Cargo.toml and plugin.json agree.
[ "$version" = "$cargo_version" ] || { echo "error: version $version does not match Cargo.toml $cargo_version (node npm/set-version.mjs $version)"; exit 1; }
[ "$version" = "$plugin_version" ] || { echo "error: version $version does not match plugin.json $plugin_version (node npm/set-version.mjs $version)"; exit 1; }

cargo build --release --locked -p drift-cli --target "$target" --manifest-path "$repo/Cargo.toml"

# Stage as the build job does; artifacts lose the executable bit, as between jobs.
exe=drift
case "$target" in *windows*) exe=drift.exe ;; esac
mkdir -p "$work/dist/$target"
cp "${CARGO_TARGET_DIR:-$repo/target}/$target/release/$exe" "$work/dist/$target/"
chmod -x "$work/dist/$target/$exe"

# 2. Archive and checksum, as the release job does (keep in sync with release.yml),
#    then verify as RELEASING.md tells users to.
tag="v$version"
(
  cd "$work"
  find dist -type f -exec chmod +x {} +
  mkdir -p out
  for dir in dist/*/; do
    t=$(basename "$dir")
    tar -C "$dir" -czf "out/drift-${tag}-${t}.tar.gz" .
  done
  (cd out && sha256sum *.tar.gz > SHA256SUMS)
  cat out/SHA256SUMS
  (cd out && sha256sum -c SHA256SUMS --ignore-missing)
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
  "./check/$exe" --version
)

# Stubs for the targets this machine did not build.
node -e '
  const c = require(process.argv[1]);
  for (const [t, v] of Object.entries(c.targets)) console.log(t, v.exe);
' "$repo/npm/config.json" | while read -r t e; do
  [ -e "$work/dist/$t/$e" ] && continue
  mkdir -p "$work/dist/$t" && echo "stub: not built by the dry run" > "$work/dist/$t/$e"
done

# 3. npm packages: build, pack, install offline from the tarballs, run the launcher.
node "$repo/npm/build.mjs" "$version" "$work/dist" "$work/npm-out"
mkdir -p "$work/packs"
for dir in "$work"/npm-out/*/; do (cd "$work/packs" && npm pack --silent "$dir" >/dev/null); done
for f in "$work"/packs/*.tgz; do echo "$(basename "$f") ($(wc -c < "$f") bytes): $(tar -tzf "$f" | sort | tr '\n' ' ')"; done

suffix=$(node -p 'process.platform + "-" + process.arch')
name=$(node -p 'require(process.argv[1]).name.replace("@", "").replace("/", "-")' "$repo/npm/config.json")
project="$work/project"
mkdir -p "$project"
(
  cd "$project"
  npm init -y >/dev/null
  npm install --offline --no-audit --no-fund --silent \
    "$work/packs/$name-$suffix-$version.tgz" "$work/packs/$name-$version.tgz"
  said=$(npx --no-install drift --version)
  echo "npx drift --version: $said"
  [ "$said" = "drift $version" ] || { echo "error: the launcher ran a binary that says '$said', not 'drift $version'"; exit 1; }
)
export PATH="$project/node_modules/.bin:$PATH"
[ "$(command -v drift)" = "$project/node_modules/.bin/drift" ] || { echo "error: drift on PATH is $(command -v drift)"; exit 1; }

# 4. A synthetic repository: 40 routes (38 wrapped in withAuth, 2 legacy) and 30 helpers.
demo="$work/demo"
mkdir -p "$demo/lib"
export DRIFT_CACHE_DIR="$work/cache"
echo '{ "name": "demo" }' > "$demo/package.json"
echo '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }' > "$demo/tsconfig.json"
printf 'export function withAuth<T>(h: T): T {\n  return h;\n}\n' > "$demo/lib/auth.ts"
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
