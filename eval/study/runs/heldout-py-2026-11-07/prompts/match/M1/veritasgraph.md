You are checking whether a tool's proposed conventions for the repository **veritasgraph** (https://github.com/bibinprathap/VeritasGraph at `6b14ce7a56772bbd354754054bc5bda10800c7ef`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/veritasgraph

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/57a0f32b-e7fa-4500-93b1-a486e7673edc/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **veritasgraph#R02** (naming, should; CONTRIBUTING.md:75): In all Python files, code should follow PEP 8 style conventions (naming, whitespace, layout).  
  scope: **/*.py all files
- **veritasgraph#R03** (other, should; CONTRIBUTING.md:76): In all Python files, public functions and classes must have docstrings.  
  scope: **/*.py public functions and classes
- **veritasgraph#R08** (other, must; veritas-reason/CONTRIBUTING.md:255): In veritas-reason/veritasreason/**, docstrings must use Google style (Args:, Returns:, Raises:, Example: sections).  
  scope: veritas-reason/veritasreason/**/*.py functions and classes
- **veritasgraph#R09** (typing, must; veritas-reason/CONTRIBUTING.md:205): In veritas-reason/veritasreason/**, code must type-check under mypy (type hints on functions).  
  scope: veritas-reason/veritasreason/**/*.py all files
- **veritasgraph#R10** (other, must; veritas-reason/CONTRIBUTING.md:204): In veritas-reason/veritasreason/** and veritas-reason/tests/**, code must pass flake8 style enforcement.  
  scope: veritas-reason/veritasreason/**, veritas-reason/tests/** all Python files
- **veritasgraph#R14** (other, must; veritas-reason/docs/contributing.md:63): In veritas-reason, code must follow the project style enforced by Black, isort and flake8.  
  scope: veritas-reason/**/*.py all files
- **veritasgraph#R15** (base_class, must; veritas-reason/docs/architecture.md:88): In veritas-reason, custom ingestors must subclass veritasreason.ingest.BaseIngestor and implement ingest(source) returning a list of document dicts.  
  scope: veritas-reason/** custom ingestor classes
- **veritasgraph#R16** (base_class, must; veritas-reason/docs/architecture.md:99): In veritas-reason, custom extractors must subclass veritasreason.semantic_extract.BaseExtractor and implement extract(text) returning a list of entity dicts.  
  scope: veritas-reason/** custom extractor classes
- **veritasgraph#R17** (base_class, must; veritas-reason/docs/architecture.md:113): In veritas-reason, custom ingestors, extractors, validators and exporters must follow the base-class pattern (subclass the module's Base* class) rather than modifying core code.  
  scope: veritas-reason/veritasreason/** plugin/extension classes
- **veritasgraph#R21** (other, must; veritas-reason/.pre-commit-config.yaml:15): In veritas-reason Python files, code must not appear before the module docstring (the docstring must come first).  
  scope: veritas-reason/**/*.py all files
- **veritasgraph#R22** (avoid, must; veritas-reason/.pre-commit-config.yaml:16): In veritas-reason Python files, code must not contain debugger imports or calls (pdb, ipdb, breakpoint()).  
  scope: veritas-reason/**/*.py all files
- **veritasgraph#R23** (file_layout, must; veritas-reason/.pre-commit-config.yaml:18): In veritas-reason test directories, test files must be named test_*.py.  
  scope: veritas-reason/tests/** test files
- **veritasgraph#R24** (other, must; veritas-reason/.pre-commit-config.yaml:38): In veritas-reason Python files, lines must not exceed 88 characters (flake8 E501).  
  scope: veritas-reason/**/*.py all files
- **veritasgraph#R27** (avoid, must; veritas-reason/.pre-commit-config.yaml:43): In veritas-reason Python files, `# noqa` comments must name specific codes; blanket `# noqa` must not be used.  
  scope: veritas-reason/**/*.py all files
- **veritasgraph#R28** (testing, must; veritas-reason/.pre-commit-config.yaml:44): In veritas-reason Python files, code must not call non-existent mock assertion methods (e.g. assert_called_once, not_called, called_once_with misspellings).  
  scope: veritas-reason/**/*.py tests
- **veritasgraph#R29** (avoid, must; veritas-reason/.pre-commit-config.yaml:45): In veritas-reason Python files, code must not use the builtin eval().  
  scope: veritas-reason/**/*.py all files
- **veritasgraph#R30** (avoid, must; veritas-reason/.pre-commit-config.yaml:46): In veritas-reason Python files, code must not call the deprecated logger .warn(); use .warning() instead.  
  scope: veritas-reason/**/*.py all files
- **veritasgraph#R33** (avoid, must; municipality-incident-chatbot/03_how_to_modify.md:44): In municipality-incident-chatbot, the channel layer, app/case_service.py and app/fusion.py must not hardcode incident categories or CV labels; they read them generically from the knowledge graph.  
  scope: municipality-incident-chatbot/app/case_service.py, app/fusion.py, channel adapters
