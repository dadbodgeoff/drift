/**
 * Unit tests for FileWalker
 *
 * Tests directory traversal, .gitignore/.driftignore pattern support,
 * symlink handling, and progress callbacks.
 *
 * @requirements 2.1, 2.8
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileWalker } from './file-walker.js';
import type { ScanOptions, ScanProgress } from './types.js';

describe('FileWalker', () => {
  let testDir: string;
  let walker: FileWalker;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-test-'));
    walker = new FileWalker();
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('basic traversal', () => {
    it('should scan an empty directory', async () => {
      const result = await walker.walk({ rootDir: testDir });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(0);
      expect(result.directories).toHaveLength(1); // Root directory
      expect(result.errors).toHaveLength(0);
    });

    it('should find files in root directory', async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, 'file1.ts'), 'const x = 1;');
      await fs.writeFile(path.join(testDir, 'file2.js'), 'const y = 2;');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
      expect(result.files.map((f) => f.name).sort()).toEqual(['file1.ts', 'file2.js']);
    });

    it('should recursively traverse subdirectories', async () => {
      // Create nested structure
      await fs.mkdir(path.join(testDir, 'src'));
      await fs.mkdir(path.join(testDir, 'src', 'utils'));
      await fs.writeFile(path.join(testDir, 'index.ts'), 'export {};');
      await fs.writeFile(path.join(testDir, 'src', 'main.ts'), 'export {};');
      await fs.writeFile(path.join(testDir, 'src', 'utils', 'helper.ts'), 'export {};');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(result.directories).toHaveLength(3); // root, src, src/utils
    });

    it('should respect maxDepth option', async () => {
      // Create nested structure
      await fs.mkdir(path.join(testDir, 'level1'));
      await fs.mkdir(path.join(testDir, 'level1', 'level2'));
      await fs.writeFile(path.join(testDir, 'root.ts'), '');
      await fs.writeFile(path.join(testDir, 'level1', 'l1.ts'), '');
      await fs.writeFile(path.join(testDir, 'level1', 'level2', 'l2.ts'), '');

      const result = await walker.walk({ rootDir: testDir, maxDepth: 1 });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2); // root.ts and l1.ts
      expect(result.files.map((f) => f.name).sort()).toEqual(['l1.ts', 'root.ts']);
    });
  });

  describe('.gitignore support', () => {
    it('should respect .gitignore patterns', async () => {
      // Create files and .gitignore
      await fs.writeFile(path.join(testDir, '.gitignore'), 'ignored.ts\n*.log');
      await fs.writeFile(path.join(testDir, 'included.ts'), '');
      await fs.writeFile(path.join(testDir, 'ignored.ts'), '');
      await fs.writeFile(path.join(testDir, 'debug.log'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2); // .gitignore and included.ts
      expect(result.files.map((f) => f.name).sort()).toEqual(['.gitignore', 'included.ts']);
      expect(result.stats.skippedByIgnore).toBe(2);
    });

    it('should ignore directories in .gitignore', async () => {
      // Create structure with ignored directory
      await fs.writeFile(path.join(testDir, '.gitignore'), 'node_modules/');
      await fs.mkdir(path.join(testDir, 'node_modules'));
      await fs.mkdir(path.join(testDir, 'src'));
      await fs.writeFile(path.join(testDir, 'node_modules', 'package.json'), '{}');
      await fs.writeFile(path.join(testDir, 'src', 'index.ts'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.success).toBe(true);
      expect(result.files.map((f) => f.name).sort()).toEqual(['.gitignore', 'index.ts']);
    });

    it('should allow disabling .gitignore respect', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), 'ignored.ts');
      await fs.writeFile(path.join(testDir, 'ignored.ts'), '');
      await fs.writeFile(path.join(testDir, 'included.ts'), '');

      const result = await walker.walk({
        rootDir: testDir,
        respectGitignore: false,
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(3); // .gitignore, ignored.ts, included.ts
    });
  });

  describe('.driftignore support', () => {
    it('should respect .driftignore patterns', async () => {
      await fs.writeFile(path.join(testDir, '.driftignore'), 'generated/\n*.gen.ts');
      await fs.mkdir(path.join(testDir, 'generated'));
      await fs.writeFile(path.join(testDir, 'generated', 'types.ts'), '');
      await fs.writeFile(path.join(testDir, 'api.gen.ts'), '');
      await fs.writeFile(path.join(testDir, 'main.ts'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.success).toBe(true);
      expect(result.files.map((f) => f.name).sort()).toEqual(['.driftignore', 'main.ts']);
    });

    it('should allow disabling .driftignore respect', async () => {
      await fs.writeFile(path.join(testDir, '.driftignore'), 'ignored.ts');
      await fs.writeFile(path.join(testDir, 'ignored.ts'), '');

      const result = await walker.walk({
        rootDir: testDir,
        respectDriftignore: false,
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2); // .driftignore and ignored.ts
    });
  });

  describe('custom ignore patterns', () => {
    it('should respect custom ignorePatterns option', async () => {
      await fs.writeFile(path.join(testDir, 'keep.ts'), '');
      await fs.writeFile(path.join(testDir, 'skip.ts'), '');
      await fs.writeFile(path.join(testDir, 'test.spec.ts'), '');

      const result = await walker.walk({
        rootDir: testDir,
        ignorePatterns: ['skip.ts', '*.spec.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('keep.ts');
    });
  });

  describe('include patterns', () => {
    it('should only include files matching includePatterns', async () => {
      await fs.writeFile(path.join(testDir, 'app.ts'), '');
      await fs.writeFile(path.join(testDir, 'app.js'), '');
      await fs.writeFile(path.join(testDir, 'style.css'), '');

      const result = await walker.walk({
        rootDir: testDir,
        includePatterns: ['*.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('app.ts');
    });
  });

  describe('extension filtering', () => {
    it('should filter by extensions option', async () => {
      await fs.writeFile(path.join(testDir, 'code.ts'), '');
      await fs.writeFile(path.join(testDir, 'code.js'), '');
      await fs.writeFile(path.join(testDir, 'readme.md'), '');

      const result = await walker.walk({
        rootDir: testDir,
        extensions: ['.ts', '.js'],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
      expect(result.files.map((f) => f.extension).sort()).toEqual(['.js', '.ts']);
    });
  });

  describe('file size filtering', () => {
    it('should skip files exceeding maxFileSize', async () => {
      await fs.writeFile(path.join(testDir, 'small.ts'), 'x');
      await fs.writeFile(path.join(testDir, 'large.ts'), 'x'.repeat(1000));

      const result = await walker.walk({
        rootDir: testDir,
        maxFileSize: 100,
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('small.ts');
      expect(result.stats.skippedBySize).toBe(1);
    });
  });

  describe('file info', () => {
    it('should populate FileInfo correctly', async () => {
      const content = 'const x = 1;';
      await fs.writeFile(path.join(testDir, 'test.ts'), content);

      const result = await walker.walk({ rootDir: testDir });

      expect(result.files).toHaveLength(1);
      const file = result.files[0];

      expect(file.name).toBe('test.ts');
      expect(file.extension).toBe('.ts');
      expect(file.relativePath).toBe('test.ts');
      expect(file.size).toBe(content.length);
      expect(file.language).toBe('typescript');
      expect(file.isSymlink).toBe(false);
      expect(file.mtime).toBeInstanceOf(Date);
    });

    it('should compute file hash when requested', async () => {
      await fs.writeFile(path.join(testDir, 'test.ts'), 'content');

      const result = await walker.walk({
        rootDir: testDir,
        computeHashes: true,
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].hash).toBeDefined();
      expect(result.files[0].hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });
  });

  describe('language detection', () => {
    it('should detect TypeScript files', async () => {
      await fs.writeFile(path.join(testDir, 'file.ts'), '');
      await fs.writeFile(path.join(testDir, 'file.tsx'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.files.every((f) => f.language === 'typescript')).toBe(true);
    });

    it('should detect JavaScript files', async () => {
      await fs.writeFile(path.join(testDir, 'file.js'), '');
      await fs.writeFile(path.join(testDir, 'file.jsx'), '');
      await fs.writeFile(path.join(testDir, 'file.mjs'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.files.every((f) => f.language === 'javascript')).toBe(true);
    });

    it('should detect Python files', async () => {
      await fs.writeFile(path.join(testDir, 'file.py'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.files[0].language).toBe('python');
    });

    it('should detect CSS/SCSS files', async () => {
      await fs.writeFile(path.join(testDir, 'style.css'), '');
      await fs.writeFile(path.join(testDir, 'style.scss'), '');

      const result = await walker.walk({ rootDir: testDir });

      const languages = result.files.map((f) => f.language).sort();
      expect(languages).toEqual(['css', 'scss']);
    });

    it('should detect JSON/YAML files', async () => {
      await fs.writeFile(path.join(testDir, 'config.json'), '{}');
      await fs.writeFile(path.join(testDir, 'config.yaml'), '');
      await fs.writeFile(path.join(testDir, 'config.yml'), '');

      const result = await walker.walk({ rootDir: testDir });

      const languages = result.files.map((f) => f.language).sort();
      expect(languages).toEqual(['json', 'yaml', 'yaml']);
    });

    it('should detect Markdown files', async () => {
      await fs.writeFile(path.join(testDir, 'README.md'), '');
      await fs.writeFile(path.join(testDir, 'doc.mdx'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.files.every((f) => f.language === 'markdown')).toBe(true);
    });

    it('should return undefined for unknown extensions', async () => {
      await fs.writeFile(path.join(testDir, 'file.xyz'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.files[0].language).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should track file counts by extension', async () => {
      await fs.writeFile(path.join(testDir, 'a.ts'), '');
      await fs.writeFile(path.join(testDir, 'b.ts'), '');
      await fs.writeFile(path.join(testDir, 'c.js'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.stats.filesByExtension['.ts']).toBe(2);
      expect(result.stats.filesByExtension['.js']).toBe(1);
    });

    it('should track file counts by language', async () => {
      await fs.writeFile(path.join(testDir, 'a.ts'), '');
      await fs.writeFile(path.join(testDir, 'b.tsx'), '');
      await fs.writeFile(path.join(testDir, 'c.py'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.stats.filesByLanguage['typescript']).toBe(2);
      expect(result.stats.filesByLanguage['python']).toBe(1);
    });

    it('should track total size', async () => {
      await fs.writeFile(path.join(testDir, 'a.ts'), '12345');
      await fs.writeFile(path.join(testDir, 'b.ts'), '123');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.stats.totalSize).toBe(8);
    });

    it('should track max depth reached', async () => {
      await fs.mkdir(path.join(testDir, 'a'));
      await fs.mkdir(path.join(testDir, 'a', 'b'));
      await fs.mkdir(path.join(testDir, 'a', 'b', 'c'));
      await fs.writeFile(path.join(testDir, 'a', 'b', 'c', 'deep.ts'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.stats.maxDepthReached).toBe(3);
    });

    it('should track scan duration', async () => {
      await fs.writeFile(path.join(testDir, 'file.ts'), '');

      const result = await walker.walk({ rootDir: testDir });

      expect(result.stats.duration).toBeGreaterThanOrEqual(0);
      expect(result.stats.startTime).toBeInstanceOf(Date);
      expect(result.stats.endTime).toBeInstanceOf(Date);
    });
  });

  describe('progress callback', () => {
    it('should call progress callback during scan', async () => {
      await fs.writeFile(path.join(testDir, 'file1.ts'), '');
      await fs.writeFile(path.join(testDir, 'file2.ts'), '');

      const progressUpdates: ScanProgress[] = [];
      await walker.walk({ rootDir: testDir }, (progress) => {
        progressUpdates.push({ ...progress });
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some((p) => p.phase === 'discovering')).toBe(true);
      expect(progressUpdates.some((p) => p.phase === 'complete')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle non-existent root directory', async () => {
      const result = await walker.walk({ rootDir: '/non/existent/path' });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('read_error');
    });

    it('should handle file as root directory', async () => {
      const filePath = path.join(testDir, 'file.ts');
      await fs.writeFile(filePath, '');

      const result = await walker.walk({ rootDir: filePath });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('shouldIgnore method', () => {
    it('should correctly identify ignored paths', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), 'ignored/\n*.log');

      // Initialize walker with the test directory
      await walker.walk({ rootDir: testDir });

      expect(walker.shouldIgnore('ignored', true)).toBe(true);
      expect(walker.shouldIgnore('test.log', false)).toBe(true);
      expect(walker.shouldIgnore('test.ts', false)).toBe(false);
    });
  });

  describe('detectLanguage method', () => {
    it('should detect language from extension', () => {
      expect(walker.detectLanguage('.ts')).toBe('typescript');
      expect(walker.detectLanguage('.tsx')).toBe('typescript');
      expect(walker.detectLanguage('.js')).toBe('javascript');
      expect(walker.detectLanguage('.py')).toBe('python');
      expect(walker.detectLanguage('.css')).toBe('css');
      expect(walker.detectLanguage('.scss')).toBe('scss');
      expect(walker.detectLanguage('.json')).toBe('json');
      expect(walker.detectLanguage('.yaml')).toBe('yaml');
      expect(walker.detectLanguage('.yml')).toBe('yaml');
      expect(walker.detectLanguage('.md')).toBe('markdown');
      expect(walker.detectLanguage('.unknown')).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      expect(walker.detectLanguage('.TS')).toBe('typescript');
      expect(walker.detectLanguage('.Js')).toBe('javascript');
    });
  });
});
