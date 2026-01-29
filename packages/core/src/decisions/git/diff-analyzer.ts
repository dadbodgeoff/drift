/**
 * Diff Analyzer
 *
 * Analyzes git diffs to extract semantic information about code changes.
 * Detects architectural signals from the actual code modifications.
 */

import type {
  GitCommit,
  ArchitecturalSignal,
  DependencyDelta,
  DecisionLanguage,
} from '../types.js';
import type {
  ParsedDiff,
  DiffHunk,
  ManifestDiff,
  ManifestDependency,
} from './types.js';

// ============================================================================
// Diff Parsing
// ============================================================================

/**
 * Parse a unified diff string
 */
export function parseDiff(diffString: string): ParsedDiff[] {
  const diffs: ParsedDiff[] = [];
  const lines = diffString.split('\n');
  
  let currentDiff: Partial<ParsedDiff> | null = null;
  let currentHunk: Partial<DiffHunk> | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    // New file diff header
    if (line.startsWith('diff --git')) {
      if (currentDiff?.file) {
        if (currentHunk) {
          currentDiff.hunks = currentDiff.hunks || [];
          currentDiff.hunks.push(currentHunk as DiffHunk);
        }
        diffs.push(currentDiff as ParsedDiff);
      }
      
      currentDiff = {
        file: '',
        changeType: 'modified',
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: false,
      };
      currentHunk = null;
      continue;
    }

    if (!currentDiff) {continue;}

    // File paths
    if (line.startsWith('--- a/')) {
      // Old file path (for renames)
      const oldPath = line.substring(6);
      if (currentDiff.file && currentDiff.file !== oldPath) {
        currentDiff.previousFile = oldPath;
        currentDiff.changeType = 'renamed';
      }
      continue;
    }

    if (line.startsWith('+++ b/')) {
      currentDiff.file = line.substring(6);
      continue;
    }

    if (line.startsWith('+++ /dev/null')) {
      currentDiff.changeType = 'deleted';
      continue;
    }

    if (line.startsWith('--- /dev/null')) {
      currentDiff.changeType = 'added';
      continue;
    }

    // Binary file
    if (line.includes('Binary files')) {
      currentDiff.isBinary = true;
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        currentDiff.hunks = currentDiff.hunks || [];
        currentDiff.hunks.push(currentHunk as DiffHunk);
      }

      oldLineNum = parseInt(hunkMatch[1] ?? '1', 10);
      newLineNum = parseInt(hunkMatch[3] ?? '1', 10);

      const hunk: Partial<DiffHunk> = {
        oldStart: oldLineNum,
        oldLines: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: newLineNum,
        newLines: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
      };
      
      const headerText = hunkMatch[5]?.trim();
      if (headerText) {
        hunk.header = headerText;
      }
      
      currentHunk = hunk;
      continue;
    }

    // Diff lines
    if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines = currentHunk.lines || [];
        currentHunk.lines.push({
          type: 'addition',
          content: line.substring(1),
          newLineNumber: newLineNum++,
        });
        currentDiff.additions = (currentDiff.additions || 0) + 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines = currentHunk.lines || [];
        currentHunk.lines.push({
          type: 'deletion',
          content: line.substring(1),
          oldLineNumber: oldLineNum++,
        });
        currentDiff.deletions = (currentDiff.deletions || 0) + 1;
      } else if (line.startsWith(' ')) {
        currentHunk.lines = currentHunk.lines || [];
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++,
        });
      }
    }
  }

  // Don't forget the last diff
  if (currentDiff?.file) {
    if (currentHunk) {
      currentDiff.hunks = currentDiff.hunks || [];
      currentDiff.hunks.push(currentHunk as DiffHunk);
    }
    diffs.push(currentDiff as ParsedDiff);
  }

  return diffs;
}

// ============================================================================
// Architectural Signal Detection
// ============================================================================

/**
 * Patterns that indicate architectural changes
 */
