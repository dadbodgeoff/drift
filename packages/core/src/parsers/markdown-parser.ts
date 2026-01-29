/**
 * Markdown Parser - Markdown/MDX parsing for AST extraction
 *
 * Extracts headings, code blocks, links, images, lists, blockquotes,
 * and front matter from Markdown files using regex-based parsing.
 *
 * @requirements 3.2
 */

import { BaseParser } from './base-parser.js';

import type { AST, ASTNode, Language, ParseResult, Position } from './types.js';

/**
 * Heading levels (h1-h6)
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Information about a Markdown heading
 */
export interface MarkdownHeadingInfo {
  /** Heading level (1-6) */
  level: HeadingLevel;
  /** Heading text content */
  text: string;
  /** Generated slug/anchor ID */
  slug: string;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a code block
 */
export interface MarkdownCodeBlockInfo {
  /** Language identifier (e.g., 'typescript', 'python') */
  language: string | null;
  /** Code content */
  content: string;
  /** Whether this is an inline code span */
  isInline: boolean;
  /** Meta string after language (e.g., 'title="example.ts"') */
  meta: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Link types in Markdown
 */
export type LinkType = 'inline' | 'reference' | 'autolink';

/**
 * Information about a Markdown link
 */
export interface MarkdownLinkInfo {
  /** Link text/label */
  text: string;
  /** Link URL/href */
  url: string;
  /** Link title (optional) */
  title: string | null;
  /** Type of link */
  type: LinkType;
  /** Reference ID for reference-style links */
  referenceId: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a Markdown image
 */
export interface MarkdownImageInfo {
  /** Alt text */
  alt: string;
  /** Image URL/src */
  url: string;
  /** Image title (optional) */
  title: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * List types in Markdown
 */
export type ListType = 'ordered' | 'unordered';

/**
 * Information about a Markdown list
 */
export interface MarkdownListInfo {
  /** Type of list */
  type: ListType;
  /** List items */
  items: MarkdownListItemInfo[];
  /** Nesting depth (0 = top level) */
  depth: number;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a list item
 */
export interface MarkdownListItemInfo {
  /** Item text content */
  text: string;
  /** Whether this is a task list item */
  isTask: boolean;
  /** Task completion status (null if not a task) */
  isChecked: boolean | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a blockquote
 */
export interface MarkdownBlockquoteInfo {
  /** Blockquote content */
  content: string;
  /** Nesting depth (1 = single >) */
  depth: number;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about front matter (YAML)
 */
export interface MarkdownFrontMatterInfo {
  /** Raw YAML content */
  raw: string;
  /** Parsed key-value pairs */
  data: Record<string, unknown>;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Extended parse result with Markdown-specific information
 */
export interface MarkdownParseResult extends ParseResult {
  /** Extracted headings */
  headings: MarkdownHeadingInfo[];
  /** Extracted code blocks */
  codeBlocks: MarkdownCodeBlockInfo[];
  /** Extracted links */
  links: MarkdownLinkInfo[];
  /** Extracted images */
  images: MarkdownImageInfo[];
  /** Extracted lists */
  lists: MarkdownListInfo[];
  /** Extracted blockquotes */
  blockquotes: MarkdownBlockquoteInfo[];
  /** Front matter if present */
  frontMatter: MarkdownFrontMatterInfo | null;
}

/**
 * Markdown/MDX parser using regex-based parsing.
 *
 * Provides AST parsing and extraction of headings, code blocks,
 * links, images, lists, blockquotes, and front matter from
 * Markdown source files.
 *
 * @requirements 3.2 - Support Markdown parsing
 * @requirements 3.3 - Graceful degradation on parse errors
 */
export class MarkdownParser extends BaseParser {
  readonly language: Language = 'markdown';
  readonly extensions: string[] = ['.md', '.mdx', '.markdown'];

