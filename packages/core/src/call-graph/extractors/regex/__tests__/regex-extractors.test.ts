/**
 * Regex Extractors Tests
 *
 * Tests for the regex-based fallback extractors.
 */

import { describe, it, expect } from 'vitest';
import { TypeScriptRegexExtractor } from '../typescript-regex.js';
import { PythonRegexExtractor } from '../python-regex.js';
import { PhpRegexExtractor } from '../php-regex.js';
import { JavaRegexExtractor } from '../java-regex.js';
import { CSharpRegexExtractor } from '../csharp-regex.js';
import { getRegexExtractor, getRegexExtractorForFile } from '../index.js';

describe('TypeScriptRegexExtractor', () => {
  const extractor = new TypeScriptRegexExtractor();

  it('should extract function declarations', () => {
    const source = `
      function hello(name: string): string {
        return 'Hello ' + name;
      }
      
      export async function fetchData(url: string) {
        return fetch(url);
      }
    `;

    const result = extractor.extract(source, 'test.ts');

    expect(result.functions.length).toBeGreaterThanOrEqual(2);
    expect(result.functions.some(f => f.name === 'hello')).toBe(true);
    expect(result.functions.some(f => f.name === 'fetchData')).toBe(true);
    expect(result.quality.method).toBe('regex');
    expect(result.quality.confidence).toBeGreaterThan(0);
  });

  it('should extract arrow functions', () => {
    const source = `
      const add = (a: number, b: number) => a + b;
      export const multiply = (a: number, b: number) => {
        return a * b;
      };
    `;

    const result = extractor.extract(source, 'test.ts');

    expect(result.functions.length).toBeGreaterThanOrEqual(2);
    expect(result.functions.some(f => f.name === 'add')).toBe(true);
    expect(result.functions.some(f => f.name === 'multiply')).toBe(true);
  });

  it('should extract classes', () => {
    const source = `
      export class UserService extends BaseService implements IUserService {
        constructor() {
          super();
        }
        
        getUser(id: string) {
          return this.db.find(id);
        }
      }
    `;

    const result = extractor.extract(source, 'test.ts');

    expect(result.classes.length).toBe(1);
    expect(result.classes[0]!.name).toBe('UserService');
    expect(result.classes[0]!.baseClasses).toContain('BaseService');
    expect(result.classes[0]!.methods).toContain('getUser');
  });

  it('should extract imports', () => {
    const source = `import { useState, useEffect } from 'react';
import axios from 'axios';
import * as utils from './utils';`;

    const result = extractor.extract(source, 'test.ts');

    // Debug: log what we got
    // console.log('Imports:', JSON.stringify(result.imports, null, 2));

    expect(result.imports.length).toBeGreaterThanOrEqual(3);
    expect(result.imports.some(i => i.source === 'react')).toBe(true);
    expect(result.imports.some(i => i.source === 'axios')).toBe(true);
  });

  it('should extract calls', () => {
    const source = `function main() {
  const data = fetchData('http://api.example.com');
  console.log(data);
  const user = new User('John');
}`;

    const result = extractor.extract(source, 'test.ts');

    // Debug: log what we got
    // console.log('Calls:', JSON.stringify(result.calls, null, 2));

    expect(result.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.calls.some(c => c.calleeName === 'fetchData')).toBe(true);
    expect(result.calls.some(c => c.calleeName === 'User' && c.isConstructorCall)).toBe(true);
  });

  it('should extract JSX components', () => {
    const source = `
      function App() {
        return (
          <div>
            <Header title="Hello" />
            <UserList users={users} />
          </div>
        );
      }
    `;

    const result = extractor.extract(source, 'test.tsx');

    expect(result.calls.some(c => c.calleeName === 'Header')).toBe(true);
    expect(result.calls.some(c => c.calleeName === 'UserList')).toBe(true);
  });
});

