#!/usr/bin/env bash
# Installs the Drift the Action runs, in three steps that action.yml calls with a
# cache step between the second and the third:
#
#   install.sh resolve   which Drift: one commit, and the release tag it is, if any
#   install.sh release   the released binary of that tag, checksum verified
#   install.sh build     otherwise built from source (cargo, cached by action.yml)
#   install.sh all       the three in a row (for a run outside action.yml)
#
# Environment:
#   DRIFT_REF          the `drift-ref` input: a tag, a branch or a full commit SHA;
#                      empty means the Action's own ref
#   DRIFT_ACTION_REF   `github.action_ref` (empty for a local `uses: ./`)
#   DRIFT_ACTION_PATH  `github.action_path`: the Action's own files, which are the
#                      Drift source at the Action's ref
#   DRIFT_SHA, DRIFT_TAG, DRIFT_SOURCE   what `resolve` found (release and build)
#   DRIFT_HOME         where the binary goes (default ~/.cache/drift-action)
#   DRIFT_REPO_URL     the repository releases and sources come from
#   RUNNER_OS, RUNNER_ARCH   the runner's platform, as GitHub names it
#
# Outputs (GITHUB_OUTPUT): sha, tag, source, target, bin, installed, how
# (release, build, or cached: this commit's binary was already there).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO_URL="${DRIFT_REPO_URL:-https://github.com/dadbodgeoff/drift}"
HOME_DIR="${DRIFT_HOME:-$HOME/.cache/drift-action}"

# The release target of this runner, named as release.yml builds it; empty where
# no binary is released (the Action then builds from source).
target() {
  case "${RUNNER_OS:-}/${RUNNER_ARCH:-}" in
    Linux/X64) echo x86_64-unknown-linux-musl ;;
    Linux/ARM64) echo aarch64-unknown-linux-musl ;;
    macOS/X64) echo x86_64-apple-darwin ;;
    macOS/ARM64) echo aarch64-apple-darwin ;;
    Windows/X64) echo x86_64-pc-windows-msvc ;;
    *) echo "" ;;
  esac
}

exe() {
  if [ "${RUNNER_OS:-}" = Windows ]; then echo drift.exe; else echo drift; fi
}

bin_path() { printf '%s/bin/%s' "$HOME_DIR" "$(exe)"; }

# The binary is what this commit built, or was released as: its stamp says which.
# A binary from another commit (a cache restored by prefix) is never used.
installed_for() {
  local bin
  bin="$(bin_path)"
  [ -x "$bin" ] && [ -f "$bin.commit" ] && [ "$(cat "$bin.commit")" = "$1" ]
}

