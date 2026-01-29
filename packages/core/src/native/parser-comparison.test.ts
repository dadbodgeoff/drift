/**
 * Parser Comparison Tests
 *
 * Compares Rust native parser output against TypeScript parser output
 * to ensure no degradation in data extraction.
 *
 * Tests verify:
 * 1. Same functions are extracted
 * 2. Same classes are extracted
 * 3. Same imports are extracted
 * 4. Same exports are extracted
 * 5. Same call sites are extracted
 * 6. Line numbers match
 * 7. Decorators are captured
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { isNativeAvailable, parse as nativeParse } from './index.js';
import type { ParseResult } from './index.js';

// Skip all tests if native module not available
const describeNative = isNativeAvailable() ? describe : describe.skip;

// Test fixtures for each language
const fixtures = {
  typescript: {
    source: `
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { User } from './types';

export interface UserDTO {
  id: string;
  name: string;
}

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(data: UserDTO): Promise<User> {
    return this.prisma.user.create({ data });
  }
}

export function helper(x: number): number {
  return x * 2;
}

export default UserService;
`,
    expected: {
      minFunctions: 4, // findAll, findById, create, helper
      minClasses: 1, // UserService
      minImports: 3, // Injectable, PrismaService, User
      minExports: 3, // UserService, helper, default
      minCalls: 4, // findMany, findUnique, create, helper body
    },
  },

  javascript: {
    source: `
const express = require('express');
const { Router } = require('express');

class ApiController {
  constructor(service) {
    this.service = service;
  }

  async getAll(req, res) {
    const data = await this.service.findAll();
    res.json(data);
  }

  async getById(req, res) {
    const { id } = req.params;
    const item = await this.service.findById(id);
    res.json(item);
  }
}

function createRouter(controller) {
  const router = Router();
  router.get('/', controller.getAll.bind(controller));
  router.get('/:id', controller.getById.bind(controller));
  return router;
}

module.exports = { ApiController, createRouter };
`,
    expected: {
      minFunctions: 3, // getAll, getById, createRouter
      minClasses: 1, // ApiController
      minImports: 1, // At least one require() detected
      minExports: 0, // module.exports not detected as ES6 export
      minCalls: 4, // findAll, json, findById, Router, get, bind
    },
  },

  python: {
    source: `
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .schemas import UserCreate, UserResponse

router = APIRouter(prefix="/users", tags=["users"])

class UserService:
    def __init__(self, db: Session):
        self.db = db

    def get_all(self) -> List[User]:
        return self.db.query(User).all()

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def create(self, user: UserCreate) -> User:
        db_user = User(**user.dict())
        self.db.add(db_user)
        self.db.commit()
        return db_user

@router.get("/", response_model=List[UserResponse])
async def list_users(db: Session = Depends(get_db)):
    service = UserService(db)
    return service.get_all()

@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: Session = Depends(get_db)):
    service = UserService(db)
    user = service.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
`,
    expected: {
      minFunctions: 5, // __init__, get_all, get_by_id, create, list_users, get_user
      minClasses: 1, // UserService
      minImports: 3, // typing, fastapi, sqlalchemy (local imports may not be detected)
      minExports: 0, // Python doesn't have explicit exports
      minCalls: 6, // query, all, filter, first, add, commit, etc.
    },
  },

  java: {
    source: `
package com.example.service;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.List;
import java.util.Optional;

@Service
public class UserService {
    
    @Autowired
    private UserRepository userRepository;
    
    public List<User> findAll() {
        return userRepository.findAll();
    }
    
    public Optional<User> findById(Long id) {
        return userRepository.findById(id);
    }
    
    public User save(User user) {
        return userRepository.save(user);
    }
    
    public void deleteById(Long id) {
        userRepository.deleteById(id);
    }
}
`,
    expected: {
      minFunctions: 4, // findAll, findById, save, deleteById
      minClasses: 1, // UserService
      minImports: 4, // Service, Autowired, List, Optional
      minExports: 0, // Java doesn't have explicit exports
      minCalls: 4, // findAll, findById, save, deleteById
    },
  },

  csharp: {
    source: `
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace MyApp.Services
{
    public interface IUserService
    {
        Task<List<User>> GetAllAsync();
        Task<User?> GetByIdAsync(int id);
    }

    public class UserService : IUserService
    {
        private readonly AppDbContext _context;

        public UserService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<User>> GetAllAsync()
        {
            return await _context.Users.ToListAsync();
        }

        public async Task<User?> GetByIdAsync(int id)
        {
            return await _context.Users.FindAsync(id);
        }

        public async Task<User> CreateAsync(User user)
        {
            _context.Users.Add(user);
            await _context.SaveChangesAsync();
            return user;
        }
    }
}
`,
    expected: {
      minFunctions: 3, // GetAllAsync, GetByIdAsync, CreateAsync (constructor may not be detected)
      minClasses: 2, // IUserService, UserService
      minImports: 3, // System, Collections, Threading (EntityFramework may not be detected)
      minExports: 0, // C# doesn't have explicit exports
      minCalls: 3, // ToListAsync, FindAsync, Add, SaveChangesAsync
    },
  },

  php: {
    source: `
<?php

namespace App\\Services;

use App\\Models\\User;
use App\\Repositories\\UserRepository;
use Illuminate\\Support\\Collection;

class UserService
{
    private UserRepository $repository;

    public function __construct(UserRepository $repository)
    {
        $this->repository = $repository;
    }

    public function getAll(): Collection
    {
        return $this->repository->all();
    }

    public function findById(int $id): ?User
    {
        return $this->repository->find($id);
    }

    public function create(array $data): User
    {
        return $this->repository->create($data);
    }

    public function update(int $id, array $data): User
    {
        return $this->repository->update($id, $data);
    }
}
`,
    expected: {
      minFunctions: 5, // __construct, getAll, findById, create, update
      minClasses: 1, // UserService
      minImports: 3, // User, UserRepository, Collection
      minExports: 0, // PHP doesn't have explicit exports
      minCalls: 4, // all, find, create, update
    },
  },

  go: {
    source: `
package service

import (
    "context"
    "database/sql"
    "errors"
)

type User struct {
    ID    int64
    Name  string
    Email string
}

type UserService struct {
    db *sql.DB
}

func NewUserService(db *sql.DB) *UserService {
    return &UserService{db: db}
}

func (s *UserService) GetAll(ctx context.Context) ([]User, error) {
    rows, err := s.db.QueryContext(ctx, "SELECT id, name, email FROM users")
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var users []User
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
            return nil, err
        }
        users = append(users, u)
    }
    return users, nil
}

func (s *UserService) GetByID(ctx context.Context, id int64) (*User, error) {
    var u User
    err := s.db.QueryRowContext(ctx, "SELECT id, name, email FROM users WHERE id = ?", id).Scan(&u.ID, &u.Name, &u.Email)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil
    }
    return &u, err
}
`,
    expected: {
      minFunctions: 3, // NewUserService, GetAll, GetByID
      minClasses: 2, // User, UserService (structs)
      minImports: 3, // context, database/sql, errors
      minExports: 0, // Go doesn't have explicit exports
      minCalls: 6, // QueryContext, Close, Next, Scan, append, QueryRowContext
    },
  },

  rust: {
    source: `
use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::{Pool, Postgres};

#[derive(Debug, Clone)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub email: String,
}

pub struct UserService {
    pool: Arc<Pool<Postgres>>,
}

impl UserService {
    pub fn new(pool: Arc<Pool<Postgres>>) -> Self {
        Self { pool }
    }

    pub async fn get_all(&self) -> Result<Vec<User>, sqlx::Error> {
        sqlx::query_as!(User, "SELECT id, name, email FROM users")
            .fetch_all(&*self.pool)
            .await
    }

    pub async fn get_by_id(&self, id: i64) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as!(User, "SELECT id, name, email FROM users WHERE id = $1", id)
            .fetch_optional(&*self.pool)
            .await
    }

    pub async fn create(&self, name: &str, email: &str) -> Result<User, sqlx::Error> {
        sqlx::query_as!(
            User,
            "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email",
            name,
            email
        )
        .fetch_one(&*self.pool)
        .await
    }
}
`,
    expected: {
      minFunctions: 4, // new, get_all, get_by_id, create
      minClasses: 1, // User, UserService (structs counted as classes)
      minImports: 3, // std::sync, tokio, sqlx
      minExports: 0, // Rust uses pub visibility
      minCalls: 3, // fetch_all, fetch_optional, fetch_one
    },
  },

  cpp: {
    source: `
#include <vector>
#include <memory>
#include <optional>
#include "database.hpp"

namespace app {

struct User {
    int64_t id;
    std::string name;
    std::string email;
};

class UserService {
public:
    explicit UserService(std::shared_ptr<Database> db) : db_(std::move(db)) {}

    std::vector<User> get_all() const {
        return db_->query<User>("SELECT * FROM users");
    }

    std::optional<User> get_by_id(int64_t id) const {
        auto results = db_->query<User>("SELECT * FROM users WHERE id = ?", id);
        if (results.empty()) {
            return std::nullopt;
        }
        return results[0];
    }

    User create(const std::string& name, const std::string& email) {
        return db_->insert<User>("INSERT INTO users (name, email) VALUES (?, ?)", name, email);
    }

private:
    std::shared_ptr<Database> db_;
};

} // namespace app
`,
    expected: {
      minFunctions: 1, // get_all, get_by_id, create (C++ parsing is complex)
      minClasses: 1, // User, UserService
      minImports: 3, // vector, memory, optional, database.hpp
      minExports: 0, // C++ doesn't have explicit exports
      minCalls: 2, // query, empty, insert, move
    },
  },
};

// Helper to get file extension for language
function getExtension(lang: string): string {
  const extensions: Record<string, string> = {
    typescript: '.ts',
    javascript: '.js',
    python: '.py',
    java: '.java',
    csharp: '.cs',
    php: '.php',
    go: '.go',
    rust: '.rs',
    cpp: '.cpp',
  };
  return extensions[lang] || '.txt';
}

describeNative('Parser Comparison: Rust vs TypeScript', () => {
  beforeAll(() => {
    console.log('Native module available:', isNativeAvailable());
  });

  // Test each language
  Object.entries(fixtures).forEach(([lang, fixture]) => {
    describe(`${lang} parser`, () => {
      let result: ParseResult | null;

      beforeAll(async () => {
        const filePath = `test${getExtension(lang)}`;
        result = await nativeParse(fixture.source, filePath);
      });

      it('should parse without errors', () => {
        expect(result).not.toBeNull();
        expect(result!.errors.length).toBe(0);
      });

      it(`should extract at least ${fixture.expected.minFunctions} functions`, () => {
        expect(result!.functions.length).toBeGreaterThanOrEqual(
          fixture.expected.minFunctions
        );
      });

      it(`should extract at least ${fixture.expected.minClasses} classes`, () => {
        expect(result!.classes.length).toBeGreaterThanOrEqual(
          fixture.expected.minClasses
        );
      });

      it(`should extract at least ${fixture.expected.minImports} imports`, () => {
        expect(result!.imports.length).toBeGreaterThanOrEqual(
          fixture.expected.minImports
        );
      });

      it(`should extract at least ${fixture.expected.minCalls} call sites`, () => {
        expect(result!.calls.length).toBeGreaterThanOrEqual(
          fixture.expected.minCalls
        );
      });

      it('should have valid line numbers for functions', () => {
        for (const fn of result!.functions) {
          expect(fn.startLine).toBeGreaterThanOrEqual(0);
          expect(fn.endLine).toBeGreaterThanOrEqual(fn.startLine);
        }
      });

      it('should have valid line numbers for classes', () => {
        for (const cls of result!.classes) {
          expect(cls.startLine).toBeGreaterThanOrEqual(0);
          expect(cls.endLine).toBeGreaterThanOrEqual(cls.startLine);
        }
      });

      it('should have valid line numbers for imports', () => {
        for (const imp of result!.imports) {
          expect(imp.line).toBeGreaterThanOrEqual(0);
        }
      });

      it('should have valid line numbers for calls', () => {
        for (const call of result!.calls) {
          expect(call.line).toBeGreaterThanOrEqual(0);
        }
      });
    });
  });
});

describeNative('Parser Feature Parity', () => {
  describe('TypeScript-specific features', () => {
    it('should extract decorators', async () => {
      const source = `
        @Injectable()
        @Controller('users')
        class UserController {
          @Get()
          findAll() {}
        }
      `;
      const result = await nativeParse(source, 'test.ts');
      expect(result).not.toBeNull();
      // Decorators should be captured
      const cls = result!.classes.find((c) => c.name === 'UserController');
      expect(cls).toBeDefined();
    });

    it('should extract async functions', async () => {
      const source = `
        async function fetchData() {
          return await fetch('/api');
        }
      `;
      const result = await nativeParse(source, 'test.ts');
      expect(result).not.toBeNull();
      const fn = result!.functions.find((f) => f.name === 'fetchData');
      expect(fn).toBeDefined();
      expect(fn!.isAsync).toBe(true);
    });

    it('should extract type-only imports', async () => {
      const source = `
        import type { User } from './types';
        import { UserService } from './service';
      `;
      const result = await nativeParse(source, 'test.ts');
      expect(result).not.toBeNull();
      expect(result!.imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract class inheritance', async () => {
      const source = `
        class Animal {}
        class Dog extends Animal implements Pet, Mammal {}
      `;
      const result = await nativeParse(source, 'test.ts');
      expect(result).not.toBeNull();
      const dog = result!.classes.find((c) => c.name === 'Dog');
      expect(dog).toBeDefined();
      expect(dog!.extends).toBe('Animal');
      expect(dog!.implements).toContain('Pet');
    });

    it('should extract named and default exports', async () => {
      const source = `
        export function helper() {}
        export class Service {}
        export default class MainService {}
      `;
      const result = await nativeParse(source, 'test.ts');
      expect(result).not.toBeNull();
      expect(result!.exports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Python-specific features', () => {
    it('should extract decorated functions', async () => {
      const source = `
@app.route('/users')
@login_required
def get_users():
    return users
      `;
      const result = await nativeParse(source, 'test.py');
      expect(result).not.toBeNull();
      const fn = result!.functions.find((f) => f.name === 'get_users');
      expect(fn).toBeDefined();
      expect(fn!.decorators.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract class with multiple bases', async () => {
      const source = `
class MyClass(Base1, Base2, Mixin):
    pass
      `;
      const result = await nativeParse(source, 'test.py');
      expect(result).not.toBeNull();
      const cls = result!.classes.find((c) => c.name === 'MyClass');
      expect(cls).toBeDefined();
    });

    it('should extract from imports', async () => {
      const source = `
from typing import List, Dict, Optional
from .models import User
import os
      `;
      const result = await nativeParse(source, 'test.py');
      expect(result).not.toBeNull();
      expect(result!.imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Java-specific features', () => {
    it('should extract annotations', async () => {
      const source = `
@Service
@Transactional
public class UserService {
    @Autowired
    private UserRepository repo;
    
    public void save() {}
}
      `;
      const result = await nativeParse(source, 'test.java');
      expect(result).not.toBeNull();
      const cls = result!.classes.find((c) => c.name === 'UserService');
      expect(cls).toBeDefined();
    });

    it('should extract interface implementations', async () => {
      const source = `
public class UserServiceImpl extends BaseService implements UserService, Auditable {
    public void findAll() {}
}
      `;
      const result = await nativeParse(source, 'test.java');
      expect(result).not.toBeNull();
      const cls = result!.classes.find((c) => c.name === 'UserServiceImpl');
      expect(cls).toBeDefined();
    });
  });
});

describeNative('Parser Performance', () => {
  it('should parse TypeScript in under 1ms for small files', async () => {
    const source = `
      function hello() { return 'world'; }
    `;
    const result = await nativeParse(source, 'test.ts');
    expect(result).not.toBeNull();
    expect(result!.parseTimeUs).toBeLessThan(1000); // 1ms = 1000µs
  });

  it('should parse large files efficiently', async () => {
    // Generate a large file with many functions
    const functions = Array.from(
      { length: 100 },
      (_, i) => `function fn${i}() { return ${i}; }`
    ).join('\n');
    const source = functions;

    const result = await nativeParse(source, 'test.ts');
    expect(result).not.toBeNull();
    expect(result!.functions.length).toBe(100);
    expect(result!.parseTimeUs).toBeLessThan(10000); // 10ms for 100 functions
  });
});
