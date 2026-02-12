# End-to-End Pipelines

## Purpose
This document traces every major operation through the system from start to finish. When implementing any pipeline, this is the reference for what happens, in what order, and which subsystems are involved.

---

## Pipeline 1: Full Scan (`drift scan`)

The most important pipeline. Discovers all conventions in a codebase.

```
User runs: drift scan [--incremental] [--categories api,auth] [--callgraph] [--manifest]

1. RESOLVE PROJECT
   CLI resolves project root (walks up from cwd looking for .drift/)
   Loads config.json (ignore patterns, feature flags, categories)
   Checks license tier (gates enterprise features)

2. FILE DISCOVERY
   Scanner walks filesystem (Rust: parallel via rayon, TS: sequential)
   Applies .driftignore patterns + config ignore patterns
   Filters by --max-file-size (default 1MB)
   If --incremental: only files changed since last scan (via content hash)
   Result: string[] of file paths

3. PARSING (per file)
   Determine language from extension
   Parse with tree-sitter (Rust primary, TS fallback)
   Extract: functions, classes, imports, exports, call sites, decorators, types
   Result: ParseResult per file

4. DETECTION (per file, parallelizable)
   Filter applicable detectors by language and --categories
   Optional: Piscina worker pool (TS) or Rayon (Rust) for parallelism
   Each detector runs detect(file, content, ast, projectContext)
   Result: PatternMatch[] per detector per file

5. AGGREGATION
   Merge PatternMatch results across all files
   Deduplicate by location (file:line:column key)
   Group by pattern ID
   Result: AggregatedPattern[] with locations[] and outliers[]

6. CONFIDENCE SCORING (per pattern)
   frequency = locations.length / totalLocations (weight: 0.40)
   consistency = 1 - variance across locations (weight: 0.30)
   age = linear scale 0→30 days (weight: 0.15)
   spread = uniqueFiles / totalFiles (weight: 0.15)
   score = weighted sum, clamped [0, 1]
   level = high (≥0.85) | medium (≥0.70) | low (≥0.50) | uncertain (<0.50)

7. PATTERN STORAGE
   Auto-detect storage backend (SQLite vs JSON)
   Persist patterns with locations, outliers, confidence, metadata
   Update existing patterns (merge locations, recalculate confidence)
   New patterns get status: "discovered"

8. OPTIONAL: CALL GRAPH BUILD (if --callgraph)
   Per-language hybrid extractor (tree-sitter + regex fallback)
   Per-language data access extractor (ORM patterns)
   GraphBuilder constructs function nodes + call edges
   Resolution pass: resolve call targets (same-file → import → fuzzy)
   Persist to SQLite (functions, function_calls, function_data_access)

9. OPTIONAL: BOUNDARY SCAN (unless --no-boundaries)
   DataAccessLearner discovers ORM frameworks and conventions
   BoundaryScanner detects all data access points
   SensitiveFieldDetector classifies PII/credentials/financial/health
   Persist to SQLite (data_models, sensitive_fields, data_access_points)

10. OPTIONAL: CONTRACT SCAN (unless --no-contracts)
    Detect backend API endpoints (Express, Spring, Django, etc.)
    Detect frontend API calls (fetch, axios, etc.)
    Match backend ↔ frontend by endpoint + method
    Detect field mismatches
    Persist to SQLite (contracts, contract_frontends)

11. OPTIONAL: MANIFEST GENERATION (if --manifest)
    For each pattern location, extract semantic context
    Function name, class name, module path
    Create SemanticLocation entries
    Persist manifest

12. FINALIZATION
    Create history snapshot (timestamped pattern state)
    Compute audit health score
    Materialize data lake views (if using legacy storage)
    Record telemetry (if enabled)
    Display results via UI (spinner → table summary)

Duration: 2-30 seconds for typical projects, up to 5 minutes for large monorepos.
Health monitoring: warns after 30s, enforces --timeout (default 300s).
```

---

## Pipeline 2: Violation Check (`drift check`)

Checks code against approved patterns. Used in CI and pre-commit hooks.

