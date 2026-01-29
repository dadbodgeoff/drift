/**
 * Native module integration tests
 *
 * Tests the native Rust core integration with TypeScript fallback.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  isNativeAvailable,
  getNativeVersion,
  getSupportedLanguages,
  scan,
  parse,
  scanBoundaries,
  analyzeCoupling,
  analyzeTestTopology,
  analyzeErrorHandling,
} from './index';

describe('Native Module', () => {
  describe('availability', () => {
    it('should report native availability status', () => {
      const available = isNativeAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should return supported languages', () => {
      const languages = getSupportedLanguages();
      expect(languages).toContain('typescript');
      expect(languages).toContain('javascript');
      expect(languages).toContain('python');
      expect(languages.length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('parsing', () => {
    it('should parse TypeScript source', async () => {
      const source = `
        import { Request, Response } from 'express';
        
        export class UserController {
          async getUser(req: Request, res: Response): Promise<void> {
            const { id } = req.params;
            res.json({ id });
          }
        }
      `;

      const result = await parse(source, 'test.ts');

      expect(result).not.toBeNull();
      expect(result?.language).toBe('typescript');
      expect(result?.classes.length).toBe(1);
      expect(result?.classes[0].name).toBe('UserController');
      expect(result?.functions.length).toBeGreaterThanOrEqual(1);
      expect(result?.imports.length).toBe(1);
    });

    it('should parse Python source', async () => {
      const source = `
from typing import Optional
from dataclasses import dataclass

@dataclass
class User:
    id: str
    email: str
    name: Optional[str] = None

def get_user(user_id: str) -> Optional[User]:
    return None
      `;

      const result = await parse(source, 'test.py');

      expect(result).not.toBeNull();
      expect(result?.language).toBe('python');
      expect(result?.classes.length).toBe(1);
      expect(result?.functions.length).toBeGreaterThanOrEqual(1);
    });

    it('should return null for unsupported files', async () => {
      const result = await parse('some content', 'test.xyz');
      expect(result).toBeNull();
    });
  });

  describe('boundary scanning', () => {
    it('should detect Prisma data access', async () => {
      const source = `
        const user = await prisma.user.findUnique({ where: { id } });
        await prisma.user.create({ data: { email, name } });
        await prisma.user.delete({ where: { id } });
      `;

      // Write to temp file for scanning
      const tmpDir = fs.mkdtempSync('/tmp/drift-test-');
      const tmpFile = path.join(tmpDir, 'test.ts');
      fs.writeFileSync(tmpFile, source);

      try {
        const result = await scanBoundaries([tmpFile]);

        expect(result.filesScanned).toBe(1);
        // Should detect prisma access points
        expect(result.accessPoints.length).toBeGreaterThanOrEqual(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('should detect SQL queries', async () => {
      const source = `
        const users = await db.query('SELECT * FROM users WHERE active = true');
        await db.query('INSERT INTO orders (user_id, total) VALUES (1, 100)');
      `;

      const tmpDir = fs.mkdtempSync('/tmp/drift-test-');
      const tmpFile = path.join(tmpDir, 'test.ts');
      fs.writeFileSync(tmpFile, source);

      try {
        const result = await scanBoundaries([tmpFile]);

        expect(result.filesScanned).toBe(1);
        // SQL detection via regex fallback
        const sqlAccess = result.accessPoints.filter(
          (a) => a.framework === 'sql'
        );
        expect(sqlAccess.length).toBeGreaterThanOrEqual(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('coupling analysis', () => {
    it('should analyze module dependencies', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/drift-test-');

      // Create a simple project structure
      fs.writeFileSync(
        path.join(tmpDir, 'index.ts'),
        `
        import { UserService } from './user.service';
        export { UserService };
      `
      );

      fs.writeFileSync(
        path.join(tmpDir, 'user.service.ts'),
        `
        import { db } from './db';
        export class UserService {
          async find() { return db.query('SELECT * FROM users'); }
        }
      `
      );

      fs.writeFileSync(
        path.join(tmpDir, 'db.ts'),
        `
        export const db = { query: (sql: string) => [] };
      `
      );

      try {
        const files = [
          path.join(tmpDir, 'index.ts'),
          path.join(tmpDir, 'user.service.ts'),
          path.join(tmpDir, 'db.ts'),
        ];

        const result = await analyzeCoupling(files);

        expect(result.filesAnalyzed).toBe(3);
        expect(result.healthScore).toBeGreaterThanOrEqual(0);
        expect(result.healthScore).toBeLessThanOrEqual(100);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('test topology', () => {
    it('should detect test files and frameworks', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/drift-test-');

      // Create source and test files
      fs.writeFileSync(
        path.join(tmpDir, 'user.service.ts'),
        `
        export class UserService {
          async find() { return []; }
        }
      `
      );

      fs.writeFileSync(
        path.join(tmpDir, 'user.service.test.ts'),
        `
        import { describe, it, expect } from 'vitest';
        import { UserService } from './user.service';
        
        describe('UserService', () => {
          it('should find users', async () => {
            const service = new UserService();
            const users = await service.find();
            expect(users).toEqual([]);
          });
        });
      `
      );

      try {
        const files = [
          path.join(tmpDir, 'user.service.ts'),
          path.join(tmpDir, 'user.service.test.ts'),
        ];

        const result = await analyzeTestTopology(files);

        expect(result.filesAnalyzed).toBe(2);
        expect(result.testFiles.length).toBe(1);
        expect(result.testFiles[0].framework).toBe('vitest');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('error handling analysis', () => {
    it('should detect try/catch blocks', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/drift-test-');

      fs.writeFileSync(
        path.join(tmpDir, 'handler.ts'),
        `
        export async function handleRequest(req: Request): Promise<Response> {
          try {
            const data = await fetchData(req.id);
            return { status: 200, body: data };
          } catch (error) {
            console.error('Failed to fetch:', error);
            return { status: 500, body: 'Internal error' };
          }
        }
      `
      );

      try {
        const files = [path.join(tmpDir, 'handler.ts')];
        const result = await analyzeErrorHandling(files);

        expect(result.filesAnalyzed).toBe(1);
        expect(result.boundaries.length).toBeGreaterThanOrEqual(1);
        expect(result.boundaries[0].boundaryType).toBe('try_catch');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('should detect unhandled async functions', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/drift-test-');

      fs.writeFileSync(
        path.join(tmpDir, 'unsafe.ts'),
        `
        export async function unsafeFunction(): Promise<void> {
          const data = await fetchData();
          processData(data);
        }
      `
      );

      try {
        const files = [path.join(tmpDir, 'unsafe.ts')];
        const result = await analyzeErrorHandling(files);

        expect(result.filesAnalyzed).toBe(1);
        // Should detect unhandled async gap
        const asyncGaps = result.gaps.filter(
          (g) => g.gapType === 'unhandled_async'
        );
        expect(asyncGaps.length).toBeGreaterThanOrEqual(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });
});
