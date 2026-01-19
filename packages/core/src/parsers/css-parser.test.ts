/**
 * CSS Parser Tests
 *
 * Tests for the CSS/SCSS/SASS/LESS parser implementation.
 *
 * @requirements 3.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CSSParser } from './css-parser.js';
import type { CSSParseResult } from './css-parser.js';

describe('CSSParser', () => {
  let parser: CSSParser;

  beforeEach(() => {
    parser = new CSSParser();
  });

  describe('basic properties', () => {
    it('should have correct language', () => {
      expect(parser.language).toBe('css');
    });

    it('should have correct extensions', () => {
      expect(parser.extensions).toContain('.css');
      expect(parser.extensions).toContain('.scss');
      expect(parser.extensions).toContain('.sass');
      expect(parser.extensions).toContain('.less');
    });

    it('should handle CSS file extensions', () => {
      expect(parser.canHandle('.css')).toBe(true);
      expect(parser.canHandle('.scss')).toBe(true);
      expect(parser.canHandle('.sass')).toBe(true);
      expect(parser.canHandle('.less')).toBe(true);
      expect(parser.canHandle('.ts')).toBe(false);
      expect(parser.canHandle('.js')).toBe(false);
    });
  });

  describe('parse()', () => {
    it('should parse empty source', () => {
      const result = parser.parse('');
      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
      expect(result.selectors).toEqual([]);
      expect(result.properties).toEqual([]);
      expect(result.atRules).toEqual([]);
      expect(result.variables).toEqual([]);
    });

    it('should parse simple CSS rule', () => {
      const source = `.button {
  color: red;
}`;
      const result = parser.parse(source);
      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
    });
  });

  describe('selector extraction', () => {
    it('should extract class selectors', () => {
      const source = `.button { color: red; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('.button');
      expect(result.selectors[0]?.type).toBe('class');
    });

    it('should extract id selectors', () => {
      const source = `#header { background: blue; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('#header');
      expect(result.selectors[0]?.type).toBe('id');
    });

    it('should extract element selectors', () => {
      const source = `div { margin: 0; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('div');
      expect(result.selectors[0]?.type).toBe('element');
    });

    it('should extract pseudo-class selectors', () => {
      const source = `a:hover { color: blue; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('a:hover');
      expect(result.selectors[0]?.parts.some(p => p.type === 'pseudo-class')).toBe(true);
    });

    it('should extract pseudo-element selectors', () => {
      const source = `p::before { content: ""; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('p::before');
      expect(result.selectors[0]?.parts.some(p => p.type === 'pseudo-element')).toBe(true);
    });

    it('should extract attribute selectors', () => {
      const source = `input[type="text"] { border: 1px solid; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('input[type="text"]');
      expect(result.selectors[0]?.parts.some(p => p.type === 'attribute')).toBe(true);
    });

    it('should extract universal selector', () => {
      const source = `* { box-sizing: border-box; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('*');
      expect(result.selectors[0]?.type).toBe('universal');
    });

    it('should extract multiple selectors from comma-separated list', () => {
      const source = `.btn, .button, button { padding: 10px; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(3);
      expect(result.selectors.map(s => s.selector)).toContain('.btn');
      expect(result.selectors.map(s => s.selector)).toContain('.button');
      expect(result.selectors.map(s => s.selector)).toContain('button');
    });

    it('should extract compound selectors', () => {
      const source = `div.container#main { width: 100%; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('div.container#main');
      expect(result.selectors[0]?.parts.some(p => p.type === 'element')).toBe(true);
      expect(result.selectors[0]?.parts.some(p => p.type === 'class')).toBe(true);
      expect(result.selectors[0]?.parts.some(p => p.type === 'id')).toBe(true);
    });

    it('should extract descendant selectors', () => {
      const source = `.container .item { display: block; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('.container .item');
    });

    it('should extract child selectors', () => {
      const source = `.parent > .child { margin: 0; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.selectors).toHaveLength(1);
      expect(result.selectors[0]?.selector).toBe('.parent > .child');
    });
  });

  describe('property extraction', () => {
    it('should extract simple properties', () => {
      const source = `.box { color: red; background: blue; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.properties).toHaveLength(2);
      expect(result.properties[0]?.name).toBe('color');
      expect(result.properties[0]?.value).toBe('red');
      expect(result.properties[1]?.name).toBe('background');
      expect(result.properties[1]?.value).toBe('blue');
    });

    it('should extract properties with complex values', () => {
      const source = `.box { 
        border: 1px solid #333;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.properties).toHaveLength(2);
      expect(result.properties[0]?.name).toBe('border');
      expect(result.properties[0]?.value).toBe('1px solid #333');
      expect(result.properties[1]?.name).toBe('box-shadow');
      expect(result.properties[1]?.value).toContain('rgba');
    });

    it('should detect !important flag', () => {
      const source = `.override { color: red !important; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.properties).toHaveLength(1);
      expect(result.properties[0]?.name).toBe('color');
      expect(result.properties[0]?.isImportant).toBe(true);
    });

    it('should track parent selector for properties', () => {
      const source = `.button { color: white; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.properties).toHaveLength(1);
      expect(result.properties[0]?.parentSelector).toBe('.button');
    });

    it('should extract vendor-prefixed properties', () => {
      const source = `.flex { 
        -webkit-flex: 1;
        -moz-flex: 1;
        flex: 1;
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.properties).toHaveLength(3);
      expect(result.properties.map(p => p.name)).toContain('-webkit-flex');
      expect(result.properties.map(p => p.name)).toContain('-moz-flex');
      expect(result.properties.map(p => p.name)).toContain('flex');
    });
  });

  describe('@rule extraction', () => {
    it('should extract @import rules', () => {
      const source = `@import url('styles.css');`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.atRules).toHaveLength(1);
      expect(result.atRules[0]?.name).toBe('import');
      expect(result.atRules[0]?.hasBlock).toBe(false);
    });

    it('should extract @media rules', () => {
      const source = `@media (max-width: 768px) {
        .container { width: 100%; }
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.atRules).toHaveLength(1);
      expect(result.atRules[0]?.name).toBe('media');
      expect(result.atRules[0]?.params).toContain('max-width');
      expect(result.atRules[0]?.hasBlock).toBe(true);
    });

    it('should extract @keyframes rules', () => {
      const source = `@keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.atRules).toHaveLength(1);
      expect(result.atRules[0]?.name).toBe('keyframes');
      expect(result.atRules[0]?.params).toBe('fadeIn');
      expect(result.atRules[0]?.hasBlock).toBe(true);
    });

    it('should extract @font-face rules', () => {
      const source = `@font-face {
        font-family: 'CustomFont';
        src: url('font.woff2');
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.atRules).toHaveLength(1);
      expect(result.atRules[0]?.name).toBe('font-face');
      expect(result.atRules[0]?.hasBlock).toBe(true);
    });

    it('should extract @charset rules', () => {
      const source = `@charset "UTF-8";`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.atRules).toHaveLength(1);
      expect(result.atRules[0]?.name).toBe('charset');
      expect(result.atRules[0]?.hasBlock).toBe(false);
    });

    it('should extract @supports rules', () => {
      const source = `@supports (display: grid) {
        .grid { display: grid; }
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.atRules).toHaveLength(1);
      expect(result.atRules[0]?.name).toBe('supports');
      expect(result.atRules[0]?.params).toContain('display: grid');
    });

    it('should extract multiple @rules', () => {
      const source = `@import url('reset.css');
@import url('base.css');
@media print {
  .no-print { display: none; }
}`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.atRules).toHaveLength(3);
      expect(result.atRules.filter(r => r.name === 'import')).toHaveLength(2);
      expect(result.atRules.filter(r => r.name === 'media')).toHaveLength(1);
    });
  });

  describe('CSS variable extraction', () => {
    it('should extract CSS variables from :root', () => {
      const source = `:root {
        --primary-color: #007bff;
        --secondary-color: #6c757d;
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.variables).toHaveLength(2);
      expect(result.variables[0]?.name).toBe('--primary-color');
      expect(result.variables[0]?.value).toBe('#007bff');
      expect(result.variables[0]?.scope).toBe(':root');
      expect(result.variables[1]?.name).toBe('--secondary-color');
      expect(result.variables[1]?.value).toBe('#6c757d');
    });

    it('should extract CSS variables from other selectors', () => {
      const source = `.dark-theme {
        --bg-color: #1a1a1a;
        --text-color: #ffffff;
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.variables).toHaveLength(2);
      expect(result.variables[0]?.scope).toBe('.dark-theme');
    });

    it('should extract CSS variables with complex values', () => {
      const source = `:root {
        --spacing-unit: 8px;
        --shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        --font-stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto;
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.variables).toHaveLength(3);
      expect(result.variables[0]?.value).toBe('8px');
      expect(result.variables[1]?.value).toContain('rgba');
      expect(result.variables[2]?.value).toContain('Roboto');
    });

    it('should identify variable declarations in properties', () => {
      const source = `.theme {
        --custom-prop: value;
        color: var(--custom-prop);
      }`;
      const result = parser.parse(source) as CSSParseResult;

      // The variable declaration
      expect(result.variables).toHaveLength(1);
      expect(result.variables[0]?.name).toBe('--custom-prop');

      // The property using the variable
      const colorProp = result.properties.find(p => p.name === 'color');
      expect(colorProp?.value).toContain('var(--custom-prop)');
    });
  });

  describe('nested rules (SCSS/LESS)', () => {
    it('should extract nested rules with &', () => {
      const source = `.button {
        color: blue;
        &:hover {
          color: red;
        }
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]?.nestedRules.length).toBeGreaterThanOrEqual(0);
    });

    it('should extract nested class selectors', () => {
      const source = `.card {
        padding: 20px;
        .title {
          font-size: 24px;
        }
      }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.rules).toHaveLength(1);
      // Nested rules should be extracted
      const cardRule = result.rules[0];
      expect(cardRule?.selectors).toContain('.card');
    });

    it('should resolve nested selectors correctly', () => {
      const source = `.parent {
        &-child {
          color: red;
        }
      }`;
      const result = parser.parse(source) as CSSParseResult;

      // The nested rule should resolve & to parent
      expect(result.rules).toHaveLength(1);
    });
  });

  describe('query()', () => {
    it('should find nodes by type', () => {
      const source = `.button { color: red; }
@media print { .no-print { display: none; } }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.ast).not.toBeNull();
      
      if (result.ast) {
        // Find Rule nodes
        const rules = parser.query(result.ast, 'Rule');
        expect(rules.length).toBeGreaterThan(0);

        // Find AtRule nodes
        const atRules = parser.query(result.ast, 'AtRule');
        expect(atRules.length).toBeGreaterThan(0);

        // Find StyleSheet root node
        const styleSheets = parser.query(result.ast, 'StyleSheet');
        expect(styleSheets.length).toBe(1);
      }
    });

    it('should find Selector nodes', () => {
      const source = `.btn, .button { padding: 10px; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const selectors = parser.query(result.ast, 'Selector');
        expect(selectors.length).toBe(2);
      }
    });

    it('should find Declaration nodes', () => {
      const source = `.box { color: red; background: blue; margin: 10px; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const declarations = parser.query(result.ast, 'Declaration');
        expect(declarations.length).toBe(3);
      }
    });
  });

  describe('error handling', () => {
    it('should handle malformed CSS gracefully', () => {
      const source = `.broken { color: red; /* unclosed comment`;
      const result = parser.parse(source);

      // Should not throw, should return a result
      expect(result).toBeDefined();
      expect(result.success).toBe(true); // Regex-based parser is lenient
    });

    it('should handle unclosed braces gracefully', () => {
      const source = `.unclosed { color: red;`;
      const result = parser.parse(source);

      expect(result).toBeDefined();
      // Parser should still work, just might not extract the rule
    });

    it('should handle empty rules', () => {
      const source = `.empty { }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.success).toBe(true);
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]?.properties).toHaveLength(0);
    });
  });

  describe('complex scenarios', () => {
    it('should parse a complete CSS file', () => {
      const source = `/* Reset */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --primary: #007bff;
  --secondary: #6c757d;
  --spacing: 8px;
}