```
User runs: drift check [--staged] [--ci] [--format github] [--fail-on error]

1. RESOLVE FILES
   If --staged: getStagedFiles() via git diff --cached --name-only --diff-filter=ACMR
   If no flag: all project files (or changed files)

2. LOAD PATTERNS
   Load approved patterns from storage (SQLite or JSON)
   Filter by relevant categories for the files being checked

3. EVALUATE
   Rules Engine evaluates each file against approved patterns
   For each approved pattern:
     - Check if file should match this pattern (by category, file path, language)
     - If file matches pattern but deviates → Violation
     - Severity from pattern config or default

4. REPORT
   Select reporter based on --format:
     text → TextReporter (colored terminal, grouped by file)
     json → JsonReporter (structured JSON)
     github → GitHubReporter (::error/::warning annotations)
     gitlab → GitLabReporter (Code Quality JSON)
   If --ci: auto-select JSON, non-interactive

5. EXIT CODE
   Count violations by severity
   Compare against --fail-on threshold (error|warning|none)
   If any violation severity ≥ threshold → exit 1
   Otherwise → exit 0

Used by: pre-commit hooks (drift check --staged), CI pipelines (drift check --ci --format github)
```

---

## Pipeline 3: MCP Context Query (`drift_context`)

The most important MCP tool. Curates context for AI code generation.

```
AI calls: drift_context intent="add_feature" focus="authentication" activeFile="src/auth/login.ts"

1. PATTERN RETRIEVAL
   Query patterns by relevance to focus ("authentication")
   Filter by category (auth, security)
   Sort by confidence (highest first)
   Limit to top N patterns

2. CODE EXAMPLES
   For top patterns, load code examples from pattern locations
   Select examples closest to activeFile (same directory preferred)
   Include snippet, file path, line numbers

3. CORTEX RETRIEVAL
   Query Cortex with intent + focus
   Intent weighting: "add_feature" boosts pattern_rationale, procedural, tribal
   Session deduplication: skip memories already sent in this conversation
   Compress to fit token budget

4. CALL GRAPH CONTEXT (if relevant)
   If activeFile has functions in call graph:
     Load callers and callees (1-2 hops)
     Include data access points reachable from active functions

5. BOUNDARY CONTEXT (if relevant)
   If focus relates to data access:
     Load relevant boundary rules
     Include sensitive field warnings

6. SYNTHESIS
   Combine all context into structured response
   Prioritize by relevance score
   Compress to fit token budget (default 2000 tokens)
   Include: patterns, examples, memories, warnings, suggested approach

7. RESPONSE
   Return curated context with metadata:
     tokenEstimate, patternCount, memoryCount, warnings
```

---

## Pipeline 4: Quality Gate (`drift gate`)

Enterprise enforcement pipeline for CI/CD.

```
User runs: drift gate [--policy strict] [--format sarif] [--ci]

1. LOAD POLICY
   PolicyLoader reads policy definition (default, strict, lenient, or custom)
   Policy defines: which gates to run, thresholds, aggregation mode

2. EXECUTE GATES (parallel where possible)
   GateOrchestrator runs enabled gates:

   a. Pattern Compliance Gate
      Load approved patterns → check files → count violations
      Pass if violation count ≤ threshold

   b. Constraint Verification Gate
      Load constraints → verify against current code
      Pass if no constraint violations

   c. Regression Detection Gate
      Compare current patterns against previous snapshot
      Pass if no patterns degraded beyond threshold

   d. Impact Analysis Gate
      Build/load call graph → analyze change blast radius
      Pass if impact score ≤ threshold

   e. Security Boundary Gate
      Check data access against boundary rules
      Pass if no unauthorized access detected

   f. Custom Rules Gate
      Evaluate user-defined rules (if any)

3. AGGREGATE RESULTS
   PolicyEvaluator aggregates gate results
   4 aggregation modes: all-pass, any-pass, weighted, custom
   Compute overall pass/fail

4. REPORT
   Select reporter: text, JSON, SARIF, GitHub, GitLab
   Generate report with per-gate details
   Store gate run in history (for trend tracking)

5. EXIT CODE
   Pass → exit 0
   Fail → exit 1 (blocks CI pipeline)
```

---

## Pipeline 5: Memory Retrieval (`drift_why`)

Cortex's "killer feature" — explains WHY things are the way they are.

