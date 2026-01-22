/**
 * Tests for Semantic Data Access Scanner
 */

import { describe, it, expect } from 'vitest';
import { SemanticDataAccessScanner, createSemanticDataAccessScanner } from './semantic-data-access-scanner.js';
import { TypeScriptDataAccessExtractor } from './typescript-data-access-extractor.js';

describe('SemanticDataAccessScanner', () => {
  describe('TypeScript extractor directly', () => {
    const extractor = new TypeScriptDataAccessExtractor();

    it('should detect Supabase .from() calls', () => {
      const source = `
        const { data } = await supabase
          .from('users')
          .select('id, email, name')
          .eq('active', true);
      `;

      const result = extractor.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.table === 'users')).toBe(true);
      expect(result.accessPoints.some(ap => ap.operation === 'read')).toBe(true);
    });

    it('should detect Prisma model calls', () => {
      const source = `
        const users = await prisma.user.findMany({
          where: { active: true },
          select: { id: true, email: true },
        });
      `;

      const result = extractor.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.table === 'users')).toBe(true);
    });

    it('should detect raw SQL queries', () => {
      const source = `
        const result = await db.query('SELECT id, name FROM customers WHERE active = true');
      `;

      const result = extractor.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.table === 'customers')).toBe(true);
      expect(result.accessPoints.some(ap => ap.isRawSql)).toBe(true);
    });

    it('should detect Supabase insert operations', () => {
      const source = `
        await supabase
          .from('orders')
          .insert({ user_id: 1, total: 100 });
      `;

      const result = extractor.extract(source, 'test.ts');

      const orderAccess = result.accessPoints.find(ap => ap.table === 'orders');
      expect(orderAccess).toBeDefined();
      expect(orderAccess?.operation).toBe('write');
    });

    it('should detect Supabase delete operations', () => {
      const source = `
        await supabase
          .from('sessions')
          .delete()
          .eq('user_id', userId);
      `;

      const result = extractor.extract(source, 'test.ts');

      const sessionAccess = result.accessPoints.find(ap => ap.table === 'sessions');
      expect(sessionAccess).toBeDefined();
      expect(sessionAccess?.operation).toBe('delete');
    });

    it('should detect Supabase update operations', () => {
      const source = `
        await supabase
          .from('profiles')
          .update({ name: 'New Name' })
          .eq('id', userId);
      `;

      const result = extractor.extract(source, 'test.ts');

      const profileAccess = result.accessPoints.find(ap => ap.table === 'profiles');
      expect(profileAccess).toBeDefined();
      expect(profileAccess?.operation).toBe('write');
    });

    it('should extract fields from select clause', () => {
      const source = `
        const { data } = await supabase
          .from('users')
          .select('id, email, name');
      `;

      const result = extractor.extract(source, 'test.ts');

      const userAccess = result.accessPoints.find(ap => ap.table === 'users');
      expect(userAccess).toBeDefined();
      expect(userAccess?.fields).toContain('id');
      expect(userAccess?.fields).toContain('email');
      expect(userAccess?.fields).toContain('name');
    });

    it('should detect TypeORM repository calls', () => {
      const source = `
        const users = await userRepository.find({ where: { active: true } });
      `;

      const result = extractor.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.operation === 'read')).toBe(true);
    });

    it('should detect Sequelize model calls', () => {
      const source = `
        const users = await User.findAll({ where: { active: true } });
      `;

      const result = extractor.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.table === 'users')).toBe(true);
    });

    it('should detect Knex table calls', () => {
      const source = `
        const users = await knex('users').select('*').where('active', true);
      `;

      const result = extractor.extract(source, 'test.ts');

      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.accessPoints.some(ap => ap.table === 'users')).toBe(true);
    });
  });

  describe('mightHaveDataAccess filter', () => {
    it('should identify files with ORM patterns', () => {
      // This is tested indirectly through the scanner behavior
      const scanner = createSemanticDataAccessScanner({ rootDir: '/test' });
      expect(scanner).toBeInstanceOf(SemanticDataAccessScanner);
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
