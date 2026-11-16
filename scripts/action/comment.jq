# The pull request comment, from `drift check --format json` (the input) and, when
# the `security` input is on, `drift security --diff-base --json` ($sec[0]).
#
#   jq -f comment.jq --slurpfile sec <file or /dev/null> --argjson limit N \
#      --arg marker M --arg base B --arg sha S --arg run URL check.json
#
# Prints {"say": bool, "body": markdown}. `say` is false when there is nothing to
# report: no new violation, no security finding, no file left unchecked.
#
# Every string that comes from the repository under review (paths, symbols, rule
# text, keys, branch names) is data. It goes through `lit`: shown in a <code>
# element (where GitHub links no @mention or #reference) with every ASCII
# punctuation character written as a numeric character reference, so no
# markdown, HTML, table pipe or autolink can be made of it.

# Control characters, and the invisible ones that reorder or hide text, become spaces.
def hidden: . < 32 or . == 127 or (. >= 8203 and . <= 8207) or (. >= 8232 and . <= 8238) or (. >= 8294 and . <= 8297) or . == 65279;
def punct: (. >= 33 and . <= 47) or (. >= 58 and . <= 64) or (. >= 91 and . <= 96) or (. >= 123 and . <= 126);
def esc($n):
  (tostring | explode) as $c
  | (if ($c | length) > $n then $c[0:$n] + [8230] else $c end)
  | map(if hidden then "&#32;" elif punct then "&#\(.);" else [.] | implode end)
  | "<code>" + join("") + "</code>";
def lit($s; $n): $s | esc($n);
def lit: esc(200);

def plural($n; $one; $many): "\($n) \(if $n == 1 then $one else $many end)";
def at($p; $l): lit("\($p):\($l)"; 200);

# Rows of a table, capped at $limit, with the rest counted.
def capped($rows; $what):
  ($rows | length) as $n
  | ($rows[0:$limit] | join("\n"))
    + (if $n > $limit then "\n\n…and \($n - $limit) more \($what) not listed here: the job's log and summary list every one." else "" end);

def new_violations:
  (.violations // [])
  | map(select((.baselined | not) and (.suppressed | not)
               and ((.unsure // false) | not) and ((.suppressed_neighbour // false) | not)));

($sec[0] // null) as $s
| new_violations as $new
| ($new | map(select(.mode == "block")) | length) as $block
| (($new | length) - $block) as $advise
| ($new
   | sort_by([(if .mode == "block" then 0 else 1 end), .path, .line, .id])
   | map("| \(if .mode == "block" then "**block**" else "advise" end) | \(at(.path; .line))\(if (.symbol // "") == "" then "" else " " + lit(.symbol; 120) end) | \(lit(.summary; 200)) \(lit(.id; 40)) |")
  ) as $vrows
# Security rows: [order, where, row]. Failing baseline findings first; a place
# listed once (the first reading of it), so one entry point is not shown twice.
| ([ ((.security.added // {}) | to_entries[] | .key as $k | .value[]
       | [0, .at, "| **fails** | \(lit($k; 40)) | \(lit(.at; 200)) | \(lit(.key; 200)) |"]),
     ((.security.advised // {}) | to_entries[] | .key as $k | .value[]
       | [1, .at, "| advice | \(lit($k; 40)) | \(lit(.at; 200)) | \(lit(.key; 200)) |"]),
     ((.security_advice // [])[]
       | [1, .at, "| advice | \(lit(.kind; 40)) | \(lit(.at; 200)) | \(lit(.key; 200)) \(lit(.read; 160)) |"]),
     (if $s == null then empty else
       (($s.guard_gaps // [])[]
          | [2, "\(.entry.path):\(.entry.line)", "| review | guard-gap | \(at(.entry.path; .entry.line)) | \(lit(.entry.symbol; 120)) lacks \(lit(.guard; 120)), which \(.with_guard) of \(.members) entry points around it have |"]),
       (($s.unguarded_reaching // [])[]
          | [2, "\(.path):\(.line)", "| review | unguarded-reaching | \(at(.path; .line)) | \(lit(.symbol; 120)): no guard found, reaches \(lit([(.reaches // [])[] | .kind] | unique | join(", "); 120)) |"]),
       (($s.added_without_guard // [])[]
          | [2, "\(.path):\(.line)", "| review | no-guard | \(at(.path; .line)) | \(lit([.method, .route, .symbol] | map(select(. != null)) | join(" "); 200)): new entry point, no guard found |"]),
       (($s.sinks // [])[]
          | [2, "\(.path):\(.line)", "| review | risky | \(at(.path; .line)) | \(lit(.kind; 60)) in \(lit(.symbol; 120)) |"]),
       (($s.leaks // [])[]
          | [2, ((.clients // [])[0] // ""), "| review | leak | \(lit((.clients // [])[0] // ""; 200)) | reaches \(lit(.reaches; 200))\(if ((.clients // []) | length) > 1 then " (and \(((.clients | length) - 1)) more client files)" else "" end) |"]),
       (($s.now_public // [])[]
          | [2, "\(.path):\(.line)", "| review | now-public | \(at(.path; .line)) | \(lit(.symbol; 120)) is now internet-facing |"])
     end)
   ]
   | reduce .[] as $r ({seen: {}, rows: []};
       if .seen[$r[1]] then . else .seen[$r[1]] = true | .rows += [$r] end)
   | .rows | sort_by(.[0]) | map(.[2])
  ) as $srows
| ((.unchecked // []) + (.diff.base_unchecked // [])) as $unread
| ($new | length) as $nv
| ($srows | length) as $ns
| ($nv > 0 or $ns > 0 or ($unread | length) > 0) as $say
| (if $base == "" then "the whole repository" else "what this pull request introduces (against \(lit($base; 120)))" end) as $scope
| {
    say: $say,
    body: ([
      $marker,
      "### Drift",
      "",
      (if $say then
        "Drift checked \($scope) at `\($sha[0:12])`."
      else
        "Nothing to report at `\($sha[0:12])`: no new violation of an accepted convention and no security finding in \($scope). Anything listed here before is resolved."
      end),
      (if $nv > 0 then
        "",
        "**Conventions: \(plural($nv; "new violation"; "new violations"))**: \($block) in block mode (these fail the check), \($advise) in advise mode.",
        "",
        "| Mode | Where | Rule |",
        "| --- | --- | --- |",
        capped($vrows; "violations")
      else empty end),
      (if $ns > 0 then
        "",
        "**Security: \(plural($ns; "finding"; "findings"))** (\"fails\": not in the committed security baseline, of a kind it sets to fail; the others are facts for review).",
        "",
        "| | Kind | Where | What |",
        "| --- | --- | --- | --- |",
        capped($srows; "findings")
      else empty end),
      (if ($unread | length) > 0 then
        "",
        "**Not checked: \(plural($unread | length; "file"; "files")).** Drift could not read them (no stack large enough could be reserved), so their violations are unknown, not absent: \(($unread[0:5] | map(lit) | join(", ")))\(if ($unread | length) > 5 then ", …" else "" end)"
      else empty end),
      (if (.diff.new_outside_diff // 0) > 0 then
        "",
        "\(plural(.diff.new_outside_diff; "new violation"; "new violations")) outside the diff are not listed (`drift check` lists them)."
      else empty end),
      "",
      "<sub>Updated on every push by the Drift Action\(if $run == "" then "" else " ([run](\($run)))" end). Reproduce with `drift check\(if $base == "" then "" else " --diff-base origin/<base branch>" end)`.</sub>"
    ] | join("\n"))
  }
