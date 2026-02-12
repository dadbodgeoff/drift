# BaseParser — Abstract Parser Interface

## Location
`packages/core/src/parsers/base-parser.ts` (~600 lines)

## Purpose
Defines the common interface and utility methods for all TypeScript-side language parsers. Every TS parser extends this class.

## Abstract Contract

```typescript
abstract class BaseParser {
  abstract readonly language: Language;
  abstract readonly extensions: string[];
  abstract parse(source: string, filePath?: string): ParseResult;
}
```

## Configuration Types

### ParseOptions
```typescript
interface ParseOptions {
  filePath?: string;
  includeComments?: boolean;
  incremental?: boolean;
  previousAst?: AST;
}
```

### QueryOptions
```typescript
interface QueryOptions {
  limit?: number;
  includeNested?: boolean;
  startPosition?: Position;
  endPosition?: Position;
}
```

## Key Methods

### Parsing
- `parse(source, filePath?)` — Abstract, must be implemented
- `parseWithOptions(source, options)` — Delegates to `parse()` with options

### AST Querying
- `queryWithOptions(ast, pattern, options)` — Pattern-based AST search
- `findNodesByType(ast, type)` — Find all nodes of a given type
- `findFirstNodeByType(ast, type)` — Find first node of type
- `findNodeAtPosition(ast, position)` — Locate node at cursor position

### Tree Traversal
- `traverse(ast, visitor)` — Depth-first traversal with visitor pattern
- `getParentChain(node, ast)` — Get ancestors from root to node
- `getDescendants(node)` — Get all descendants
- `getSiblings(node, ast)` — Get sibling nodes

### Position Utilities
- `positionInRange(position, start, end)` — Check if position is within range
- `comparePositions(a, b)` — Compare two positions (-1, 0, 1)
- `getTextBetween(source, start, end)` — Extract text between positions

### Node Creation
- `createNode(type, text, start, end, children)` — Build ASTNode
- `createAST(rootNode, text)` — Build AST wrapper
- `nodesEqual(a, b)` — Deep equality check

### Result Builders
- `createSuccessResult(ast, language)` — Success ParseResult
- `createFailureResult(errors, language)` — Failed ParseResult
- `createPartialResult(ast, errors, language)` — Partial success

### Extension Checking
- `canHandle(extension)` — Check if parser handles this file type

## TraversalResult
```typescript
interface TraversalResult {
  node: ASTNode;
  parent: ASTNode | null;
  depth: number;
  path: number[];  // Index path from root
}
```

## ASTVisitor
```typescript
type ASTVisitor = (result: TraversalResult) => boolean | void;
// Return false to stop traversal
```

## v2 Considerations
- This class becomes unnecessary when Rust handles all parsing
- The query/traversal utilities could be reimplemented as Rust functions operating on tree-sitter trees directly
- The visitor pattern maps to Rust's `TreeCursor` API
- Position utilities are trivial to port
