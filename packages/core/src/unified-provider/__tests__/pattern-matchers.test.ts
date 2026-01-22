/**
 * Pattern Matcher Tests
 */

import { describe, it, expect } from 'vitest';
import { SupabaseMatcher } from '../matching/supabase-matcher.js';
import { PrismaMatcher } from '../matching/prisma-matcher.js';
import { RawSqlMatcher } from '../matching/raw-sql-matcher.js';
import type { UnifiedCallChain, CallChainSegment, NormalizedArg } from '../types.js';

// Helper to create test call chains
function createChain(
  receiver: string,
  segments: Array<{ name: string; isCall: boolean; args?: NormalizedArg[] }>
): UnifiedCallChain {
  return {
    receiver,
    segments: segments.map((s, i) => ({
      name: s.name,
      isCall: s.isCall,
      args: s.args ?? [],
      line: 1,
      column: i * 10,
    })),
    fullExpression: `${receiver}.${segments.map(s => s.name + (s.isCall ? '()' : '')).join('.')}`,
    file: 'test.ts',
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 100,
    language: 'typescript',
  };
}

function stringArg(value: string): NormalizedArg {
  return {
    type: 'string',
    value: `'${value}'`,
    stringValue: value,
    line: 1,
    column: 0,
  };
}

function objectArg(properties: Record<string, NormalizedArg>): NormalizedArg {
  return {
    type: 'object',
    value: '{}',
    properties,
    line: 1,
    column: 0,
  };
}

