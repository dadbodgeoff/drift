import { describe, it, expect } from 'vitest';
import {
  getPrimitiveNames,
  getFrameworkNames,
  findPrimitiveFramework,
  looksLikePrimitive,
  getPrimitiveCount,
  getPrimitivesByCategory,
  ALL_PRIMITIVES,
  REACT_PRIMITIVES,
  TYPESCRIPT_PRIMITIVES,
} from '../primitives/registry.js';

describe('Primitive Registry', () => {
  describe('getPrimitiveNames', () => {
    it('returns all primitive names for TypeScript', () => {
      const names = getPrimitiveNames('typescript');
      expect(names.size).toBeGreaterThan(50);
      expect(names.has('useState')).toBe(true);
      expect(names.has('useEffect')).toBe(true);
      expect(names.has('useQuery')).toBe(true);
    });

    it('returns all primitive names for Python', () => {
      const names = getPrimitiveNames('python');
      expect(names.size).toBeGreaterThan(30);
      expect(names.has('Depends')).toBe(true);
      expect(names.has('login_required')).toBe(true);
    });

    it('returns all primitive names for Java', () => {
      const names = getPrimitiveNames('java');
      expect(names.size).toBeGreaterThan(30);
      expect(names.has('@Autowired')).toBe(true);
      expect(names.has('@Transactional')).toBe(true);
    });

    it('returns all primitive names for C#', () => {
      const names = getPrimitiveNames('csharp');
      expect(names.size).toBeGreaterThan(30);
      expect(names.has('GetService')).toBe(true);
      expect(names.has('[Authorize]')).toBe(true);
    });

    it('returns all primitive names for PHP', () => {
      const names = getPrimitiveNames('php');
      expect(names.size).toBeGreaterThan(30);
      expect(names.has('Auth::')).toBe(true);
      expect(names.has('where')).toBe(true);
    });
  });

  describe('getFrameworkNames', () => {
    it('returns framework names for TypeScript', () => {
      const frameworks = getFrameworkNames('typescript');
      expect(frameworks).toContain('react');
      expect(frameworks).toContain('tanstack-query');
      expect(frameworks).toContain('vue');
      expect(frameworks).toContain('jest');
    });

    it('returns framework names for Python', () => {
      const frameworks = getFrameworkNames('python');
      expect(frameworks).toContain('fastapi');
      expect(frameworks).toContain('django');
      expect(frameworks).toContain('pytest');
    });
  });

  describe('findPrimitiveFramework', () => {
    it('finds React primitives', () => {
      const result = findPrimitiveFramework('useState', 'typescript');
      expect(result).toEqual({ framework: 'react', category: 'state' });
    });

    it('finds TanStack Query primitives', () => {
      const result = findPrimitiveFramework('useQuery', 'typescript');
      expect(result).toEqual({ framework: 'tanstack-query', category: 'query' });
    });

    it('finds FastAPI primitives', () => {
      const result = findPrimitiveFramework('Depends', 'python');
      expect(result).toEqual({ framework: 'fastapi', category: 'di' });
    });

    it('finds Spring primitives', () => {
      const result = findPrimitiveFramework('@Autowired', 'java');
      expect(result).toEqual({ framework: 'spring', category: 'di' });
    });

    it('returns null for unknown primitives', () => {
      const result = findPrimitiveFramework('unknownFunction', 'typescript');
      expect(result).toBeNull();
    });
  });

  describe('looksLikePrimitive', () => {
    it('detects React hooks', () => {
      expect(looksLikePrimitive('useCustomHook', 'typescript')).toBe(true);
      expect(looksLikePrimitive('useState', 'typescript')).toBe(true);
    });

    it('detects factory patterns', () => {
      expect(looksLikePrimitive('createStore', 'typescript')).toBe(true);
      expect(looksLikePrimitive('makeObservable', 'typescript')).toBe(true);
    });

    it('detects decorators', () => {
      expect(looksLikePrimitive('@Component', 'java')).toBe(true);
      expect(looksLikePrimitive('#[Route]', 'php')).toBe(true);
    });

    it('rejects non-primitive names', () => {
      expect(looksLikePrimitive('handleClick', 'typescript')).toBe(false);
      expect(looksLikePrimitive('processData', 'typescript')).toBe(false);
    });
  });

  describe('getPrimitiveCount', () => {
    it('returns correct counts', () => {
      expect(getPrimitiveCount('typescript')).toBeGreaterThan(50);
      expect(getPrimitiveCount('python')).toBeGreaterThan(30);
      expect(getPrimitiveCount('java')).toBeGreaterThan(30);
    });
  });

  describe('getPrimitivesByCategory', () => {
    it('groups TypeScript primitives by category', () => {
      const byCategory = getPrimitivesByCategory('typescript');
      expect(byCategory.get('state')).toContain('useState');
      expect(byCategory.get('effect')).toContain('useEffect');
      expect(byCategory.get('query')).toContain('useQuery');
    });
  });

  describe('Registry structure', () => {
    it('has all supported languages', () => {
      expect(Object.keys(ALL_PRIMITIVES)).toEqual([
        'typescript',
        'python',
        'java',
        'csharp',
        'php',
        'rust',
        'cpp',
      ]);
    });

    it('React primitives have correct structure', () => {
      expect(REACT_PRIMITIVES.react.state).toContain('useState');
      expect(REACT_PRIMITIVES.react.effect).toContain('useEffect');
      expect(REACT_PRIMITIVES.react.context).toContain('useContext');
    });
  });
});
