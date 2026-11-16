#!/usr/bin/env bash
# Arm "agents-md": Drift's setup and export only. `drift init`, the accept rule
# (common.sh), then `drift export agents-md --write <instructions file>`, which
# creates the file or updates only its drift:start/drift:end block. No hooks and
# no MCP server; harness.py keeps drift off the agent's PATH unless the config
# says otherwise (PREREG-DRAFT.md, decision D3).
. "$(dirname "$0")/common.sh"
drift_setup
drift_export_agents_md