describe('SupabaseMatcher', () => {
  const matcher = new SupabaseMatcher();

  it('should match supabase.from().select()', () => {
    const chain = createChain('supabase', [
      { name: 'from', isCall: true, args: [stringArg('users')] },
      { name: 'select', isCall: true, args: [stringArg('*')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('supabase');
    expect(result?.confidence).toBeGreaterThan(0.9);
  });

  it('should match supabase.from().insert()', () => {
    const chain = createChain('supabase', [
      { name: 'from', isCall: true, args: [stringArg('users')] },
      { name: 'insert', isCall: true, args: [objectArg({
        name: stringArg('John'),
        email: stringArg('john@example.com'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match supabase.from().delete().eq()', () => {
    const chain = createChain('supabase', [
      { name: 'from', isCall: true, args: [stringArg('users')] },
      { name: 'delete', isCall: true },
      { name: 'eq', isCall: true, args: [stringArg('id'), stringArg('123')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('delete');
    expect(result?.fields).toContain('id');
  });

  it('should extract fields from select string', () => {
    const chain = createChain('supabase', [
      { name: 'from', isCall: true, args: [stringArg('users')] },
      { name: 'select', isCall: true, args: [stringArg('id, name, email')] },
    ]);

    const result = matcher.match(chain);

    expect(result?.fields).toContain('id');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should not match non-supabase chains', () => {
    const chain = createChain('db', [
      { name: 'query', isCall: true, args: [stringArg('SELECT * FROM users')] },
    ]);

    const result = matcher.match(chain);
    expect(result).toBeNull();
  });
});

describe('PrismaMatcher', () => {
  const matcher = new PrismaMatcher();

  it('should match prisma.model.findMany()', () => {
    const chain = createChain('prisma', [
      { name: 'user', isCall: false },
      { name: 'findMany', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('prisma');
  });

  it('should match prisma.model.create() with data', () => {
    const chain = createChain('prisma', [
      { name: 'user', isCall: false },
      { name: 'create', isCall: true, args: [objectArg({
        data: objectArg({
          name: stringArg('John'),
          email: stringArg('john@example.com'),
        }),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match prisma.model.delete()', () => {
    const chain = createChain('prisma', [
      { name: 'post', isCall: false },
      { name: 'delete', isCall: true, args: [objectArg({
        where: objectArg({ id: stringArg('123') }),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('posts');
    expect(result?.operation).toBe('delete');
    expect(result?.fields).toContain('id');
  });

  it('should extract fields from select option', () => {
    const chain = createChain('prisma', [
      { name: 'user', isCall: false },
      { name: 'findMany', isCall: true, args: [objectArg({
        select: objectArg({
          id: { type: 'boolean', value: 'true', booleanValue: true, line: 1, column: 0 },
          name: { type: 'boolean', value: 'true', booleanValue: true, line: 1, column: 0 },
        }),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result?.fields).toContain('id');
    expect(result?.fields).toContain('name');
  });

  it('should not match prisma client methods', () => {
    const chain = createChain('prisma', [
      { name: '$connect', isCall: true },
    ]);

    const result = matcher.match(chain);
    expect(result).toBeNull();
  });
});

describe('RawSqlMatcher', () => {
  const matcher = new RawSqlMatcher();

  it('should match db.query() with SELECT', () => {
    const chain = createChain('db', [
      { name: 'query', isCall: true, args: [stringArg('SELECT * FROM users WHERE active = true')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.isRawSql).toBe(true);
  });

  it('should match connection.execute() with INSERT', () => {
    const chain = createChain('connection', [
      { name: 'execute', isCall: true, args: [stringArg('INSERT INTO users (name, email) VALUES (?, ?)')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match UPDATE statements', () => {
    const chain = createChain('db', [
      { name: 'query', isCall: true, args: [stringArg('UPDATE users SET name = ?, email = ? WHERE id = ?')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match DELETE statements', () => {
    const chain = createChain('db', [
      { name: 'query', isCall: true, args: [stringArg('DELETE FROM users WHERE id = ?')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('delete');
  });

  it('should extract fields from SELECT', () => {
    const chain = createChain('db', [
      { name: 'query', isCall: true, args: [stringArg('SELECT id, name, email FROM users')] },
    ]);

    const result = matcher.match(chain);

    expect(result?.fields).toContain('id');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should handle table names with quotes', () => {
    const chain = createChain('db', [
      { name: 'query', isCall: true, args: [stringArg('SELECT * FROM "users"')] },
    ]);

    const result = matcher.match(chain);
    expect(result?.table).toBe('users');
  });

  it('should not match non-SQL methods', () => {
    const chain = createChain('db', [
      { name: 'connect', isCall: true },
    ]);

    const result = matcher.match(chain);
    expect(result).toBeNull();
  });
});


import { TypeORMMatcher } from '../matching/typeorm-matcher.js';
import { SequelizeMatcher } from '../matching/sequelize-matcher.js';
import { DrizzleMatcher } from '../matching/drizzle-matcher.js';
import { KnexMatcher } from '../matching/knex-matcher.js';
import { MongooseMatcher } from '../matching/mongoose-matcher.js';
import { DjangoMatcher } from '../matching/django-matcher.js';
import { SQLAlchemyMatcher } from '../matching/sqlalchemy-matcher.js';

function identifierArg(value: string): NormalizedArg {
  return {
    type: 'identifier',
    value,
    line: 1,
    column: 0,
  };
}

function createPythonChain(
  receiver: string,
  segments: Array<{ name: string; isCall: boolean; args?: NormalizedArg[] }>
): UnifiedCallChain {
  return {
    receiver,
    segments: segments.map((s, i) => ({
      name: s.name,
      isCall: s.isCall,
      args: s.args ?? [],
      line: 1,
      column: i * 10,
    })),
    fullExpression: `${receiver}.${segments.map(s => s.name + (s.isCall ? '()' : '')).join('.')}`,
    file: 'test.py',
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 100,
    language: 'python',
  };
}

describe('TypeORMMatcher', () => {
  const matcher = new TypeORMMatcher();

  it('should match userRepository.find()', () => {
    const chain = createChain('userRepository', [
      { name: 'find', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('typeorm');
  });

  it('should match repository.findOne() with where clause', () => {
    const chain = createChain('userRepository', [
      { name: 'findOne', isCall: true, args: [objectArg({
        where: objectArg({ id: stringArg('123') }),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
    expect(result?.fields).toContain('id');
  });

  it('should match repository.save()', () => {
    const chain = createChain('postRepository', [
      { name: 'save', isCall: true, args: [objectArg({
        title: stringArg('Hello'),
        content: stringArg('World'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('posts');
    expect(result?.operation).toBe('write');
  });

  it('should match repository.delete()', () => {
    const chain = createChain('userRepository', [
      { name: 'delete', isCall: true, args: [objectArg({
        id: stringArg('123'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });

  it('should match getRepository(Entity).find()', () => {
    const chain = createChain('dataSource', [
      { name: 'getRepository', isCall: true, args: [identifierArg('User')] },
      { name: 'find', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
  });
});

describe('SequelizeMatcher', () => {
  const matcher = new SequelizeMatcher();

  it('should match User.findAll()', () => {
    const chain = createChain('User', [
      { name: 'findAll', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('sequelize');
  });

  it('should match User.findOne() with where', () => {
    const chain = createChain('User', [
      { name: 'findOne', isCall: true, args: [objectArg({
        where: objectArg({ email: stringArg('test@example.com') }),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
    expect(result?.fields).toContain('email');
  });

  it('should match User.create()', () => {
    const chain = createChain('User', [
      { name: 'create', isCall: true, args: [objectArg({
        name: stringArg('John'),
        email: stringArg('john@example.com'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match User.destroy()', () => {
    const chain = createChain('User', [
      { name: 'destroy', isCall: true, args: [objectArg({
        where: objectArg({ id: stringArg('123') }),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });
});

describe('DrizzleMatcher', () => {
  const matcher = new DrizzleMatcher();

  it('should match db.select().from(users)', () => {
    const chain = createChain('db', [
      { name: 'select', isCall: true },
      { name: 'from', isCall: true, args: [identifierArg('users')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('drizzle');
  });

  it('should match db.insert(users).values()', () => {
    const chain = createChain('db', [
      { name: 'insert', isCall: true, args: [identifierArg('users')] },
      { name: 'values', isCall: true, args: [objectArg({
        name: stringArg('John'),
        email: stringArg('john@example.com'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match db.update(users).set()', () => {
    const chain = createChain('db', [
      { name: 'update', isCall: true, args: [identifierArg('users')] },
      { name: 'set', isCall: true, args: [objectArg({
        name: stringArg('Jane'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
  });

  it('should match db.delete(users)', () => {
    const chain = createChain('db', [
      { name: 'delete', isCall: true, args: [identifierArg('users')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });
});

describe('KnexMatcher', () => {
  const matcher = new KnexMatcher();

  it('should match knex(table).select()', () => {
    const chain = createChain('knex', [
      { name: 'knex', isCall: true, args: [stringArg('users')] },
      { name: 'select', isCall: true, args: [stringArg('*')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('knex');
  });

  it('should match db(table).insert()', () => {
    const chain = createChain('db', [
      { name: 'db', isCall: true, args: [stringArg('users')] },
      { name: 'insert', isCall: true, args: [objectArg({
        name: stringArg('John'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
  });

  it('should match knex(table).where().delete()', () => {
    const chain = createChain('knex', [
      { name: 'knex', isCall: true, args: [stringArg('users')] },
      { name: 'where', isCall: true, args: [stringArg('id'), stringArg('123')] },
      { name: 'delete', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
    expect(result?.fields).toContain('id');
  });
});

describe('MongooseMatcher', () => {
  const matcher = new MongooseMatcher();

  it('should match User.find()', () => {
    const chain = createChain('User', [
      { name: 'find', isCall: true, args: [objectArg({
        active: { type: 'boolean', value: 'true', booleanValue: true, line: 1, column: 0 },
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('mongoose');
    expect(result?.fields).toContain('active');
  });

  it('should match User.findById()', () => {
    const chain = createChain('User', [
      { name: 'findById', isCall: true, args: [stringArg('123')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
  });

  it('should match User.create()', () => {
    const chain = createChain('User', [
      { name: 'create', isCall: true, args: [objectArg({
        name: stringArg('John'),
        email: stringArg('john@example.com'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match User.deleteOne()', () => {
    const chain = createChain('User', [
      { name: 'deleteOne', isCall: true, args: [objectArg({
        _id: stringArg('123'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });
});

describe('DjangoMatcher', () => {
  const matcher = new DjangoMatcher();

  it('should match User.objects.all()', () => {
    const chain = createPythonChain('User', [
      { name: 'objects', isCall: false },
      { name: 'all', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('django');
  });

  it('should match User.objects.filter()', () => {
    const chain = createPythonChain('User', [
      { name: 'objects', isCall: false },
      { name: 'filter', isCall: true, args: [{ type: 'identifier', value: 'active=True', line: 1, column: 0 }] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
  });

  it('should match User.objects.create()', () => {
    const chain = createPythonChain('User', [
      { name: 'objects', isCall: false },
      { name: 'create', isCall: true, args: [
        { type: 'identifier', value: 'name=John', line: 1, column: 0 },
        { type: 'identifier', value: 'email=john@example.com', line: 1, column: 0 },
      ] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match User.objects.filter().delete()', () => {
    const chain = createPythonChain('User', [
      { name: 'objects', isCall: false },
      { name: 'filter', isCall: true, args: [{ type: 'identifier', value: 'id=1', line: 1, column: 0 }] },
      { name: 'delete', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });
});

describe('SQLAlchemyMatcher', () => {
  const matcher = new SQLAlchemyMatcher();

  it('should match session.query(User).all()', () => {
    const chain = createPythonChain('session', [
      { name: 'query', isCall: true, args: [identifierArg('User')] },
      { name: 'all', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('sqlalchemy');
  });

  it('should match session.query(User).filter_by()', () => {
    const chain = createPythonChain('session', [
      { name: 'query', isCall: true, args: [identifierArg('User')] },
      { name: 'filter_by', isCall: true, args: [
        { type: 'identifier', value: 'id=1', line: 1, column: 0 },
      ] },
      { name: 'first', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
    expect(result?.fields).toContain('id');
  });

  it('should match session.add()', () => {
    const chain = createPythonChain('session', [
      { name: 'add', isCall: true, args: [identifierArg('user')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
  });

  it('should match session.delete()', () => {
    const chain = createPythonChain('session', [
      { name: 'delete', isCall: true, args: [identifierArg('user')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });

  it('should match select(User) core pattern', () => {
    const chain = createPythonChain('db', [
      { name: 'select', isCall: true, args: [identifierArg('User')] },
      { name: 'where', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
  });

  it('should match insert(users).values() core pattern', () => {
    const chain = createPythonChain('db', [
      { name: 'insert', isCall: true, args: [identifierArg('users')] },
      { name: 'values', isCall: true, args: [
        { type: 'identifier', value: 'name=John', line: 1, column: 0 },
      ] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
  });
});


import { EFCoreMatcher } from '../matching/efcore-matcher.js';
import { EloquentMatcher } from '../matching/eloquent-matcher.js';
import { SpringDataMatcher } from '../matching/spring-data-matcher.js';

function createCSharpChain(
  receiver: string,
  segments: Array<{ name: string; isCall: boolean; args?: NormalizedArg[] }>
): UnifiedCallChain {
  return {
    receiver,
    segments: segments.map((s, i) => ({
      name: s.name,
      isCall: s.isCall,
      args: s.args ?? [],
      line: 1,
      column: i * 10,
    })),
    fullExpression: `${receiver}.${segments.map(s => s.name + (s.isCall ? '()' : '')).join('.')}`,
    file: 'test.cs',
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 100,
    language: 'csharp',
  };
}

function createPhpChain(
  receiver: string,
  segments: Array<{ name: string; isCall: boolean; args?: NormalizedArg[] }>
): UnifiedCallChain {
  return {
    receiver,
    segments: segments.map((s, i) => ({
      name: s.name,
      isCall: s.isCall,
      args: s.args ?? [],
      line: 1,
      column: i * 10,
    })),
    fullExpression: `${receiver}->${segments.map(s => s.name + (s.isCall ? '()' : '')).join('->')}`,
    file: 'test.php',
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 100,
    language: 'php',
  };
}

function createJavaChain(
  receiver: string,
  segments: Array<{ name: string; isCall: boolean; args?: NormalizedArg[] }>
): UnifiedCallChain {
  return {
    receiver,
    segments: segments.map((s, i) => ({
      name: s.name,
      isCall: s.isCall,
      args: s.args ?? [],
      line: 1,
      column: i * 10,
    })),
    fullExpression: `${receiver}.${segments.map(s => s.name + (s.isCall ? '()' : '')).join('.')}`,
    file: 'Test.java',
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 100,
    language: 'java',
  };
}

describe('EFCoreMatcher', () => {
  const matcher = new EFCoreMatcher();

  it('should match _context.Users.ToListAsync()', () => {
    const chain = createCSharpChain('_context', [
      { name: 'Users', isCall: false },
      { name: 'ToListAsync', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('efcore');
  });

  it('should match _context.Users.Where().FirstOrDefaultAsync()', () => {
    const chain = createCSharpChain('_context', [
      { name: 'Users', isCall: false },
      { name: 'Where', isCall: true },
      { name: 'FirstOrDefaultAsync', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
  });

  it('should match _context.Users.Add()', () => {
    const chain = createCSharpChain('_context', [
      { name: 'Users', isCall: false },
      { name: 'Add', isCall: true, args: [identifierArg('user')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
  });

  it('should match _context.Users.Remove()', () => {
    const chain = createCSharpChain('_context', [
      { name: 'Users', isCall: false },
      { name: 'Remove', isCall: true, args: [identifierArg('user')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });
});

describe('EloquentMatcher', () => {
  const matcher = new EloquentMatcher();

  it('should match User::all()', () => {
    const chain = createPhpChain('User', [
      { name: 'all', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('eloquent');
  });

  it('should match User::where()->get()', () => {
    const chain = createPhpChain('User', [
      { name: 'where', isCall: true, args: [stringArg('active'), stringArg('true')] },
      { name: 'get', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
    expect(result?.fields).toContain('active');
  });

  it('should match User::create()', () => {
    const chain = createPhpChain('User', [
      { name: 'create', isCall: true, args: [objectArg({
        name: stringArg('John'),
        email: stringArg('john@example.com'),
      })] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
    expect(result?.fields).toContain('name');
    expect(result?.fields).toContain('email');
  });

  it('should match User::destroy()', () => {
    const chain = createPhpChain('User', [
      { name: 'destroy', isCall: true, args: [stringArg('123')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });

  it('should match $user->save()', () => {
    const chain = createPhpChain('user', [
      { name: 'save', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
  });
});

describe('SpringDataMatcher', () => {
  const matcher = new SpringDataMatcher();

  it('should match userRepository.findAll()', () => {
    const chain = createJavaChain('userRepository', [
      { name: 'findAll', isCall: true },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.table).toBe('users');
    expect(result?.operation).toBe('read');
    expect(result?.orm).toBe('spring-data');
  });

  it('should match userRepository.findById()', () => {
    const chain = createJavaChain('userRepository', [
      { name: 'findById', isCall: true, args: [stringArg('123')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
  });

  it('should match userRepository.save()', () => {
    const chain = createJavaChain('userRepository', [
      { name: 'save', isCall: true, args: [identifierArg('user')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('write');
  });

  it('should match userRepository.delete()', () => {
    const chain = createJavaChain('userRepository', [
      { name: 'delete', isCall: true, args: [identifierArg('user')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('delete');
  });

  it('should extract fields from query derivation method names', () => {
    const chain = createJavaChain('userRepository', [
      { name: 'findByEmailAndActive', isCall: true, args: [stringArg('test@example.com'), stringArg('true')] },
    ]);

    const result = matcher.match(chain);

    expect(result).not.toBeNull();
    expect(result?.operation).toBe('read');
    expect(result?.fields).toContain('email');
    expect(result?.fields).toContain('active');
  });
});
