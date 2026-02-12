# PHP Extraction Utilities

## Location
`packages/detectors/src/php/`

## Purpose
Shared PHP parsing utilities used by Laravel detectors and other PHP-specific detectors. These extract structured information from PHP source code without requiring a full PHP parser.

## Files
- `class-extractor.ts` — Extracts PHP class definitions
- `method-extractor.ts` — Extracts PHP method definitions
- `attribute-extractor.ts` — Extracts PHP 8 attributes
- `docblock-extractor.ts` — Extracts PHPDoc blocks
- `types.ts` — Comprehensive PHP type definitions

## Type Definitions (`types.ts`)

### Class-Level Types
```typescript
interface PhpClassInfo {
  name: string;
  namespace?: string;
  modifiers: PhpClassModifiers;    // abstract, final, readonly
  extends?: string;
  implements: string[];
  traits: string[];
  properties: PhpPropertyInfo[];
  methods: PhpMethodInfo[];
  constants: PhpConstantInfo[];
  attributes: PhpAttribute[];
  docblock?: DocblockInfo;
  location: PhpLocation;
}
```

### Method-Level Types
```typescript
interface PhpMethodInfo {
  name: string;
  modifiers: PhpMethodModifiers;   // public/protected/private, static, abstract, final
  parameters: PhpParameterInfo[];
  returnType?: PhpTypeInfo;
  attributes: PhpAttribute[];
  docblock?: DocblockInfo;
  location: PhpLocation;
}
```

### PHP 8 Attributes
```typescript
interface PhpAttribute {
  name: string;
  arguments: PhpAttributeArgument[];
  target: 'class' | 'method' | 'property' | 'parameter' | 'function' | 'constant';
  location: PhpLocation;
}
```

### PHPDoc Blocks
```typescript
interface DocblockInfo {
  summary: string;
  description?: string;
  tags: DocblockTag[];
  location: PhpLocation;
}

interface DocblockTag {
  name: string;          // e.g. 'param', 'return', 'throws'
  type?: string;
  variable?: string;
  description?: string;
}
```

### Additional Types
- `PhpInterfaceInfo` — Interface definitions
- `PhpTraitInfo` — Trait definitions
- `PhpEnumInfo` + `PhpEnumCase` — PHP 8.1 enums
- `PhpFunctionInfo` — Standalone functions
- `PhpUseStatement` — Use/import statements
- `PhpNamespace` — Namespace declarations
- `PhpPropertyInfo` — Class properties with promoted constructor params
- `PhpConstantInfo` — Class constants
- `PhpTypeInfo` — Type information (nullable, union, intersection)
- `PhpFileExtractionResult` — Complete file extraction result

### Utility
```typescript
function isBuiltinType(type: string): boolean
// Checks: string, int, float, bool, array, object, null, void, never, mixed, etc.
```
