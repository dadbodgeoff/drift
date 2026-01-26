# Contributing to Drift

First off, thanks for taking the time to contribute! 🎉

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (code snippets, file structures)
- **Describe the behavior you observed and what you expected**
- **Include your environment** (OS, Node version, package versions)

### Suggesting Features

Feature requests are welcome! Please:

- **Use a clear and descriptive title**
- **Provide a detailed description** of the suggested feature
- **Explain why this feature would be useful** to most users
- **List any alternatives you've considered**

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. Ensure the test suite passes (`pnpm test`)
4. Make sure your code lints (`pnpm lint`)
5. Update documentation if needed
6. Issue the pull request!

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/drift.git
cd drift

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linting
pnpm lint
```

## Project Structure

```
drift/
├── packages/
│   ├── cli/          # Command-line interface
│   ├── core/         # Core pattern matching engine
│   ├── detectors/    # Pattern detectors (101 detectors)
│   ├── dashboard/    # Web dashboard
│   ├── mcp/          # MCP server for AI agents
│   ├── lsp/          # Language Server Protocol
│   └── vscode/       # VS Code extension
├── demo/             # Demo project for testing
└── test-repos/       # Test repositories
```

## Adding a New Detector

Detectors live in `packages/detectors/src/{category}/`. To add a new detector:

1. Create a new file in the appropriate category folder
2. Extend `BaseLearningDetector` or `SemanticDetector`
3. Implement the required methods
4. Register it in `packages/detectors/src/registry/detector-registry.ts`
5. Add tests in the same folder

Example detector structure:

```typescript
import { BaseLearningDetector } from '../base/learning-detector';

export class MyNewDetector extends BaseLearningDetector {
  readonly id = 'my-category/my-detector';
  readonly name = 'My New Detector';
  readonly description = 'Detects X patterns in your codebase';
  readonly category = 'my-category';

  protected extractPatterns(content: string, filePath: string) {
    // Your detection logic here
  }
}
```

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Code style (formatting, semicolons, etc)
- `refactor:` Code change that neither fixes a bug nor adds a feature
- `perf:` Performance improvement
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Examples:
```
feat(detectors): add new RBAC pattern detector
fix(cli): handle empty directories gracefully
docs: update README with MCP setup instructions
```

## Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter driftdetect-core test

# Run tests in watch mode
pnpm test -- --watch
```

## Code Style

- We use TypeScript for all packages
- Prettier for formatting (run `pnpm format`)
- ESLint for linting (run `pnpm lint`)
- Prefer functional patterns where appropriate
- Write descriptive variable and function names

## Questions?

Feel free to open a [Discussion](https://github.com/dadbodgeoff/drift/discussions) if you have questions or want to discuss ideas before implementing them.

Thank you for contributing! 🙏
