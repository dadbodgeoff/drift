#!/usr/bin/env bash
# Arm "hooks": Drift's setup with hooks. The same setup as arm "agents-md"
# (unless BENCH_HOOKS_WITH_AGENTS_MD=0), then the hook wiring: each
# "SOURCE=>DEST" line of BENCH_HOOK_FILES is copied into the working copy. The
# operator supplies those files in the form the agent under test reads (for one
# agent, integrations/claude-code/hooks/hooks.json placed where that agent reads
# project hooks; the skill and an MCP entry for `drift mcp` likewise). harness.py
# puts drift on the agent's PATH for this arm, since the hooks run `drift hook ...`.
. "$(dirname "$0")/common.sh"
drift_setup
if [ "${BENCH_HOOKS_WITH_AGENTS_MD:-1}" = 1 ]; then
  drift_export_agents_md
fi
if [ -z "${BENCH_HOOK_FILES:-}" ]; then
  log "hooks arm: BENCH_HOOK_FILES is empty: no hook is wired"; exit 3
fi
printf '%s\n' "$BENCH_HOOK_FILES" | while IFS= read -r line; do
  [ -n "$line" ] || continue
  src=${line%%=>*}
  dest=${line#*=>}
  case "$dest" in /*|*..*) log "hooks arm: destination must be inside the working copy: $dest"; exit 3;; esac
  mkdir -p "$(dirname "$dest")"
  log "+ copy $src to $dest"
  cp "$src" "$dest"
done
