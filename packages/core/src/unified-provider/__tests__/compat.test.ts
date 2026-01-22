/**
 * Backward Compatibility Tests
 *
 * Tests for the old API names to ensure they work correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  SemanticDataAccessScanner,
  createSemanticDataAccessScanner,
  TypeScriptDataAccessExtractor,
  PythonDataAccessExtractor,
  CSharpDataAccessExtractor,
  JavaDataAccessExtractor,
  PhpDataAccessExtractor,
  createTypeScriptDataAccessExtractor,
  createPythonDataAccessExtractor,
  createCSharpDataAccessExtractor,
  createJavaDataAccessExtractor,
  createPhpDataAccessExtractor,
  createDataAccessExtractors,
} from '../compat/index.js';

describe('Backward Compatibility Aliases', () => {
  describe('SemanticDataAccessScanner', () => {
    it('should create scanner with createSemanticDataAccessScanner', () => {
      const scanner = createSemanticDataAccessScanner({ rootDir: '/test' });
      expect(scanner).toBeInstanceOf(SemanticDataAccessScanner);
    });

    it('should have scanFiles method', () => {
      const scanner = createSemanticDataAccessScanner({ rootDir: '/test' });
      expect(typeof scanner.scanFiles).toBe('function');
    });

    it('should have scanDirectory method', () => {
      const scanner = createSemanticDataAccessScanner({ rootDir: '/test' });
      expect(typeof scanner.scanDirectory).toBe('function');
    });
  });

  describe('TypeScriptDataAccessExtractor', () => {
    it('should create extractor with factory function', () => {
      const extractor = createTypeScriptDataAccessExtractor();
      expect(extractor).toBeInstanceOf(TypeScriptDataAccessExtractor);
    });

    it('should have correct language', () => {
      const extractor = new TypeScriptDataAccessExtractor();
      expect(extractor.language).toBe('typescript');
    });

    it('should have correct extensions', () => {
      const extractor = new TypeScriptDataAccessExtractor();
      expect(extractor.extensions).toContain('.ts');
      expect(extractor.extensions).toContain('.tsx');
      expect(extractor.extensions).toContain('.js');
      expect(extractor.extensions).toContain('.jsx');
    });

    it('should handle TypeScript files', () => {
      const extractor = new TypeScriptDataAccessExtractor();
      expect(extractor.canHandle('test.ts')).toBe(true);
      expect(extractor.canHandle('test.tsx')).toBe(true);
      expect(extractor.canHandle('test.js')).toBe(true);
      expect(extractor.canHandle('test.py')).toBe(false);
    });

    it('should throw on synchronous extract', () => {
      const extractor = new TypeScriptDataAccessExtractor();
      expect(() => extractor.extract('const x = 1;', 'test.ts')).toThrow();
    });

    it('should have extractAsync method', () => {
      const extractor = new TypeScriptDataAccessExtractor();
      expect(typeof extractor.extractAsync).toBe('function');
    });
  });

  describe('PythonDataAccessExtractor', () => {
    it('should create extractor with factory function', () => {
      const extractor = createPythonDataAccessExtractor();
      expect(extractor).toBeInstanceOf(PythonDataAccessExtractor);
    });

    it('should have correct language', () => {
      const extractor = new PythonDataAccessExtractor();
      expect(extractor.language).toBe('python');
    });

    it('should handle Python files', () => {
      const extractor = new PythonDataAccessExtractor();
      expect(extractor.canHandle('test.py')).toBe(true);
      expect(extractor.canHandle('test.pyw')).toBe(true);
      expect(extractor.canHandle('test.ts')).toBe(false);
    });
  });

  describe('CSharpDataAccessExtractor', () => {
    it('should create extractor with factory function', () => {
      const extractor = createCSharpDataAccessExtractor();
      expect(extractor).toBeInstanceOf(CSharpDataAccessExtractor);
    });

    it('should have correct language', () => {
      const extractor = new CSharpDataAccessExtractor();
      expect(extractor.language).toBe('csharp');
    });

    it('should handle C# files', () => {
      const extractor = new CSharpDataAccessExtractor();
      expect(extractor.canHandle('test.cs')).toBe(true);
      expect(extractor.canHandle('test.ts')).toBe(false);
    });
  });

  describe('JavaDataAccessExtractor', () => {
    it('should create extractor with factory function', () => {
      const extractor = createJavaDataAccessExtractor();
      expect(extractor).toBeInstanceOf(JavaDataAccessExtractor);
    });

    it('should have correct language', () => {
      const extractor = new JavaDataAccessExtractor();
      expect(extractor.language).toBe('java');
    });

    it('should handle Java files', () => {
      const extractor = new JavaDataAccessExtractor();
      expect(extractor.canHandle('test.java')).toBe(true);
      expect(extractor.canHandle('test.ts')).toBe(false);
    });
  });

  describe('PhpDataAccessExtractor', () => {
    it('should create extractor with factory function', () => {
      const extractor = createPhpDataAccessExtractor();
      expect(extractor).toBeInstanceOf(PhpDataAccessExtractor);
    });

    it('should have correct language', () => {
      const extractor = new PhpDataAccessExtractor();
      expect(extractor.language).toBe('php');
    });

    it('should handle PHP files', () => {
      const extractor = new PhpDataAccessExtractor();
      expect(extractor.canHandle('test.php')).toBe(true);
      expect(extractor.canHandle('test.phtml')).toBe(true);
      expect(extractor.canHandle('test.ts')).toBe(false);
    });
  });

  describe('createDataAccessExtractors', () => {
    it('should create all extractors', () => {
      const extractors = createDataAccessExtractors();
      expect(extractors.typescript).toBeInstanceOf(TypeScriptDataAccessExtractor);
      expect(extractors.python).toBeInstanceOf(PythonDataAccessExtractor);
      expect(extractors.csharp).toBeInstanceOf(CSharpDataAccessExtractor);
      expect(extractors.java).toBeInstanceOf(JavaDataAccessExtractor);
      expect(extractors.php).toBeInstanceOf(PhpDataAccessExtractor);
    });
  });
});
