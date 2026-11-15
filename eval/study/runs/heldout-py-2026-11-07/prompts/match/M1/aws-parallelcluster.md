You are checking whether a tool's proposed conventions for the repository **aws-parallelcluster** (https://github.com/aws/aws-parallelcluster at `28c28bac550a2c4a6fd458f763e06a3a4d23ee23`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/aws-parallelcluster

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/e73ab0af-394f-4b93-995b-606e0a4ddefc/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **aws-parallelcluster#R19** (other, must; cli/.flake8:53): In flake8-linted Python files, functions must not exceed a McCabe cyclomatic complexity of 10 (C901).  
  scope: cli/setup.py, cli/src/**, cli/tests/**, cloudformation/**, tests/integration-tests/**, util/** Python functions
- **aws-parallelcluster#R20** (other, must; cli/.flake8:54): In flake8-linted Python files, lines must not exceed 120 characters (E501).  
  scope: cli/setup.py, cli/src/**, cli/tests/**, cloudformation/**, tests/integration-tests/**, util/** Python files
- **aws-parallelcluster#R21** (other, must; cli/tox.ini:108): In flake8-linted Python files, public classes and methods must have PEP 257-compliant docstrings (flake8-docstrings D family enabled, minus the ignored codes).  
  scope: cli/setup.py, cli/src/**, cli/tests/**, cloudformation/**, tests/integration-tests/**, util/** Python files
- **aws-parallelcluster#R22** (avoid, must; cli/tox.ini:109): In flake8-linted Python files, code must not contain likely bugs and design problems flagged by flake8-bugbear (B family enabled, minus B028 and B042).  
  scope: cli/setup.py, cli/src/**, cli/tests/**, cloudformation/**, tests/integration-tests/**, util/** Python files
- **aws-parallelcluster#R23** (naming, must; cli/tox.ini:112): In flake8-linted Python files, names must follow PEP 8 naming conventions (pep8-naming N family enabled, minus N818).  
  scope: cli/setup.py, cli/src/**, cli/tests/**, cloudformation/**, tests/integration-tests/**, util/** Python files
- **aws-parallelcluster#R24** (other, must; api/client/src/setup.cfg:2): In api/client/src (generated Python API client), lines must not exceed 99 characters (flake8 E501).  
  scope: api/client/src/** Python files
- **aws-parallelcluster#R48** (other, must; cli/.pylintrc:128): In pylint-linted code, functions must not nest more than 6 blocks deep (too-many-nested-blocks).  
  scope: cli/setup.py, cli/src/pcluster/** functions (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R49** (naming, must; cli/.pylintrc:238): In pylint-linted code, local variables that are intentionally unused must be named _ , _-prefixed, dummy, ignored_* or unused_* (otherwise unused-variable is reported).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R50** (naming, must; cli/.pylintrc:242): In pylint-linted code, function arguments that are intentionally unused must be named _*, ignored_*, unused_*, args or kwargs (otherwise unused-argument is reported).  
  scope: cli/setup.py, cli/src/pcluster/** functions (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R51** (other, must; cli/.pylintrc:268): In pylint-linted code, lines must not exceed 120 characters, except lines consisting only of a URL (line-too-long).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R52** (file_layout, must; cli/.pylintrc:271): In pylint-linted code, a module must not exceed 1000 lines (too-many-lines).  
  scope: cli/setup.py, cli/src/pcluster/** modules (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R53** (naming, must; cli/.pylintrc:300): In pylint-linted code, function arguments must be named in snake_case (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R54** (naming, must; cli/.pylintrc:307): In pylint-linted code, instance attributes must be named in snake_case (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R55** (naming, must; cli/.pylintrc:314): In pylint-linted code, variables and functions must not be named foo, bar, baz, toto, tutu or tata (disallowed-name).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R57** (naming, must; cli/.pylintrc:329): In pylint-linted code, classes must be named in PascalCase (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** classes (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R58** (naming, must; cli/.pylintrc:336): In pylint-linted code, module-level constants must be named in UPPER_CASE (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** module-level constants (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R59** (naming, must; cli/.pylintrc:347): In pylint-linted code, functions must be named in snake_case (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** functions (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R60** (naming, must; cli/.pylintrc:354): In pylint-linted code, the names i, j, k, ex, Run, e, f, _, id and os are always accepted regardless of naming-style rules.  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R62** (naming, must; cli/.pylintrc:376): In pylint-linted code, methods must be named in snake_case (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** methods (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R63** (naming, must; cli/.pylintrc:383): In pylint-linted code, module file names must be snake_case (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** modules (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R64** (naming, must; cli/.pylintrc:403): In pylint-linted code, variables must be named in snake_case (invalid-name).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R65** (import_restriction, must; cli/.pylintrc:413): In pylint-linted code, wildcard imports (from x import *) must not be used, even when the imported module defines __all__ (wildcard-import).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R66** (import_restriction, must; cli/.pylintrc:421): In pylint-linted code, the module regsub must not be imported (deprecated-module).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R67** (import_restriction, must; cli/.pylintrc:422): In pylint-linted code, the module TERMIOS must not be imported (deprecated-module).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R68** (import_restriction, must; cli/.pylintrc:423): In pylint-linted code, the module Bastion must not be imported (deprecated-module).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R69** (import_restriction, must; cli/.pylintrc:424): In pylint-linted code, the module rexec must not be imported (deprecated-module).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R70** (avoid, must; cli/.pylintrc:455): In pylint-linted code, protected members (leading underscore) of other objects must not be accessed, except the namedtuple members _asdict, _fields, _replace, _source and _make (protected-access).  
  scope: cli/setup.py, cli/src/pcluster/** (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R71** (naming, must; cli/.pylintrc:462): In pylint-linted code, the first argument of a classmethod must be named cls (bad-classmethod-argument).  
  scope: cli/setup.py, cli/src/pcluster/** classmethods (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R72** (naming, must; cli/.pylintrc:465): In pylint-linted code, the first argument of a metaclass classmethod must be named mcs (bad-mcs-classmethod-argument).  
  scope: cli/setup.py, cli/src/pcluster/** metaclasses (excluding cli/src/pcluster/api/models, cli/src/awsbatch)
- **aws-parallelcluster#R73** (avoid, must; cli/.bandit.ini:1): In non-test Python code (cli/setup.py, cli/src/**, cloudformation/**, util/**), code must not trigger any bandit security check; no bandit test IDs are skipped.  
  scope: cli/setup.py, cli/src/** (excluding cli/src/pcluster/api/models), cloudformation/** (excluding tests), util/** Python files
- **aws-parallelcluster#R74** (avoid, must; cli/tox.ini:180): In non-test code under cli/, code must not match semgrep rules from the r2c-security-audit, secrets, default, owasp-top-ten and dockerfile rulesets (findings fail the build).  
  scope: cli/** excluding tests/**
- **aws-parallelcluster#R75** (avoid, must; .github/workflows/security_exclusions_checker.yml:18): In all files, added lines must not contain nosec or nosemgrep suppression annotations (bandit/semgrep findings must not be silenced inline).  
  scope: ** all files (lines added in a pull request)
- **aws-parallelcluster#R76** (avoid, must; .github/workflows/unsafe_patterns_checker.yml:18): In all files, added lines must not hardcode the AWS domain suffixes amazonaws.com, amazonaws.com.cn, c2s.ic.gov or sc2s.sgov.gov.  
  scope: ** all files (lines added in a pull request)
- **aws-parallelcluster#R77** (avoid, must; .github/workflows/ci.yml:153): In shell scripts outside tests/ (except user_data.sh), code must not trigger ShellCheck findings of severity warning or higher.  
  scope: **/*.sh shell scripts excluding tests/** and user_data.sh
- **aws-parallelcluster#R78** (avoid, must; .pre-commit-config.yaml:14): In Python files, code must not contain debugger imports or breakpoint() calls (pdb, ipdb, etc.).  
  scope: **/*.py all Python files