# Installed: said in the outputs, and the binary's directory goes first on PATH
# for the rest of the job, so later steps can run `drift` too.
installed() {
  out installed true
  out how "$1"
  if [ -n "${GITHUB_PATH:-}" ]; then dirname "$(bin_path)" >>"$GITHUB_PATH"; fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# Is this name a release tag? release.yml runs on tags `v*.*.*`.
is_release_tag() {
  # shellcheck disable=SC2053
  [[ "$1" == v*.*.* ]]
}

resolve() {
  local ref="${DRIFT_REF:-}" source="" refs="" sha="" tag=""
  if [ -z "$ref" ]; then
    # The Action's own ref, never a floating default: `uses: owner/drift@v1.2.3`
    # runs Drift v1.2.3. Its files are that ref's source, so a build needs no clone.
    ref="${DRIFT_ACTION_REF:-}"
    if [ -n "${DRIFT_ACTION_PATH:-}" ] && [ -f "$DRIFT_ACTION_PATH/crates/drift-cli/Cargo.toml" ]; then
      source="$DRIFT_ACTION_PATH"
    fi
    if [ -z "$ref" ]; then
      # A local `uses: ./` has no action_ref: the checkout's own commit.
      ref="$(git -C "${DRIFT_ACTION_PATH:-.}" rev-parse HEAD 2>/dev/null)" ||
        die "the Action's own ref is unknown (github.action_ref is empty and ${DRIFT_ACTION_PATH:-the action path} is not a git checkout); set drift-ref to a tag or a full commit SHA"
    fi
  fi
  if [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
    sha="$ref"
    # A commit may be a release: found by the tags that point at it. Not being
    # able to ask only means building from source.
    refs="$(git ls-remote --tags "$REPO_URL" 2>/dev/null)" || refs=""
    tag="$(awk -v s="$sha" '$1 == s { n = $2; sub(/^refs\/tags\//, "", n); sub(/\^\{\}$/, "", n); print n }' <<<"$refs" |
      while read -r t; do if is_release_tag "$t"; then echo "$t"; fi; done | sort -u | head -n 1)"
  else
    # Full ref names only: `ls-remote` patterns match suffixes, so `v1` would also
    # match `refs/heads/archive/v1`.
    refs="$(git ls-remote --heads --tags "$REPO_URL")" || die "could not list the refs of $REPO_URL"
    local want
    for want in "refs/tags/$ref^{}" "refs/tags/$ref" "refs/heads/$ref"; do
      sha="$(awk -v w="$want" '$2 == w { print $1; exit }' <<<"$refs")"
      [ -n "$sha" ] && break
    done
    [ -n "$sha" ] || die "drift-ref '$ref' is not a tag, a branch or a full 40-character commit SHA of $REPO_URL"
    if [ "$want" != "refs/heads/$ref" ] && is_release_tag "$ref"; then tag="$ref"; fi
  fi
  DRIFT_SHA="$sha" DRIFT_TAG="$tag" DRIFT_SOURCE="$source"
  out sha "$sha"
  out tag "$tag"
  out source "$source"
  out target "$(target)"
  out bin "$(bin_path)"
  if [ -n "${GITHUB_ENV:-}" ]; then
    # A fresh fact cache outside the checkout: pull request code must not be able
    # to supply cached facts (Drift also ignores a git-tracked .drift/cache).
    echo "DRIFT_CACHE_DIR=$(mktemp -d "$(scratch)/drift-cache.XXXXXX")" >>"$GITHUB_ENV"
  fi
}

# The released archive of DRIFT_TAG for this runner, verified against the
# release's SHA256SUMS. No release (or none for this platform) means building
# from source; a checksum or version that does not match stops the job.
release() {
  local sha="${DRIFT_SHA:?resolve first}" tag="${DRIFT_TAG:-}" tgt bin tmp archive want got said
  bin="$(bin_path)"
  if installed_for "$sha"; then
    installed cached
    return
  fi
  tgt="$(target)"
  if [ -z "$tag" ] || [ -z "$tgt" ]; then
    out installed false
    return
  fi
  tmp="$(mktemp -d "$(scratch)/drift-release.XXXXXX")"
  local base="$REPO_URL/releases/download/$tag"
  if ! curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"; then
    echo "drift action: no release assets for $tag; building from source"
    out installed false
    return
  fi
  archive="drift-$tag-$tgt.tar.gz"
  want="$(awk -v f="$archive" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/SHA256SUMS")"
  if [ -z "$want" ]; then
    echo "drift action: release $tag has no $archive; building from source"
    out installed false
    return
  fi
  if ! curl -fsSL --retry 3 -o "$tmp/$archive" "$base/$archive"; then
    annotate warning "drift action: $archive could not be downloaded; building from source"
    out installed false
    return
  fi
  got="$(sha256 "$tmp/$archive")"
  [ "$got" = "$want" ] || die "$archive does not match the release's SHA256SUMS (expected $want, got $got); not installed"
  mkdir -p "$tmp/x" "$(dirname "$bin")"
  tar -xzf "$tmp/$archive" -C "$tmp/x"
  [ -f "$tmp/x/$(exe)" ] || die "$archive holds no $(exe)"
  cp "$tmp/x/$(exe)" "$bin.new"
  chmod +x "$bin.new"
  said="$("$bin.new" --version 2>/dev/null || true)"
  [ "$said" = "drift ${tag#v}" ] || die "the binary of $tag says '$said'; not installed"
  mv -f "$bin.new" "$bin"
  printf '%s\n' "$sha" >"$bin.commit"
  rm -rf "$tmp"
  echo "drift action: installed $said from the $tag release ($tgt, checksum verified)"
  installed release
}

# Builds DRIFT_SHA from source: the Action's own files when they are that commit,
# else a shallow fetch of it. The cargo registry and the build output live in
# DRIFT_HOME and ~/.cargo, which action.yml caches by commit.
build() {
  local sha="${DRIFT_SHA:?resolve first}" src="${DRIFT_SOURCE:-}" bin
  bin="$(bin_path)"
  if installed_for "$sha"; then
    installed cached
    return
  fi
  command -v cargo >/dev/null 2>&1 || die "no released binary for this ref and platform, and cargo is not installed to build one"
  if [ -z "$src" ]; then
    src="$(mktemp -d "$(scratch)/drift-src.XXXXXX")"
    git -C "$src" init -q
    git -C "$src" fetch -q --depth 1 "$REPO_URL" "$sha" || die "could not fetch $sha from $REPO_URL"
    git -C "$src" checkout -q FETCH_HEAD
  fi
  local target_dir="$HOME_DIR/target"
  (cd "$src" && CARGO_TARGET_DIR="$target_dir" cargo build --release --locked -p drift-cli)
  mkdir -p "$(dirname "$bin")"
  cp "$target_dir/release/$(exe)" "$bin"
  printf '%s\n' "$sha" >"$bin.commit"
  # Drift's own crates are rebuilt for every commit anyway: only the dependencies
  # are worth keeping in the cache.
  rm -rf "$target_dir"/release/incremental "$target_dir"/release/.fingerprint/drift-* \
    "$target_dir"/release/build/drift-* "$target_dir"/release/deps/drift* "$target_dir"/release/deps/libdrift*
  echo "drift action: built $("$bin" --version) from source at $sha"
  installed build
}

case "${1:-}" in
  resolve) resolve ;;
  release) release ;;
  build) build ;;
  all)
    resolve
    export DRIFT_SHA DRIFT_TAG DRIFT_SOURCE
    release
    build
    ;;
  *)
    echo "usage: install.sh resolve|release|build|all" >&2
    exit 2
    ;;
esac