const ARCHITECTURAL_PATTERNS: Array<{
  pattern: RegExp;
  signalType: ArchitecturalSignal['type'];
  description: string;
  confidence: number;
  languages?: DecisionLanguage[];
}> = [
  // New abstractions
  {
    pattern: /^\+\s*(export\s+)?(abstract\s+class|interface|trait|protocol)\s+\w+/m,
    signalType: 'new-abstraction',
    description: 'New interface or abstract class introduced',
    confidence: 0.8,
  },
  // API surface changes
  {
    pattern: /^\+\s*@(Controller|RestController|RequestMapping|GetMapping|PostMapping|Api|Route)/m,
    signalType: 'api-surface-change',
    description: 'New API endpoint added',
    confidence: 0.9,
    languages: ['java', 'typescript', 'php'],
  },
  {
    pattern: /^\+\s*(app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch))/m,
    signalType: 'api-surface-change',
    description: 'New Express/Fastify route added',
    confidence: 0.8,
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /^\+\s*@(app\.)?(route|get|post|put|delete)\s*\(/m,
    signalType: 'api-surface-change',
    description: 'New Flask/FastAPI route added',
    confidence: 0.8,
    languages: ['python'],
  },
  // Data model changes
  {
    pattern: /^\+\s*@(Entity|Table|Model|Document|Schema)/m,
    signalType: 'data-model-change',
    description: 'New database entity/model added',
    confidence: 0.9,
  },
  {
    pattern: /^\+\s*class\s+\w+.*\(.*Model.*\)/m,
    signalType: 'data-model-change',
    description: 'New Django model added',
    confidence: 0.8,
    languages: ['python'],
  },
  // Auth changes
  {
    pattern: /^\+\s*@(Authorize|RequireAuth|Protected|Auth|Authenticated)/m,
    signalType: 'auth-change',
    description: 'Authentication/authorization decorator added',
    confidence: 0.8,
  },
  {
    pattern: /^\+.*\b(jwt|oauth|bearer|token|session|cookie)\b.*auth/im,
    signalType: 'auth-change',
    description: 'Authentication mechanism change',
    confidence: 0.7,
  },
  // Error handling changes
  {
    pattern: /^\+\s*@(ExceptionHandler|ControllerAdvice|ErrorBoundary)/m,
    signalType: 'error-handling-change',
    description: 'Error handling mechanism added',
    confidence: 0.8,
  },
  {
    pattern: /^\+\s*(class\s+\w+Error|class\s+\w+Exception)\s+extends/m,
    signalType: 'error-handling-change',
    description: 'Custom error class added',
    confidence: 0.7,
  },
  // Config changes
  {
    pattern: /^\+\s*@(Configuration|Bean|Injectable|Module|Provider)/m,
    signalType: 'config-change',
    description: 'Configuration/DI setup added',
    confidence: 0.7,
  },
  // Build changes
  {
    pattern: /^\+\s*(plugins|dependencies|devDependencies)\s*[:{]/m,
    signalType: 'build-change',
    description: 'Build configuration changed',
    confidence: 0.6,
  },
  // Test strategy changes
  {
    pattern: /^\+\s*@(Test|Spec|Describe|It|Given|When|Then)/m,
    signalType: 'test-strategy-change',
    description: 'Test structure added',
    confidence: 0.5,
  },
  // Integration changes
  {
    pattern: /^\+\s*(import|require|from)\s+['"](@?aws-sdk|@azure|@google-cloud|stripe|twilio)/m,
    signalType: 'integration-change',
    description: 'External service integration added',
    confidence: 0.8,
  },
];

/**
 * Analyze diffs for architectural signals
 */
export function analyzeArchitecturalSignals(
  diffs: ParsedDiff[],
  language?: DecisionLanguage
): ArchitecturalSignal[] {
  const signals: ArchitecturalSignal[] = [];
  const signalMap = new Map<string, ArchitecturalSignal>();

  for (const diff of diffs) {
    // Skip binary files
    if (diff.isBinary) {continue;}

    // Get all additions as a single string for pattern matching
    const additions = diff.hunks
      .flatMap(h => h.lines)
      .filter(l => l.type === 'addition')
      .map(l => '+' + l.content)
      .join('\n');

    for (const pattern of ARCHITECTURAL_PATTERNS) {
      // Skip if language-specific and doesn't match
      if (pattern.languages && language && !pattern.languages.includes(language)) {
        continue;
      }

      if (pattern.pattern.test(additions)) {
        const key = `${pattern.signalType}:${pattern.description}`;
        
        if (signalMap.has(key)) {
          // Add file to existing signal
          const existing = signalMap.get(key)!;
          if (!existing.files.includes(diff.file)) {
            existing.files.push(diff.file);
          }
        } else {
          // Create new signal
          const signal: ArchitecturalSignal = {
            type: pattern.signalType,
            description: pattern.description,
            files: [diff.file],
            confidence: pattern.confidence,
          };
          signalMap.set(key, signal);
          signals.push(signal);
        }
      }
    }
  }

  return signals;
}

// ============================================================================
// Dependency Analysis
// ============================================================================

/**
 * Parse package.json content
 */
function parsePackageJson(content: string): { deps: ManifestDependency[]; devDeps: ManifestDependency[] } {
  try {
    const pkg = JSON.parse(content);
    const deps: ManifestDependency[] = [];
    const devDeps: ManifestDependency[] = [];

    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      deps.push({ name, version: version as string });
    }

    for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
      devDeps.push({ name, version: version as string });
    }

    return { deps, devDeps };
  } catch {
    return { deps: [], devDeps: [] };
  }
}

