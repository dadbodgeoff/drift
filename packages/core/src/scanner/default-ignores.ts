/**
 * Enterprise-Grade Default Ignore Patterns
 *
 * Comprehensive ignore patterns for all supported languages and ecosystems.
 * These patterns prevent scanning of build artifacts, dependencies, generated code,
 * and other non-source files that would waste resources and pollute results.
 *
 * Used by:
 * - FileWalker for directory traversal
 * - Call graph builders
 * - CLI scan command
 * - MCP tools
 *
 * @module scanner/default-ignores
 */

/**
 * Directory names to always skip (simple string matching).
 * Used for fast directory-level filtering before glob matching.
 */
export const DEFAULT_IGNORE_DIRECTORIES: readonly string[] = [
  // === Universal ===
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.drift',

  // === Build outputs ===
  'dist',
  'build',
  'out',
  'output',
  '.next',
  '.nuxt',
  '.output',
  '.vercel',
  '.netlify',

  // === Dependencies & Package Managers ===
  '.npm',
  '.yarn',
  '.pnpm-store',
  'bower_components',

  // === Python ===
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.env',
  '.eggs',
  '.tox',
  '.nox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.pytype',
  'htmlcov',
  '.hypothesis',

  // === .NET / C# / F# / VB ===
  'bin',
  'obj',
  // Note: 'packages' removed - conflicts with monorepo packages/ directories
  // NuGet packages are typically in packages/ at solution root, but this
  // pattern was incorrectly ignoring monorepo source code directories
  '.vs',
  'TestResults',
  'BenchmarkDotNet.Artifacts',

  // === Java / Kotlin / Scala ===
  'target',
  '.gradle',
  '.m2',
  '.mvn',
  '.idea',

  // === Go ===
  'vendor',

  // === Rust ===
  // 'target' already covered above

  // === C / C++ ===
  'cmake-build-debug',
  'cmake-build-release',
  'cmake-build-relwithdebinfo',
  'cmake-build-minsizerel',
  'CMakeFiles',
  '.ccache',
  'conan',

  // === Ruby ===
  '.bundle',

  // === PHP ===
  // 'vendor' already covered above

  // === Elixir / Erlang ===
  '_build',
  'deps',
  '.elixir_ls',

  // === Swift / iOS / macOS ===
  '.build',
  'DerivedData',
  'Pods',
  'Carthage',

  // === Android ===
  '.gradle',
  '.cxx',

  // === Coverage & Testing ===
  'coverage',
  '.nyc_output',
  '__snapshots__',

  // === IDE / Editor ===
  '.idea',
  '.vscode',
  '.vs',
  '.eclipse',
  '.settings',

  // === Temporary / Cache ===
  'tmp',
  'temp',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.nx',
  '.angular',

  // === Documentation generators ===
  '_site',
  '.docusaurus',
  '.vitepress',
  'docs/_build',
  'site',
] as const;

