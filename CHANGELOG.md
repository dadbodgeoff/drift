# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2025-01-20

### Added
- **Semantic Detectors**: New category of detectors that understand code meaning, not just syntax
- **MCP Server** (`driftdetect-mcp`): Model Context Protocol server for AI agent integration
  - `drift_status` - Pattern health overview
  - `drift_patterns` - Query patterns by category
  - `drift_files` - Patterns in specific files
  - `drift_where` - Find pattern usage locations
  - `drift_contracts` - FE/BE API contract mismatches
  - `drift_examples` - Real code examples from codebase
  - `drift_pack` - Pre-built pattern bundles
  - `drift_export` - AI-optimized pattern export
  - `drift_feedback` - Rate examples to improve suggestions
- **Contract Detection**: Automatic detection of frontend/backend API mismatches
  - Missing fields
  - Type mismatches
  - Nullability differences
- **Pattern Packs**: Pre-built bundles for common tasks
  - `backend_route` - API endpoint patterns
  - `react_component` - React component patterns
  - `data_layer` - Database access patterns
  - `testing` - Test structure patterns
  - `security_audit` - Security review patterns
- **Context-aware filtering**: Examples exclude deprecated code, config files, and docs

### Changed
- All 101 detectors transformed to learning-based architecture
- Improved confidence scoring algorithm
- Better outlier detection for pattern violations

### Fixed
- Dashboard pattern filtering performance
- Contract detection for nested response types

## [0.1.8] - 2025-01-15

### Added
- Initial public release
- 101 pattern detectors across 15 categories
- CLI with `init`, `scan`, `status`, `check`, `dashboard` commands
- Web dashboard for pattern management
- VS Code extension (beta)
- LSP server for editor integration

### Categories
- api, auth, security, errors, logging
- data-access, config, testing, performance
- components, styling, structural, types
- accessibility, documentation

---

## Version History

- **0.2.x** - MCP integration, semantic detectors, contract detection
- **0.1.x** - Initial release, core functionality

[Unreleased]: https://github.com/dadbodgeoff/drift/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/dadbodgeoff/drift/compare/v0.1.8...v0.2.2
[0.1.8]: https://github.com/dadbodgeoff/drift/releases/tag/v0.1.8