/**
 * Parse requirements.txt content
 */
function parseRequirementsTxt(content: string): ManifestDependency[] {
  const deps: ManifestDependency[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {continue;}

    // Match: package==version, package>=version, package~=version, etc.
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:\[.*\])?(?:([<>=!~]+)(.+))?$/);
    if (match?.[1]) {
      deps.push({
        name: match[1],
        version: match[3] ?? '*',
      });
    }
  }

  return deps;
}

/**
 * Parse composer.json content
 */
function parseComposerJson(content: string): { deps: ManifestDependency[]; devDeps: ManifestDependency[] } {
  try {
    const composer = JSON.parse(content);
    const deps: ManifestDependency[] = [];
    const devDeps: ManifestDependency[] = [];

    for (const [name, version] of Object.entries(composer.require || {})) {
      if (name !== 'php') {
        deps.push({ name, version: version as string });
      }
    }

    for (const [name, version] of Object.entries(composer['require-dev'] || {})) {
      devDeps.push({ name, version: version as string });
    }

    return { deps, devDeps };
  } catch {
    return { deps: [], devDeps: [] };
  }
}

/**
 * Analyze dependency changes from file changes
 */
export function analyzeDependencyChanges(
  commit: GitCommit,
  _getFileContent: (sha: string, path: string) => Promise<string | null>
): Promise<DependencyDelta[]> {
  return Promise.resolve(analyzeDependencyChangesSync(commit));
}

/**
 * Synchronous dependency analysis from commit file changes
 * (Uses heuristics when we can't access file content)
 */