  /**
   * Parse Markdown source code into an AST.
   *
   * @param source - The source code to parse
   * @param filePath - Optional file path for error reporting
   * @returns MarkdownParseResult containing the AST and extracted information
   *
   * @requirements 3.2, 3.3
   */
  parse(source: string, _filePath?: string): MarkdownParseResult {
    try {
      const lines = source.split('\n');
      const rootChildren: ASTNode[] = [];

      // Extract front matter first (must be at the start)
      const frontMatter = this.extractFrontMatter(source, lines);

      // Extract semantic information
      const headings = this.extractHeadings(source, lines);
      const codeBlocks = this.extractCodeBlocks(source, lines);
      const links = this.extractLinks(source, lines);
      const images = this.extractImages(source, lines);
      const lists = this.extractLists(source, lines);
      const blockquotes = this.extractBlockquotes(source, lines);

      // Build AST nodes for front matter
      if (frontMatter) {
        const frontMatterNode = this.createFrontMatterNode(frontMatter);
        rootChildren.push(frontMatterNode);
      }

      // Build AST nodes for headings
      for (const heading of headings) {
        const headingNode = this.createHeadingNode(heading);
        rootChildren.push(headingNode);
      }

      // Build AST nodes for code blocks
      for (const codeBlock of codeBlocks) {
        const codeBlockNode = this.createCodeBlockNode(codeBlock);
        rootChildren.push(codeBlockNode);
      }

      // Build AST nodes for links
      for (const link of links) {
        const linkNode = this.createLinkNode(link);
        rootChildren.push(linkNode);
      }

      // Build AST nodes for images
      for (const image of images) {
        const imageNode = this.createImageNode(image);
        rootChildren.push(imageNode);
      }

      // Build AST nodes for lists
      for (const list of lists) {
        const listNode = this.createListNode(list);
        rootChildren.push(listNode);
      }

      // Build AST nodes for blockquotes
      for (const blockquote of blockquotes) {
        const blockquoteNode = this.createBlockquoteNode(blockquote);
        rootChildren.push(blockquoteNode);
      }

      // Create root node
      const endPosition = lines.length > 0
        ? { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 }
        : { row: 0, column: 0 };

      const rootNode = this.createNode(
        'Document',
        source,
        { row: 0, column: 0 },
        endPosition,
        rootChildren
      );

      const ast = this.createAST(rootNode, source);

      return {
        ...this.createSuccessResult(ast),
        headings,
        codeBlocks,
        links,
        images,
        lists,
        blockquotes,
        frontMatter,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        ...this.createFailureResult([this.createError(errorMessage, { row: 0, column: 0 })]),
        headings: [],
        codeBlocks: [],
        links: [],
        images: [],
        lists: [],
        blockquotes: [],
        frontMatter: null,
      };
    }
  }

  /**
   * Query the AST for nodes matching a pattern.
   *
   * Supports querying by node type (e.g., 'Heading', 'CodeBlock', 'Link', 'Image').
   *
   * @param ast - The AST to query
   * @param pattern - The node type to search for
   * @returns Array of matching AST nodes
   *
   * @requirements 3.5
   */
  query(ast: AST, pattern: string): ASTNode[] {
    return this.findNodesByType(ast, pattern);
  }

  // ============================================
  // Front Matter Extraction
  // ============================================

  /**
   * Extract YAML front matter from the start of the document.
   */
  private extractFrontMatter(source: string, lines: string[]): MarkdownFrontMatterInfo | null {
    // Front matter must start at the very beginning with ---
    if (!source.startsWith('---')) {
      return null;
    }

    // Find the closing ---
    const endMatch = source.slice(3).match(/\n---(?:\n|$)/);
    if (endMatch?.index === undefined) {
      return null;
    }

    const endIndex = endMatch.index + 3; // +3 for initial ---
    const raw = source.slice(4, endIndex).trim(); // Skip opening --- and newline

    // Parse YAML content (simple key: value parsing)
    const data = this.parseSimpleYaml(raw);

    // Calculate end position
    let endRow = 0;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += (lines[i]?.length ?? 0) + 1; // +1 for newline
      if (charCount > endIndex + 4) { // +4 for closing ---\n
        endRow = i;
        break;
      }
    }

