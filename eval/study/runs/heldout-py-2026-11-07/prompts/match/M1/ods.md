You are checking whether a tool's proposed conventions for the repository **ods** (https://github.com/Osmantic/ODS at `891f722ab7cca7715fa719cff5f8b3ac3b09c1ac`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/ods

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/addb3501-5571-49e7-a80b-2b3e5bc38878/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **ods#R02** (layering, must; CLAUDE.md:102): In ods/installers/lib/*.sh, files must only define pure functions (no side effects at source time); executable install steps belong in ods/installers/phases/*.sh.  
  scope: ods/installers/lib/*.sh installer libraries
- **ods#R03** (file_layout, must; CLAUDE.md:102): In ods/installers/lib/*.sh and ods/installers/phases/*.sh, every module must start with the standardized header containing Purpose, Expects, Provides and Modder notes fields.  
  scope: ods/installers/{lib,phases}/*.sh installer modules
- **ods#R04** (calls, must; CLAUDE.md:102): In ods/install-core.sh, the orchestrator must set INSTALL_PHASE before sourcing each phase file.  
  scope: ods/install-core.sh orchestrator
- **ods#R05** (file_layout, must; CLAUDE.md:106): In ods/extensions/services/<name>/, every service directory must contain a manifest.yaml defining its metadata.  
  scope: ods/extensions/services/*/ service directories
- **ods#R06** (file_layout, must; CLAUDE.md:106): In ods/extensions/services/{llama-server,open-webui,dashboard,dashboard-api}/, core services must have only a manifest.yaml and no compose.yaml; their compose definitions live in ods/docker-compose.base.yml.  
  scope: ods/extensions/services/<core service>/
- **ods#R07** (other, must; CLAUDE.md:114): In ods/docker-compose*.yml and extension compose.yaml files, published service ports must bind to 127.0.0.1 by default.  
  scope: ods/docker-compose*.yml, ods/extensions/services/*/compose*.yaml
- **ods#R08** (other, must; CLAUDE.md:122): In all Bash scripts, the script must enable `set -euo pipefail`.  
  scope: **/*.sh Bash scripts
- **ods#R10** (avoid, should; CLAUDE.md:122): In shell scripts, code should use POSIX-compatible constructs and must avoid GNU-only flags of date and grep for macOS portability.  
  scope: **/*.sh shell scripts
- **ods#R12** (import_restriction, must; CLAUDE.md:123): In Python services, HTTP APIs must be built with FastAPI.  
  scope: ods/extensions/services/*/ Python API services
- **ods#R13** (testing, must; CLAUDE.md:123): In Python test files, tests must be written for pytest.  
  scope: **/tests/**/*.py Python tests
- **ods#R14** (render, must; CLAUDE.md:124): In ods/extensions/services/dashboard/src/**, React components must be styled with Tailwind CSS utility classes.  
  scope: ods/extensions/services/dashboard/src/** React components
- **ods#R15** (error_handling, must; CLAUDE.md:132): In all Python code, code must not use broad or silent catches such as `except Exception: pass` or `except Exception: return None`.  
  scope: **/*.py
- **ods#R16** (error_handling, must; CLAUDE.md:132): In all code, code must not implement retry/backoff loops.  
  scope: all source files
- **ods#R17** (error_handling, must; CLAUDE.md:132): In all code, code must not implement fallback chains that try alternative paths after a failure.  
  scope: all source files
- **ods#R18** (error_handling, must; CLAUDE.md:133): In Python I/O boundary code (health checks, network calls, file I/O), exception handlers must catch only specific exception types (e.g. asyncio.TimeoutError, aiohttp.ClientConnectorError), each mapping to a distinct status.  
  scope: **/*.py I/O boundary code
- **ods#R19** (error_handling, must; CLAUDE.md:134): In internal (non-boundary) functions, code must not add try/except error handling; exceptions must propagate.  
  scope: **/*.py internal functions
- **ods#R20** (error_handling, should; CLAUDE.md:135): In Bash scripts, code should use `trap` handlers to add error context (as in ods/install-core.sh).  
  scope: **/*.sh Bash scripts
- **ods#R21** (calls, must; CLAUDE.md:135): In Bash scripts, a tolerated command failure must be logged with `|| warn "..."` rather than silently ignored.  
  scope: **/*.sh Bash scripts
