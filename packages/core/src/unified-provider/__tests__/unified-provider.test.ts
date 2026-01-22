/**
 * Unified Language Provider Integration Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createUnifiedProvider, UnifiedLanguageProvider } from '../provider/unified-language-provider.js';
import { getParserRegistry } from '../parsing/parser-registry.js';

describe('UnifiedLanguageProvider', () => {
  let provider: UnifiedLanguageProvider;
  let typescriptAvailable: boolean;
  let pythonAvailable: boolean;

  beforeAll(async () => {
    provider = createUnifiedProvider({ projectRoot: '.' });
    const registry = getParserRegistry();
    typescriptAvailable = await registry.isAvailable('typescript');
    pythonAvailable = await registry.isAvailable('python');
  });

  describe('TypeScript extraction', () => {
    it.skipIf(!typescriptAvailable)('should extract Supabase data access', async () => {
      const source = `
        import { createClient } from '@supabase/supabase-js';

        const supabase = createClient(url, key);

        async function getUsers() {
          const { data } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('active', true);
          return data;
        }
      `;

      const result = await provider.extract(source, 'api/users.ts');

      expect(result.errors).toHaveLength(0);
      expect(result.language).toBe('typescript');
      expect(result.dataAccess.length).toBeGreaterThan(0);

      const userAccess = result.dataAccess.find(a => a.table === 'users');
      expect(userAccess).toBeDefined();
      expect(userAccess?.operation).toBe('read');
      expect(userAccess?.orm).toBe('supabase');
      expect(userAccess?.fields).toContain('id');
      expect(userAccess?.fields).toContain('name');
      expect(userAccess?.fields).toContain('email');
      expect(userAccess?.fields).toContain('active');
    });

    it.skipIf(!typescriptAvailable)('should extract Prisma data access', async () => {
      const source = `
        import { PrismaClient } from '@prisma/client';

        const prisma = new PrismaClient();

        async function createUser(data: UserInput) {
          return prisma.user.create({
            data: {
              name: data.name,
              email: data.email,
            },
            select: {
              id: true,
              name: true,
            },
          });
        }
      `;

      const result = await provider.extract(source, 'api/users.ts');

      expect(result.errors).toHaveLength(0);
      expect(result.dataAccess.length).toBeGreaterThan(0);

      const userAccess = result.dataAccess.find(a => a.table === 'users');
      expect(userAccess).toBeDefined();
      expect(userAccess?.operation).toBe('write');
      expect(userAccess?.orm).toBe('prisma');
    });

    it.skipIf(!typescriptAvailable)('should extract raw SQL', async () => {
      const source = `
        async function getActiveUsers(db: Database) {
          const result = await db.query('SELECT id, name FROM users WHERE active = true');
          return result.rows;
        }
      `;

      const result = await provider.extract(source, 'api/users.ts');

      expect(result.errors).toHaveLength(0);
      expect(result.dataAccess.length).toBeGreaterThan(0);

      const userAccess = result.dataAccess.find(a => a.table === 'users');
      expect(userAccess).toBeDefined();
      expect(userAccess?.operation).toBe('read');
      expect(userAccess?.isRawSql).toBe(true);
      expect(userAccess?.fields).toContain('id');
      expect(userAccess?.fields).toContain('name');
    });

    it.skipIf(!typescriptAvailable)('should extract functions and classes', async () => {
      const source = `
        export class UserService {
          constructor(private db: Database) {}

          async getUser(id: string): Promise<User> {
            return this.db.findById(id);
          }

          async createUser(data: UserInput): Promise<User> {
            return this.db.create(data);
          }
        }

        export async function fetchUsers(): Promise<User[]> {
          const service = new UserService(db);
          return service.getUser('1');
        }
      `;

      const result = await provider.extract(source, 'services/user.ts');

      expect(result.errors).toHaveLength(0);
      expect(result.classes.length).toBeGreaterThan(0);
      expect(result.functions.length).toBeGreaterThan(0);

      const userService = result.classes.find(c => c.name === 'UserService');
      expect(userService).toBeDefined();
      expect(userService?.methods).toContain('getUser');
      expect(userService?.methods).toContain('createUser');

      const fetchUsers = result.functions.find(f => f.name === 'fetchUsers');
      expect(fetchUsers).toBeDefined();
      expect(fetchUsers?.isAsync).toBe(true);
      expect(fetchUsers?.isExported).toBe(true);
    });

    it.skipIf(!typescriptAvailable)('should extract imports', async () => {
      const source = `
        import { createClient } from '@supabase/supabase-js';
        import type { User } from './types';
        import * as utils from './utils';
        import defaultExport from './default';
      `;

      const result = await provider.extract(source, 'api/index.ts');

      expect(result.errors).toHaveLength(0);
      expect(result.imports.length).toBeGreaterThanOrEqual(3);

      const supabaseImport = result.imports.find(i => i.source === '@supabase/supabase-js');
      expect(supabaseImport).toBeDefined();
      expect(supabaseImport?.names.some(n => n.imported === 'createClient')).toBe(true);
    });
  });

  describe('Python extraction', () => {
    it.skipIf(!pythonAvailable)('should extract Supabase data access', async () => {
      const source = `
from supabase import create_client

supabase = create_client(url, key)

async def get_users():
    response = supabase.from_('users').select('id, name, email').eq('active', True).execute()
    return response.data
      `;

      const result = await provider.extract(source, 'api/users.py');

      expect(result.errors).toHaveLength(0);
      expect(result.language).toBe('python');
      expect(result.dataAccess.length).toBeGreaterThan(0);

      const userAccess = result.dataAccess.find(a => a.table === 'users');
      expect(userAccess).toBeDefined();
      expect(userAccess?.operation).toBe('read');
      expect(userAccess?.orm).toBe('supabase');
    });

    it.skipIf(!pythonAvailable)('should extract functions and classes', async () => {
      const source = `
class UserService:
    def __init__(self, db):
        self.db = db

    async def get_user(self, user_id: str) -> User:
        return await self.db.find_by_id(user_id)

    @staticmethod
    def validate_email(email: str) -> bool:
        return '@' in email

async def fetch_users() -> list[User]:
    service = UserService(db)
    return await service.get_user('1')
      `;

      const result = await provider.extract(source, 'services/user.py');

      expect(result.errors).toHaveLength(0);
      expect(result.classes.length).toBeGreaterThan(0);
      expect(result.functions.length).toBeGreaterThan(0);

      const userService = result.classes.find(c => c.name === 'UserService');
      expect(userService).toBeDefined();
      expect(userService?.methods).toContain('__init__');
      expect(userService?.methods).toContain('get_user');
      expect(userService?.methods).toContain('validate_email');
    });

    it.skipIf(!pythonAvailable)('should extract imports', async () => {
      const source = `
from supabase import create_client
from typing import List, Optional
import os
from . import utils
      `;

      const result = await provider.extract(source, 'api/__init__.py');

      expect(result.errors).toHaveLength(0);
      expect(result.imports.length).toBeGreaterThanOrEqual(3);

      const supabaseImport = result.imports.find(i => i.source === 'supabase');
      expect(supabaseImport).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should handle unknown file types', async () => {
      const result = await provider.extract('content', 'file.unknown');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Unknown file type');
    });

    it('should handle parse errors gracefully', async () => {
      const source = `
        function broken( {
          // Missing closing brace
      `;

      const result = await provider.extract(source, 'broken.ts');

      // Should not throw, but may have errors or partial results
      expect(result).toBeDefined();
      expect(result.file).toBe('broken.ts');
    });
  });

  describe('Statistics', () => {
    it.skipIf(!typescriptAvailable)('should track extraction statistics', async () => {
      const source = `
        const result = await supabase.from('users').select('*');
        const posts = await supabase.from('posts').select('*');
      `;

      const result = await provider.extract(source, 'api/data.ts');

      expect(result.stats).toBeDefined();
      expect(result.stats.parseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.stats.normalizeTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.stats.matchTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.stats.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.stats.callChainsExtracted).toBeGreaterThan(0);
    });
  });
});