- **veritasgraph#R34** (layering, must; municipality-incident-chatbot/03_how_to_modify.md:78): In municipality-incident-chatbot, app/orchestrator.py, app/fusion.py and app/knowledge_graph.py must consume CV results only via the CV service contract (app/cv_service.py) and must not depend on model internals (e.g. import ultralytics/YOLO directly).  
  scope: municipality-incident-chatbot/app/orchestrator.py, app/fusion.py, app/knowledge_graph.py
- **veritasgraph#R35** (wrapper, must; municipality-incident-chatbot/03_how_to_modify.md:75): In municipality-incident-chatbot, any new CV/VLM backend must be wrapped in an adapter that returns the CV contract shape ({detections: [{label, confidence, bbox}], model}).  
  scope: municipality-incident-chatbot/app/cv_service.py CV backends
- **veritasgraph#R36** (base_class, must; municipality-incident-chatbot/03_how_to_modify.md:101): In municipality-incident-chatbot, knowledge-graph engines must be implemented as adapters behind the KnowledgeRepository interface (classify, route, findSimilar, getPolicy); callers must not depend on the engine directly.  
  scope: municipality-incident-chatbot/app/knowledge_graph.py and callers
- **veritasgraph#R37** (wrapper, must; municipality-incident-chatbot/03_how_to_modify.md:127): In municipality-incident-chatbot, each channel must be a channel adapter that translates messages into the orchestrator's canonical request ({userId, text, attachments, channel}).  
  scope: municipality-incident-chatbot channel adapters
- **veritasgraph#R38** (layering, must; municipality-incident-chatbot/03_how_to_modify.md:134): In municipality-incident-chatbot, app/orchestrator.py, app/knowledge_graph.py, app/cv_service.py and app/case_service.py must not contain channel-specific logic; channel limits are handled only in edge adapters.  
  scope: municipality-incident-chatbot/app/orchestrator.py, knowledge_graph.py, cv_service.py, case_service.py
- **veritasgraph#R39** (base_class, must; municipality-incident-chatbot/03_how_to_modify.md:150): In municipality-incident-chatbot, external corroboration sources must implement the CorroborationSource interface with supports(incidentType, location) and fetch(location, timeWindow).  
  scope: municipality-incident-chatbot/app/external_sources.py connectors
- **veritasgraph#R40** (error_handling, must; municipality-incident-chatbot/03_how_to_modify.md:161): In municipality-incident-chatbot/app/fusion.py, failure of a corroboration source must be handled so fusion still returns a (capped, lower-confidence) result instead of raising.  
  scope: municipality-incident-chatbot/app/fusion.py, app/external_sources.py
- **veritasgraph#R41** (avoid, must; municipality-incident-chatbot/03_how_to_modify.md:175): In municipality-incident-chatbot/app/fusion.py, fusion weights, thresholds and caps must be read from config and must not be hardcoded in code.  
  scope: municipality-incident-chatbot/app/fusion.py
- **veritasgraph#R42** (base_class, must; municipality-incident-chatbot/03_how_to_modify.md:215): In municipality-incident-chatbot, case-management targets must be adapters implementing the CaseSink interface (create, updateStatus, findExisting).  
  scope: municipality-incident-chatbot/app/case_service.py case-management adapters
- **veritasgraph#R43** (error_handling, must; municipality-incident-chatbot/03_how_to_modify.md:223): In municipality-incident-chatbot/app/case_service.py, case-sink writes must keep retry/outbox behavior so outages persist cases locally and retry.  
  scope: municipality-incident-chatbot/app/case_service.py
- **veritasgraph#R44** (layering, must; municipality-incident-chatbot/03_how_to_modify.md:226): In municipality-incident-chatbot, app/orchestrator.py, app/cv_service.py and app/fusion.py must call CaseSink and must not import or call case-management vendor SDKs (ServiceNow, Dynamics 365) directly.  
  scope: municipality-incident-chatbot/app/orchestrator.py, cv_service.py, fusion.py