/**
 * Glob patterns for comprehensive file/directory ignoring.
 * Used when full glob matching is needed.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  // === Universal directories ===
  'node_modules/**',
  '.git/**',
  '.svn/**',
  '.hg/**',
  '.drift/**',
  'dist/**',
  'build/**',
  'out/**',
  'output/**',
  'coverage/**',

  // === Node.js / JavaScript / TypeScript ===
  '.next/**',
  '.nuxt/**',
  '.output/**',
  '.vercel/**',
  '.netlify/**',
  '.npm/**',
  '.yarn/**',
  '.pnpm-store/**',
  '.turbo/**',
  '.nx/**',
  '.angular/**',
  '.parcel-cache/**',
  'bower_components/**',

  // === Python ===
  '__pycache__/**',
  '.venv/**',
  'venv/**',
  'env/**',
  '.eggs/**',
  '*.egg-info/**',
  '.tox/**',
  '.nox/**',
  '.mypy_cache/**',
  '.pytest_cache/**',
  '.ruff_cache/**',
  '.pytype/**',
  'htmlcov/**',
  '.hypothesis/**',
  '*.pyc',
  '*.pyo',
  '*.pyd',
  '.Python',
  'pip-wheel-metadata/**',

  // === .NET / C# / F# / VB / MAUI / Blazor / WPF ===
  'bin/**',
  'obj/**',
  // Note: 'packages/**' removed - conflicts with monorepo packages/ directories
  // NuGet packages are handled by more specific patterns below
  '.vs/**',
  'TestResults/**',
  'BenchmarkDotNet.Artifacts/**',
  '*.dll',
  '*.exe',
  '*.pdb',
  '*.nupkg',
  '*.snupkg',
  '*.msi',
  '*.msix',
  'wwwroot/lib/**',
  'publish/**',
  'artifacts/**',

  // === Java / Kotlin / Scala / Spring / Gradle / Maven ===
  'target/**',
  '.gradle/**',
  '.m2/**',
  '.mvn/**',
  '*.class',
  '*.jar',
  '*.war',
  '*.ear',
  '*.nar',
  'hs_err_pid*',

  // === Go ===
  'vendor/**',
  '*.exe',
  '*.test',
  '*.out',

  // === Rust ===
  'target/**',
  '*.rlib',
  '*.rmeta',
  'Cargo.lock',

  // === C / C++ / CMake ===
  'cmake-build-*/**',
  'CMakeFiles/**',
  'CMakeCache.txt',
  '.ccache/**',
  'conan/**',
  '*.o',
  '*.obj',
  '*.a',
  '*.lib',
  '*.so',
  '*.so.*',
  '*.dylib',
  '*.dll',
  '*.exe',
  '*.out',
  '*.app',
  '*.dSYM/**',
  '*.gcno',
  '*.gcda',
  '*.gcov',

  // === Ruby ===
  '.bundle/**',
  'vendor/bundle/**',
  '*.gem',

  // === PHP / Laravel / Symfony / Composer ===
  'vendor/**',
  'storage/framework/**',
  'bootstrap/cache/**',
  '*.phar',

  // === Elixir / Erlang ===
  '_build/**',
  'deps/**',
  '.elixir_ls/**',
  '*.beam',
  'erl_crash.dump',

  // === Swift / iOS / macOS / Xcode ===
  '.build/**',
  'DerivedData/**',
  'Pods/**',
  'Carthage/**',
  '*.xcworkspace/**',
  '*.xcodeproj/**',
  '*.playground/**',
  '*.ipa',
  '*.dSYM/**',

  // === Android ===
  '.gradle/**',
  '.cxx/**',
  '*.apk',
  '*.aab',
  '*.ap_',
  'local.properties',

  // === IDE / Editor ===
  '.idea/**',
  '.vscode/**',
  '.vs/**',
  '.eclipse/**',
  '.settings/**',
  '*.swp',
  '*.swo',
  '*~',
  '.project',
  '.classpath',
  '*.iml',

  // === OS files ===
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.lnk',

  // === Logs ===
  '*.log',
  'logs/**',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  'pnpm-debug.log*',
  'lerna-debug.log*',

  // === Temporary / Cache ===
  'tmp/**',
  'temp/**',
  '.cache/**',
  '.temp/**',
  '.tmp/**',

  // === Archives / Binaries (common in enterprise) ===
  '*.zip',
  '*.rar',
  '*.7z',
  '*.tar',
  '*.tar.gz',
  '*.tgz',
  '*.tar.bz2',
  '*.tar.xz',
  '*.gz',
  '*.bz2',
  '*.xz',

  // === Database files ===
  '*.sqlite',
  '*.sqlite3',
  '*.db',
  '*.mdb',
  '*.accdb',

  // === Media files (usually not source code) ===
  '*.mp3',
  '*.mp4',
  '*.avi',
  '*.mov',
  '*.wmv',
  '*.flv',
  '*.wav',
  '*.ogg',

  // === Large binary assets ===
  '*.pdf',
  '*.doc',
  '*.docx',
  '*.xls',
  '*.xlsx',
  '*.ppt',
  '*.pptx',

  // === Images (keep small ones, skip large) ===
  '*.psd',
  '*.ai',
  '*.sketch',
  '*.fig',

  // === Minified / Bundled (generated) ===
  '*.min.js',
  '*.min.css',
  '*.bundle.js',
  '*.bundle.css',
  '*.chunk.js',
  '*.chunk.css',

  // === Source maps (generated) ===
  '*.map',
  '*.js.map',
  '*.css.map',

  // === Lock files (not source code) ===
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'go.sum',

  // === Generated documentation ===
  '_site/**',
  '.docusaurus/**',
  '.vitepress/**',
  'docs/_build/**',
  'site/**',
  'javadoc/**',
  'apidoc/**',

  // === Terraform / Infrastructure ===
  '.terraform/**',
  '*.tfstate',
  '*.tfstate.*',

  // === Docker ===
  '.docker/**',

  // === Kubernetes ===
  '.kube/**',

  // === Serverless ===
  '.serverless/**',
  '.aws-sam/**',

  // === Test fixtures that are large ===
  'fixtures/**/*.json',
  '__fixtures__/**',
  'test-data/**',
  'testdata/**',
] as const;

