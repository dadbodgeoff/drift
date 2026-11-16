# The Action's outputs from `drift check --format json`, one `name=value` per line.
#
# A new violation is what Drift's own `new_violations` counts: not in drift.lock
# (`baselined`), not covered by a drift-ignore (`suppressed`), not unsure (its
# file depends on a file that was not parsed) and not held back by the neighbour
# gate. `unsure` and `suppressed_neighbour` are omitted when false.
def new_violations:
  (.violations // [])
  | map(select((.baselined | not) and (.suppressed | not)
               and ((.unsure // false) | not) and ((.suppressed_neighbour // false) | not)));

def total: [.[] | length] | add // 0;

(new_violations) as $new
| {
    # Mode is `block` or `advise`; anything that does not block is counted as advice.
    "block": ($new | map(select(.mode == "block")) | length),
    "advise": ($new | map(select(.mode != "block")) | length),
    # Security findings not in the committed baseline, of a kind it sets to fail.
    "security-findings": ((.security.added // {}) | total),
    # Not in the baseline but of a kind that advises, and, with no baseline, what
    # the change adds that a baseline would hold.
    "security-advice": (((.security.advised // {}) | total) + ((.security_advice // []) | length)),
    # Files Drift could not read, here or at the merge base: their violations are
    # unknown, not absent.
    "unchecked": (((.unchecked // []) | length) + ((.diff.base_unchecked // []) | length)),
    # PR mode: new violations outside the diff, not reported (`drift check` lists them).
    "outside-diff": (.diff.new_outside_diff // 0)
  }
| to_entries[]
| "\(.key)=\(.value)"
