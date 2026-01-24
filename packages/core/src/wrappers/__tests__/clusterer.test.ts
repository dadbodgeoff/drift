import { describe, it, expect } from 'vitest';
import {
  clusterWrappers,
  inferCategory,
  calculateConfidence,
  detectNamingPatterns,
  getClustersByCategory,
  getMostCommonPrimitives,
  findRelatedClusters,
} from '../clustering/clusterer.js';
import type { WrapperFunction, DetectedPrimitive } from '../types.js';

describe('Wrapper Clustering', () => {
  const createWrapper = (
    name: string,
    primitives: string[],
    overrides: Partial<WrapperFunction> = {}
  ): WrapperFunction => ({
    name,
    qualifiedName: `src/hooks/${name}.ts:${name}`,
    file: `src/hooks/${name}.ts`,
    line: 1,
    language: 'typescript',
    directPrimitives: primitives,
    transitivePrimitives: [],
    primitiveSignature: primitives.sort(),
    depth: 1,
    callsWrappers: [],
    calledBy: ['Component1', 'Component2'],
    isFactory: false,
    isHigherOrder: false,
    isDecorator: false,
    isAsync: false,
    ...overrides,
  });

  const createPrimitive = (name: string, category: string): DetectedPrimitive => ({
    name,
    framework: 'react',
    category,
    source: { type: 'bootstrap', confidence: 1.0 },
    language: 'typescript',
    usageCount: 10,
  });

  describe('clusterWrappers', () => {
    it('groups wrappers by primitive signature', () => {
      const wrappers: WrapperFunction[] = [
        createWrapper('useUsers', ['useQuery', 'useState']),
        createWrapper('usePosts', ['useQuery', 'useState']),
        createWrapper('useComments', ['useQuery', 'useState']),
        createWrapper('useAuth', ['useContext']),
      ];

      const primitives: DetectedPrimitive[] = [
        createPrimitive('useQuery', 'query'),
        createPrimitive('useState', 'state'),
        createPrimitive('useContext', 'context'),
      ];

      const clusters = clusterWrappers(wrappers, primitives);

      expect(clusters.length).toBeGreaterThanOrEqual(1);

      const queryCluster = clusters.find((c) =>
        c.primitiveSignature.includes('useQuery') && c.primitiveSignature.includes('useState')
      );
      expect(queryCluster).toBeDefined();
      expect(queryCluster?.wrappers).toHaveLength(3);
    });

    it('filters out small clusters', () => {
      const wrappers: WrapperFunction[] = [
        createWrapper('useA', ['useState']),
        createWrapper('useB', ['useEffect']),
        createWrapper('useC', ['useCallback']),
      ];

      const primitives: DetectedPrimitive[] = [
        createPrimitive('useState', 'state'),
        createPrimitive('useEffect', 'effect'),
        createPrimitive('useCallback', 'memo'),
      ];

      const clusters = clusterWrappers(wrappers, primitives, { minClusterSize: 2 });

      // Each wrapper has unique signature, so no clusters should form
      expect(clusters).toHaveLength(0);
    });

    it('calculates cluster statistics', () => {
      const wrappers: WrapperFunction[] = [
        createWrapper('useA', ['useState'], { depth: 1, calledBy: ['C1', 'C2', 'C3'] }),
        createWrapper('useB', ['useState'], { depth: 2, calledBy: ['C4', 'C5'] }),
        createWrapper('useC', ['useState'], { depth: 1, calledBy: ['C6'] }),
      ];

      const primitives: DetectedPrimitive[] = [createPrimitive('useState', 'state')];

      const clusters = clusterWrappers(wrappers, primitives, { minClusterSize: 2 });

      expect(clusters).toHaveLength(1);
      expect(clusters[0].totalUsages).toBe(6);
      expect(clusters[0].avgDepth).toBeCloseTo(1.33, 1);
      expect(clusters[0].maxDepth).toBe(2);
    });

    it('spreads wrappers across files', () => {
      const wrappers: WrapperFunction[] = [
        createWrapper('useA', ['useState'], { file: 'src/hooks/a.ts' }),
        createWrapper('useB', ['useState'], { file: 'src/hooks/b.ts' }),
        createWrapper('useC', ['useState'], { file: 'src/hooks/c.ts' }),
      ];

      const primitives: DetectedPrimitive[] = [createPrimitive('useState', 'state')];

      const clusters = clusterWrappers(wrappers, primitives, { minClusterSize: 2 });

      expect(clusters).toHaveLength(1);
      expect(clusters[0].fileSpread).toBe(3);
    });
  });

  describe('inferCategory', () => {
    const primitives: DetectedPrimitive[] = [
      createPrimitive('useState', 'state'),
      createPrimitive('useEffect', 'effect'),
      createPrimitive('useQuery', 'query'),
      createPrimitive('useForm', 'form'),
      createPrimitive('useNavigate', 'routing'),
      createPrimitive('Depends', 'di'),
      createPrimitive('@Autowired', 'di'),
    ];

    it('infers state-management category', () => {
      expect(inferCategory(['useState'], primitives)).toBe('state-management');
      expect(inferCategory(['useReducer'], primitives)).toBe('state-management');
    });

    it('infers side-effects category', () => {
      expect(inferCategory(['useEffect'], primitives)).toBe('side-effects');
      expect(inferCategory(['useState', 'useEffect'], primitives)).toBe('side-effects');
    });

    it('infers data-fetching category', () => {
      expect(inferCategory(['useQuery'], primitives)).toBe('data-fetching');
      expect(inferCategory(['useSWR'], primitives)).toBe('data-fetching');
      expect(inferCategory(['useMutation'], primitives)).toBe('data-fetching');
    });

    it('infers form-handling category', () => {
      expect(inferCategory(['useForm'], primitives)).toBe('form-handling');
      expect(inferCategory(['useFormik'], primitives)).toBe('form-handling');
    });

    it('infers routing category', () => {
      expect(inferCategory(['useNavigate'], primitives)).toBe('routing');
      expect(inferCategory(['useRouter'], primitives)).toBe('routing');
    });

    it('infers dependency-injection category', () => {
      expect(inferCategory(['Depends'], primitives)).toBe('dependency-injection');
      expect(inferCategory(['@Autowired'], primitives)).toBe('dependency-injection');
      expect(inferCategory(['GetService'], primitives)).toBe('dependency-injection');
    });

    it('infers authentication category', () => {
      expect(inferCategory(['useAuth'], primitives)).toBe('authentication');
      expect(inferCategory(['login_required'], primitives)).toBe('authentication');
    });

    it('infers testing category', () => {
      expect(inferCategory(['mock', 'spy'], primitives)).toBe('testing');
      expect(inferCategory(['fixture'], primitives)).toBe('testing');
    });

    it('defaults to utility for unknown patterns', () => {
      expect(inferCategory(['unknownPrimitive'], primitives)).toBe('utility');
    });
  });

  describe('calculateConfidence', () => {
    it('increases confidence with more members', () => {
      const twoMembers = [createWrapper('a', ['x']), createWrapper('b', ['x'])];
      const fiveMembers = [
        createWrapper('a', ['x']),
        createWrapper('b', ['x']),
        createWrapper('c', ['x']),
        createWrapper('d', ['x']),
        createWrapper('e', ['x']),
      ];

      const conf2 = calculateConfidence(twoMembers, ['x'], 4, 2);
      const conf5 = calculateConfidence(fiveMembers, ['x'], 10, 5);

      expect(conf5).toBeGreaterThan(conf2);
    });

    it('increases confidence with more usages', () => {
      const lowUsage = [
        createWrapper('a', ['x'], { calledBy: ['c1'] }),
        createWrapper('b', ['x'], { calledBy: ['c2'] }),
      ];
      const highUsage = [
        createWrapper('a', ['x'], { calledBy: Array(10).fill('c') }),
        createWrapper('b', ['x'], { calledBy: Array(15).fill('c') }),
      ];

      const confLow = calculateConfidence(lowUsage, ['x'], 2, 1);
      const confHigh = calculateConfidence(highUsage, ['x'], 25, 1);

      expect(confHigh).toBeGreaterThan(confLow);
    });

    it('increases confidence with file spread', () => {
      const members = [createWrapper('a', ['x']), createWrapper('b', ['x'])];

      const confSingleFile = calculateConfidence(members, ['x'], 4, 1);
      const confMultiFile = calculateConfidence(members, ['x'], 4, 3);

      expect(confMultiFile).toBeGreaterThan(confSingleFile);
    });

    it('caps confidence at 1.0', () => {
      const manyMembers = Array(20)
        .fill(null)
        .map((_, i) => createWrapper(`use${i}`, ['useState'], { calledBy: Array(10).fill('c') }));

      const conf = calculateConfidence(manyMembers, ['useState'], 200, 20);

      expect(conf).toBeLessThanOrEqual(1.0);
    });
  });

  describe('detectNamingPatterns', () => {
    it('detects use* prefix pattern', () => {
      const members = [
        createWrapper('useUsers', ['x']),
        createWrapper('usePosts', ['x']),
        createWrapper('useComments', ['x']),
      ];

      const patterns = detectNamingPatterns(members);

      expect(patterns).toContain('use*');
    });

    it('detects *Service suffix pattern', () => {
      const members = [
        createWrapper('UserService', ['x']),
        createWrapper('PostService', ['x']),
        createWrapper('CommentService', ['x']),
      ];

      const patterns = detectNamingPatterns(members);

      expect(patterns).toContain('*Service');
    });

    it('returns empty for inconsistent naming', () => {
      const members = [
        createWrapper('fetchUsers', ['x']),
        createWrapper('loadPosts', ['x']),
        createWrapper('getComments', ['x']),
      ];

      const patterns = detectNamingPatterns(members);

      expect(patterns).toHaveLength(0);
    });
  });

  describe('getClustersByCategory', () => {
    it('groups clusters by category', () => {
      const wrappers: WrapperFunction[] = [
        createWrapper('useUsers', ['useQuery']),
        createWrapper('usePosts', ['useQuery']),
        createWrapper('useAuth', ['useContext']),
        createWrapper('useSession', ['useContext']),
      ];

      const primitives: DetectedPrimitive[] = [
        createPrimitive('useQuery', 'query'),
        createPrimitive('useContext', 'context'),
      ];

      const clusters = clusterWrappers(wrappers, primitives, { minClusterSize: 2 });
      const byCategory = getClustersByCategory(clusters);

      expect(byCategory.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getMostCommonPrimitives', () => {
    it('returns primitives sorted by usage', () => {
      const wrappers: WrapperFunction[] = [
        createWrapper('a', ['useState']),
        createWrapper('b', ['useState']),
        createWrapper('c', ['useState']),
        createWrapper('d', ['useEffect']),
        createWrapper('e', ['useEffect']),
      ];

      const primitives: DetectedPrimitive[] = [
        createPrimitive('useState', 'state'),
        createPrimitive('useEffect', 'effect'),
      ];

      const clusters = clusterWrappers(wrappers, primitives, { minClusterSize: 2 });
      const common = getMostCommonPrimitives(clusters, 5);

      expect(common[0].primitive).toBe('useState');
      expect(common[0].count).toBe(3);
    });
  });

  describe('findRelatedClusters', () => {
    it('finds clusters sharing primitives', () => {
      const wrappers: WrapperFunction[] = [
        createWrapper('a1', ['useState', 'useEffect']),
        createWrapper('a2', ['useState', 'useEffect']),
        createWrapper('b1', ['useState', 'useCallback']),
        createWrapper('b2', ['useState', 'useCallback']),
        createWrapper('c1', ['useRef']),
        createWrapper('c2', ['useRef']),
      ];

      const primitives: DetectedPrimitive[] = [
        createPrimitive('useState', 'state'),
        createPrimitive('useEffect', 'effect'),
        createPrimitive('useCallback', 'memo'),
        createPrimitive('useRef', 'ref'),
      ];

      const clusters = clusterWrappers(wrappers, primitives, { minClusterSize: 2 });
      const clusterA = clusters.find((c) => c.primitiveSignature.includes('useEffect'));

      if (clusterA) {
        const related = findRelatedClusters(clusterA, clusters);
        // Should find cluster B (shares useState) but not cluster C
        expect(related.some((c) => c.primitiveSignature.includes('useCallback'))).toBe(true);
        expect(related.every((c) => !c.primitiveSignature.includes('useRef') || c.primitiveSignature.includes('useState'))).toBe(true);
      }
    });
  });
});
