/**
 * Python Parser Tests
 *
 * Tests for the Python parser implementation.
 *
 * @requirements 3.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PythonParser } from './python-parser.js';
import type { PythonParseResult } from './python-parser.js';

describe('PythonParser', () => {
  let parser: PythonParser;

  beforeEach(() => {
    parser = new PythonParser();
  });

  describe('basic properties', () => {
    it('should have correct language', () => {
      expect(parser.language).toBe('python');
    });

    it('should have correct extensions', () => {
      expect(parser.extensions).toContain('.py');
      expect(parser.extensions).toContain('.pyw');
      expect(parser.extensions).toContain('.pyi');
    });

    it('should handle Python file extensions', () => {
      expect(parser.canHandle('.py')).toBe(true);
      expect(parser.canHandle('.pyw')).toBe(true);
      expect(parser.canHandle('.pyi')).toBe(true);
      expect(parser.canHandle('.ts')).toBe(false);
    });
  });

  describe('parse()', () => {
    it('should parse empty source', () => {
      const result = parser.parse('');
      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
      expect(result.imports).toEqual([]);
      expect(result.classes).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    it('should parse simple Python code', () => {
      const source = `
x = 1
y = 2
`;
      const result = parser.parse(source);
      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
    });
  });

  describe('import extraction', () => {
    it('should extract simple import statements', () => {
      const source = `import os
import sys`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0]?.module).toBe('os');
      expect(result.imports[0]?.isFromImport).toBe(false);
      expect(result.imports[1]?.module).toBe('sys');
    });

    it('should extract import with alias', () => {
      const source = `import numpy as np`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]?.module).toBe('numpy');
      expect(result.imports[0]?.names[0]?.alias).toBe('np');
    });

    it('should extract from...import statements', () => {
      const source = `from typing import List, Dict, Optional`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]?.module).toBe('typing');
      expect(result.imports[0]?.isFromImport).toBe(true);
      expect(result.imports[0]?.names).toHaveLength(3);
      expect(result.imports[0]?.names[0]?.name).toBe('List');
      expect(result.imports[0]?.names[1]?.name).toBe('Dict');
      expect(result.imports[0]?.names[2]?.name).toBe('Optional');
    });

    it('should extract from...import with alias', () => {
      const source = `from collections import defaultdict as dd`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]?.names[0]?.name).toBe('defaultdict');
      expect(result.imports[0]?.names[0]?.alias).toBe('dd');
    });

    it('should extract relative imports', () => {
      const source = `from . import utils
from .. import config
from ...package import module`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0]?.level).toBe(1);
      expect(result.imports[1]?.level).toBe(2);
      expect(result.imports[2]?.level).toBe(3);
    });
  });

  describe('function extraction', () => {
    it('should extract simple function', () => {
      const source = `def hello():
    print("Hello")`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]?.name).toBe('hello');
      expect(result.functions[0]?.isAsync).toBe(false);
      expect(result.functions[0]?.parameters).toEqual([]);
    });

    it('should extract function with parameters', () => {
      const source = `def greet(name, greeting="Hello"):
    print(f"{greeting}, {name}")`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]?.name).toBe('greet');
      expect(result.functions[0]?.parameters).toContain('name');
      expect(result.functions[0]?.parameters).toContain('greeting');
    });

    it('should extract async function', () => {
      const source = `async def fetch_data(url):
    return await get(url)`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]?.name).toBe('fetch_data');
      expect(result.functions[0]?.isAsync).toBe(true);
    });

    it('should extract function with type hints', () => {
      const source = `def add(a: int, b: int) -> int:
    return a + b`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]?.name).toBe('add');
      expect(result.functions[0]?.returnType).toBe('int');
    });

    it('should extract generator function', () => {
      const source = `def count_up(n):
    for i in range(n):
        yield i`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]?.name).toBe('count_up');
      expect(result.functions[0]?.isGenerator).toBe(true);
    });

    it('should extract function with decorators', () => {
      const source = `@staticmethod
@cache
def compute(x):
    return x * 2`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]?.name).toBe('compute');
      expect(result.functions[0]?.decorators).toContain('staticmethod');
      expect(result.functions[0]?.decorators).toContain('cache');
    });

    it('should extract function with *args and **kwargs', () => {
      const source = `def variadic(*args, **kwargs):
    pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]?.parameters).toContain('*args');
      expect(result.functions[0]?.parameters).toContain('**kwargs');
    });
  });

  describe('class extraction', () => {
    it('should extract simple class', () => {
      const source = `class MyClass:
    pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.name).toBe('MyClass');
      expect(result.classes[0]?.bases).toEqual([]);
    });

    it('should extract class with base classes', () => {
      const source = `class Child(Parent, Mixin):
    pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.name).toBe('Child');
      expect(result.classes[0]?.bases).toContain('Parent');
      expect(result.classes[0]?.bases).toContain('Mixin');
    });

    it('should extract class methods', () => {
      const source = `class Calculator:
    def __init__(self):
        self.value = 0

    def add(self, x):
        self.value += x

    async def fetch(self, url):
        pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.methods).toContain('__init__');
      expect(result.classes[0]?.methods).toContain('add');
      expect(result.classes[0]?.methods).toContain('fetch');
    });

    it('should extract class with decorators', () => {
      const source = `@dataclass
class Point:
    x: int
    y: int`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.name).toBe('Point');
      expect(result.classes[0]?.decorators).toContain('dataclass');
      expect(result.classes[0]?.isDataclass).toBe(true);
    });

    it('should extract class attributes', () => {
      const source = `class Config:
    DEBUG = True
    VERSION = "1.0"
    
    def __init__(self):
        pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.attributes).toContain('DEBUG');
      expect(result.classes[0]?.attributes).toContain('VERSION');
    });
  });

  describe('decorator extraction', () => {
    it('should extract simple decorators', () => {
      const source = `@property
def value(self):
    return self._value`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.decorators).toHaveLength(1);
      expect(result.decorators[0]?.name).toBe('property');
      expect(result.decorators[0]?.arguments).toBeNull();
    });

    it('should extract decorators with arguments', () => {
      const source = `@app.route("/api/users")
def get_users():
    pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.decorators).toHaveLength(1);
      expect(result.decorators[0]?.name).toBe('app.route');
      expect(result.decorators[0]?.arguments).toBe('"/api/users"');
    });

    it('should extract multiple decorators', () => {
      const source = `@login_required
@permission_required("admin")
@cache(timeout=300)
def admin_panel():
    pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.decorators).toHaveLength(3);
      expect(result.decorators[0]?.name).toBe('login_required');
      expect(result.decorators[1]?.name).toBe('permission_required');
      expect(result.decorators[2]?.name).toBe('cache');
    });
  });

  describe('query()', () => {
    it('should find nodes by type', () => {
      const source = `import os
def hello():
    pass
class MyClass:
    pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.ast).not.toBeNull();
      
      // First verify the semantic extraction works
      expect(result.imports).toHaveLength(1);
      expect(result.functions).toHaveLength(1);
      expect(result.classes).toHaveLength(1);
      
      if (result.ast) {
        // Import nodes are created with type 'Import'
        const imports = parser.query(result.ast, 'Import');
        expect(imports.length).toBeGreaterThan(0);

        // Function nodes are created with type 'FunctionDef'
        const functions = parser.query(result.ast, 'FunctionDef');
        expect(functions.length).toBeGreaterThan(0);

        // Class nodes are created with type 'ClassDef'
        const classes = parser.query(result.ast, 'ClassDef');
        expect(classes.length).toBeGreaterThan(0);

        // Also verify the Module root node
        const modules = parser.query(result.ast, 'Module');
        expect(modules.length).toBe(1);
      }
    });

    it('should find function nodes correctly', () => {
      const source = `def simple_func():
    pass`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(1);
      expect(result.ast).not.toBeNull();
      if (result.ast) {
        // The root node should have children
        expect(result.ast.rootNode.children.length).toBeGreaterThan(0);
        
        // Find FunctionDef nodes
        const funcNodes = parser.query(result.ast, 'FunctionDef');
        expect(funcNodes.length).toBe(1);
      }
    });
  });

  describe('error handling', () => {
    it('should handle malformed code gracefully', () => {
      // Python parser is regex-based, so it won't fail on syntax errors
      // but should still return a result
      const source = `def broken(
    # missing closing paren`;
      const result = parser.parse(source);

      // Should not throw, should return a result
      expect(result).toBeDefined();
      expect(result.success).toBe(true); // Regex-based parser is lenient
    });
  });

  describe('complex scenarios', () => {
    it('should extract multiple module-level functions', () => {
      const source = 'def first():\n    pass\n\ndef second():\n    pass\n\ndef third():\n    pass';
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(3);
      expect(result.functions.map(f => f.name)).toEqual(['first', 'second', 'third']);
    });

    it('should extract functions after decorated async functions', () => {
      const source = `@decorator
async def decorated_func() -> str:
    return "hello"

def plain_func():
    print("world")`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.functions).toHaveLength(2);
      expect(result.functions.map(f => f.name)).toContain('decorated_func');
      expect(result.functions.map(f => f.name)).toContain('plain_func');
    });

    it('should parse a complete Python module', () => {
      const source = `"""Module docstring."""

from typing import List, Optional
import os
import sys

CONSTANT = 42

@dataclass
class User:
    name: str
    email: str
    age: int = 0

    def greet(self) -> str:
        return f"Hello, {self.name}"

class UserService:
    def __init__(self, db):
        self.db = db

    async def get_user(self, user_id: int) -> Optional[User]:
        return await self.db.find(user_id)

    @staticmethod
    def validate_email(email: str) -> bool:
        return "@" in email

@app.route("/users")
async def list_users() -> List[User]:
    service = UserService(db)
    return await service.get_all()

def main():
    print("Starting...")
`;
      const result = parser.parse(source) as PythonParseResult;

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThanOrEqual(3);
      expect(result.classes).toHaveLength(2);
      
      // Debug: log the extracted functions
      const funcNames = result.functions.map(f => f.name);
      
      // Should have list_users and main as module-level functions
      expect(funcNames).toContain('list_users');
      expect(funcNames).toContain('main');
      expect(result.functions).toHaveLength(2);

      // Check User class
      const userClass = result.classes.find((c) => c.name === 'User');
      expect(userClass).toBeDefined();
      expect(userClass?.isDataclass).toBe(true);
      expect(userClass?.methods).toContain('greet');

      // Check UserService class
      const serviceClass = result.classes.find((c) => c.name === 'UserService');
      expect(serviceClass).toBeDefined();
      expect(serviceClass?.methods).toContain('__init__');
      expect(serviceClass?.methods).toContain('get_user');
      expect(serviceClass?.methods).toContain('validate_email');

      // Check list_users function
      const listUsers = result.functions.find((f) => f.name === 'list_users');
      expect(listUsers).toBeDefined();
      expect(listUsers?.isAsync).toBe(true);
      expect(listUsers?.decorators).toContain('app.route');
    });
  });
});