    return {
      raw,
      data,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: endRow, column: 3 },
    };
  }

  /**
   * Parse simple YAML key-value pairs.
   */
  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {continue;}

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        let value: unknown = trimmed.slice(colonIndex + 1).trim();

        // Parse value type
        if (value === 'true') {value = true;}
        else if (value === 'false') {value = false;}
        else if (value === 'null' || value === '') {value = null;}
        else if (!isNaN(Number(value)) && value !== '') {value = Number(value);}
        else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        } else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          // Simple array parsing
          value = value.slice(1, -1).split(',').map(v => v.trim());
        }

        data[key] = value;
      }
    }

    return data;
  }

  // ============================================
  // Heading Extraction
  // ============================================

  /**
   * Extract all headings from Markdown source.
   */
  private extractHeadings(source: string, lines: string[]): MarkdownHeadingInfo[] {
    const headings: MarkdownHeadingInfo[] = [];

    // Match ATX-style headings: # Heading
    const atxHeadingRegex = /^(#{1,6})\s+(.+?)(?:\s+#*)?$/gm;
    let match: RegExpExecArray | null;

    while ((match = atxHeadingRegex.exec(source)) !== null) {
      const hashes = match[1] ?? '';
      const level = hashes.length as HeadingLevel;
      const text = (match[2] ?? '').trim();
      const lineNumber = this.getLineNumber(source, match.index);

      headings.push({
        level,
        text,
        slug: this.generateSlug(text),
        startPosition: { row: lineNumber, column: 0 },
        endPosition: { row: lineNumber, column: (lines[lineNumber]?.length ?? 0) },
      });
    }

    // Match Setext-style headings (underlined with = or -)
    for (let i = 0; i < lines.length - 1; i++) {
      const currentLine = lines[i]?.trim() ?? '';
      const nextLine = lines[i + 1]?.trim() ?? '';

      if (currentLine && /^=+$/.test(nextLine)) {
        // H1 with ===
        headings.push({
          level: 1,
          text: currentLine,
          slug: this.generateSlug(currentLine),
          startPosition: { row: i, column: 0 },
          endPosition: { row: i + 1, column: (lines[i + 1]?.length ?? 0) },
        });
      } else if (currentLine && /^-+$/.test(nextLine) && nextLine.length >= 2) {
        // H2 with ---
        headings.push({
          level: 2,
          text: currentLine,
          slug: this.generateSlug(currentLine),
          startPosition: { row: i, column: 0 },
          endPosition: { row: i + 1, column: (lines[i + 1]?.length ?? 0) },
        });
      }
    }

    // Sort by position
    headings.sort((a, b) => a.startPosition.row - b.startPosition.row);

    return headings;
  }

  /**
   * Generate a URL-friendly slug from heading text.
   */
  private generateSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  // ============================================
  // Code Block Extraction
  // ============================================

  /**
   * Extract all code blocks from Markdown source.
   */
  private extractCodeBlocks(source: string, lines: string[]): MarkdownCodeBlockInfo[] {
    const codeBlocks: MarkdownCodeBlockInfo[] = [];

    // Match fenced code blocks with ``` or ~~~
    const fencedCodeRegex = /^(```|~~~)(\w*)?(?:\s+(.+))?\n([\s\S]*?)^\1$/gm;
    let match: RegExpExecArray | null;

    while ((match = fencedCodeRegex.exec(source)) !== null) {
      const language = match[2] || null;
      const meta = match[3] || null;
      const content = match[4] ?? '';
      const lineNumber = this.getLineNumber(source, match.index);
      const endLineNumber = this.getLineNumber(source, match.index + (match[0]?.length ?? 0));

      codeBlocks.push({
        language,
        content: content.trimEnd(),
        isInline: false,
        meta,
        startPosition: { row: lineNumber, column: 0 },
        endPosition: { row: endLineNumber, column: (lines[endLineNumber]?.length ?? 0) },
      });
    }

    // Match indented code blocks (4 spaces or 1 tab)
    let inCodeBlock = false;
    let codeBlockStart = -1;
    let codeBlockContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const isIndented = line.startsWith('    ') || line.startsWith('\t');
      const isEmpty = line.trim() === '';

      if (isIndented && !inCodeBlock) {
        // Start of indented code block
        inCodeBlock = true;
        codeBlockStart = i;
        codeBlockContent = [line.slice(4) || line.slice(1)]; // Remove indent
      } else if (inCodeBlock && (isIndented || isEmpty)) {
        // Continue code block
        codeBlockContent.push(isIndented ? (line.slice(4) || line.slice(1)) : '');
      } else if (inCodeBlock && !isIndented && !isEmpty) {
        // End of indented code block
        // Remove trailing empty lines
        while (codeBlockContent.length > 0 && codeBlockContent[codeBlockContent.length - 1]?.trim() === '') {
          codeBlockContent.pop();
        }

        if (codeBlockContent.length > 0) {
          codeBlocks.push({
            language: null,
            content: codeBlockContent.join('\n'),
            isInline: false,
            meta: null,
            startPosition: { row: codeBlockStart, column: 0 },
            endPosition: { row: i - 1, column: (lines[i - 1]?.length ?? 0) },
          });
        }

        inCodeBlock = false;
        codeBlockContent = [];
      }
    }

    // Handle code block at end of file
    if (inCodeBlock && codeBlockContent.length > 0) {
      while (codeBlockContent.length > 0 && codeBlockContent[codeBlockContent.length - 1]?.trim() === '') {
        codeBlockContent.pop();
      }

      if (codeBlockContent.length > 0) {
        codeBlocks.push({
          language: null,
          content: codeBlockContent.join('\n'),
          isInline: false,
          meta: null,
          startPosition: { row: codeBlockStart, column: 0 },
          endPosition: { row: lines.length - 1, column: (lines[lines.length - 1]?.length ?? 0) },
        });
      }
    }

    // Match inline code spans
    const inlineCodeRegex = /`([^`\n]+)`/g;
    while ((match = inlineCodeRegex.exec(source)) !== null) {
      const content = match[1] ?? '';
      const lineNumber = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      codeBlocks.push({
        language: null,
        content,
        isInline: true,
        meta: null,
        startPosition: { row: lineNumber, column },
        endPosition: { row: lineNumber, column: column + (match[0]?.length ?? 0) },
      });
    }

    // Sort by position
    codeBlocks.sort((a, b) => {
      if (a.startPosition.row !== b.startPosition.row) {
        return a.startPosition.row - b.startPosition.row;
      }
      return a.startPosition.column - b.startPosition.column;
    });

    return codeBlocks;
  }

  // ============================================
  // Link Extraction
  // ============================================

  /**
   * Extract all links from Markdown source.
   */
  private extractLinks(source: string, _lines: string[]): MarkdownLinkInfo[] {
    const links: MarkdownLinkInfo[] = [];

    // Match inline links: [text](url "title")
    const inlineLinkRegex = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
    let match: RegExpExecArray | null;

    while ((match = inlineLinkRegex.exec(source)) !== null) {
      const text = match[1] ?? '';
      const url = match[2] ?? '';
      const title = match[3] || null;
      const lineNumber = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      links.push({
        text,
        url,
        title,
        type: 'inline',
        referenceId: null,
        startPosition: { row: lineNumber, column },
        endPosition: { row: lineNumber, column: column + (match[0]?.length ?? 0) },
      });
    }

    // Match reference-style links: [text][ref] or [text][]
    const refLinkRegex = /\[([^\]]+)\]\[([^\]]*)\]/g;
    while ((match = refLinkRegex.exec(source)) !== null) {
      const text = match[1] ?? '';
      const refId = match[2] || text; // If empty, use text as reference
      const lineNumber = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      // Find the reference definition
      const refDef = this.findLinkReference(source, refId);

      links.push({
        text,
        url: refDef?.url ?? '',
        title: refDef?.title ?? null,
        type: 'reference',
        referenceId: refId,
        startPosition: { row: lineNumber, column },
        endPosition: { row: lineNumber, column: column + (match[0]?.length ?? 0) },
      });
    }

    // Match autolinks: <url> or <email>
    const autolinkRegex = /<(https?:\/\/[^>]+|[^@\s>]+@[^@\s>]+\.[^@\s>]+)>/g;
    while ((match = autolinkRegex.exec(source)) !== null) {
      const url = match[1] ?? '';
      const lineNumber = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      links.push({
        text: url,
        url: url.includes('@') && !url.startsWith('http') ? `mailto:${url}` : url,
        title: null,
        type: 'autolink',
        referenceId: null,
        startPosition: { row: lineNumber, column },
        endPosition: { row: lineNumber, column: column + (match[0]?.length ?? 0) },
      });
    }

    return links;
  }

  /**
   * Find a link reference definition.
   */
  private findLinkReference(source: string, refId: string): { url: string; title: string | null } | null {
    // Match reference definitions: [ref]: url "title"
    const escapedRefId = refId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const refDefRegex = new RegExp(`^\\[${escapedRefId}\\]:\\s*(\\S+)(?:\\s+"([^"]*)")?`, 'im');
    const match = refDefRegex.exec(source);

    if (match) {
      return {
        url: match[1] ?? '',
        title: match[2] || null,
      };
    }

    return null;
  }

  // ============================================
  // Image Extraction
  // ============================================

  /**
   * Extract all images from Markdown source.
   */
  private extractImages(source: string, _lines: string[]): MarkdownImageInfo[] {
    const images: MarkdownImageInfo[] = [];

    // Match inline images: ![alt](url "title")
    const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
    let match: RegExpExecArray | null;

    while ((match = imageRegex.exec(source)) !== null) {
      const alt = match[1] ?? '';
      const url = match[2] ?? '';
      const title = match[3] || null;
      const lineNumber = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      images.push({
        alt,
        url,
        title,
        startPosition: { row: lineNumber, column },
        endPosition: { row: lineNumber, column: column + (match[0]?.length ?? 0) },
      });
    }

    // Match reference-style images: ![alt][ref]
    const refImageRegex = /!\[([^\]]*)\]\[([^\]]*)\]/g;
    while ((match = refImageRegex.exec(source)) !== null) {
      const alt = match[1] ?? '';
      const refId = match[2] || alt;
      const lineNumber = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      // Find the reference definition
      const refDef = this.findLinkReference(source, refId);

      images.push({
        alt,
        url: refDef?.url ?? '',
        title: refDef?.title ?? null,
        startPosition: { row: lineNumber, column },
        endPosition: { row: lineNumber, column: column + (match[0]?.length ?? 0) },
      });
    }

    return images;
  }

