#!/usr/bin/env bash
# Derive the enumerations several charters would otherwise each re-derive, once, WITH the command
# that produced each. Agents may use these; the recorded command is how a skeptic re-checks one
# cheaply instead of trusting it.
set -euo pipefail
: "${DRIFT_BETA_SRC:?source env.sh first}"
F="$DRIFT_BETA_FREEZE/facts"; mkdir -p "$F"; cd "$DRIFT_BETA_SRC"

emit() { echo "# $2" > "$F/$1"; eval "$2" >> "$F/$1"; echo "   $1"; }

emit router-arms.txt      "grep -nE '^\s+if \(group === ' packages/cli/src/app/router.ts"
emit predb-arms.txt       "grep -nE 'positional\[0\] === ' packages/cli/src/app/run-cli.ts"
emit convention-kinds.txt "node -e \"const v=require('./vocabulary/vocabulary.json');console.log(JSON.stringify(v,null,1))\""
emit failure-contract.txt "sed -n '52,93p' packages/cli/src/app/drift-error.ts"
emit ledger-cells.txt     "node -e \"const c=require('./test/canary/convention-cell-ledger.json');console.log(JSON.stringify(c.derived_from));for(const x of c.cells)console.log(x.state,x.id??'',x.canary??'')\""
emit mcp-tools.txt        "sed -n '4,193p' packages/mcp/src/tools.ts"
emit migrations.txt       "grep -nE 'id: \"[0-9]{3}' packages/storage/src/migrations.ts"
emit fixtures.txt         "ls test/fixtures"
emit package-scripts.txt  "node -e \"console.log(JSON.stringify(require('./package.json').scripts,null,1))\""

echo "facts in $F"
