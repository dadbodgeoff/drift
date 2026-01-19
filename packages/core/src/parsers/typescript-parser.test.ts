/**
 * Unit tests for TypeScriptParser
 *
 * Tests the TypeScript/JavaScript parser including AST generation,
 * import/export extraction, and class/function detection.
 *
 * @requirements 3.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TypeScriptParser } from './typescript-parser.js';

describe('TypeScriptParser', () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  describe('properties', () => {
    it('should have typescript as language', () => {
      expect(parser.language).toBe('typescript');
    });

    it('should support TypeScript and JavaScript extensions', () => {
      expect(parser.extensions).toContain('.ts');
      expect(parser.extensions).toContain('.tsx');
      expect(parser.extensions).toContain('.js');
      expect(parser.extensions).toContain('.jsx');
      expect(parser.extensions).toContain('.mts');
      expect(parser.extensions).toContain('.cts');
      expect(parser.extensions).toContain('.mjs');
      expect(parser.extensions).toContain('.cjs');
    });
  });

  describe('canHandle', () => {
    it('should handle TypeScript files', () => {
      expect(parser.canHandle('.ts')).toBe(true);
      expect(parser.canHandle('.tsx')).toBe(true);
      expect(parser.canHandle('.mts')).toBe(true);
      expect(parser.canHandle('.cts')).toBe(true);
    });

    it('should handle JavaScript files', () => {
      expect(parser.canHandle('.js')).toBe(true);
      expect(parser.canHandle('.jsx')).toBe(true);
      expect(parser.canHandle('.mjs')).toBe(true);
      expect(parser.canHandle('.cjs')).toBe(true);
    });

    it('should not handle other file types', () => {
      expect(parser.canHandle('.py')).toBe(false);
      expect(parser.canHandle('.css')).toBe(false);
      expect(parser.canHandle('.json')).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse simple TypeScript code', () => {
      const source = 'const x = 1;';
      const result = parser.parse(source);

      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
      expect(result.language).toBe('typescript');
      expect(result.errors).toHaveLength(0);
    });

    it('should parse TypeScript with types', () => {
      const source = 'const x: number = 1;';
      const result = parser.parse(source);

      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
    });

    it('should parse JSX syntax', () => {
      const source = 'const element = <div>Hello</div>;';
      const result = parser.parse(source, 'test.tsx');

      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
    });

    it('should handle syntax errors gracefully', () => {
      const source = 'const x = {';
      const result = parser.parse(source);

      // Should still return a result, possibly with errors
      expect(result).toBeDefined();
      expect(result.language).toBe('typescript');
    });

    it('should include source text in AST', () => {
      const source = 'const x = 1;';
      const result = parser.parse(source);

      expect(result.ast?.text).toBe(source);
    });
  });

  describe('imports extraction', () => {
    it('should extract named imports', () => {
      const source = `import { foo, bar } from './utils';`;
      const result = parser.parse(source);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].moduleSpecifier).toBe('./utils');
      expect(result.imports[0].namedImports).toContain('foo');
      expect(result.imports[0].namedImports).toContain('bar');
      expect(result.imports[0].defaultImport).toBeNull();
    });

    it('should extract default imports', () => {
      const source = `import React from 'react';`;
      const result = parser.parse(source);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].moduleSpecifier).toBe('react');
      expect(result.imports[0].defaultImport).toBe('React');
      expect(result.imports[0].namedImports).toHaveLength(0);
    });

    it('should extract namespace imports', () => {
      const source = `import * as utils from './utils';`;
      const result = parser.parse(source);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].moduleSpecifier).toBe('./utils');
      expect(result.imports[0].namespaceImport).toBe('utils');
    });

    it('should extract mixed imports', () => {
      const source = `import React, { useState, useEffect } from 'react';`;
      const result = parser.parse(source);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].defaultImport).toBe('React');
      expect(result.imports[0].namedImports).toContain('useState');
      expect(result.imports[0].namedImports).toContain('useEffect');
    });

    it('should extract type-only imports', () => {
      const source = `import type { User } from './types';`;
      const result = parser.parse(source);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].isTypeOnly).toBe(true);
      expect(result.imports[0].namedImports).toContain('User');
    });

    it('should extract aliased imports', () => {
      const source = `import { foo as bar } from './utils';`;
      const result = parser.parse(source);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].namedImports).toContain('foo as bar');
    });

    it('should extract multiple imports', () => {
      const source = `
        import { foo } from './foo';
        import { bar } from './bar';
        import baz from './baz';
      `;
      const result = parser.parse(source);

      expect(result.imports).toHaveLength(3);
    });

    it('should include position information for imports', () => {
      const source = `import { foo } from './utils';`;
      const result = parser.parse(source);

      expect(result.imports[0].startPosition).toBeDefined();
      expect(result.imports[0].endPosition).toBeDefined();
      expect(result.imports[0].startPosition.row).toBe(0);
    });
  });

  describe('exports extraction', () => {
    it('should extract named exports', () => {
      const source = `export { foo, bar };`;
      const result = parser.parse(source);

      expect(result.exports).toHaveLength(2);
      expect(result.exports.map((e) => e.name)).toContain('foo');
      expect(result.exports.map((e) => e.name)).toContain('bar');
    });

    it('should extract default export', () => {
      const source = `export default function main() {}`;
      const result = parser.parse(source);

      const defaultExport = result.exports.find((e) => e.isDefault);
      expect(defaultExport).toBeDefined();
      expect(defaultExport?.name).toBe('main');
    });

    it('should extract export assignment', () => {
      const source = `const foo = 1; export default foo;`;
      const result = parser.parse(source);

      const defaultExport = result.exports.find((e) => e.isDefault);
      expect(defaultExport).toBeDefined();
    });

    it('should extract re-exports', () => {
      const source = `export { foo } from './utils';`;
      const result = parser.parse(source);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].isReExport).toBe(true);
      expect(result.exports[0].moduleSpecifier).toBe('./utils');
    });

    it('should extract export all', () => {
      const source = `export * from './utils';`;
      const result = parser.parse(source);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('*');
      expect(result.exports[0].isReExport).toBe(true);
    });

    it('should extract namespace re-export', () => {
      const source = `export * as utils from './utils';`;
      const result = parser.parse(source);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('utils');
      expect(result.exports[0].localName).toBe('*');
    });

    it('should extract exported function', () => {
      const source = `export function foo() {}`;
      const result = parser.parse(source);

      expect(result.exports.some((e) => e.name === 'foo')).toBe(true);
    });

    it('should extract exported class', () => {
      const source = `export class MyClass {}`;
      const result = parser.parse(source);

      expect(result.exports.some((e) => e.name === 'MyClass')).toBe(true);
    });

    it('should extract exported variable', () => {
      const source = `export const foo = 1;`;
      const result = parser.parse(source);

      expect(result.exports.some((e) => e.name === 'foo')).toBe(true);
    });

    it('should extract type-only exports', () => {
      const source = `export type { User };`;
      const result = parser.parse(source);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].isTypeOnly).toBe(true);
    });
  });

  describe('classes extraction', () => {
    it('should extract class declaration', () => {
      const source = `class MyClass {}`;
      const result = parser.parse(source);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('MyClass');
      expect(result.classes[0].isExported).toBe(false);
    });

    it('should extract exported class', () => {
      const source = `export class MyClass {}`;
      const result = parser.parse(source);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].isExported).toBe(true);
    });

    it('should extract abstract class', () => {
      const source = `abstract class BaseClass {}`;
      const result = parser.parse(source);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].isAbstract).toBe(true);
    });

    it('should extract class with extends', () => {
      const source = `class Child extends Parent {}`;
      const result = parser.parse(source);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].extends).toBe('Parent');
    });

    it('should extract class with implements', () => {
      const source = `class MyClass implements IFoo, IBar {}`;
      const result = parser.parse(source);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].implements).toContain('IFoo');
      expect(result.classes[0].implements).toContain('IBar');
    });

    it('should extract class methods', () => {
      const source = `
        class MyClass {
          foo() {}
          bar() {}
        }
      `;
      const result = parser.parse(source);

      expect(result.classes[0].methods).toContain('foo');
      expect(result.classes[0].methods).toContain('bar');
    });

    it('should extract class properties', () => {
      const source = `
        class MyClass {
          name: string;
          age: number;
        }
      `;
      const result = parser.parse(source);

      expect(result.classes[0].properties).toContain('name');
      expect(result.classes[0].properties).toContain('age');
    });

    it('should extract constructor', () => {
      const source = `
        class MyClass {
          constructor() {}
        }
      `;
      const result = parser.parse(source);

      expect(result.classes[0].methods).toContain('constructor');
    });

    it('should extract getters and setters', () => {
      const source = `
        class MyClass {
          get value() { return this._value; }
          set value(v) { this._value = v; }
        }
      `;
      const result = parser.parse(source);

      expect(result.classes[0].properties).toContain('get value');
      expect(result.classes[0].properties).toContain('set value');
    });
  });

  describe('functions extraction', () => {
    it('should extract function declaration', () => {
      const source = `function foo() {}`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('foo');
      expect(result.functions[0].isExported).toBe(false);
    });

    it('should extract exported function', () => {
      const source = `export function foo() {}`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].isExported).toBe(true);
    });

    it('should extract async function', () => {
      const source = `async function fetchData() {}`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].isAsync).toBe(true);
    });

    it('should extract generator function', () => {
      const source = `function* generator() {}`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].isGenerator).toBe(true);
    });

    it('should extract function parameters', () => {
      const source = `function foo(a, b, c) {}`;
      const result = parser.parse(source);

      expect(result.functions[0].parameters).toEqual(['a', 'b', 'c']);
    });

    it('should extract arrow function assigned to variable', () => {
      const source = `const foo = () => {};`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('foo');
    });

    it('should extract exported arrow function', () => {
      const source = `export const foo = () => {};`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].isExported).toBe(true);
    });

    it('should extract async arrow function', () => {
      const source = `const fetchData = async () => {};`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].isAsync).toBe(true);
    });

    it('should extract function expression', () => {
      const source = `const foo = function() {};`;
      const result = parser.parse(source);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('foo');
    });
  });

  describe('interfaces extraction', () => {
    it('should extract interface declaration', () => {
      const source = `interface User { name: string; }`;
      const result = parser.parse(source);

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0].name).toBe('User');
    });

    it('should extract exported interface', () => {
      const source = `export interface User { name: string; }`;
      const result = parser.parse(source);

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0].isExported).toBe(true);
    });

    it('should extract interface with extends', () => {
      const source = `interface Admin extends User, Role {}`;
      const result = parser.parse(source);

      expect(result.interfaces[0].extends).toContain('User');
      expect(result.interfaces[0].extends).toContain('Role');
    });

    it('should extract interface properties', () => {
      const source = `
        interface User {
          name: string;
          age: number;
        }
      `;
      const result = parser.parse(source);

      expect(result.interfaces[0].properties).toContain('name');
      expect(result.interfaces[0].properties).toContain('age');
    });

    it('should extract interface methods', () => {
      const source = `
        interface Service {
          start(): void;
          stop(): void;
        }
      `;
      const result = parser.parse(source);

      expect(result.interfaces[0].methods).toContain('start');
      expect(result.interfaces[0].methods).toContain('stop');
    });
  });

  describe('type aliases extraction', () => {
    it('should extract type alias', () => {
      const source = `type ID = string;`;
      const result = parser.parse(source);

      expect(result.typeAliases).toHaveLength(1);
      expect(result.typeAliases[0].name).toBe('ID');
    });

    it('should extract exported type alias', () => {
      const source = `export type ID = string;`;
      const result = parser.parse(source);

      expect(result.typeAliases).toHaveLength(1);
      expect(result.typeAliases[0].isExported).toBe(true);
    });

    it('should extract union type alias', () => {
      const source = `type Status = 'pending' | 'active' | 'done';`;
      const result = parser.parse(source);

      expect(result.typeAliases).toHaveLength(1);
      expect(result.typeAliases[0].name).toBe('Status');
    });

    it('should extract complex type alias', () => {
      const source = `type Handler<T> = (value: T) => void;`;
      const result = parser.parse(source);

      expect(result.typeAliases).toHaveLength(1);
      expect(result.typeAliases[0].name).toBe('Handler');
    });
  });

  describe('query', () => {
    it('should find nodes by type', () => {
      const source = `
        const x = 1;
        const y = 2;
      `;
      const result = parser.parse(source);
      const nodes = parser.query(result.ast!, 'VariableDeclaration');

      expect(nodes.length).toBeGreaterThan(0);
    });

    it('should find function declarations', () => {
      const source = `
        function foo() {}
        function bar() {}
      `;
      const result = parser.parse(source);
      const nodes = parser.query(result.ast!, 'FunctionDeclaration');

      expect(nodes).toHaveLength(2);
    });

    it('should return empty array for non-matching pattern', () => {
      const source = `const x = 1;`;
      const result = parser.parse(source);
      const nodes = parser.query(result.ast!, 'ClassDeclaration');

      expect(nodes).toHaveLength(0);
    });
  });

  describe('AST traversal', () => {
    it('should traverse all nodes', () => {
      const source = `const x = 1;`;
      const result = parser.parse(source);
      const nodeTypes: string[] = [];

      parser.traverse(result.ast!, ({ node }) => {
        nodeTypes.push(node.type);
      });

      expect(nodeTypes.length).toBeGreaterThan(0);
      expect(nodeTypes).toContain('SourceFile');
    });

    it('should find node at position', () => {
      const source = `const foo = 1;`;
      const result = parser.parse(source);
      const node = parser.findNodeAtPosition(result.ast!, { row: 0, column: 7 });

      expect(node).not.toBeNull();
    });
  });

  describe('JavaScript parsing', () => {
    it('should parse JavaScript without types', () => {
      const source = `
        const x = 1;
        function foo(a, b) {
          return a + b;
        }
      `;
      const result = parser.parse(source, 'test.js');

      expect(result.success).toBe(true);
      expect(result.functions).toHaveLength(1);
    });

    it('should parse CommonJS require', () => {
      const source = `const fs = require('fs');`;
      const result = parser.parse(source, 'test.js');

      expect(result.success).toBe(true);
    });

    it('should parse CommonJS exports', () => {
      const source = `module.exports = { foo: 1 };`;
      const result = parser.parse(source, 'test.js');

      expect(result.success).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('should parse a complete module', () => {
      const source = `
        import { useState } from 'react';
        import type { User } from './types';

        export interface Props {
          user: User;
        }

        export type Status = 'active' | 'inactive';

        export class UserService {
          private users: User[] = [];

          async getUser(id: string): Promise<User | null> {
            return this.users.find(u => u.id === id) || null;
          }
        }

        export function createUser(name: string): User {
          return { id: '1', name };
        }

        export const fetchUsers = async () => {
          return [];
        };

        export default UserService;
      `;
      const result = parser.parse(source);

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(2);
      expect(result.interfaces).toHaveLength(1);
      expect(result.typeAliases).toHaveLength(1);
      expect(result.classes).toHaveLength(1);
      expect(result.functions.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle decorators', () => {
      const source = `
        @Component({
          selector: 'app-root'
        })
        export class AppComponent {}
      `;
      const result = parser.parse(source);

      expect(result.success).toBe(true);
      expect(result.classes).toHaveLength(1);
    });

    it('should handle generic types', () => {
      const source = `
        export interface Repository<T> {
          find(id: string): Promise<T>;
          save(entity: T): Promise<void>;
        }

        export class BaseRepository<T> implements Repository<T> {
          async find(id: string): Promise<T> {
            throw new Error('Not implemented');
          }
          async save(entity: T): Promise<void> {}
        }
      `;
      const result = parser.parse(source);

      expect(result.success).toBe(true);
      expect(result.interfaces).toHaveLength(1);
      expect(result.classes).toHaveLength(1);
    });
  });
});
