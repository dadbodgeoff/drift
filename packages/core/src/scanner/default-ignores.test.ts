/**
 * Tests for Enterprise-Grade Default Ignore Patterns
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_IGNORE_DIRECTORIES,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_IGNORE_EXTENSIONS,
  shouldIgnoreDirectory,
  shouldIgnoreExtension,
  getDefaultIgnorePatterns,
  getDefaultIgnoreDirectories,
  mergeIgnorePatterns,
} from './default-ignores.js';

describe('default-ignores', () => {
  describe('DEFAULT_IGNORE_DIRECTORIES', () => {
    it('should include common dependency directories', () => {
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('node_modules');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('vendor');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('.venv');
    });

    it('should include build output directories', () => {
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('dist');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('build');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('out');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('target');
    });

    it('should include .NET directories', () => {
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('bin');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('obj');
      // Note: 'packages' removed from defaults - conflicts with monorepo packages/ directories
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('.vs');
    });

    it('should include Java/Gradle directories', () => {
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('target');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('.gradle');
    });

    it('should include Python directories', () => {
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('__pycache__');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('.venv');
      expect(DEFAULT_IGNORE_DIRECTORIES).toContain('.pytest_cache');
    });
  });

  describe('shouldIgnoreDirectory', () => {
    it('should return true for common ignore directories', () => {
      expect(shouldIgnoreDirectory('node_modules')).toBe(true);
      expect(shouldIgnoreDirectory('dist')).toBe(true);
      expect(shouldIgnoreDirectory('.git')).toBe(true);
      expect(shouldIgnoreDirectory('__pycache__')).toBe(true);
      expect(shouldIgnoreDirectory('bin')).toBe(true);
      expect(shouldIgnoreDirectory('target')).toBe(true);
    });

    it('should return true for cmake-build-* directories', () => {
      expect(shouldIgnoreDirectory('cmake-build-debug')).toBe(true);
      expect(shouldIgnoreDirectory('cmake-build-release')).toBe(true);
      expect(shouldIgnoreDirectory('cmake-build-custom')).toBe(true);
    });

    it('should return true for hidden directories (except allowed)', () => {
      expect(shouldIgnoreDirectory('.hidden')).toBe(true);
      expect(shouldIgnoreDirectory('.cache')).toBe(true);
    });

    it('should return false for allowed hidden directories', () => {
      expect(shouldIgnoreDirectory('.github')).toBe(false);
      expect(shouldIgnoreDirectory('.circleci')).toBe(false);
    });

    it('should return false for source directories', () => {
      expect(shouldIgnoreDirectory('src')).toBe(false);
      expect(shouldIgnoreDirectory('lib')).toBe(false);
      expect(shouldIgnoreDirectory('app')).toBe(false);
      expect(shouldIgnoreDirectory('components')).toBe(false);
    });
  });

  describe('shouldIgnoreExtension', () => {
    it('should return true for compiled files', () => {
      expect(shouldIgnoreExtension('file.dll')).toBe(true);
      expect(shouldIgnoreExtension('file.exe')).toBe(true);
      expect(shouldIgnoreExtension('file.class')).toBe(true);
      expect(shouldIgnoreExtension('file.pyc')).toBe(true);
      expect(shouldIgnoreExtension('file.o')).toBe(true);
    });

    it('should return true for archive files', () => {
      expect(shouldIgnoreExtension('file.zip')).toBe(true);
      expect(shouldIgnoreExtension('file.tar')).toBe(true);
      expect(shouldIgnoreExtension('file.gz')).toBe(true);
    });

    it('should return false for source files', () => {
      expect(shouldIgnoreExtension('file.ts')).toBe(false);
      expect(shouldIgnoreExtension('file.py')).toBe(false);
      expect(shouldIgnoreExtension('file.java')).toBe(false);
      expect(shouldIgnoreExtension('file.cs')).toBe(false);
    });
  });

  describe('getDefaultIgnorePatterns', () => {
    it('should return a copy of default patterns', () => {
      const patterns = getDefaultIgnorePatterns();
      expect(patterns).toContain('node_modules/**');
      expect(patterns).toContain('dist/**');
      expect(patterns).toContain('*.dll');
    });

    it('should return a new array each time', () => {
      const patterns1 = getDefaultIgnorePatterns();
      const patterns2 = getDefaultIgnorePatterns();
      expect(patterns1).not.toBe(patterns2);
    });
  });

  describe('mergeIgnorePatterns', () => {
    it('should merge user patterns with defaults', () => {
      const userPatterns = ['custom/**', 'my-build/**'];
      const merged = mergeIgnorePatterns(userPatterns);
      
      // Should include defaults
      expect(merged).toContain('node_modules/**');
      expect(merged).toContain('dist/**');
      
      // Should include user patterns
      expect(merged).toContain('custom/**');
      expect(merged).toContain('my-build/**');
    });

    it('should deduplicate patterns', () => {
      const userPatterns = ['node_modules/**', 'custom/**'];
      const merged = mergeIgnorePatterns(userPatterns);
      
      // Should not have duplicates
      const nodeModulesCount = merged.filter(p => p === 'node_modules/**').length;
      expect(nodeModulesCount).toBe(1);
    });
  });
});
