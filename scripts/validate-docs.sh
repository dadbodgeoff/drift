#!/bin/bash
#
# Documentation Validator
# 
# Validates that CLI commands mentioned in documentation actually exist.
# Run this in CI to catch documentation drift before it ships.
#
# Usage:
#   ./scripts/validate-docs.sh
#   pnpm run validate-docs
#
# Exit codes:
#   0 - All commands valid
#   1 - Invalid commands found

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔍 Validating documentation against CLI commands..."
echo ""

# Build list of valid commands
VALID_FILE=$(mktemp)

# Get top-level commands
npx driftdetect --help 2>/dev/null | \
  grep -E "^  [a-z]" | \
  awk '{print $1}' | \
  grep -v "^$" >> "$VALID_FILE"

# Get subcommands for known parents
SUBCOMMAND_PARENTS="callgraph boundaries test-topology coupling error-handling constraints skills projects dna env constants gate context telemetry ts py java php go rust cpp wpf"

for parent in $SUBCOMMAND_PARENTS; do
  npx driftdetect $parent --help 2>/dev/null | \
    grep -E "^  [a-z]" | \
    awk -v p="$parent" '{print p" "$1}' | \
    grep -v "^$" >> "$VALID_FILE" 2>/dev/null || true
done

# Sort and dedupe
sort -u "$VALID_FILE" -o "$VALID_FILE"

VALID_COUNT=$(wc -l < "$VALID_FILE" | tr -d ' ')
echo "Found $VALID_COUNT valid commands/subcommands"
echo ""

# Find markdown files
DOCS_FILES=$(find "$ROOT_DIR" \( \
  -path "*/wiki/*.md" -o \
  -name "README.md" \
  \) -type f 2>/dev/null | grep -v node_modules | head -30)

DOCS_COUNT=$(echo "$DOCS_FILES" | wc -l | tr -d ' ')
echo "Scanning $DOCS_COUNT documentation files (wiki + READMEs)..."
echo ""

# Track errors
ERROR_COUNT=0
ERRORS=""

# Extract commands from docs and validate
for file in $DOCS_FILES; do
  [ -f "$file" ] || continue
  REL_PATH="${file#$ROOT_DIR/}"
  
  # Extract drift commands from backticks and $ prompts
  # Pattern: `drift cmd` or `drift cmd subcmd` or $ drift cmd
  FOUND=$(grep -noE '`drift [a-z][-a-z]*( [a-z][-a-z]*)?`|\$ drift [a-z][-a-z]*( [a-z][-a-z]*)?' "$file" 2>/dev/null || true)
  
  while IFS=: read -r line_num match; do
    [ -z "$match" ] && continue
    
    # Clean up the match
    cmd=$(echo "$match" | sed 's/`//g' | sed 's/^\$ //' | sed 's/^drift //')
    
    # Get first word (main command)
    main_cmd=$(echo "$cmd" | awk '{print $1}')
    sub_cmd=$(echo "$cmd" | awk '{print $2}')
    
    # Skip common false positives
    case "$main_cmd" in
      in|it|is|to|the|a|an|and|or|for|with|from|by|as|on|at|of|that|this|your|be|can|will|not|no|yes|so|if|but|then|when|where|what|which|who|how|why|all|any|some|just|also|very|even|still|already|always|never|often|really|actually|probably|however|therefore|thus|meanwhile|otherwise|instead|rather|quite|too|enough|almost|nearly|about|around|over|under|between|through|during|before|after|above|below|into|onto|upon|within|without|against|along|across|behind|beside|beyond|inside|outside|toward|until|unless|since|while|although|though|because|whether|either|neither|nor|yet|once|twice|again|further|furthermore|moreover|besides|anyway|anywhere|everywhere|somewhere|nowhere|anyone|everyone|someone|anything|everything|something|nothing)
        continue
        ;;
    esac
    
    # Check if main command exists
    if ! grep -q "^$main_cmd$" "$VALID_FILE" && ! grep -q "^$main_cmd " "$VALID_FILE"; then
      ERRORS="$ERRORS
❌ $REL_PATH:$line_num - 'drift $cmd' (command '$main_cmd' not found)"
      ERROR_COUNT=$((ERROR_COUNT + 1))
      continue
    fi
    
    # If has subcommand, check that too
    if [ -n "$sub_cmd" ]; then
      if ! grep -q "^$main_cmd $sub_cmd$" "$VALID_FILE"; then
        # Only error if parent has subcommands defined
        if grep -q "^$main_cmd " "$VALID_FILE"; then
          VALID_SUBS=$(grep "^$main_cmd " "$VALID_FILE" | awk '{print $2}' | tr '\n' ', ' | sed 's/,$//')
          ERRORS="$ERRORS
❌ $REL_PATH:$line_num - 'drift $cmd' (subcommand '$sub_cmd' not found)
   Valid: $VALID_SUBS"
          ERROR_COUNT=$((ERROR_COUNT + 1))
        fi
      fi
    fi
  done <<< "$FOUND"
done

# Cleanup
rm -f "$VALID_FILE"

# Report
if [ $ERROR_COUNT -eq 0 ]; then
  echo "✅ All documented commands are valid!"
  exit 0
fi

echo "Found $ERROR_COUNT invalid command(s):"
echo "$ERRORS"
echo ""
echo "Run 'npx driftdetect --help' to see available commands."
exit 1