- **veritasgraph#R46** (calls, must; municipality-incident-chatbot/03_how_to_modify.md:244): In municipality-incident-chatbot, every signal or model must write its output to the evidence bundle and the audit log.  
  scope: municipality-incident-chatbot/app/** signal and model components
- **veritasgraph#R47** (error_handling, must; municipality-incident-chatbot/03_how_to_modify.md:246): In municipality-incident-chatbot, external dependencies must be optional and their failures must be caught so the system never hard-fails when a corroboration source is offline.  
  scope: municipality-incident-chatbot/app/** external integrations

## Proposals shown to the user

```text
[D-e381dd] veritas-reason: HTTP handlers in veritasreason/explorer/** pass `response_model` to APIRouter.api_route()
    evidence: 60/69 (lower bound 0.77, lift 10.3)
    example:  veritas-reason/veritasreason/explorer/routes/analytics.py#get_analytics
    outlier:  veritas-reason/veritasreason/explorer/routes/annotations.py:56 delete_annotation
    outlier:  veritas-reason/veritasreason/explorer/routes/export_import.py:244 export_distance_enriched
    outlier:  veritas-reason/veritasreason/explorer/routes/export_import.py:197 export_graph
    outlier:  veritas-reason/veritasreason/explorer/routes/ontology.py:1905 add_comment
    outlier:  veritas-reason/veritasreason/explorer/routes/ontology.py:1763 approve_proposal
    outlier:  veritas-reason/veritasreason/explorer/routes/ontology.py:1793 publish_proposal
    outlier:  veritas-reason/veritasreason/explorer/routes/ontology.py:1778 reject_proposal
    outlier:  veritas-reason/veritasreason/explorer/routes/ontology.py:1485 remove_ontology
    outlier:  veritas-reason/veritasreason/explorer/routes/provenance.py:158 export_provenance_report
```

```text
[D-b12755] veritas-reason: classes in veritasreason/explorer/** extend BaseModel
    evidence: 81/84 (lower bound 0.90, lift 8.1)
    example:  veritas-reason/veritasreason/explorer/routes/ontology.py#AlignmentRequest
    outlier:  veritas-reason/veritasreason/explorer/search_index.py:93 GraphSearchIndex
    outlier:  veritas-reason/veritasreason/explorer/session.py:37 GraphSession
    outlier:  veritas-reason/veritasreason/explorer/ws.py:17 ConnectionManager
```

```text
[D-a849e1] veritas-reason: classes in veritasreason/normalize/** call get_logger()
    evidence: 23/24 (lower bound 0.80, lift 2.4)
    example:  veritas-reason/veritasreason/normalize/data_cleaner.py#DataCleaner
    outlier:  veritas-reason/veritasreason/normalize/normalize_provenance.py:18 NormalizerWithProvenance
```

```text
[D-3e5d8c] veritas-reason: classes in veritasreason/parse/** call get_logger()
    evidence: 23/25 (lower bound 0.75, lift 2.3)
    example:  veritas-reason/veritasreason/parse/code_parser.py#CodeParser
    outlier:  veritas-reason/veritasreason/parse/parse_provenance.py:20 ParserWithProvenance
    outlier:  veritas-reason/veritasreason/parse/web_parser.py:155 HTMLContentParser
```

```text
[D-1d585e] veritas-reason: dataclasses in veritasreason/** pass `default_factory` to field()
    evidence: 141/141 (lower bound 0.97, lift 4.5)
    example:  veritas-reason/veritasreason/change_management/change_log.py#ChangeLogEntry
    exempt:   veritas-reason/veritasreason/change_management/change_log.py:114 MutationRecord (does not call field())
    exempt:   veritas-reason/veritasreason/deduplication/entity_merger.py:55 MergeOperation (does not call field())
    exempt:   veritas-reason/veritasreason/deduplication/merge_strategy.py:64 PropertyMergeRule (does not call field())
    exempt:   veritas-reason/veritasreason/deduplication/similarity_calculator.py:61 SimilarityResult (does not call field())
    exempt:   veritas-reason/veritasreason/explorer/search_index.py:80 IndexedNodeDocument (does not call field())
    exempt:   veritas-reason/veritasreason/kg/temporal_query.py:28 TemporalConsistencyIssue (does not call field())
    exempt:   veritas-reason/veritasreason/kg/temporal_query.py:35 TemporalConsistencyReport (does not call field())
    exempt:   veritas-reason/veritasreason/kg/temporal_query_rewriter.py:56 TemporalQueryResult (does not call field())
    exempt:   veritas-reason/veritasreason/kg/temporal_reasoning.py:20 TemporalInterval (does not call field())
    exempt:   veritas-reason/veritasreason/normalize/data_cleaner.py:41 DuplicateGroup (does not call field())
    exempt:   veritas-reason/veritasreason/ontology/ontology_generator.py:720 PropertyShape (does not call field())
    exempt:   veritas-reason/veritasreason/ontology/ontology_validator.py:25 SHACLViolation (does not call field())
    exempt:   veritas-reason/veritasreason/parse/code_parser.py:58 CodeComment (does not call field())
    exempt:   veritas-reason/veritasreason/parse/docling_parser.py:64 DoclingMetadata (does not call field())
    exempt:   veritas-reason/veritasreason/parse/docx_parser.py:58 DocxMetadata (does not call field())
    exempt:   veritas-reason/veritasreason/parse/html_parser.py:43 HTMLMetadata (does not call field())
    exempt:   veritas-reason/veritasreason/parse/json_parser.py:40 JSONData (does not call field())
    exempt:   veritas-reason/veritasreason/parse/pdf_parser.py:53 PDFMetadata (does not call field())
    exempt:   veritas-reason/veritasreason/pipeline/parallelism_manager.py:56 ParallelExecutionResult (does not call field())
    exempt:   veritas-reason/veritasreason/reasoning/datalog_reasoner.py:18 DatalogFact (does not call field())
    exempt:   veritas-reason/veritasreason/reasoning/datalog_reasoner.py:29 DatalogRule (does not call field())
    exempt:   veritas-reason/veritasreason/semantic_extract/llm_extraction.py:74 LLMResponse (does not call field())
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "veritasgraph#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
