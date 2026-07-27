# Contract field → enforcement site (T28)

Every field a `RepoContract` can carry, and what actually acts on it. A field the schema accepts
but nothing enforces is an overclaim: an operator can write it, Drift will store it, and it will
change nothing — silently.

Three of the seven unenforced fields below were found by the tripwire test rather than by reading
the interface, which is the argument for having the tripwire.

Counts are non-schema references (excluding `domain.ts`, `schemas.ts`, `contracts.ts`) across the
CLI, query, MCP and engine.

## Enforced

| Field | Sites | Enforced where |
|---|---|---|
| `conventions` | many | Engine rules + CLI scoping; the core wedge |
| `conventions[].matcher` | many | `is_forbidden_import` (engine), `isForbiddenImport` (CLI mirror) |
| `conventions[].scope` | many | `filesForConvention`, gated on engine route-role facts |
| `conventions[].exceptions` | — | CLI: `isExceptedPath` / `isExceptedImport`, pinned by T27 |
| `conventions[].governance` | — | CLI approval gates |
| `waivers` | — | CLI: `findContractWaiverForImport`, `waiverRequiresReapproval`, pinned by T27 |
| `context_egress` | 44 | `authorizeContextExport`, applied to the walk and to requested paths; pinned by T29 |
| `required_checks` | 33 | `drift checks run` / release proof |
| `safe_commands` | 30 | Agent surfaces |
| `agent_permissions` | 27 | Governance gates |
| `risky_areas` | 17 | Preflight ranking |
| `agent_contracts` | 17 | `run-check.ts` file-role and boundary rules |
| `rejected_inferences` | 11 | Candidate suppression on rescan |

## Declared but not enforced

These appear **only** in `schemas.ts` and `domain.ts`. Nothing reads them.

| Field | Status |
|---|---|
| `enforcement_policy` | **No reader anywhere.** The name reads as the control for how enforcement behaves; writing it does nothing. The most misleading of the set. |
| `active_convention_rule_ids` | No reader anywhere. An operator can pin a rule set and Drift will ignore it. |
| `beta_claim_profile` | No reader. Implies claim scoping is configurable per contract; it is not. |
| `active_semantic_capability_ids` | No reader. Pairs with `semantic_capability_contract_version`, also inert. |
| `architecture_contract_id` | Present on architecture *schemas*, but never read from `RepoContract`. |
| `architecture_contract_fingerprint` | No reader. Cannot detect the drift it names. |
| `semantic_capability_contract_version` | No reader. Declares a capability contract nothing checks. |

`layer_architecture` is a near-miss: it is **written** by `contract-materialization.ts` (defaulted
from accepted conventions) but never read back to enforce anything. It is materialized state, not
a control.

## Why this matters more than it looks

`enforcement_policy` and `active_convention_rule_ids` are the sharpest examples. Their names
promise that an operator can govern how enforcement behaves and restrict which rules are active.
Writing either produces no error and no effect, so a team could believe they had scoped
enforcement while every rule kept running — or believe a rule was active when it was not.

This is the same shape as F3 and A4: a confident-looking declaration with nothing behind it. The
difference is that here the declaration is the *operator's*, which makes the silence harder to
notice, because they wrote it themselves and got no complaint.

## Recommendation — not implemented, needs a decision

Reject unenforced fields at `contract import`, naming them, the way the compatibility check
already names `repo_id_mismatch`. That turns a silent no-op into a visible refusal.

Not done here because each field needs a call the schema cannot make for us:

- **`enforcement_policy`, `active_convention_rule_ids`** — implement (both are reasonable
  features whose names describe real needs) or remove. Rejecting a field people may already have
  in committed contracts is a breaking change.
- **`beta_claim_profile`, `active_semantic_capability_ids`** — almost certainly forward
  declarations; mark experimental or drop.
- **`architecture_contract_id` / `_fingerprint` / `semantic_capability_contract_version`** —
  these look like forward-declarations for work in progress. If so they should be marked
  experimental rather than rejected, so the schema stops implying they do something.

Either way the current state is the worst of the options: accepted, stored, and inert.