  // ============================================
  // List Extraction
  // ============================================

  /**
   * Extract all lists from Markdown source.
   */
  private extractLists(_source: string, lines: string[]): MarkdownListInfo[] {
    const lists: MarkdownListInfo[] = [];
    let currentList: MarkdownListInfo | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      // Check for unordered list item: - item, * item, + item
      const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
      // Check for ordered list item: 1. item, 2) item
      const orderedMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);

      if (unorderedMatch || orderedMatch) {
        const match = unorderedMatch || orderedMatch;
        const indent = match?.[1]?.length ?? 0;
        const itemText = match?.[3] ?? '';
        const listType: ListType = unorderedMatch ? 'unordered' : 'ordered';
        const depth = Math.floor(indent / 2);

        // Check for task list item
        const taskMatch = itemText.match(/^\[([ xX])\]\s*(.*)$/);
        const isTask = !!taskMatch;
        const isChecked = taskMatch ? taskMatch[1]?.toLowerCase() === 'x' : null;
        const text = taskMatch ? (taskMatch[2] ?? '') : itemText;

        const listItem: MarkdownListItemInfo = {
          text,
          isTask,
          isChecked,
          startPosition: { row: i, column: indent },
          endPosition: { row: i, column: line.length },
        };

        // Check if we need to start a new list
        if (!currentList || currentList.type !== listType || currentList.depth !== depth) {
          // Save previous list if exists
          if (currentList && currentList.items.length > 0) {
            currentList.endPosition = { row: i - 1, column: (lines[i - 1]?.length ?? 0) };
            lists.push(currentList);
          }

          // Start new list
          currentList = {
            type: listType,
            items: [listItem],
            depth,
            startPosition: { row: i, column: indent },
            endPosition: { row: i, column: line.length },
          };
        } else {
          // Add to current list
          currentList.items.push(listItem);
          currentList.endPosition = { row: i, column: line.length };
        }
      } else if (trimmed === '' && currentList) {
        // Empty line might end the list
        // Check if next non-empty line continues the list
        let nextNonEmpty = i + 1;
        while (nextNonEmpty < lines.length && lines[nextNonEmpty]?.trim() === '') {
          nextNonEmpty++;
        }

        const nextLine = lines[nextNonEmpty] ?? '';
        const continuesList = nextLine.match(/^(\s*)([-*+]|\d+[.)])\s+/);

