/**
 * Tests for Semantic Data Access Scanner
 * 
 * These tests verify the unified provider system works correctly
 * through the compat layer aliases.
 */

import { describe, it, expect } from 'vitest';
import { SemanticDataAccessScanner, createSemanticDataAccessScanner } from '../../unified-provider/compat/index.js';
import { createUnifiedDataAccessAdapter } from '../../unified-provider/integration/unified-data-access-adapter.js';

describe('SemanticDataAccessScanner (Unified Provider)', () => {
  describe('UnifiedDataAccessAdapter directly', () => {
    const adapter = createUnifiedDataAccessAdapter();

    it('should detect Supabase .from() calls', async () => {
      const source = `
        const { data } = await supabase
          .from('users')
          .select('id, email, name')
          .eq('active', true);
      `;

      const result = await adapter.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.table === 'users')).toBe(true);
      expect(result.accessPoints.some(ap => ap.operation === 'read')).toBe(true);
    });

    it('should detect Prisma model calls', async () => {
      const source = `
        const users = await prisma.user.findMany({
          where: { active: true },
          select: { id: true, email: true },
        });
      `;

      const result = await adapter.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.table === 'users')).toBe(true);
    });

    it('should detect Supabase insert operations', async () => {
      const source = `
        await supabase
          .from('orders')
          .insert({ user_id: 1, total: 100 });
      `;

      const result = await adapter.extract(source, 'test.ts');

      const orderAccess = result.accessPoints.find(ap => ap.table === 'orders');
      expect(orderAccess).toBeDefined();
      expect(orderAccess?.operation).toBe('write');
    });

    it('should detect Supabase delete operations', async () => {
      const source = `
        await supabase
          .from('sessions')
          .delete()
          .eq('user_id', userId);
      `;

      const result = await adapter.extract(source, 'test.ts');

      const sessionAccess = result.accessPoints.find(ap => ap.table === 'sessions');
      expect(sessionAccess).toBeDefined();
      expect(sessionAccess?.operation).toBe('delete');
    });

    it('should detect Supabase update operations', async () => {
      const source = `
        await supabase
          .from('profiles')
          .update({ name: 'New Name' })
          .eq('id', userId);
      `;

      const result = await adapter.extract(source, 'test.ts');

      const profileAccess = result.accessPoints.find(ap => ap.table === 'profiles');
      expect(profileAccess).toBeDefined();
      expect(profileAccess?.operation).toBe('write');
    });

    it('should extract fields from select clause', async () => {
      const source = `
        const { data } = await supabase
          .from('users')
          .select('id, email, name');
      `;

      const result = await adapter.extract(source, 'test.ts');

      const userAccess = result.accessPoints.find(ap => ap.table === 'users');
      expect(userAccess).toBeDefined();
      expect(userAccess?.fields).toContain('id');
      expect(userAccess?.fields).toContain('email');
      expect(userAccess?.fields).toContain('name');
    });
  });

  describe('factory function', () => {
    it('should create scanner with createSemanticDataAccessScanner', () => {
      const scanner = createSemanticDataAccessScanner({ rootDir: '/test' });
      expect(scanner).toBeInstanceOf(SemanticDataAccessScanner);
    });

    it('should accept verbose option', () => {
      const scanner = createSemanticDataAccessScanner({ rootDir: '/test', verbose: true });
      expect(scanner).toBeInstanceOf(SemanticDataAccessScanner);
    });
  });
});
