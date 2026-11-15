You are checking whether a tool's proposed conventions for the repository **cosmos-transfer1** (https://github.com/nvidia-cosmos/cosmos-transfer1 at `5005e823dbd478ad8e51f6bc28a913a13a994b5f`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/cosmos-transfer1

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/66fbd027-1414-46a9-b0c9-d76ff7c92137/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

## Decide, for each documented item

**`match`**: compare against the **shown** proposals only.

- **FULL**: one shown proposal (or several together) states the same requirement on substantially the same scope. It would flag essentially the same violations as the documented rule.
  - Wording does not matter.
  - A proposal that lists alternatives ("wrapped in A() or B()") matches a document that allows the same alternatives.
  - Scope matches when the proposal's group covers most of the documented scope. If the document's scope is a whole package and the proposal covers the part of it where the rule actually applies, that also matches.
- **PARTIAL**: one of these:
  - the same requirement on a clearly narrower scope (one sub-area of several the document names);
  - only part of a compound requirement;
  - the same intent stated more weakly, so it would catch only some of the documented violations.
- **NONE**: anything else. Being about the same topic is not a match. For example, "routes call `getSession()`" does not match "routes must be wrapped in `withAuth()`".

**`pool_match`**: the same question, over shown **and** pool proposals. It is always at least as good as `match`.

**`followed`**: does the code follow the documented item?

1. Open two or three files in the item's scope.
2. Use grep to estimate how widely it is followed.
3. Answer `yes`, `mostly` (a few exceptions), `no`, or `unknown` (the scope has no code, or you cannot tell).

## Documented items

- **cosmos-transfer1#R01** (avoid, must; .flake8:3): In all Python files outside third_party/, code must not trigger flake8-bugbear B checks (likely bugs and design problems such as mutable default arguments, bare except, loop-variable closures).  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R02** (avoid, must; .flake8:3): In all Python files outside third_party/, code must not trigger flake8 C checks (mccabe complexity C901 and flake8-comprehensions C4xx, e.g. unnecessary list/dict/set calls or comprehensions).  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R03** (other, must; .flake8:3): In all Python files outside third_party/, code must not trigger pycodestyle E errors other than the explicitly ignored codes.  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R04** (avoid, must; .flake8:3): In all Python files outside third_party/, code must not trigger pyflakes F checks (e.g. undefined names, unused imports, redefinitions) other than the explicitly ignored codes.  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R05** (avoid, must; .flake8:2-3): In all Python files outside third_party/, logging calls must not build their message with str.format(), %-formatting, string concatenation or f-strings (flake8-logging-format G checks); pass arguments to the logger instead.  
  scope: **/*.py (excluding third_party/) logging calls
- **cosmos-transfer1#R06** (avoid, must; .flake8:3): In all Python files outside third_party/, str.format() format strings must not use unindexed/implicit positional fields or mismatched arguments (flake8-string-format P checks).  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R07** (avoid, must; .flake8:3): In all Python files outside third_party/, code must not trigger flake8-simplify SIM1xx checks (e.g. nested ifs that can be merged, needless if/else returning bools, use of contextlib.suppress, combinable isinstance calls).  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R08** (typing, must; .flake8:3): In all Python files outside third_party/, code must not trigger flake8-mypy T4xx type-checking errors.  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R09** (other, must; .flake8:3): In all Python files outside third_party/, code must not trigger pycodestyle W warnings other than the explicitly ignored codes.  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R10** (avoid, must; .flake8:3): In all Python files outside third_party/, code must not trigger flake8-bugbear opinionated B9xx checks (e.g. B901 return in generator, B902 bad first argument to method, B903 data class candidates, B904 raise without from inside except, B950 line too long).  
  scope: **/*.py (excluding third_party/) all files
- **cosmos-transfer1#R35** (import_restriction, must; .pre-commit-config.yaml:41-44): In all Python files, imports of first-party modules must be absolute (e.g. from cosmos_transfer1.utils import ...) and must not use relative imports (from . / from ..).  
  scope: **/*.py all files
- **cosmos-transfer1#R41** (file_layout, must; scripts/ip_header.py:27-52,100-108,115-126): In cosmos_transfer1/auxiliary, cosmos_transfer1/diffusion and cosmos_transfer1/utils, every .py and .yaml file (except __init__.py and paths containing 'prompt_upsampler') must begin with the '#'-commented NVIDIA SPDX Apache-2.0 license header (SPDX-FileCopyrightText ... 2025 NVIDIA CORPORATION & AFFILIATES, SPDX-License-Identifier: Apache-2.0, Apache License text) as its first lines, followed by exactly one blank line and then non-blank content.  
  scope: cosmos_transfer1/{auxiliary,diffusion,utils}/**/*.{py,yaml} (excluding __init__.py, *prompt_upsampler*)
- **cosmos-transfer1#R42** (file_layout, must; scripts/ip_header.py:53-54,94): In cosmos_transfer1/auxiliary, cosmos_transfer1/diffusion and cosmos_transfer1/utils, every .c, .cpp, .cu, .h and .cuh file (except paths containing 'prompt_upsampler') must begin with the NVIDIA SPDX Apache-2.0 license header as a /* ... */ block comment with ' * ' line prefixes, followed by one blank line.  
  scope: cosmos_transfer1/{auxiliary,diffusion,utils}/**/*.{c,cpp,cu,h,cuh}

## Proposals shown to the user

```text
[D-fd9569] files in cosmos_transfer1/** do not import from scripts/** (declared dependencies, and lazy loads of peer or optional dependencies, excepted)
    evidence: 228/229 (lower bound 0.98, lift 3.0)
    example:  cosmos_transfer1/auxiliary/depth_anything/inference/depth_anything_pipeline.py#(file)
    outlier:  cosmos_transfer1/distillation/scripts/save_negative_prompt.py:1 (file)
```

```text
[D-877f3b] classes in cosmos_transfer1/diffusion/training/modules/** extend nn.Module
    evidence: 20/21 (lower bound 0.77, lift 2.2)
    example:  cosmos_transfer1/diffusion/training/modules/attention.py#Attention
    outlier:  cosmos_transfer1/diffusion/training/modules/edm_sde.py:22 EDMSDE
```

```text
[D-3c82bf] functions in cosmos_transfer1/auxiliary/tokenizer/inference/** declare their return type
    evidence: 20/21 (lower bound 0.77, lift 1.8)
    example:  cosmos_transfer1/auxiliary/tokenizer/inference/image_cli.py#main
    outlier:  cosmos_transfer1/auxiliary/tokenizer/inference/utils.py:240 write_image
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "cosmos-transfer1#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
