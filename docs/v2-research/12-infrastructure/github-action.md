# GitHub Action

## Location
`actions/drift-action/`

## What It Is
A composite GitHub Action that installs `driftdetect-ci` and runs PR analysis. Users add it to their workflows for automated pattern checking.

## Files
- `action.yml` — Action definition
- `README.md` — Usage documentation

## Inputs

| Input | Required | Default | Purpose |
|-------|----------|---------|---------|
| `github-token` | Yes | `${{ github.token }}` | GitHub API access |
| `fail-on-violation` | No | `false` | Fail action on violations |
| `post-comment` | No | `true` | Post PR comment |
| `create-check` | No | `true` | Create check run |
| `pattern-check` | No | `true` | Enable pattern checking |
| `impact-analysis` | No | `true` | Enable impact analysis |
| `constraint-verification` | No | `true` | Enable constraint verification |
| `security-boundaries` | No | `true` | Enable security boundary checking |
| `memory-enabled` | No | `true` | Enable Cortex memory |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | `pass`, `warn`, or `fail` |
| `summary` | Human-readable summary |
| `violations-count` | Total violation count |
| `drift-score` | Score 0-100 |
| `result-json` | Full JSON result |

## How It Works
1. Sets up Node.js 20
2. Installs `driftdetect-ci@latest` globally
3. Extracts PR number from `github.event.pull_request.number`
4. Runs `drift-ci analyze --pr <N> --owner <O> --repo <R> --json`
5. Parses JSON output with `jq`
6. Sets GitHub Action outputs
7. Exits with captured exit code if `fail-on-violation`

## Usage Example
```yaml
- name: Run Drift CI
  id: drift
  uses: dadbodgeoff/drift/actions/drift-action@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-violation: true
```

## v2 Considerations
- Action needs updating for v2 binary distribution
- Consider pre-built Docker action for faster startup
- May need Rust toolchain if v2 requires native compilation
- Output schema stays the same — backward compatible