- **ods#R22** (avoid, must; CLAUDE.md:135): In Bash scripts, new code must not use `|| true` or `2>/dev/null` without an adjacent comment explaining why the failure is safe to ignore.  
  scope: **/*.sh Bash scripts
- **ods#R23** (error_handling, must; CLAUDE.md:136): In FastAPI routers (ods/extensions/services/dashboard-api/routers/*.py), handlers must validate input and signal errors by raising HTTPException.  
  scope: ods/extensions/services/dashboard-api/routers/*.py route handlers
- **ods#R24** (error_handling, must; CLAUDE.md:136): In Python code, functions must not return None to signal an error.  
  scope: **/*.py
- **ods#R25** (testing, must; CLAUDE.md:137): In test files, tests must not catch exceptions to avoid failure.  
  scope: test files (tests/**)
- **ods#R28** (other, should; CLAUDE.md:144): In all code, functions should stay at or under 30 lines, nesting at or under 3 levels, and files at or under 500 lines; larger ones should be split.  
  scope: all source files
- **ods#R30** (layering, must; CLAUDE.md:149): In the installer, I/O and side effects must live in ods/installers/phases/*.sh (imperative shell), not in ods/installers/lib/*.sh (pure core).  
  scope: ods/installers/**
- **ods#R33** (calls, must; CLAUDE.md:156): In FastAPI handlers, dependencies must be injected with Depends(), and in Bash scripts via environment variables, rather than hardcoded.  
  scope: ods/extensions/services/dashboard-api/**/*.py route handlers; **/*.sh
- **ods#R34** (layering, must; ARCHITECTURE.md:167): In ods/installers/lib/*.sh, files must contain only pure functions with no side effects.  
  scope: ods/installers/lib/*.sh
- **ods#R35** (other, must; ARCHITECTURE.md:286): In compose files, service ports must bind to 127.0.0.1, and port assignments must come from ods/config/ports.json.  
  scope: ods/docker-compose*.yml, ods/extensions/services/*/compose*.yaml
- **ods#R36** (other, must; ARCHITECTURE.md:312): In ods/extensions/services/*/manifest.yaml, manifests must conform to ods/extensions/schema/service-manifest.v1.json.  
  scope: ods/extensions/services/*/manifest.yaml
- **ods#R37** (error_handling, must; ARCHITECTURE.md:333): In all code, code must not use broad catches or silently swallow errors; Bash scripts must use `set -euo pipefail`.  
  scope: all source files
- **ods#R38** (testing, must; CONTRIBUTING.md:74): In ods/tests/** and ods/extensions/services/*/tests/**, every test file must be executed by a CI workflow or listed in ods/tests/ci-suite.txt, or recorded with a reason in ods/tests/ci-not-run.txt.  
  scope: ods/tests/**, ods/extensions/services/*/tests/** test files
- **ods#R39** (typing, must; CONTRIBUTING.md:85): In ods/extensions/services/{dashboard-api,token-spy,privacy-shield}/ and ods/scripts/*.py, code must not introduce mypy errors beyond .github/mypy-baseline.json.  
  scope: ods/extensions/services/{dashboard-api,token-spy,privacy-shield}/**/*.py, ods/scripts/*.py
- **ods#R40** (other, must; CONTRIBUTING.md:116): In copied or vendored files, upstream copyright and license notices must be retained.  
  scope: copied third-party files (e.g. ods/vendor/**)
- **ods#R42** (calls, must; ods/CONTRIBUTING.md:92): In shell scripts that run on macOS, code must not use GNU-only sed/date flags and must use the `_sed_i` and `_now_ms` helpers for in-place sed and millisecond timestamps.  
  scope: ods/**/*.sh shell scripts
- **ods#R43** (avoid, must; ods/CONTRIBUTING.md:94): In Bash scripts, code must not use associative arrays (declare -A) unless guarded by a Bash 4+ version check.  
  scope: ods/**/*.sh Bash scripts
- **ods#R44** (calls, should; ods/CONTRIBUTING.md:95): In shell scripts, path handling should use the helpers in ods/installers/lib/path-utils.sh.  
  scope: ods/**/*.sh shell scripts
- **ods#R45** (other, must; ods/CONTRIBUTING.md:134): In all code, referenced functions must be defined, and shell variables must not be used in Dockerfile/compose exec-form commands where they will not expand.  
  scope: all source files, Dockerfiles and compose files
- **ods#R46** (testing, must; ods/CONTRIBUTING.md:136): In test files, tests must not skip() assertions for features that do not exist yet.  
  scope: test files
- **ods#R47** (other, must; ods/CONTRIBUTING.md:144): In Bash scripts, `set -euo pipefail` must appear at the top of the file.  
  scope: ods/**/*.sh Bash scripts
- **ods#R48** (other, must; ods/CONTRIBUTING.md:144): In Bash scripts, variable expansions must be quoted.  
  scope: ods/**/*.sh Bash scripts
- **ods#R51** (layering, must; ods/docs/INSTALLER-ARCHITECTURE.md:56): In ods/installers/lib/*.sh, each file must only define functions and constants with no top-level side effects.  
  scope: ods/installers/lib/*.sh
- **ods#R52** (file_layout, must; ods/docs/INSTALLER-ARCHITECTURE.md:61): In ods/installers/phases/*.sh, each phase file must run its step's logic at top level when sourced.  
  scope: ods/installers/phases/*.sh
- **ods#R53** (render, must; ods/docs/INSTALLER-ARCHITECTURE.md:90): In installer UI code, plain mode must not clear the screen, ring the terminal bell, or emit cursor-motion escape sequences.  
  scope: ods/installers/lib/ui.sh and platform UI helpers
- **ods#R54** (file_layout, must; ods/docs/INSTALLER-ARCHITECTURE.md:103): In ods/installers/lib/*.sh and ods/installers/phases/*.sh, each file must begin with the standard header block (`#!/bin/bash`, `ODS Installer — <Module Name>`, Part of, Purpose, Expects, Provides, Modder notes).  
  scope: ods/installers/{lib,phases}/*.sh
- **ods#R55** (file_layout, must; ods/docs/INSTALLER-ARCHITECTURE.md:144): In ods/installers/phases/, new phases must be numbered `NN-name.sh` files with the standard header and must be sourced from ods/install-core.sh in order.  
  scope: ods/installers/phases/*.sh
- **ods#R56** (other, must; ods/docs/INSTALLER-ARCHITECTURE.md:164): In OpenCode config writers, configs routed through LiteLLM must use LITELLM_KEY, while direct llama-server paths use `no-key`.  
  scope: OpenCode config writers (phases/07-devtools.sh, macOS/Windows installers, upgrade scripts)
- **ods#R57** (other, must; ods/docs/INSTALLER-ARCHITECTURE.md:166): In every writer of config/litellm/local.yaml, the config must set extra_body.chat_template_kwargs.enable_thinking: false and reference the key only as os.environ/LLAMA_SERVER_API_KEY, never as a literal.  
  scope: LiteLLM config writers (scripts/render-runtime-configs.py, installers/windows/lib/env-generator.ps1, scripts/bootstrap-upgrade.sh)
- **ods#R58** (layering, should; ods/docs/INSTALLER_PHASE_CONTRACTS.md:12): In ods/installers/lib/*, files should define only functions and constants.  
  scope: ods/installers/lib/*
- **ods#R61** (render, must; ods/docs/INSTALLER_PHASE_CONTRACTS.md:25): In installer output code, non-TTY, CI, GUI and NO_COLOR paths must not emit screen clearing, terminal bells or cursor-motion animation.  
  scope: ods/installers/** UI code
- **ods#R63** (other, should; ods/docs/LINUX-PORTABILITY.md:10): In compose files, bind mounts should carry the `:z` SELinux label.  
  scope: ods/docker-compose*.yml, ods/extensions/services/*/compose*.yaml
- **ods#R64** (other, must; ods/docs/EXTENSIONS.md:283): In ods/extensions/services/*/manifest.yaml, the root must set schema_version: ods.services.v1.  
  scope: ods/extensions/services/*/manifest.yaml
- **ods#R65** (other, must; ods/docs/EXTENSIONS.md:291): In ods/extensions/services/*/manifest.yaml, the service section must define id, name, port and health.  
  scope: ods/extensions/services/*/manifest.yaml
- **ods#R66** (other, must; ods/docs/EXTENSIONS.md:297): In ods/extensions/services/*/manifest.yaml, each feature entry must define id, name, description, icon, category, requirements and priority.  
  scope: ods/extensions/services/*/manifest.yaml
- **ods#R67** (other, must; ods/docs/EXTENSIONS.md:300): In ods/extensions/services/*/manifest.yaml, services that consume an LLM must declare a service.llm block (consumes, route, pinning, probe).  
  scope: ods/extensions/services/*/manifest.yaml
- **ods#R68** (other, must; ods/docs/EXTENSIONS.md:516): In ods/extensions/services/dashboard-api/routers/extensions.py and ods/scripts/resolve-compose-stack.sh, the `# >>> shared compose policy >>>` block must be byte-identical.  
  scope: ods/extensions/services/dashboard-api/routers/extensions.py, ods/scripts/resolve-compose-stack.sh
- **ods#R69** (file_layout, should; ods/docs/EXTENSIONS.md:638): In ods/extensions/services/*/, extension files should be ASCII and small, with one service per directory.  
  scope: ods/extensions/services/*/
- **ods#R70** (calls, must; ods/docs/EXTENSIONS.md:640): In shell scripts that load .env files, code must source lib/safe-env.sh and call load_env_file, and must not use eval or `export $(grep ... .env | xargs)`.  
  scope: ods/**/*.sh scripts loading .env
- **ods#R71** (other, should; ods/docs/EXTENSIONS.md:309): In extension app config, OpenAI-protocol apps should target the gateway alias (http://litellm:4000/v1, model ods/current) and should not persist GGUF filenames, catalog ids or concrete model names.  
  scope: ods/extensions/services/*/ and ods/extensions/library/** app config
- **ods#R72** (avoid, must; ods/docs/SWAP-SAFE-EXTENSIONS.md:35): In extension app config, code must not persist GGUF filenames, llama-server model names or catalog ids; it must use the ods/current gateway alias.  
  scope: ods/extensions/** LLM-consuming app config
- **ods#R73** (other, must; ods/docs/SWAP-SAFE-EXTENSIONS.md:70): In manifest.yaml, an llm block with route: direct must declare pinning: dynamic and a probe.  
  scope: ods/extensions/services/*/manifest.yaml
- **ods#R74** (other, must; ods/docs/COMPOSE_RESOLVER_CONTRACTS.md:28): In compose files, every service named in depends_on must be defined in every resolved compose file set that includes the dependent service.  
  scope: ods/docker-compose*.yml, ods/extensions/services/*/compose*.yaml
- **ods#R75** (other, must; ods/docs/COMPOSE_RESOLVER_CONTRACTS.md:32): In compose files, host ports must be declared through the port contract (ods/config/ports.json and manifest port env vars) rather than hardcoded.  
  scope: ods/docker-compose*.yml, ods/extensions/services/*/compose*.yaml
- **ods#R76** (other, should; ods/docs/COMPOSE_RESOLVER_CONTRACTS.md:35): In GPU overlay compose files (docker-compose.{amd,nvidia,apple}.yml, compose.{amd,nvidia}.yaml), overlays should only change runtime flags, devices, images or build targets for their backend.  
  scope: ods/docker-compose.{amd,nvidia,apple,cpu}.yml, ods/extensions/services/*/compose.{amd,nvidia}.yaml
- **ods#R77** (other, should; ods/docs/COMPOSE_RESOLVER_CONTRACTS.md:94): In service config, service-to-service traffic should use container DNS names and internal ports, not host ports.  
  scope: compose files and service config
- **ods#R78** (file_layout, must; ods/docs/COMPOSE_RESOLVER_CONTRACTS.md:96): In the repo, host-facing port defaults must be defined in ods/config/ports.json and service manifests.  
  scope: ods/config/ports.json, ods/extensions/services/*/manifest.yaml
- **ods#R79** (naming, should; ods/extensions/services/dashboard/eslint.config.js:71): In ods/extensions/services/dashboard/**/*.{js,jsx}, code should not have unused variables; unused function arguments are allowed only when prefixed with `_`.  
  scope: ods/extensions/services/dashboard/**/*.{js,jsx}
- **ods#R80** (other, must; .github/workflows/lint-python.yml:30): In ods/**/*.py, code must pass ruff pycodestyle error rules (E).  
  scope: ods/**/*.py
- **ods#R81** (other, must; .github/workflows/lint-python.yml:30): In ods/**/*.py, code must pass ruff Pyflakes rules (F): no unused imports/variables, undefined names, etc.  
  scope: ods/**/*.py
- **ods#R82** (other, must; .github/workflows/lint-python.yml:30): In ods/**/*.py, code must pass ruff pycodestyle warning rules (W).  
  scope: ods/**/*.py
- **ods#R88** (other, must; .github/workflows/lint-python.yml:38): In ods/**/*.py, code must parse under Python 3.9 syntax (no 3.10+/3.12-only syntax such as backslashes inside f-string expressions).  
  scope: ods/**/*.py
- **ods#R89** (typing, must; .github/workflows/type-check-python.yml:81): In dashboard-api, token-spy, privacy-shield and ods/scripts/*.py, mypy also type-checks the bodies of unannotated functions.  
  scope: ods/extensions/services/{dashboard-api,token-spy,privacy-shield}/**/*.py, ods/scripts/*.py
- **ods#R92** (other, must; .github/workflows/lint-shell.yml:59): In ods/**/*.sh, ods/ods-cli and ods/bin/ods-pixel-approve, code must have no error-severity ShellCheck findings.  
  scope: ods/**/*.sh, ods/ods-cli, ods/bin/ods-pixel-approve
- **ods#R95** (avoid, must; .github/workflows/lint-shell.yml:71): In ods/**/*.sh and *.bash (except scripts/demo-offline.sh and tests/test-extension-audit.sh), curl calls must not target http://localhost:; they must use 127.0.0.1.  
  scope: ods/**/*.{sh,bash}
- **ods#R96** (other, must; ods/.github/workflows/lint-shell.yml:43): In ods/**/*.sh (excluding vendor/pixel), code must have no ShellCheck findings at warning severity or above, following sourced files (-x).  
  scope: ods/**/*.sh excluding ods/vendor/pixel/**
- **ods#R97** (other, must; ods/.github/workflows/lint-shell.yml:31): In ods/**/*.sh (excluding vendor/pixel), every script must pass `bash -n` syntax checking.  
  scope: ods/**/*.sh excluding ods/vendor/pixel/**
- **ods#R105** (avoid, must; ods/PSScriptAnalyzerSettings.psd1:12): In PowerShell scripts, code must not call ConvertTo-SecureString with -AsPlainText.  
  scope: ods/installers/**/*.ps1, install.ps1
- **ods#R109** (file_layout, must; ods/vendor/pixel/CONTRIBUTING.md:35): In ods/vendor/pixel, release pins must be edited only in RELEASE-MANIFEST.json and compatibility state only in OPENCLAW-COMPATIBILITY.json; derived files are generated by scripts/generate-release-files.mjs.  
  scope: ods/vendor/pixel/** release files
- **ods#R111** (other, must; .github/prompts/issue-to-pr.md:21): In Python files, new code must pass `ruff check` and `python -m py_compile`.  
  scope: **/*.py
- **ods#R113** (error_handling, must; .github/prompts/nightly-code-review.md:18): In all code, changes must not add error handling, fallbacks or defensive checks.  
  scope: all source files
- **ods#R114** (error_handling, must; .github/prompts/nightly-code-review.md:73): In Python code, changes must not add try/except blocks.  
  scope: **/*.py
- **ods#R115** (file_layout, should; .claude/commands/tdd.md:54): In ods/tests/, BATS tests for ods/installers/lib/<lib>.sh and phases go in ods/tests/bats-tests/<name>.bats, and tests for ods/scripts/<script>.sh or ods-cli features go in ods/tests/test-<name>.sh.  
  scope: ods/tests/** shell tests
- **ods#R116** (file_layout, should; .claude/commands/tdd.md:64): In ods/extensions/services/dashboard-api/tests/, tests for routers/<router>.py go in tests/test_<router>.py (and helpers.py, security.py, gpu.py in test_helpers.py, test_security.py, test_gpu.py).  
  scope: ods/extensions/services/dashboard-api/tests/*.py
- **ods#R117** (testing, must; .claude/commands/tdd.md:507): In Python test files, tests must not contain try/except blocks.  
  scope: **/tests/**/*.py
- **ods#R118** (testing, must; .claude/commands/test-coverage.md:439): In test files, tests must not call private/internal functions directly; they must test via the public interface.  
  scope: test files
- **ods#R119** (testing, must; .claude/commands/test-coverage.md:442): In test files, tests must not use sleep for synchronization.  
  scope: test files
- **ods#R120** (testing, must; .claude/commands/test-coverage.md:444): In test files, tests must not use `|| true` or other silent error suppression.  
  scope: test files
- **ods#R122** (testing, must; .claude/commands/test-coverage.md:449): In test files, code must not create test utility frameworks or test base classes.  
  scope: test files
- **ods#R123** (testing, must; .claude/commands/test-coverage.md:450): In test files, parameterized tests must not be used for fewer than 3 cases.  
  scope: test files
- **ods#R124** (testing, must; .claude/commands/test-coverage.md:483): In Python test files, tests must not mock Pydantic validation; ValidationError must propagate.  
  scope: **/tests/**/*.py
- **ods#R125** (testing, must; .claude/commands/test-coverage.md:484): In shell test files, tests must not use `2>/dev/null` to suppress errors.  
  scope: ods/tests/**/*.{sh,bats}

## Proposals shown to the user

```text
[D-80b356] functions in ods/** do not throw a bare Error
    evidence: 1892/1911 (lower bound 0.98, lift 11.0)
    example:  ods/bin/extension_assets.py#check_space
    outlier:  ods/extensions/library/services/umami/ods-config.mjs:1 environment
    outlier:  ods/extensions/services/n8n/n8n-prepare.mjs:143 ensureOwnerHash
    outlier:  ods/extensions/services/perplexica/patch-client-citations.js:31 patchClientChunk
    outlier:  ods/extensions/services/pixel-agent/host/access_mode_http.mjs:6 accessPort
    outlier:  ods/extensions/services/pixel-agent/host/access_mode_http.mjs:12 createAccessServer
    outlier:  ods/extensions/services/pixel-agent/host/access_mode_http.mjs:45 startNativeAccessServer
    outlier:  ods/extensions/services/pixel-agent/host/access_mode_relay.mjs:59 publicModelControl
    outlier:  ods/extensions/services/pixel-agent/host/access_mode_relay.mjs:102 requestAccessController
    outlier:  ods/extensions/services/pixel-agent/host/native_ingress_config.mjs:13 stageConfiguration
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:2037 atomicWriteJson
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:285 createLoopbackGatewayFetch
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:580 prepareSocketPath
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:1610 projectExamplePreview
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:1601 projectExampleProjects
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:1728 projectRestoreOptions
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:1709 projectRestoreReceipt
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:1563 projectRuntimeIdentity
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:488 readGatewayConfiguration
    outlier:  ods/extensions/services/pixel-agent/host/pixel_ingress.mjs:365 validateConfig
```

```text
[D-6e9535] HTTP handlers in ods/** are wrapped in security_scheme()
    evidence: 174/199 (lower bound 0.82, lift 12.8)
    example:  ods/extensions/services/dashboard-api/routers/agents.py#get_agent_metrics
    outlier:  ods/extensions/library/services/bark/server.py:142 health
    outlier:  ods/extensions/library/services/bark/server.py:220 list_voices
    outlier:  ods/extensions/library/services/bark/server.py:147 text_to_speech
    outlier:  ods/extensions/library/services/bark/server.py:181 text_to_speech_stream
    outlier:  ods/extensions/library/services/open-interpreter/server.py:116 chat
    outlier:  ods/extensions/library/services/open-interpreter/server.py:154 chat_stream
    outlier:  ods/extensions/library/services/open-interpreter/server.py:111 health
    outlier:  ods/extensions/services/dashboard-api/routers/auth.py:103 hermes_session
    outlier:  ods/extensions/services/dashboard-api/routers/auth.py:170 verify_session
    outlier:  ods/extensions/services/dashboard-api/routers/dashboard_session.py:142 dashboard_login
    outlier:  ods/extensions/services/dashboard-api/routers/dashboard_session.py:205 dashboard_logout
    outlier:  ods/extensions/services/dashboard-api/routers/dashboard_session.py:123 verify_dashboard_session
    outlier:  ods/extensions/services/dashboard-api/routers/magic_link.py:730 redeem_magic_link
    outlier:  ods/extensions/services/dashboard-api/routers/oauth_passthrough.py:400 oauth_callback
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:946 talk_approval
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:999 talk_attachment
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:1073 talk_audio_message
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:898 talk_message
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:914 talk_message_stream
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:874 talk_session
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:1090 talk_speak
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:841 talk_status
    outlier:  ods/extensions/services/privacy-shield/proxy.py:226 health
    outlier:  ods/extensions/services/privacy-shield/proxy.py:272 proxy
    outlier:  ods/extensions/services/privacy-shield/proxy.py:241 stats
```

```text
[D-c72ce2] files in ods/extensions/services/dashboard-api/** have a test file
    evidence: 94/104 (lower bound 0.83, lift 2.1)
    example:  ods/extensions/services/dashboard-api/agent_monitor.py#(file)
    outlier:  ods/extensions/services/dashboard-api/builtin_source_recipes.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/context_policy.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/dashboard_password.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/hermes_bridge.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/model_selection.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/pixel_connection_public.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/pixel_runtime_state.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/routers/auth.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/runtime_projection.py:1 (file)
    outlier:  ods/extensions/services/dashboard-api/settings.py:1 (file)
```

```text
[D-637b72] functions in ods/bin/model_switchboard/** declare their return type
    evidence: 25/26 (lower bound 0.81, lift 3.3)
    example:  ods/bin/model_switchboard/adapters.py#result
    outlier:  ods/bin/model_switchboard/wsl_runtime.py:56 env_value
```

```text
[D-f40096] functions in ods/bin/remote_provider/** declare their return type
    evidence: 30/31 (lower bound 0.84, lift 3.3)
    example:  ods/bin/remote_provider/egress.py#connection_header_names
    outlier:  ods/bin/remote_provider/telemetry.py:7 route_fingerprint
```

```text
[D-4c758e] HTTP handlers in ods/** are wrapped in verify_api_key() or verify_api_key() or verify_api_key()
    evidence: 178/199 (lower bound 0.84, lift 12.9)
    split:    verify_api_key 174, verify_api_key 2, verify_api_key 2
    example:  ods/extensions/services/dashboard-api/routers/agents.py#get_agent_metrics
    outlier:  ods/extensions/library/services/bark/server.py:142 health
    outlier:  ods/extensions/library/services/bark/server.py:220 list_voices
    outlier:  ods/extensions/library/services/bark/server.py:147 text_to_speech
    outlier:  ods/extensions/library/services/bark/server.py:181 text_to_speech_stream
    outlier:  ods/extensions/library/services/open-interpreter/server.py:111 health
    outlier:  ods/extensions/services/dashboard-api/routers/auth.py:103 hermes_session
    outlier:  ods/extensions/services/dashboard-api/routers/auth.py:170 verify_session
    outlier:  ods/extensions/services/dashboard-api/routers/dashboard_session.py:142 dashboard_login
    outlier:  ods/extensions/services/dashboard-api/routers/dashboard_session.py:205 dashboard_logout
    outlier:  ods/extensions/services/dashboard-api/routers/dashboard_session.py:123 verify_dashboard_session
    outlier:  ods/extensions/services/dashboard-api/routers/magic_link.py:730 redeem_magic_link
    outlier:  ods/extensions/services/dashboard-api/routers/oauth_passthrough.py:400 oauth_callback
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:946 talk_approval
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:999 talk_attachment
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:1073 talk_audio_message
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:898 talk_message
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:914 talk_message_stream
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:874 talk_session
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:1090 talk_speak
    outlier:  ods/extensions/services/dashboard-api/routers/talk.py:841 talk_status
    outlier:  ods/extensions/services/privacy-shield/proxy.py:226 health
```

```text
[D-2264ef] functions in ods/scripts/** declare their return type
    evidence: 292/351 (lower bound 0.79, lift 2.7)
    example:  ods/scripts/assign_gpus.py#assign_services
    outlier:  ods/scripts/assign_gpus.py:467 main
    outlier:  ods/scripts/backup-native-preflight.py:20 main
    outlier:  ods/scripts/backup-native-preflight.py:10 native_state
    outlier:  ods/scripts/cleanup-wsl-pixel-mounts.py:225 cleanup
    outlier:  ods/scripts/cleanup-wsl-pixel-mounts.py:71 directory
    outlier:  ods/scripts/cleanup-wsl-pixel-mounts.py:38 docker
    outlier:  ods/scripts/cleanup-wsl-pixel-mounts.py:145 ensure_unused
    outlier:  ods/scripts/cleanup-wsl-pixel-mounts.py:80 plan
    outlier:  ods/scripts/cleanup-wsl-pixel-mounts.py:54 read_mounts
    outlier:  ods/scripts/cleanup-wsl-pixel-mounts.py:50 unescape
    outlier:  ods/scripts/compose-cache-policy.py:146 main
    outlier:  ods/scripts/compose-cache-policy.py:37 validate_flags
    outlier:  ods/scripts/generate-setup-card.py:115 render_card
    outlier:  ods/scripts/generate-setup-card.py:83 render_qr
    outlier:  ods/scripts/healthcheck.py:272 with_retries
    outlier:  ods/scripts/macos-bootstrap-promote.py:399 main
    outlier:  ods/scripts/macos-bootstrap-promote.py:347 run
    outlier:  ods/scripts/model-store-compose-flags.py:55 main
    outlier:  ods/scripts/model-store-compose-flags.py:14 resolve_flags
    outlier:  ods/scripts/prepare-containerd-console.py:205 do_apply
    outlier:  ods/scripts/prepare-containerd-console.py:198 do_check
    outlier:  ods/scripts/prepare-containerd-console.py:254 main
    outlier:  ods/scripts/recover-macos-local-model.py:26 installed_env
    outlier:  ods/scripts/recover-macos-local-model.py:106 main
    outlier:  ods/scripts/recover-macos-local-model.py:39 request
    outlier:  ods/scripts/recover-macos-local-model.py:76 run
    outlier:  ods/scripts/refresh-hermes-mounts.py:80 desktop_data_source_matches
    outlier:  ods/scripts/refresh-hermes-mounts.py:84 desktop_file_source_matches
    outlier:  ods/scripts/refresh-hermes-mounts.py:51 execute
    outlier:  ods/scripts/refresh-hermes-mounts.py:88 host_digests
    outlier:  ods/scripts/refresh-hermes-mounts.py:220 main
    outlier:  ods/scripts/refresh-hermes-mounts.py:108 refresh
    outlier:  ods/scripts/register-model-store.py:110 main
    outlier:  ods/scripts/source-update-preflight.py:163 check_compose
    outlier:  ods/scripts/source-update-preflight.py:134 check_native
    outlier:  ods/scripts/source-update-preflight.py:149 check_rollback
    outlier:  ods/scripts/source-update-preflight.py:176 main
    outlier:  ods/scripts/source-update-preflight.py:55 root_managed_pixel_identity
    outlier:  ods/scripts/stop-owned-containers.py:93 main
    outlier:  ods/scripts/stop-owned-containers.py:31 stop_owned_containers
    outlier:  ods/scripts/verify-pixel-bundle.py:61 bundle_tree_modes
    outlier:  ods/scripts/verify-pixel-bundle.py:19 command
    outlier:  ods/scripts/verify-pixel-bundle.py:31 files
    outlier:  ods/scripts/verify-pixel-bundle.py:78 main
    outlier:  ods/scripts/verify-pixel-bundle.py:43 source_index_modes
    outlier:  ods/scripts/windows-retained-extensions.py:72 main
    outlier:  ods/scripts/windows-retained-extensions.py:19 resolve
    outlier:  ods/scripts/wsl-bind-recovery.py:144 active_profiles
    outlier:  ods/scripts/wsl-bind-recovery.py:398 backup_phantom
    outlier:  ods/scripts/wsl-bind-recovery.py:298 classify_running
    outlier:  ods/scripts/wsl-bind-recovery.py:309 classify_stopped
    outlier:  ods/scripts/wsl-bind-recovery.py:84 compose_config_json
    outlier:  ods/scripts/wsl-bind-recovery.py:39 fail
    outlier:  ods/scripts/wsl-bind-recovery.py:69 is_wsl_docker_desktop
    outlier:  ods/scripts/wsl-bind-recovery.py:506 main
    outlier:  ods/scripts/wsl-bind-recovery.py:465 recreate
    outlier:  ods/scripts/wsl-bind-recovery.py:186 resolve_bind_targets
    outlier:  ods/scripts/wsl-bind-recovery.py:177 service_enabled
    outlier:  ods/scripts/wsl-bind-recovery.py:473 verify
    exempt:   ods/scripts/cleanup-wsl-pixel-mounts.py:31 run (shared part used by 2 members)
    exempt:   ods/scripts/prepare-containerd-console.py:102 classify (shared part used by 2 members)
    exempt:   ods/scripts/refresh-hermes-mounts.py:60 desktop_source_matches (shared part used by 2 members)
    exempt:   ods/scripts/source-update-preflight.py:15 load_helper (shared part used by 2 members)
    exempt:   ods/scripts/source-update-preflight.py:24 locally_selected_native (shared part used by 2 members)
    exempt:   ods/scripts/source-update-preflight.py:103 managed_pixel_identity (shared part used by 2 members)
    exempt:   ods/scripts/verify-pixel-bundle.py:23 digest (shared part used by 2 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:266 bind_view_matches (shared part used by 2 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:99 compose_ps (shared part used by 2 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:226 exec_stat (shared part used by 4 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:208 host_stat (shared part used by 5 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:132 inspect_container (shared part used by 3 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:35 log (shared part used by 2 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:257 prevalidate_binds (shared part used by 4 members)
    exempt:   ods/scripts/wsl-bind-recovery.py:44 run (shared part used by 7 members)
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "ods#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
