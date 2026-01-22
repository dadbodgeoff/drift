/**
 * TypeScript Normalizer Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TypeScriptNormalizer } from '../normalization/typescript-normalizer.js';
import { getParserRegistry } from '../parsing/parser-registry.js';
import type { TreeSitterNode } from '../../parsers/tree-sitter/types.js';

describe('TypeScriptNormalizer', () => {
  const normalizer = new TypeScriptNormalizer();
  let parser: Awaited<ReturnType<typeof getParserRegistry.prototype.getParser>>;

  beforeAll(async () => {
    parser = await getParserRegistry().getParser('typescript');
  });

  const parse = (source: string): TreeSitterNode => {
    if (!parser) throw new Error('Parser not available');
    return parser.parse(source).rootNode as TreeSitterNode;
  };

  describe('normalizeCallChains', () => {
    it('should extract simple method chain', () => {
      const source = `supabase.from('users').select('*')`;
      const root = parse(source);
      const chains = normalizer.normalizeCallChains(root, source, 'test.ts');

      expect(chains).toHaveLength(1);
      expect(chains[0]?.receiver).toBe('supabase');
      expect(chains[0]?.segments).toHaveLength(2);
      expect(chains[0]?.segments[0]?.name).toBe('from');
      expect(chains[0]?.segments[0]?.args[0]?.stringValue).toBe('users');
      expect(chains[0]?.segments[1]?.name).toBe('select');
      expect(chains[0]?.segments[1]?.args[0]?.stringValue).toBe('*');
    });

    it('should extract Prisma-style chain', () => {
      const source = `prisma.user.findMany({ where: { active: true } })`;
      const root = parse(source);
      const chains = normalizer.normalizeCallChains(root, source, 'test.ts');

      expect(chains).toHaveLength(1);
      expect(chains[0]?.receiver).toBe('prisma');
      expect(chains[0]?.segments).toHaveLength(2);
      expect(chains[0]?.segments[0]?.name).toBe('user');
      expect(chains[0]?.segments[0]?.isCall).toBe(false);
      expect(chains[0]?.segments[1]?.name).toBe('findMany');
      expect(chains[0]?.segments[1]?.isCall).toBe(true);
    });

    it('should extract chain with multiple where clauses', () => {
      const source = `supabase.from('users').select('id, name').eq('active', true).gt('age', 18)`;
      const root = parse(source);
      const chains = normalizer.normalizeCallChains(root, source, 'test.ts');

      expect(chains).toHaveLength(1);
      expect(chains[0]?.segments).toHaveLength(4);
      expect(chains[0]?.segments[2]?.name).toBe('eq');
      expect(chains[0]?.segments[3]?.name).toBe('gt');
    });

    it('should handle object arguments', () => {
      const source = `db.insert({ name: 'John', email: 'john@example.com' })`;
      const root = parse(source);
      const chains = normalizer.normalizeCallChains(root, source, 'test.ts');

      expect(chains).toHaveLength(1);
      const insertArg = chains[0]?.segments[0]?.args[0];
      expect(insertArg?.type).toBe('object');
      expect(insertArg?.properties).toHaveProperty('name');
      expect(insertArg?.properties).toHaveProperty('email');
    });

    it('should handle array arguments', () => {
      const source = `db.select(['id', 'name', 'email'])`;
      const root = parse(source);
      const chains = normalizer.normalizeCallChains(root, source, 'test.ts');

      expect(chains).toHaveLength(1);
      const selectArg = chains[0]?.segments[0]?.args[0];
      expect(selectArg?.type).toBe('array');
      expect(selectArg?.elements).toHaveLength(3);
    });
  });

  describe('extractFunctions', () => {
    it('should extract function declarations', () => {
      const source = `
        function getUsers() {
          return [];
        }

        async function fetchUser(id: string): Promise<User> {
          return await db.find(id);
        }
      `;
      const root = parse(source);
      const functions = normalizer.extractFunctions(root, source, 'test.ts');

      expect(functions).toHaveLength(2);
      expect(functions[0]?.name).toBe('getUsers');
      expect(functions[0]?.isAsync).toBe(false);
      expect(functions[1]?.name).toBe('fetchUser');
      expect(functions[1]?.isAsync).toBe(true);
      expect(functions[1]?.parameters).toHaveLength(1);
      expect(functions[1]?.parameters[0]?.name).toBe('id');
    });

    it('should extract arrow functions', () => {
      const source = `
        const getUsers = () => [];
        const fetchUser = async (id: string) => await db.find(id);
      `;
      const root = parse(source);
      const functions = normalizer.extractFunctions(root, source, 'test.ts');

      expect(functions).toHaveLength(2);
      expect(functions[0]?.name).toBe('getUsers');
      expect(functions[1]?.name).toBe('fetchUser');
      expect(functions[1]?.isAsync).toBe(true);
    });

    it('should extract class methods', () => {
      const source = `
        class UserService {
          constructor(private db: Database) {}

          async getUser(id: string) {
            return this.db.find(id);
          }

          static create() {
            return new UserService(new Database());
          }
        }
      `;
      const root = parse(source);
      const functions = normalizer.extractFunctions(root, source, 'test.ts');

      expect(functions.length).toBeGreaterThanOrEqual(3);
      const constructor = functions.find(f => f.name === 'constructor');
      const getUser = functions.find(f => f.name === 'getUser');
      const create = functions.find(f => f.name === 'create');

      expect(constructor?.isConstructor).toBe(true);
      expect(getUser?.isMethod).toBe(true);
      expect(getUser?.isAsync).toBe(true);
      expect(create?.isStatic).toBe(true);
    });
  });

  describe('extractClasses', () => {
    it('should extract class with inheritance', () => {
      const source = `
        class UserService extends BaseService implements IUserService {
          getUser(id: string) {}
          createUser(data: UserData) {}
        }
      `;
      const root = parse(source);
      const classes = normalizer.extractClasses(root, source, 'test.ts');

      expect(classes).toHaveLength(1);
      expect(classes[0]?.name).toBe('UserService');
      expect(classes[0]?.methods).toContain('getUser');
      expect(classes[0]?.methods).toContain('createUser');
    });
  });

  describe('extractImports', () => {
    it('should extract various import styles', () => {
      const source = `
        import { User, type UserData } from './models';
        import * as utils from './utils';
        import defaultExport from './default';
        import './side-effect';
      `;
      const root = parse(source);
      const imports = normalizer.extractImports(root, source, 'test.ts');

      expect(imports.length).toBeGreaterThanOrEqual(3);

      const namedImport = imports.find(i => i.source === './models');
      expect(namedImport?.names.some(n => n.imported === 'User')).toBe(true);

      const namespaceImport = imports.find(i => i.source === './utils');
      expect(namespaceImport?.names[0]?.isNamespace).toBe(true);
      expect(namespaceImport?.names[0]?.local).toBe('utils');

      const defaultImport = imports.find(i => i.source === './default');
      expect(defaultImport?.names[0]?.isDefault).toBe(true);
    });
  });

  describe('extractExports', () => {
    it('should extract various export styles', () => {
      const source = `
        export function getUsers() {}
        export const API_URL = 'https://api.example.com';
        export default class UserService {}
        export { helper } from './utils';
      `;
      const root = parse(source);
      const exports = normalizer.extractExports(root, source, 'test.ts');

      expect(exports.length).toBeGreaterThanOrEqual(3);

      const funcExport = exports.find(e => e.name === 'getUsers');
      expect(funcExport).toBeDefined();

      const defaultExport = exports.find(e => e.isDefault);
      expect(defaultExport).toBeDefined();

      const reExport = exports.find(e => e.isReExport);
      expect(reExport?.source).toBe('./utils');
    });
  });
});
