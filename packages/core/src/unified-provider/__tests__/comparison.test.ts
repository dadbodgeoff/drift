/**
 * Comparison Tests
 *
 * Verifies that the new UnifiedLanguageProvider produces equivalent
 * or better results compared to the old extractors.
 * 
 * These tests compare actual outputs from both implementations
 * rather than hardcoding expected values.
 */

import { describe, it, expect } from 'vitest';

// Old extractors (original implementation)
import { TypeScriptDataAccessExtractor as OldTSExtractor } from '../../call-graph/extractors/typescript-data-access-extractor.js';
import { PythonDataAccessExtractor as OldPyExtractor } from '../../call-graph/extractors/python-data-access-extractor.js';

// New unified provider
import { createUnifiedProvider } from '../provider/unified-language-provider.js';

describe('Comparison: Old vs New Extractors', () => {
  describe('TypeScript/JavaScript', () => {
    const oldExtractor = new OldTSExtractor();
    const newProvider = createUnifiedProvider({ extractDataAccess: true });

    describe('Supabase patterns', () => {
      it('should produce equivalent results for supabase.from().select()', async () => {
        const code = `
          const { data } = await supabase
            .from('users')
            .select('id, name, email');
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        // Both should detect the access
        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        // New should match old behavior
        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for supabase.from().insert()', async () => {
        const code = `
          await supabase
            .from('posts')
            .insert({ title: 'Hello', content: 'World' });
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for supabase.from().update()', async () => {
        const code = `
          await supabase
            .from('users')
            .update({ name: 'New Name' })
            .eq('id', 1);
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for supabase.from().delete()', async () => {
        const code = `
          await supabase
            .from('sessions')
            .delete()
            .eq('user_id', userId);
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });
    });

    describe('Prisma patterns', () => {
      it('should produce equivalent results for prisma.model.findMany()', async () => {
        const code = `
          const users = await prisma.user.findMany({
            where: { active: true },
            select: { id: true, name: true }
          });
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        // Both should infer table name the same way (pluralized)
        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for prisma.model.create()', async () => {
        const code = `
          const post = await prisma.post.create({
            data: { title: 'Hello', authorId: 1 }
          });
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for prisma.model.delete()', async () => {
        const code = `
          await prisma.comment.delete({
            where: { id: commentId }
          });
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });
    });

    describe('Raw SQL patterns', () => {
      it('should produce equivalent results for SELECT queries', async () => {
        const code = `
          const result = await db.query('SELECT id, name FROM users WHERE active = true');
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
        expect(newResult.dataAccess[0]?.isRawSql).toBe(oldResult.accessPoints[0]?.isRawSql);
      });

      it('should produce equivalent results for INSERT queries', async () => {
        const code = `
          await connection.execute('INSERT INTO logs (message, level) VALUES (?, ?)');
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for UPDATE queries', async () => {
        const code = `
          await pool.query('UPDATE products SET price = $1 WHERE id = $2');
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for DELETE queries', async () => {
        const code = `
          await db.execute('DELETE FROM temp_data WHERE created_at < NOW()');
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });
    });

    describe('Complex scenarios', () => {
      it('should detect same number of access points in multi-query file', async () => {
        const code = `
          async function getUserWithPosts(userId: string) {
            const user = await supabase
              .from('users')
              .select('*')
              .eq('id', userId)
              .single();
            
            const posts = await supabase
              .from('posts')
              .select('id, title')
              .eq('author_id', userId);
            
            return { user, posts };
          }
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        // Both should detect same number of access points
        expect(newResult.dataAccess.length).toBe(oldResult.accessPoints.length);

        // Tables should match
        const oldTables = oldResult.accessPoints.map(ap => ap.table).sort();
        const newTables = newResult.dataAccess.map(da => da.table).sort();
        expect(newTables).toEqual(oldTables);
      });

      it('should handle chained operations equivalently', async () => {
        const code = `
          const result = await supabase
            .from('orders')
            .select('id, total, status')
            .eq('user_id', userId)
            .gte('total', 100)
            .order('created_at', { ascending: false })
            .limit(10);
        `;

        const oldResult = oldExtractor.extract(code, 'test.ts');
        const newResult = await newProvider.extract(code, 'test.ts');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });
    });
  });

  describe('Python', () => {
    const oldExtractor = new OldPyExtractor();
    const newProvider = createUnifiedProvider({ extractDataAccess: true });

    describe('Django ORM patterns', () => {
      it('should produce equivalent results for Model.objects.all()', async () => {
        const code = `
from myapp.models import User

def get_all_users():
    return User.objects.all()
        `;

        const oldResult = oldExtractor.extract(code, 'test.py');
        const newResult = await newProvider.extract(code, 'test.py');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for Model.objects.filter()', async () => {
        const code = `
def get_active_users():
    return User.objects.filter(is_active=True)
        `;

        const oldResult = oldExtractor.extract(code, 'test.py');
        const newResult = await newProvider.extract(code, 'test.py');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should produce equivalent results for Model.objects.create()', async () => {
        const code = `
def create_user(name, email):
    return User.objects.create(name=name, email=email)
        `;

        const oldResult = oldExtractor.extract(code, 'test.py');
        const newResult = await newProvider.extract(code, 'test.py');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        expect(newResult.dataAccess[0]?.operation).toBe(oldResult.accessPoints[0]?.operation);
      });

      it('should correctly identify filter().delete() as delete (improvement over old)', async () => {
        const code = `
def delete_inactive_users():
    User.objects.filter(is_active=False).delete()
        `;

        const oldResult = oldExtractor.extract(code, 'test.py');
        const newResult = await newProvider.extract(code, 'test.py');

        expect(oldResult.accessPoints.length).toBeGreaterThan(0);
        expect(newResult.dataAccess.length).toBeGreaterThan(0);

        // Table should match
        expect(newResult.dataAccess[0]?.table).toBe(oldResult.accessPoints[0]?.table);
        
        // Old extractor incorrectly returns 'read', new provider correctly returns 'delete'
        expect(oldResult.accessPoints[0]?.operation).toBe('read'); // Bug in old extractor
        expect(newResult.dataAccess[0]?.operation).toBe('delete'); // Correct behavior
      });
    });

    describe('SQLAlchemy patterns (new capability)', () => {
      // Note: The old extractor doesn't detect SQLAlchemy session patterns
      // These tests verify the new provider improves on the old behavior
      
      it('should detect session.query() (improvement over old extractor)', async () => {
        const code = `
def get_all_products(session):
    return session.query(Product).all()
        `;

        const oldResult = oldExtractor.extract(code, 'test.py');
        const newResult = await newProvider.extract(code, 'test.py');

        // Old extractor misses this pattern
        expect(oldResult.accessPoints.length).toBe(0);
        
        // New provider should detect it (improvement)
        expect(newResult.dataAccess.length).toBeGreaterThan(0);
        expect(newResult.dataAccess[0]?.operation).toBe('read');
      });

      it('should detect session.add() (improvement over old extractor)', async () => {
        const code = `
def create_product(session, name, price):
    product = Product(name=name, price=price)
    session.add(product)
    session.commit()
        `;

        const oldResult = oldExtractor.extract(code, 'test.py');
        const newResult = await newProvider.extract(code, 'test.py');

        // Old extractor misses this pattern
        expect(oldResult.accessPoints.length).toBe(0);

        // New provider should detect it (improvement)
        expect(newResult.dataAccess.length).toBeGreaterThan(0);
      });

      it('should detect session.delete() (improvement over old extractor)', async () => {
        const code = `
def delete_product(session, product):
    session.delete(product)
    session.commit()
        `;

        const oldResult = oldExtractor.extract(code, 'test.py');
        const newResult = await newProvider.extract(code, 'test.py');

        // Old extractor misses this pattern
        expect(oldResult.accessPoints.length).toBe(0);

        // New provider should detect it (improvement)
        expect(newResult.dataAccess.length).toBeGreaterThan(0);
      });
    });
  });

  describe('New capabilities (not in old extractor)', () => {
    const newProvider = createUnifiedProvider({ 
      extractDataAccess: true,
      extractCallGraph: true 
    });

    it('should extract functions', async () => {
      const code = `
        async function fetchUsers() {
          return await supabase.from('users').select('*');
        }

        const getUser = async (id: string) => {
          return await supabase.from('users').select('*').eq('id', id).single();
        };
      `;

      const result = await newProvider.extract(code, 'test.ts');

      // New provider extracts functions (old didn't)
      expect(result.functions.length).toBe(2);
      expect(result.functions.map(f => f.name).sort()).toEqual(['fetchUsers', 'getUser']);
    });

    it('should extract classes', async () => {
      const code = `
        class UserService {
          async getAll() {
            return await supabase.from('users').select('*');
          }

          async create(data: any) {
            return await supabase.from('users').insert(data);
          }
        }
      `;

      const result = await newProvider.extract(code, 'test.ts');

      // New provider extracts classes (old didn't)
      expect(result.classes.length).toBe(1);
      expect(result.classes[0]?.name).toBe('UserService');
      expect(result.classes[0]?.methods).toContain('getAll');
      expect(result.classes[0]?.methods).toContain('create');
    });

    it('should extract imports', async () => {
      const code = `
        import { createClient } from '@supabase/supabase-js';
        import type { User } from './types';

        const supabase = createClient(url, key);
        const users = await supabase.from('users').select('*');
      `;

      const result = await newProvider.extract(code, 'test.ts');

      // New provider extracts imports (old didn't)
      expect(result.imports.length).toBe(2);
      expect(result.imports.some(i => i.source === '@supabase/supabase-js')).toBe(true);
    });

    it('should provide ORM identification', async () => {
      const code = `
        const users = await supabase.from('users').select('*');
      `;

      const result = await newProvider.extract(code, 'test.ts');

      // New provider identifies which ORM (old didn't expose this)
      expect(result.dataAccess.length).toBeGreaterThan(0);
      expect(result.dataAccess[0]?.orm).toBe('supabase');
    });

    it('should provide confidence scores', async () => {
      const code = `
        const users = await supabase.from('users').select('*');
      `;

      const result = await newProvider.extract(code, 'test.ts');

      // New provider includes confidence scores
      expect(result.dataAccess[0]?.confidence).toBeGreaterThan(0);
      expect(result.dataAccess[0]?.confidence).toBeLessThanOrEqual(1);
    });
  });
});
