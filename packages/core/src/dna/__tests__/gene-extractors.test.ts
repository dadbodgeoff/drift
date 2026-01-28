import { describe, it, expect } from 'vitest';
import { VariantHandlingExtractor } from '../gene-extractors/variant-handling.js';
import { ResponsiveApproachExtractor } from '../gene-extractors/responsive-approach.js';
import { StateStylingExtractor } from '../gene-extractors/state-styling.js';
import { ThemingExtractor } from '../gene-extractors/theming.js';
import { SpacingPhilosophyExtractor } from '../gene-extractors/spacing-philosophy.js';
import { AnimationApproachExtractor } from '../gene-extractors/animation-approach.js';
import { createAllGeneExtractors } from '../gene-extractors/index.js';

describe('Gene Extractors', () => {
  describe('VariantHandlingExtractor', () => {
    const extractor = new VariantHandlingExtractor();

    it('should detect className composition pattern', () => {
      const content = `export function Button({ variant }) {
        const variants = { primary: 'bg-blue-500', secondary: 'bg-gray-500' };
        return <button className={variants[variant]} />;
      }`;
      const result = extractor.extractFromFile('Button.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'classname-composition')).toBe(true);
    });

    it('should detect CVA pattern', () => {
      const content = `import { cva } from 'class-variance-authority';
        const buttonVariants = cva('base', { variants: {} });`;
      const imports = ["import { cva } from 'class-variance-authority'"];
      const result = extractor.extractFromFile('Button.tsx', content, imports);
      expect(result.detectedAlleles.some(a => a.alleleId === 'cva')).toBe(true);
    });

    it('should detect conditional classes pattern', () => {
      const content = `export function Button() { return <button className={cn('base', active && 'active')} />; }`;
      const result = extractor.extractFromFile('Button.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'conditional-classes')).toBe(true);
    });
  });

  describe('ResponsiveApproachExtractor', () => {
    const extractor = new ResponsiveApproachExtractor();

    it('should detect Tailwind mobile-first', () => {
      const content = `export function Card() { return <div className="flex flex-col md:flex-row lg:gap-8" />; }`;
      const result = extractor.extractFromFile('Card.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'tailwind-mobile-first')).toBe(true);
    });

    it('should detect JS responsive hooks', () => {
      const content = `const isMobile = useMediaQuery('(max-width: 768px)');`;
      const result = extractor.extractFromFile('Component.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'js-responsive')).toBe(true);
    });
  });

  describe('StateStylingExtractor', () => {
    const extractor = new StateStylingExtractor();

    it('should detect Tailwind state variants', () => {
      const content = `<button className="bg-blue-500 hover:bg-blue-600 focus:ring-2" />`;
      const result = extractor.extractFromFile('Button.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'tailwind-variants')).toBe(true);
    });

    it('should detect data-state pattern', () => {
      const content = `<button data-state={isOpen ? 'open' : 'closed'} />`;
      const result = extractor.extractFromFile('Button.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'data-state')).toBe(true);
    });
  });

  describe('ThemingExtractor', () => {
    const extractor = new ThemingExtractor();

    it('should detect Tailwind dark mode', () => {
      const content = `<div className="bg-white dark:bg-gray-900" />`;
      const result = extractor.extractFromFile('Card.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'tailwind-dark')).toBe(true);
    });

    it('should detect CSS variables', () => {
      const content = `<div style={{ backgroundColor: 'var(--bg-primary)' }} />`;
      const result = extractor.extractFromFile('Card.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'css-variables')).toBe(true);
    });
  });

  describe('SpacingPhilosophyExtractor', () => {
    const extractor = new SpacingPhilosophyExtractor();

    it('should detect Tailwind spacing scale', () => {
      const content = `<div className="p-4 m-2 gap-6" />`;
      const result = extractor.extractFromFile('Card.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'tailwind-scale')).toBe(true);
    });

    it('should detect hardcoded values', () => {
      const content = `.card { padding: 16px; margin: 8px; }`;
      const result = extractor.extractFromFile('Card.css', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'hardcoded')).toBe(true);
    });
  });

  describe('AnimationApproachExtractor', () => {
    const extractor = new AnimationApproachExtractor();

    it('should detect Tailwind transitions', () => {
      const content = `<button className="transition-colors duration-200 ease-in-out" />`;
      const result = extractor.extractFromFile('Button.tsx', content, []);
      expect(result.detectedAlleles.some(a => a.alleleId === 'tailwind-transitions')).toBe(true);
    });

    it('should detect Framer Motion', () => {
      const content = `import { motion } from 'framer-motion'; <motion.div animate={{ opacity: 1 }} />`;
      const imports = ["import { motion } from 'framer-motion'"];
      const result = extractor.extractFromFile('Card.tsx', content, imports);
      expect(result.detectedAlleles.some(a => a.alleleId === 'framer-motion')).toBe(true);
    });
  });

  describe('createAllGeneExtractors', () => {
    it('should create all 10 extractors (6 frontend + 4 backend)', () => {
      const extractors = createAllGeneExtractors();
      expect(extractors.size).toBe(10);
      // Frontend extractors
      expect(extractors.has('variant-handling')).toBe(true);
      expect(extractors.has('responsive-approach')).toBe(true);
      expect(extractors.has('state-styling')).toBe(true);
      expect(extractors.has('theming')).toBe(true);
      expect(extractors.has('spacing-philosophy')).toBe(true);
      expect(extractors.has('animation-approach')).toBe(true);
      // Backend extractors
      expect(extractors.has('api-response-format')).toBe(true);
      expect(extractors.has('error-response-format')).toBe(true);
      expect(extractors.has('logging-format')).toBe(true);
      expect(extractors.has('config-pattern')).toBe(true);
    });
  });
});