export function analyzeDependencyChangesSync(commit: GitCommit): DependencyDelta[] {
  const deltas: DependencyDelta[] = [];

  for (const file of commit.files) {
    // package.json changes
    if (file.path === 'package.json' || file.path.endsWith('/package.json')) {
      // We can't see the actual content, but we know dependencies might have changed
      if (file.status === 'modified' && (file.additions > 0 || file.deletions > 0)) {
        // This is a heuristic - actual parsing would require file content
        deltas.push({
          name: '[package.json modified]',
          changeType: 'added', // Placeholder
          isDev: false,
          sourceFile: file.path,
        });
      }
    }

    // requirements.txt changes
    if (file.path.includes('requirements') && file.path.endsWith('.txt')) {
      if (file.status === 'modified' || file.status === 'added') {
        deltas.push({
          name: '[requirements.txt modified]',
          changeType: file.status === 'added' ? 'added' : 'upgraded',
          isDev: file.path.includes('dev'),
          sourceFile: file.path,
        });
      }
    }

    // composer.json changes
    if (file.path === 'composer.json' || file.path.endsWith('/composer.json')) {
      if (file.status === 'modified' || file.status === 'added') {
        deltas.push({
          name: '[composer.json modified]',
          changeType: file.status === 'added' ? 'added' : 'upgraded',
          isDev: false,
          sourceFile: file.path,
        });
      }
    }

    // pom.xml changes
    if (file.path === 'pom.xml' || file.path.endsWith('/pom.xml')) {
      if (file.status === 'modified' || file.status === 'added') {
        deltas.push({
          name: '[pom.xml modified]',
          changeType: file.status === 'added' ? 'added' : 'upgraded',
          isDev: false,
          sourceFile: file.path,
        });
      }
    }

    // .csproj changes
    if (file.path.endsWith('.csproj')) {
      if (file.status === 'modified' || file.status === 'added') {
        deltas.push({
          name: '[.csproj modified]',
          changeType: file.status === 'added' ? 'added' : 'upgraded',
          isDev: false,
          sourceFile: file.path,
        });
      }
    }

    // build.gradle changes
    if (file.path.includes('build.gradle')) {
      if (file.status === 'modified' || file.status === 'added') {
        deltas.push({
          name: '[build.gradle modified]',
          changeType: file.status === 'added' ? 'added' : 'upgraded',
          isDev: false,
          sourceFile: file.path,
        });
      }
    }
  }

  return deltas;
}

/**
 * Compare two manifest versions to get detailed dependency changes
 */
export function compareManifests(
  beforeContent: string,
  afterContent: string,
  manifestType: 'npm' | 'pip' | 'composer'
): ManifestDiff {
  let beforeDeps: ManifestDependency[] = [];
  let afterDeps: ManifestDependency[] = [];

  switch (manifestType) {
    case 'npm': {
      const before = parsePackageJson(beforeContent);
      const after = parsePackageJson(afterContent);
      beforeDeps = [...before.deps, ...before.devDeps];
      afterDeps = [...after.deps, ...after.devDeps];
      break;
    }
    case 'pip': {
      beforeDeps = parseRequirementsTxt(beforeContent);
      afterDeps = parseRequirementsTxt(afterContent);
      break;
    }
    case 'composer': {
      const before = parseComposerJson(beforeContent);
      const after = parseComposerJson(afterContent);
      beforeDeps = [...before.deps, ...before.devDeps];
      afterDeps = [...after.deps, ...after.devDeps];
      break;
    }
  }

  const beforeMap = new Map(beforeDeps.map(d => [d.name, d.version]));
  const afterMap = new Map(afterDeps.map(d => [d.name, d.version]));

  const added: ManifestDependency[] = [];
  const removed: ManifestDependency[] = [];
  const upgraded: Array<{ name: string; from: string; to: string }> = [];
  const downgraded: Array<{ name: string; from: string; to: string }> = [];

  // Find added and upgraded
  for (const [name, version] of afterMap) {
    if (!beforeMap.has(name)) {
      added.push({ name, version });
    } else if (beforeMap.get(name) !== version) {
      // Simple version comparison (not semver-aware)
      const from = beforeMap.get(name)!;
      if (version > from) {
        upgraded.push({ name, from, to: version });
      } else {
        downgraded.push({ name, from, to: version });
      }
    }
  }

  // Find removed
  for (const [name, version] of beforeMap) {
    if (!afterMap.has(name)) {
      removed.push({ name, version });
    }
  }

  return { added, removed, upgraded, downgraded };
}