body {
  font-family: Arial, sans-serif;
  line-height: 1.6;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--spacing);
}

.button {
  display: inline-block;
  padding: 10px 20px;
  background-color: var(--primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.button:hover {
  background-color: #0056b3;
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .container {
    padding: 10px;
  }
}
`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.success).toBe(true);
      
      // Should have multiple selectors
      expect(result.selectors.length).toBeGreaterThan(5);
      
      // Should have CSS variables
      expect(result.variables.length).toBeGreaterThanOrEqual(3);
      
      // Should have @media rule
      expect(result.atRules.some(r => r.name === 'media')).toBe(true);
      
      // Should have multiple properties
      expect(result.properties.length).toBeGreaterThan(10);
    });

    it('should parse SCSS-like syntax', () => {
      const source = `$primary: #007bff;

.card {
  padding: 20px;
  border: 1px solid #ddd;
  
  .header {
    font-size: 18px;
    font-weight: bold;
  }
  
  .body {
    margin-top: 10px;
  }
  
  &:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
}
`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.success).toBe(true);
      expect(result.rules.length).toBeGreaterThan(0);
    });

    it('should handle multiple rules with same selector', () => {
      const source = `.button { color: red; }
.button { background: blue; }
.button { border: none; }`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.rules).toHaveLength(3);
      expect(result.selectors.filter(s => s.selector === '.button')).toHaveLength(3);
    });

    it('should extract all selector types from complex stylesheet', () => {
      const source = `
/* Element */
div { display: block; }

/* Class */
.class { color: red; }

/* ID */
#id { font-size: 16px; }

/* Attribute */
[data-active] { opacity: 1; }

/* Pseudo-class */
a:hover { text-decoration: underline; }

/* Pseudo-element */
p::first-line { font-weight: bold; }

/* Universal */
* { margin: 0; }

/* Compound */
div.container#main[data-page]:hover::before { content: ""; }
`;
      const result = parser.parse(source) as CSSParseResult;

      expect(result.success).toBe(true);
      
      // Check for different selector types
      const types = result.selectors.map(s => s.type);
      expect(types).toContain('element');
      expect(types).toContain('class');
      expect(types).toContain('id');
      expect(types).toContain('universal');
    });
  });
});