- **aws-parallelcluster#R79** (avoid, must; .pre-commit-config.yaml:15): In all files, private keys must not be committed.  
  scope: ** all files
- **aws-parallelcluster#R80** (file_layout, must; .pre-commit-config.yaml:8): In all files, files marked executable must start with a shebang line.  
  scope: ** executable files
- **aws-parallelcluster#R83** (file_layout, must; api/README.md:77): In cli/src/pcluster/api/controllers, API endpoint handlers must live under this directory and match the controller signatures of the OpenAPI-generated server stub.  
  scope: cli/src/pcluster/api/controllers/** API endpoint handlers
- **aws-parallelcluster#R85** (file_layout, must; tests/integration-tests/README.md:549): In tests/integration-tests, integration test modules must be placed under tests/integration-tests/tests/.  
  scope: tests/integration-tests/** integration tests
- **aws-parallelcluster#R86** (naming, must; tests/integration-tests/README.md:552): In tests/integration-tests/tests, test files must be named test_*.py or *_test.py, test functions must be prefixed test_, and test classes must be prefixed Test and have no __init__ method.  
  scope: tests/integration-tests/tests/** test modules
- **aws-parallelcluster#R87** (naming, should; tests/integration-tests/README.md:557): In tests/integration-tests/tests, each test file must be named test_<feature_under_test>.py, optionally grouped in a per-feature or per-category directory.  
  scope: tests/integration-tests/tests/** test modules
- **aws-parallelcluster#R88** (decorator, should; tests/integration-tests/README.md:593): In tests/integration-tests/tests, test functions that do not use the region/os/instance/scheduler dimension arguments should declare them with @pytest.mark.usefixtures("region", "os", "instance", "scheduler") instead of as function arguments.  
  scope: tests/integration-tests/tests/** test functions
- **aws-parallelcluster#R89** (decorator, should; tests/integration-tests/README.md:617): In tests/integration-tests/tests, restricting a test's dimensions should be done with the custom markers @pytest.mark.instances/regions/oss/schedulers/dimensions and their skip_* counterparts.  
  scope: tests/integration-tests/tests/** test functions
- **aws-parallelcluster#R90** (other, should; tests/integration-tests/README.md:662): In tests/integration-tests, globally unsupported dimension combinations should be declared by extending UNSUPPORTED_DIMENSIONS in tests/integration-tests/conftest_markers.py rather than per-test.  
  scope: tests/integration-tests/conftest_markers.py
- **aws-parallelcluster#R91** (file_layout, must; tests/integration-tests/README.md:667): In tests/integration-tests/tests, per-test resources must be placed in <test_file_name>/<test_case_name>/ next to the test module, and resources shared across tests in tests/integration-tests/tests/data/.  
  scope: tests/integration-tests/tests/** test data
- **aws-parallelcluster#R92** (calls, should; tests/integration-tests/README.md:684): In tests/integration-tests/tests, tests should access their per-test resources via the test_datadir fixture and shared resources via the shared_datadir fixture.  
  scope: tests/integration-tests/tests/** test functions
- **aws-parallelcluster#R93** (file_layout, must; tests/integration-tests/README.md:703): In tests/integration-tests/tests, the cluster configuration for a test case must be a file named pcluster.config.yaml inside that test case's data directory (<test_file>/<test_case>/pcluster.config.yaml).  
  scope: tests/integration-tests/tests/** test data
- **aws-parallelcluster#R94** (calls, should; tests/integration-tests/README.md:706): In tests/integration-tests/tests, tests should read and render their cluster configuration through the pcluster_config_reader fixture.  
  scope: tests/integration-tests/tests/** test functions
- **aws-parallelcluster#R95** (calls, should; tests/integration-tests/README.md:854): In tests/integration-tests/tests, clusters must be created through the clusters_factory fixture so the framework manages their lifecycle and cleanup.  
  scope: tests/integration-tests/tests/** test functions
- **aws-parallelcluster#R96** (calls, should; tests/integration-tests/README.md:875): In tests/integration-tests/tests, remote commands and scripts on the cluster head node should be executed via RemoteCommandExecutor (run_remote_command / run_remote_script).  
  scope: tests/integration-tests/tests/** test functions
- **aws-parallelcluster#R97** (calls, should; tests/integration-tests/README.md:916): In tests/integration-tests/tests, additional AWS resources should be created as CloudFormation stacks via the cfn_stacks_factory fixture (or a fixture wrapping CfnStacksFactory) so cleanup is handled by fixtures.  
  scope: tests/integration-tests/tests/** tests and fixtures
- **aws-parallelcluster#R98** (argument, must; tests/integration-tests/README.md:938): In tests/integration-tests/tests, an integration test that runs performance benchmarks must take the run_benchmarks and benchmarks fixtures and pass benchmarks=benchmarks to pcluster_config_reader.  
  scope: tests/integration-tests/tests/** test functions running benchmarks

## Proposals shown to the user

```text
[D-6f69b2] cli: classes in src/pcluster/validators/** are named `*Validator`
    evidence: 125/129 (lower bound 0.92, lift 5.0)
    example:  cli/src/pcluster/validators/cluster_validators.py#ArchitectureOsValidator
    outlier:  cli/src/pcluster/validators/cluster_validators.py:1507 DictLaunchTemplateBuilder
    outlier:  cli/src/pcluster/validators/slurm_settings_validator.py:202 ExternalSlurmdbdRequiresCustomMungeKey
    outlier:  cli/src/pcluster/validators/slurm_settings_validator.py:213 ExternalSlurmdbdTrafficNotEncrypted
    outlier:  cli/src/pcluster/validators/slurm_settings_validator.py:186 ExternalSlurmdbdVsDatabaseIncompatibility
```

```text
[D-c15280] cli: files in src/pcluster/validators/** have a test file
    evidence: 18/19 (lower bound 0.75, lift 1.9)
    example:  cli/src/pcluster/validators/cluster_validators.py#(file)
    outlier:  cli/src/pcluster/validators/slurm_settings_validator.py:1 (file)
```

```text
[D-79ad45] cli: classes in src/pcluster/schemas/** extend BaseSchema
    evidence: 94/95 (lower bound 0.94, lift 6.5)
    example:  cli/src/pcluster/schemas/cluster_schema.py#AdditionalPackagesSchema
    outlier:  cli/src/pcluster/schemas/cluster_schema.py:1252 OneOrManyCustomActionField
```

```text
[D-8241b1] cli: functions in src/pcluster/api/controllers/** are decorated with convert_errors()
    evidence: 20/21 (lower bound 0.77, lift 18.3)
    example:  cli/src/pcluster/api/controllers/cluster_compute_fleet_controller.py#describe_compute_fleet
    outlier:  cli/src/pcluster/api/controllers/cluster_logs_controller.py:27 validate_filters
```

```text
[D-51bdb8] cli: classes in src/pcluster/schemas/** are named `*Schema`
    evidence: 93/94 (lower bound 0.94, lift 6.4)
    example:  cli/src/pcluster/schemas/cluster_schema.py#AdditionalPackagesSchema
    outlier:  cli/src/pcluster/schemas/cluster_schema.py:1308 CustomActionScriptSchemaBase
    exempt:   cli/src/pcluster/schemas/cluster_schema.py:1252 OneOrManyCustomActionField (shared part used by 3 members)
```

```text
[D-1ef14c] api/client/src: files in pcluster_client/** have a test file
    evidence: 73/79 (lower bound 0.84, lift 1.8)
    example:  api/client/src/pcluster_client/api/cluster_compute_fleet_api.py#(file)
    outlier:  api/client/src/pcluster_client/api_client.py:1 (file)
    outlier:  api/client/src/pcluster_client/configuration.py:1 (file)
    outlier:  api/client/src/pcluster_client/exceptions.py:1 (file)
    outlier:  api/client/src/pcluster_client/model_utils.py:1 (file)
    outlier:  api/client/src/pcluster_client/rest.py:1 (file)
    outlier:  api/client/src/pcluster_client/sigv4_auth.py:1 (file)
```

```text
[D-70f439] cli: classes in src/pcluster/api/** extend Model
    evidence: 67/68 (lower bound 0.92, lift 8.4)
    example:  cli/src/pcluster/api/models/ami_info.py#AmiInfo
    outlier:  cli/src/pcluster/api/flask_app.py:70 ParallelClusterFlaskApp
    exempt:   cli/src/pcluster/api/errors.py:99 BadRequestException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:81 BuildImageBadRequestException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:153 ConflictException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:72 CreateClusterBadRequestException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:135 DryrunOperationException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:108 InternalServiceException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:117 LimitExceededException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:126 NotFoundException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/errors.py:90 UpdateClusterBadRequestException (a exception, named for its base ParallelClusterApiException)
    exempt:   cli/src/pcluster/api/flask_app.py:32 CustomParameterValidator (a validator, named for its base decorators.validation.ParameterValidator)
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "aws-parallelcluster#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
