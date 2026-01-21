import { describe, it, expect } from 'vitest';
import { DNAAnalyzer } from '../dna-analyzer.js';
import { GENE_IDS } from '../types.js';

describe('DNAAnalyzer', () => {
  it('should initialize without error', async () => {
    const analyzer = new DNAAnalyzer({ rootDir: '.' });
    await analyzer.initialize();
  });

  it('should analyze files and produce valid profile', async () => {
    const analyzer = new DNAAnalyzer({ rootDir: '.' });
    const files = new Map<string, string>();
    files.set('Button.tsx', `export function Button({ variant }) {
      const variants = { primary: 'bg-blue-500 hover:bg-blue-600', secondary: 'bg-gray-500' };
      return <button className={variants[variant]} />;
    }`);
    files.set('Card.tsx', `export function Card() {
      return <div className="p-4 m-2 bg-white dark:bg-gray-900 md:flex" />;
    }`);

    const result = await analyzer.analyze(files);

    expect(result.profile.version).toBe('1.0.0');
    expect(result.profile.summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.profile.summary.healthScore).toBeLessThanOrEqual(100);
    expect(result.stats.filesAnalyzed).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect all 6 genes', async () => {
    const analyzer = new DNAAnalyzer({ rootDir: '.' });
    const files = new Map<string, string>();
    files.set('Component.tsx', `export function Component() {
      const variants = { primary: 'bg-blue-500' };
      return <div className="p-4 md:p-8 hover:bg-blue-600 dark:bg-gray-900 transition-colors" />;
    }`);

    const result = await analyzer.analyze(files);

    for (const geneId of GENE_IDS) {
      expect(result.profile.genes[geneId]).toBeDefined();
      expect(result.profile.genes[geneId].id).toBe(geneId);
    }
  });

  it('should handle empty projects gracefully', async () => {
    const analyzer = new DNAAnalyzer({ rootDir: '.' });
    const files = new Map<string, string>();

    const result = await analyzer.analyze(files);

    expect(result.profile.summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.profile.summary.totalFilesAnalyzed).toBe(0);
  });

  it('should calculate health score between 0-100', async () => {
    const analyzer = new DNAAnalyzer({ rootDir: '.' });
    const files = new Map<string, string>();
    files.set('Button.tsx', `export function Button() { return <button className="p-4 hover:bg-blue-500" />; }`);

    const result = await analyzer.analyze(files);

    expect(result.profile.summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.profile.summary.healthScore).toBeLessThanOrEqual(100);
  });
});