describe('PythonRegexExtractor', () => {
  const extractor = new PythonRegexExtractor();

  it('should extract function definitions', () => {
    const source = `
def hello(name: str) -> str:
    return f"Hello {name}"

async def fetch_data(url: str):
    async with aiohttp.ClientSession() as session:
        return await session.get(url)
    `;

    const result = extractor.extract(source, 'test.py');

    expect(result.functions.length).toBeGreaterThanOrEqual(2);
    expect(result.functions.some(f => f.name === 'hello')).toBe(true);
    expect(result.functions.some(f => f.name === 'fetch_data' && f.isAsync)).toBe(true);
  });

  it('should extract classes', () => {
    const source = `
class UserService(BaseService):
    def __init__(self, db):
        self.db = db
    
    def get_user(self, user_id: str):
        return self.db.find(user_id)
    `;

    const result = extractor.extract(source, 'test.py');

    expect(result.classes.length).toBe(1);
    expect(result.classes[0]!.name).toBe('UserService');
    expect(result.classes[0]!.baseClasses).toContain('BaseService');
  });

  it('should extract imports', () => {
    const source = `
from typing import List, Optional
import os
from .utils import helper as h
    `;

    const result = extractor.extract(source, 'test.py');

    expect(result.imports.length).toBeGreaterThanOrEqual(3);
    expect(result.imports.some(i => i.source === 'typing')).toBe(true);
    expect(result.imports.some(i => i.source === 'os')).toBe(true);
  });

  it('should extract decorators', () => {
    const source = `
@app.route('/users')
@login_required
def get_users():
    return User.query.all()
    `;

    const result = extractor.extract(source, 'test.py');

    expect(result.functions.length).toBe(1);
    expect(result.functions[0]!.decorators.length).toBe(2);
  });
});

describe('PhpRegexExtractor', () => {
  const extractor = new PhpRegexExtractor();

  it('should extract functions and methods', () => {
    const source = `<?php
      function hello(string $name): string {
        return "Hello " . $name;
      }
      
      class UserController {
        public function index(): Response {
          return view('users.index');
        }
        
        private function validate($data) {
          return true;
        }
      }
    ?>`;

    const result = extractor.extract(source, 'test.php');

    expect(result.functions.length).toBeGreaterThanOrEqual(3);
    expect(result.functions.some(f => f.name === 'hello')).toBe(true);
    expect(result.functions.some(f => f.name === 'index')).toBe(true);
  });

  it('should extract use statements', () => {
    const source = `<?php
      namespace App\\Controllers;
      
      use App\\Models\\User;
      use Illuminate\\Http\\Request;
    ?>`;

    const result = extractor.extract(source, 'test.php');

    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });
});

describe('JavaRegexExtractor', () => {
  const extractor = new JavaRegexExtractor();

  it('should extract methods', () => {
    const source = `
      public class UserService {
        public User getUser(String id) {
          return userRepository.findById(id);
        }
        
        private void validateUser(User user) {
          // validation logic
        }
      }
    `;

    const result = extractor.extract(source, 'UserService.java');

    expect(result.functions.length).toBeGreaterThanOrEqual(2);
    expect(result.functions.some(f => f.name === 'getUser')).toBe(true);
  });

  it('should extract classes and interfaces', () => {
    const source = `
      public interface UserRepository extends JpaRepository<User, String> {
        User findByEmail(String email);
      }
      
      public class UserServiceImpl implements UserService {
        // implementation
      }
    `;

    const result = extractor.extract(source, 'UserRepository.java');

    expect(result.classes.length).toBeGreaterThanOrEqual(2);
  });

  it('should extract imports', () => {
    const source = `
      package com.example.service;
      
      import java.util.List;
      import org.springframework.stereotype.Service;
      import static org.junit.Assert.*;
    `;

    const result = extractor.extract(source, 'Service.java');

    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });
});

