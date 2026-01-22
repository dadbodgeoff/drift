/**
 * Language Intelligence Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LanguageIntelligence,
  createLanguageIntelligence,
  FrameworkRegistry,
  registerAllFrameworks,
  SPRING_PATTERNS,
  FASTAPI_PATTERNS,
  NESTJS_PATTERNS,
} from '../index.js';

describe('LanguageIntelligence', () => {
  let intelligence: LanguageIntelligence;

  beforeEach(() => {
    FrameworkRegistry.reset();
    intelligence = createLanguageIntelligence({ rootDir: '/test' });
  });

  describe('initialization', () => {
    it('should initialize with all framework patterns', () => {
      const registry = FrameworkRegistry.getInstance();
      expect(registry.has('spring')).toBe(true);
      expect(registry.has('fastapi')).toBe(true);
      expect(registry.has('nestjs')).toBe(true);
      expect(registry.has('laravel')).toBe(true);
      expect(registry.has('aspnet')).toBe(true);
    });

    it('should return config', () => {
      const config = intelligence.getConfig();
      expect(config.rootDir).toBe('/test');
    });
  });

  describe('normalizeFile', () => {
    it('should normalize a Java Spring controller', () => {
      const source = `
        package com.example;
        
        import org.springframework.web.bind.annotation.*;
        
        @RestController
        @RequestMapping("/api/users")
        public class UserController {
          
          @GetMapping("/{id}")
          public User getUser(@PathVariable Long id) {
            return userService.findById(id);
          }
        }
      `;

      const result = intelligence.normalizeFile(source, 'UserController.java');
      
      expect(result).not.toBeNull();
      expect(result!.detectedFrameworks).toContain('spring');
      expect(result!.fileSemantics.isController).toBe(true);
    });

    it('should normalize a Python FastAPI endpoint', () => {
      const source = `
from fastapi import FastAPI, Depends

app = FastAPI()

@app.get("/users/{user_id}")
async def get_user(user_id: int, db: Session = Depends(get_db)):
    return db.query(User).filter(User.id == user_id).first()
      `;

      const result = intelligence.normalizeFile(source, 'main.py');
      
      expect(result).not.toBeNull();
      expect(result!.detectedFrameworks).toContain('fastapi');
    });

    it('should normalize a TypeScript NestJS controller', () => {
      const source = `
import { Controller, Get, Param } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Get(':id')
  getUser(@Param('id') id: string) {
    return this.userService.findOne(id);
  }
}
      `;

      const result = intelligence.normalizeFile(source, 'user.controller.ts');
      
      expect(result).not.toBeNull();
      expect(result!.detectedFrameworks).toContain('nestjs');
    });

    it('should return null for unsupported file types', () => {
      const result = intelligence.normalizeFile('content', 'file.txt');
      expect(result).toBeNull();
    });
  });

  describe('query methods', () => {
    it('should find entry points', () => {
      const files = [
        {
          file: 'test.java',
          language: 'java' as const,
          functions: [
            {
              name: 'getUser',
              qualifiedName: 'UserController.getUser',
              startLine: 1,
              endLine: 5,
              startColumn: 0,
              endColumn: 0,
              parameters: [],
              isMethod: true,
              isStatic: false,
              isExported: true,
              isConstructor: false,
              isAsync: false,
              decorators: ['@GetMapping("/users")'],
              bodyStartLine: 2,
              bodyEndLine: 4,
              normalizedDecorators: [{
                raw: '@GetMapping("/users")',
                name: 'GetMapping',
                language: 'java' as const,
                framework: 'spring',
                semantic: {
                  category: 'routing' as const,
                  intent: 'HTTP endpoint',
                  isEntryPoint: true,
                  isInjectable: false,
                  requiresAuth: false,
                  confidence: 1.0,
                },
                arguments: { path: '/users', methods: ['GET' as const] },
              }],
              semantics: {
                isEntryPoint: true,
                isDataAccessor: false,
                isAuthHandler: false,
                isTestCase: false,
                isInjectable: false,
                dependencies: [],
                dataAccess: [],
              },
            },
          ],
          calls: [],
          imports: [],
          exports: [],
          classes: [],
          errors: [],
          detectedFrameworks: ['spring'],
          fileSemantics: {
            isController: true,
            isService: false,
            isModel: false,
            isTestFile: false,
            primaryFramework: 'spring',
          },
        },
      ];

      const entryPoints = intelligence.findEntryPoints(files);
      expect(entryPoints).toHaveLength(1);
      expect(entryPoints[0]?.name).toBe('getUser');
    });

    it('should get summary statistics', () => {
      const files = [
        {
          file: 'test.java',
          language: 'java' as const,
          functions: [
            {
              name: 'getUser',
              qualifiedName: 'UserController.getUser',
              startLine: 1,
              endLine: 5,
              startColumn: 0,
              endColumn: 0,
              parameters: [],
              isMethod: true,
              isStatic: false,
              isExported: true,
              isConstructor: false,
              isAsync: false,
              decorators: [],
              bodyStartLine: 2,
              bodyEndLine: 4,
              normalizedDecorators: [{
                raw: '@GetMapping',
                name: 'GetMapping',
                language: 'java' as const,
                framework: 'spring',
                semantic: {
                  category: 'routing' as const,
                  intent: 'HTTP endpoint',
                  isEntryPoint: true,
                  isInjectable: false,
                  requiresAuth: false,
                  confidence: 1.0,
                },
                arguments: {},
              }],
              semantics: {
                isEntryPoint: true,
                isDataAccessor: false,
                isAuthHandler: false,
                isTestCase: false,
                isInjectable: false,
                dependencies: [],
                dataAccess: [],
              },
            },
          ],
          calls: [],
          imports: [],
          exports: [],
          classes: [],
          errors: [],
          detectedFrameworks: ['spring'],
          fileSemantics: {
            isController: true,
            isService: false,
            isModel: false,
            isTestFile: false,
          },
        },
      ];

      const summary = intelligence.getSummary(files);
      expect(summary.totalFunctions).toBe(1);
      expect(summary.entryPoints).toBe(1);
      expect(summary.byFramework['spring']).toBe(1);
      expect(summary.byCategory['routing']).toBe(1);
    });
  });
});

describe('FrameworkRegistry', () => {
  beforeEach(() => {
    FrameworkRegistry.reset();
  });

  it('should register and retrieve frameworks', () => {
    const registry = FrameworkRegistry.getInstance();
    registry.register(SPRING_PATTERNS);
    
    expect(registry.has('spring')).toBe(true);
    expect(registry.get('spring')).toBe(SPRING_PATTERNS);
  });

  it('should get frameworks by language', () => {
    const registry = FrameworkRegistry.getInstance();
    registerAllFrameworks();
    
    const javaFrameworks = registry.getForLanguage('java');
    expect(javaFrameworks.some(f => f.framework === 'spring')).toBe(true);
    
    const pythonFrameworks = registry.getForLanguage('python');
    expect(pythonFrameworks.some(f => f.framework === 'fastapi')).toBe(true);
  });

  it('should detect frameworks from source', () => {
    const registry = FrameworkRegistry.getInstance();
    registerAllFrameworks();
    
    const javaSource = `
      import org.springframework.web.bind.annotation.RestController;
      @RestController
      public class MyController {}
    `;
    
    const detected = registry.detectFrameworks(javaSource, 'java');
    expect(detected.some(f => f.framework === 'spring')).toBe(true);
  });
});

describe('Framework Patterns', () => {
  it('should have correct Spring patterns', () => {
    expect(SPRING_PATTERNS.framework).toBe('spring');
    expect(SPRING_PATTERNS.languages).toContain('java');
    expect(SPRING_PATTERNS.decoratorMappings.length).toBeGreaterThan(0);
  });

  it('should have correct FastAPI patterns', () => {
    expect(FASTAPI_PATTERNS.framework).toBe('fastapi');
    expect(FASTAPI_PATTERNS.languages).toContain('python');
  });

  it('should have correct NestJS patterns', () => {
    expect(NESTJS_PATTERNS.framework).toBe('nestjs');
    expect(NESTJS_PATTERNS.languages).toContain('typescript');
  });
});