        if (!continuesList) {
          // End the list
          currentList.endPosition = { row: i - 1, column: (lines[i - 1]?.length ?? 0) };
          lists.push(currentList);
          currentList = null;
        }
      } else if (currentList && !trimmed.match(/^\s/) && trimmed !== '') {
        // Non-indented, non-list content ends the list
        currentList.endPosition = { row: i - 1, column: (lines[i - 1]?.length ?? 0) };
        lists.push(currentList);
        currentList = null;
      }
    }

    // Don't forget the last list
    if (currentList && currentList.items.length > 0) {
      currentList.endPosition = { row: lines.length - 1, column: (lines[lines.length - 1]?.length ?? 0) };
      lists.push(currentList);
    }

    return lists;
  }

  // ============================================
  // Blockquote Extraction
  // ============================================

  /**
   * Extract all blockquotes from Markdown source.
   */
  private extractBlockquotes(_source: string, lines: string[]): MarkdownBlockquoteInfo[] {
    const blockquotes: MarkdownBlockquoteInfo[] = [];
    let currentBlockquote: { content: string[]; depth: number; startLine: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Match blockquote lines: > content or >> nested
      const blockquoteMatch = line.match(/^(>+)\s?(.*)$/);

      if (blockquoteMatch) {
        const depth = blockquoteMatch[1]?.length ?? 1;
        const content = blockquoteMatch[2] ?? '';

        if (!currentBlockquote || currentBlockquote.depth !== depth) {
          // Save previous blockquote if exists
          if (currentBlockquote) {
            blockquotes.push({
              content: currentBlockquote.content.join('\n'),
              depth: currentBlockquote.depth,
              startPosition: { row: currentBlockquote.startLine, column: 0 },
              endPosition: { row: i - 1, column: (lines[i - 1]?.length ?? 0) },
            });
          }

          // Start new blockquote
          currentBlockquote = {
            content: [content],
            depth,
            startLine: i,
          };
        } else {
          // Continue current blockquote
          currentBlockquote.content.push(content);
        }
      } else if (currentBlockquote) {
        // Non-blockquote line ends the blockquote
        blockquotes.push({
          content: currentBlockquote.content.join('\n'),
          depth: currentBlockquote.depth,
          startPosition: { row: currentBlockquote.startLine, column: 0 },
          endPosition: { row: i - 1, column: (lines[i - 1]?.length ?? 0) },
        });
        currentBlockquote = null;
      }
    }

    // Don't forget the last blockquote
    if (currentBlockquote) {
      blockquotes.push({
        content: currentBlockquote.content.join('\n'),
        depth: currentBlockquote.depth,
        startPosition: { row: currentBlockquote.startLine, column: 0 },
        endPosition: { row: lines.length - 1, column: (lines[lines.length - 1]?.length ?? 0) },
      });
    }

    return blockquotes;
  }

  // ============================================
  // AST Node Creation
  // ============================================

  /**
   * Create an AST node for front matter.
   */
  private createFrontMatterNode(frontMatter: MarkdownFrontMatterInfo): ASTNode {
    return this.createNode(
      'FrontMatter',
      frontMatter.raw,
      frontMatter.startPosition,
      frontMatter.endPosition,
      []
    );
  }

  /**
   * Create an AST node for a heading.
   */
  private createHeadingNode(heading: MarkdownHeadingInfo): ASTNode {
    return this.createNode(
      `Heading${heading.level}`,
      heading.text,
      heading.startPosition,
      heading.endPosition,
      []
    );
  }

  /**
   * Create an AST node for a code block.
   */
  private createCodeBlockNode(codeBlock: MarkdownCodeBlockInfo): ASTNode {
    const nodeType = codeBlock.isInline ? 'InlineCode' : 'CodeBlock';
    const children: ASTNode[] = [];

    // Add language node if present
    if (codeBlock.language) {
      children.push(
        this.createNode(
          'Language',
          codeBlock.language,
          codeBlock.startPosition,
          codeBlock.startPosition,
          []
        )
      );
    }

    return this.createNode(
      nodeType,
      codeBlock.content,
      codeBlock.startPosition,
      codeBlock.endPosition,
      children
    );
  }

  /**
   * Create an AST node for a link.
   */
  private createLinkNode(link: MarkdownLinkInfo): ASTNode {
    const children: ASTNode[] = [
      this.createNode('LinkText', link.text, link.startPosition, link.endPosition, []),
      this.createNode('LinkUrl', link.url, link.startPosition, link.endPosition, []),
    ];

    if (link.title) {
      children.push(
        this.createNode('LinkTitle', link.title, link.startPosition, link.endPosition, [])
      );
    }

    return this.createNode(
      'Link',
      `[${link.text}](${link.url})`,
      link.startPosition,
      link.endPosition,
      children
    );
  }

  /**
   * Create an AST node for an image.
   */
  private createImageNode(image: MarkdownImageInfo): ASTNode {
    const children: ASTNode[] = [
      this.createNode('ImageAlt', image.alt, image.startPosition, image.endPosition, []),
      this.createNode('ImageUrl', image.url, image.startPosition, image.endPosition, []),
    ];

    if (image.title) {
      children.push(
        this.createNode('ImageTitle', image.title, image.startPosition, image.endPosition, [])
      );
    }

    return this.createNode(
      'Image',
      `![${image.alt}](${image.url})`,
      image.startPosition,
      image.endPosition,
      children
    );
  }

  /**
   * Create an AST node for a list.
   */
  private createListNode(list: MarkdownListInfo): ASTNode {
    const nodeType = list.type === 'ordered' ? 'OrderedList' : 'UnorderedList';
    const children: ASTNode[] = list.items.map((item) =>
      this.createNode(
        item.isTask ? 'TaskListItem' : 'ListItem',
        item.text,
        item.startPosition,
        item.endPosition,
        []
      )
    );

    return this.createNode(
      nodeType,
      list.items.map((i) => i.text).join('\n'),
      list.startPosition,
      list.endPosition,
      children
    );
  }

  /**
   * Create an AST node for a blockquote.
   */
  private createBlockquoteNode(blockquote: MarkdownBlockquoteInfo): ASTNode {
    return this.createNode(
      'Blockquote',
      blockquote.content,
      blockquote.startPosition,
      blockquote.endPosition,
      []
    );
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get the line number for a character offset.
   */
  private getLineNumber(source: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  /**
   * Get the column number for a character offset.
   */
  private getColumnNumber(source: string, offset: number): number {
    let column = 0;
    for (let i = offset - 1; i >= 0 && source[i] !== '\n'; i--) {
      column++;
    }
    return column;
  }
}