```
AI calls: drift_why focus="authentication" sessionId="abc123"

1. GATHER CANDIDATES
   Search by topic: semantic similarity to "authentication"
   Search by pattern: memories linked to auth-category patterns
   Search by file: memories linked to auth-related files
   Search by function: memories linked to auth functions in call graph

2. SCORE CANDIDATES
   Relevance scorer considers:
     Semantic similarity to focus query
     File proximity (same directory as active file)
     Pattern alignment
     Recency of access
     Confidence level
     Importance level

3. INTENT WEIGHTING
   "why" intent boosts: tribal, pattern_rationale, decision_context, incident
   Reduces: procedural, agent_spawn, workflow

4. SESSION DEDUPLICATION
   Check sessionId for already-sent memories
   Exclude duplicates (don't waste tokens re-sending)

5. CAUSAL NARRATIVE
   For high-importance memories, traverse causal graph
   Build narrative: "X happened because Y, which was caused by Z"
   Include causal chain in response

6. COMPRESSION
   Hierarchical compression to fit token budget:
     Level 0: Full content
     Level 1: Summary + key details
     Level 2: Summary only
     Level 3: One-line summary
   Higher-importance memories get more token allocation

7. RESPONSE
   Return: memories, causal narratives, warnings, suggestions
   Track returned memories in session (for future deduplication)
```

---

## Pipeline 6: Setup Wizard (`drift setup`)

Guided onboarding that runs all features in sequence.

```
User runs: drift setup [-y] [--resume]

Phase 1: PREREQUISITES
  Check if .drift/ exists, count existing patterns
  Decide: fresh setup or incremental

Phase 2: INIT
  Create .drift/ with 30+ subdirectories
  Generate config.json with project UUID
  Register in global registry (~/.drift/registry.json)

Phase 3: SCAN + APPROVAL
  Run full scan (Pipeline 1)
  Interactive batch approval of high-confidence patterns (≥85%)
  In -y mode: auto-approve above threshold

Phase 4: CORE FEATURES
  Run: boundaries, contracts, environment, constants
  Each is a modular runner (prompted individually or all-enabled with -y)

Phase 5: DEEP ANALYSIS
  Run: callgraph, test-topology, coupling, DNA, error-handling
  Heavier operations, each prompted individually

Phase 6: DERIVED FEATURES
  Run: constraints, audit
  Depend on data from phases 4-5

Phase 7: MEMORY
  Initialize Cortex memory system
  Create cortex.db with schema

Phase 8: FINALIZE
  Sync all data to SQLite (if using hybrid storage)
  Generate source-of-truth.json with baseline checksums
  Print summary with stats and next steps

Resume: SetupState persisted to disk, --resume picks up from last completed phase.
```

---

## Pipeline 7: Learning from Corrections (`drift_memory_learn`)

How Cortex gets smarter over time.

```
AI calls: drift_memory_learn original="Used MD5 for hashing" feedback="Use bcrypt with 12 salt rounds"

1. CORRECTION ANALYSIS
   CorrectionAnalyzer categorizes the correction:
     pattern_violation | tribal_miss | constraint_violation |
     style_preference | naming_convention | architecture_mismatch |
     security_issue | performance_issue | api_misuse | other

2. DIFF ANALYSIS (if code provided)
   DiffAnalyzer compares original vs corrected code
   Extracts: additions, removals, modifications, semantic changes

3. PRINCIPLE EXTRACTION
   PrincipleExtractor generalizes the correction into a rule:
     "Always use bcrypt with 12 salt rounds for password hashing"
   Assigns confidence to the extracted principle

4. MEMORY CREATION
   LearningMemoryFactory creates appropriate memory type:
     security_issue → tribal (critical importance)
     pattern_violation → pattern_rationale
     style_preference → preference
   Links to relevant patterns, files, functions

5. CAUSAL INFERENCE
   Automatically infer causal relationships:
     "MD5 is insecure" → causes → "Use bcrypt instead"
   Store causal edges in causal graph

6. CONTRADICTION CHECK
   Check if new memory contradicts existing memories
   If contradiction found: flag for review, lower confidence of weaker memory

7. PERSISTENCE
   Store memory in cortex.db
   Generate embedding for semantic search
   Link to relevant entities (patterns, files, functions)
```