/**
 * File extensions to always skip (without the dot).
 * Used for fast extension-based filtering.
 */
export const DEFAULT_IGNORE_EXTENSIONS: readonly string[] = [
  // Compiled / Binary
  'dll',
  'exe',
  'pdb',
  'class',
  'jar',
  'war',
  'ear',
  'pyc',
  'pyo',
  'o',
  'obj',
  'a',
  'lib',
  'so',
  'dylib',
  'beam',

  // Archives
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'tgz',

  // Media
  'mp3',
  'mp4',
  'avi',
  'mov',
  'wmv',
  'wav',
  'ogg',
  'flv',

  // Documents
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',

  // Design
  'psd',
  'ai',
  'sketch',
  'fig',

  // Database
  'sqlite',
  'sqlite3',
  'db',
  'mdb',

  // Logs
  'log',

  // Lock files
  'lock',
] as const;

/**
 * Check if a directory name should be ignored.
 * Fast O(1) lookup using Set.
 */
const ignoreDirectorySet = new Set(DEFAULT_IGNORE_DIRECTORIES);

export function shouldIgnoreDirectory(dirName: string): boolean {
  // Check exact match
  if (ignoreDirectorySet.has(dirName)) {
    return true;
  }

  // Check cmake-build-* pattern
  if (dirName.startsWith('cmake-build-')) {
    return true;
  }

  // Skip hidden directories (except specific ones we want)
  if (dirName.startsWith('.') && !['src', 'test', 'tests', 'spec', 'specs'].includes(dirName)) {
    // Allow .github, .circleci, etc. for CI config analysis
    const allowedHidden = ['.github', '.circleci', '.gitlab', '.azure-pipelines'];
    if (!allowedHidden.includes(dirName)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file extension should be ignored.
 * Fast O(1) lookup using Set.
 */
const ignoreExtensionSet = new Set(DEFAULT_IGNORE_EXTENSIONS);

export function shouldIgnoreExtension(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) {return false;}
  return ignoreExtensionSet.has(ext);
}

/**
 * Get all default ignore patterns as a single array.
 * Useful for passing to glob libraries.
 */
export function getDefaultIgnorePatterns(): string[] {
  return [...DEFAULT_IGNORE_PATTERNS];
}

/**
 * Get default ignore directories as a single array.
 * Useful for simple directory name checks.
 */
export function getDefaultIgnoreDirectories(): string[] {
  return [...DEFAULT_IGNORE_DIRECTORIES];
}

/**
 * Merge user patterns with defaults, removing duplicates.
 */
export function mergeIgnorePatterns(userPatterns: string[]): string[] {
  const combined = new Set([...DEFAULT_IGNORE_PATTERNS, ...userPatterns]);
  return Array.from(combined);
}
