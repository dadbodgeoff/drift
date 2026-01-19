/**
 * Property-Based Tests for FileWalker
 *
 * Property: Gitignore Exclusion
 * For any file matching .gitignore, it SHALL NOT appear in scan results
 * **Validates: Requirements 2.1**
 *
 * @requirements 2.1 - THE Scanner SHALL traverse directory structures respecting .gitignore and .driftignore patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileWalker } from './file-walker.js';

/**
 * Helper to create a valid filename with required extension
 */
const validFilenameArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }),
    fc.constantFrom('.ts', '.js', '.py', '.css', '.json', '.md', '.txt')
  )
  .map(([name, ext]) => `${name}${ext}`);

/**
 * Helper to create a valid directory name
 */
const validDirNameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'),
  { minLength: 2, maxLength: 8 }
);

describe('FileWalker Property Tests', () => {
  let testDir: string;
  let walker: FileWalker;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-'));
    walker = new FileWalker();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Property: Gitignore Exclusion
   * For any file matching .gitignore, it SHALL NOT appear in scan results
   * **Validates: Requirements 2.1**
   */
  describe('Property: Gitignore Exclusion', () => {
    it('should exclude files with exact name match in .gitignore', async () => {
      await fc.assert(
        fc.asyncProperty(
          validFilenameArb,
          validFilenameArb.filter((f) => f.length > 3), // Ensure different from first
          async (ignoredFile, keptFile) => {
            // Ensure files are different
            if (ignoredFile === keptFile) {
              return true; // Skip this case
            }

            // Create files
            await fs.writeFile(path.join(testDir, ignoredFile), `// ${ignoredFile}`);
            await fs.writeFile(path.join(testDir, keptFile), `// ${keptFile}`);

            // Create .gitignore with exact filename
            await fs.writeFile(path.join(testDir, '.gitignore'), ignoredFile);

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get scanned file names (excluding .gitignore)
            const scannedFileNames = result.files
              .map((f) => f.name)
              .filter((f) => f !== '.gitignore');

            // PROPERTY: The ignored file should NOT appear in results
            expect(scannedFileNames).not.toContain(ignoredFile);

            // The kept file should still be present
            expect(scannedFileNames).toContain(keptFile);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should exclude all files matching glob extension pattern', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('.ts', '.js', '.py', '.css', '.json'),
          fc.constantFrom('.md', '.txt'),
          validFilenameArb,
          async (ignoredExt, keptExt, baseName) => {
            // Create files with ignored extension
            const ignoredFile1 = `file1${ignoredExt}`;
            const ignoredFile2 = `file2${ignoredExt}`;
            // Create file with kept extension
            const keptFile = `${baseName.replace(/\.[^.]+$/, '')}${keptExt}`;

            await fs.writeFile(path.join(testDir, ignoredFile1), '// ignored1');
            await fs.writeFile(path.join(testDir, ignoredFile2), '// ignored2');
            await fs.writeFile(path.join(testDir, keptFile), '// kept');

            // Create .gitignore with glob pattern
            await fs.writeFile(path.join(testDir, '.gitignore'), `*${ignoredExt}`);

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get scanned file extensions (excluding .gitignore)
            const scannedFiles = result.files
              .filter((f) => f.name !== '.gitignore')
              .map((f) => f.name);

            // PROPERTY: No file with ignored extension should appear
            for (const file of scannedFiles) {
              expect(file).not.toMatch(new RegExp(`\\${ignoredExt}$`));
            }

            // The kept file should still be present
            expect(scannedFiles).toContain(keptFile);

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should exclude entire directories matching directory pattern', async () => {
      await fc.assert(
        fc.asyncProperty(
          validDirNameArb,
          validFilenameArb,
          validFilenameArb,
          async (ignoredDir, fileInIgnoredDir, rootFile) => {
            // Create directory structure
            await fs.mkdir(path.join(testDir, ignoredDir), { recursive: true });
            await fs.writeFile(path.join(testDir, ignoredDir, fileInIgnoredDir), '// inside ignored');
            await fs.writeFile(path.join(testDir, rootFile), '// root file');

            // Create .gitignore with directory pattern
            await fs.writeFile(path.join(testDir, '.gitignore'), `${ignoredDir}/`);

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get scanned file paths
            const scannedPaths = result.files.map((f) => f.relativePath.replace(/\\/g, '/'));

            // PROPERTY: No file inside the ignored directory should appear
            const filesInIgnoredDir = scannedPaths.filter((p) =>
              p.startsWith(`${ignoredDir}/`)
            );
            expect(filesInIgnoredDir).toHaveLength(0);

            // Root file should still be present
            expect(scannedPaths).toContain(rootFile);

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should exclude files in subdirectories matching glob pattern', async () => {
      await fc.assert(
        fc.asyncProperty(
          validDirNameArb,
          fc.constantFrom('.log', '.tmp', '.bak'),
          async (subdir, ignoredExt) => {
            // Create directory structure with files
            await fs.mkdir(path.join(testDir, subdir), { recursive: true });
            
            const ignoredInRoot = `root${ignoredExt}`;
            const ignoredInSubdir = `sub${ignoredExt}`;
            const keptInRoot = 'keep.ts';
            const keptInSubdir = 'keep.ts';

            await fs.writeFile(path.join(testDir, ignoredInRoot), '// ignored root');
            await fs.writeFile(path.join(testDir, subdir, ignoredInSubdir), '// ignored sub');
            await fs.writeFile(path.join(testDir, keptInRoot), '// kept root');
            await fs.writeFile(path.join(testDir, subdir, keptInSubdir), '// kept sub');

            // Create .gitignore with glob pattern
            await fs.writeFile(path.join(testDir, '.gitignore'), `*${ignoredExt}`);

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get all scanned files
            const scannedFiles = result.files
              .filter((f) => f.name !== '.gitignore')
              .map((f) => f.name);

            // PROPERTY: No file with ignored extension should appear anywhere
            for (const file of scannedFiles) {
              expect(file).not.toMatch(new RegExp(`\\${ignoredExt}$`));
            }

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle multiple gitignore patterns correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validFilenameArb, { minLength: 2, maxLength: 5 }),
          async (filenames) => {
            // Ensure unique filenames
            const uniqueFiles = [...new Set(filenames)];
            if (uniqueFiles.length < 2) {
              return true; // Skip if not enough unique files
            }

            // Split files: first half ignored, second half kept
            const midpoint = Math.floor(uniqueFiles.length / 2);
            const ignoredFiles = uniqueFiles.slice(0, midpoint);
            const keptFiles = uniqueFiles.slice(midpoint);

            // Create all files
            for (const file of uniqueFiles) {
              await fs.writeFile(path.join(testDir, file), `// ${file}`);
            }

            // Create .gitignore with multiple exact patterns
            await fs.writeFile(path.join(testDir, '.gitignore'), ignoredFiles.join('\n'));

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get scanned file names
            const scannedFileNames = result.files
              .map((f) => f.name)
              .filter((f) => f !== '.gitignore');

            // PROPERTY: All ignored files should NOT appear
            for (const ignored of ignoredFiles) {
              expect(scannedFileNames).not.toContain(ignored);
            }

            // All kept files should appear
            for (const kept of keptFiles) {
              expect(scannedFileNames).toContain(kept);
            }

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should respect .driftignore patterns independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          validFilenameArb,
          validFilenameArb.filter((f) => f.length > 3),
          async (driftIgnoredFile, keptFile) => {
            if (driftIgnoredFile === keptFile) {
              return true;
            }

            // Create files
            await fs.writeFile(path.join(testDir, driftIgnoredFile), '// drift ignored');
            await fs.writeFile(path.join(testDir, keptFile), '// kept');

            // Create .driftignore (not .gitignore)
            await fs.writeFile(path.join(testDir, '.driftignore'), driftIgnoredFile);

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get scanned file names
            const scannedFileNames = result.files
              .map((f) => f.name)
              .filter((f) => f !== '.driftignore');

            // PROPERTY: The drift-ignored file should NOT appear
            expect(scannedFileNames).not.toContain(driftIgnoredFile);

            // The kept file should still be present
            expect(scannedFileNames).toContain(keptFile);

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should combine .gitignore and .driftignore patterns', async () => {
      await fc.assert(
        fc.asyncProperty(
          validFilenameArb,
          validFilenameArb.filter((f) => f.length > 3),
          validFilenameArb.filter((f) => f.length > 4),
          async (gitIgnored, driftIgnored, keptFile) => {
            // Ensure all files are different
            const files = new Set([gitIgnored, driftIgnored, keptFile]);
            if (files.size < 3) {
              return true;
            }

            // Create files
            await fs.writeFile(path.join(testDir, gitIgnored), '// git ignored');
            await fs.writeFile(path.join(testDir, driftIgnored), '// drift ignored');
            await fs.writeFile(path.join(testDir, keptFile), '// kept');

            // Create both ignore files
            await fs.writeFile(path.join(testDir, '.gitignore'), gitIgnored);
            await fs.writeFile(path.join(testDir, '.driftignore'), driftIgnored);

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get scanned file names
            const scannedFileNames = result.files
              .map((f) => f.name)
              .filter((f) => f !== '.gitignore' && f !== '.driftignore');

            // PROPERTY: Both ignored files should NOT appear
            expect(scannedFileNames).not.toContain(gitIgnored);
            expect(scannedFileNames).not.toContain(driftIgnored);

            // The kept file should still be present
            expect(scannedFileNames).toContain(keptFile);

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle negation patterns in .gitignore', async () => {
      // This test verifies that negation patterns (!) work correctly
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('.log', '.tmp', '.bak'),
          validFilenameArb,
          async (ignoredExt, specialFileName) => {
            const specialFile = `important${ignoredExt}`;
            const regularIgnored = `regular${ignoredExt}`;
            const keptFile = specialFileName.replace(/\.[^.]+$/, '.ts');

            // Create files
            await fs.writeFile(path.join(testDir, specialFile), '// special');
            await fs.writeFile(path.join(testDir, regularIgnored), '// regular');
            await fs.writeFile(path.join(testDir, keptFile), '// kept');

            // Create .gitignore with negation pattern
            // First ignore all files with extension, then un-ignore the special one
            await fs.writeFile(
              path.join(testDir, '.gitignore'),
              `*${ignoredExt}\n!${specialFile}`
            );

            // Run the file walker
            const result = await walker.walk({ rootDir: testDir });

            // Get scanned file names
            const scannedFileNames = result.files
              .map((f) => f.name)
              .filter((f) => f !== '.gitignore');

            // PROPERTY: Regular ignored file should NOT appear
            expect(scannedFileNames).not.toContain(regularIgnored);

            // PROPERTY: Special file (negated) SHOULD appear
            expect(scannedFileNames).toContain(specialFile);

            // Kept file should appear
            expect(scannedFileNames).toContain(keptFile);

            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