describe('CSharpRegexExtractor', () => {
  const extractor = new CSharpRegexExtractor();

  it('should extract methods', () => {
    const source = `
      public class UserService {
        public async Task<User> GetUserAsync(string id) {
          return await _repository.FindAsync(id);
        }
        
        private void ValidateUser(User user) {
          // validation logic
        }
      }
    `;

    const result = extractor.extract(source, 'UserService.cs');

    expect(result.functions.length).toBeGreaterThanOrEqual(2);
    expect(result.functions.some(f => f.name === 'GetUserAsync')).toBe(true);
  });

  it('should extract classes and interfaces', () => {
    const source = `
      public interface IUserRepository {
        Task<User> FindAsync(string id);
      }
      
      public class UserRepository : IUserRepository {
        // implementation
      }
    `;

    const result = extractor.extract(source, 'UserRepository.cs');

    expect(result.classes.length).toBeGreaterThanOrEqual(2);
  });

  it('should extract using statements', () => {
    const source = `
      using System;
      using System.Collections.Generic;
      using Microsoft.EntityFrameworkCore;
    `;

    const result = extractor.extract(source, 'Service.cs');

    expect(result.imports.length).toBeGreaterThanOrEqual(3);
  });

  it('should extract LINQ calls', () => {
    const source = `
      public class QueryService {
        public List<User> GetActiveUsers() {
          return _context.Users
            .Where(u => u.IsActive)
            .OrderBy(u => u.Name)
            .ToList();
        }
      }
    `;

    const result = extractor.extract(source, 'QueryService.cs');

    expect(result.calls.some(c => c.calleeName === 'Where')).toBe(true);
    expect(result.calls.some(c => c.calleeName === 'OrderBy')).toBe(true);
    expect(result.calls.some(c => c.calleeName === 'ToList')).toBe(true);
  });
});

describe('getRegexExtractor', () => {
  it('should return correct extractor for each language', () => {
    expect(getRegexExtractor('typescript')).toBeInstanceOf(TypeScriptRegexExtractor);
    expect(getRegexExtractor('javascript')).toBeInstanceOf(TypeScriptRegexExtractor);
    expect(getRegexExtractor('python')).toBeInstanceOf(PythonRegexExtractor);
    expect(getRegexExtractor('php')).toBeInstanceOf(PhpRegexExtractor);
    expect(getRegexExtractor('java')).toBeInstanceOf(JavaRegexExtractor);
    expect(getRegexExtractor('csharp')).toBeInstanceOf(CSharpRegexExtractor);
  });
});

describe('getRegexExtractorForFile', () => {
  it('should return correct extractor for file extensions', () => {
    expect(getRegexExtractorForFile('test.ts')).toBeInstanceOf(TypeScriptRegexExtractor);
    expect(getRegexExtractorForFile('test.tsx')).toBeInstanceOf(TypeScriptRegexExtractor);
    expect(getRegexExtractorForFile('test.js')).toBeInstanceOf(TypeScriptRegexExtractor);
    expect(getRegexExtractorForFile('test.py')).toBeInstanceOf(PythonRegexExtractor);
    expect(getRegexExtractorForFile('test.php')).toBeInstanceOf(PhpRegexExtractor);
    expect(getRegexExtractorForFile('Test.java')).toBeInstanceOf(JavaRegexExtractor);
    expect(getRegexExtractorForFile('Test.cs')).toBeInstanceOf(CSharpRegexExtractor);
  });

  it('should return Go extractor for .go files', () => {
    const extractor = getRegexExtractorForFile('test.go');
    expect(extractor).not.toBeNull();
    expect(extractor?.language).toBe('go');
  });

  it('should return Rust extractor for .rs files', () => {
    const extractor = getRegexExtractorForFile('test.rs');
    expect(extractor).not.toBeNull();
    expect(extractor?.language).toBe('rust');
  });

  it('should return null for unsupported extensions', () => {
    expect(getRegexExtractorForFile('test.rb')).toBeNull();
    expect(getRegexExtractorForFile('test.swift')).toBeNull();
  });
});
