/**
 * Code-Behind Linker
 *
 * Links XAML x:Class to .xaml.cs files.
 * Extracts event handlers and named element usages.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { SourceLocation } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface CodeBehindLink {
  /** XAML file path */
  xamlFile: string;
  /** Code-behind file path */
  codeBehindFile: string;
  /** Class name */
  className: string;
  /** Namespace */
  namespace: string;
  /** Event handlers */
  eventHandlers: EventHandlerLink[];
  /** Named elements */
  namedElements: NamedElementLink[];
}

export interface EventHandlerLink {
  /** XAML element */
  xamlElement: string;
  /** Event name (e.g., "Click", "Loaded") */
  eventName: string;
  /** Handler method name */
  handlerName: string;
  /** Handler location in code-behind */
  handlerLocation: SourceLocation;
}

export interface NamedElementLink {
  /** x:Name value */
  xamlName: string;
  /** Element type */
  elementType: string;
  /** Usages in code-behind */
  codeBehindUsages: SourceLocation[];
}

// ============================================================================
// Regex Patterns
// ============================================================================

const CODE_BEHIND_PATTERNS = {
  // Event handler method signature
  eventHandler: /(?:private|protected|public)?\s*(?:async\s+)?void\s+(\w+_\w+)\s*\(\s*object\s+\w+\s*,\s*(\w+EventArgs|RoutedEventArgs|EventArgs)\s+\w+\s*\)/g,

  // x:Name usage in code-behind
  namedElementUsage: /\b(this\.)?(\w+)\.([\w.]+)/g,

  // Class declaration with namespace
  classDeclaration: /namespace\s+([\w.]+)\s*\{[\s\S]*?(?:public\s+)?partial\s+class\s+(\w+)/,

  // InitializeComponent call
  initializeComponent: /InitializeComponent\s*\(\s*\)/,
};

const XAML_EVENT_PATTERNS = {
  // Event handler in XAML: Click="Button_Click"
  eventHandler: /(\w+)\s*=\s*["']([A-Z]\w*_\w+)["']/g,

  // x:Name declaration
  xName: /x:Name\s*=\s*["'](\w+)["']/g,

  // Element with x:Name
  namedElement: /<(\w+)[^>]*x:Name\s*=\s*["'](\w+)["'][^>]*>/g,
};

// ============================================================================
// Code-Behind Linker
// ============================================================================

export class CodeBehindLinker {
  /**
   * Link XAML to its code-behind file
   */
  async link(
    xamlPath: string,
    xamlContent: string,
    rootDir: string
  ): Promise<CodeBehindLink | null> {
    // Find code-behind file
    const codeBehindPath = xamlPath + '.cs';
    const fullCodeBehindPath = path.join(rootDir, codeBehindPath);

    let codeBehindContent: string;
    try {
      codeBehindContent = await fs.readFile(fullCodeBehindPath, 'utf-8');
    } catch {
      return null; // No code-behind file
    }

    // Extract class info
    const classMatch = codeBehindContent.match(CODE_BEHIND_PATTERNS.classDeclaration);
    if (!classMatch) {return null;}

    const namespace = classMatch[1] ?? '';
    const className = classMatch[2] ?? '';

    // Extract event handlers
    const eventHandlers = this.extractEventHandlers(xamlContent, codeBehindContent, codeBehindPath);

    // Extract named elements
    const namedElements = this.extractNamedElements(xamlContent, codeBehindContent, codeBehindPath);

    return {
      xamlFile: xamlPath,
      codeBehindFile: codeBehindPath,
      className,
      namespace,
      eventHandlers,
      namedElements,
    };
  }

  /**
   * Extract event handlers from XAML and find them in code-behind
   */
  private extractEventHandlers(
    xamlContent: string,
    codeBehindContent: string,
    codeBehindPath: string
  ): EventHandlerLink[] {
    const handlers: EventHandlerLink[] = [];
    const xamlHandlers = new Map<string, string>(); // handlerName -> eventName

    // Find event handlers in XAML
    let match;
    while ((match = XAML_EVENT_PATTERNS.eventHandler.exec(xamlContent)) !== null) {
      const eventName = match[1] ?? '';
      const handlerName = match[2] ?? '';
      
      // Skip if it's a binding or not an event
      if (handlerName.includes('{') || !this.isEventName(eventName)) {continue;}
      
      xamlHandlers.set(handlerName, eventName);
    }

    // Find handler implementations in code-behind
    CODE_BEHIND_PATTERNS.eventHandler.lastIndex = 0;
    while ((match = CODE_BEHIND_PATTERNS.eventHandler.exec(codeBehindContent)) !== null) {
      const handlerName = match[1] ?? '';
      const eventName = xamlHandlers.get(handlerName);

      if (eventName) {
        const line = this.getLineNumber(codeBehindContent, match.index);
        handlers.push({
          xamlElement: this.extractElementFromHandlerName(handlerName),
          eventName,
          handlerName,
          handlerLocation: { file: codeBehindPath, line },
        });
      }
    }

    return handlers;
  }

  /**
   * Extract named elements and find their usages in code-behind
   */
  private extractNamedElements(
    xamlContent: string,
    codeBehindContent: string,
    codeBehindPath: string
  ): NamedElementLink[] {
    const elements: NamedElementLink[] = [];
    const namedElements = new Map<string, string>(); // name -> elementType

    // Find x:Name declarations in XAML
    let match;
    while ((match = XAML_EVENT_PATTERNS.namedElement.exec(xamlContent)) !== null) {
      const elementType = match[1] ?? '';
      const name = match[2] ?? '';
      namedElements.set(name, elementType);
    }

    // Find usages in code-behind
    for (const [name, elementType] of namedElements) {
      const usages: SourceLocation[] = [];
      const usagePattern = new RegExp(`\\b${name}\\b`, 'g');

      while ((match = usagePattern.exec(codeBehindContent)) !== null) {
        // Skip the field declaration itself
        const context = codeBehindContent.slice(Math.max(0, match.index - 50), match.index);
        if (context.includes('private') || context.includes('internal')) {continue;}

        usages.push({
          file: codeBehindPath,
          line: this.getLineNumber(codeBehindContent, match.index),
        });
      }

      if (usages.length > 0) {
        elements.push({
          xamlName: name,
          elementType,
          codeBehindUsages: usages,
        });
      }
    }

    return elements;
  }

  /**
   * Check if a name is likely an event name
   */
  private isEventName(name: string): boolean {
    const eventNames = [
      'Click', 'DoubleClick', 'MouseDown', 'MouseUp', 'MouseMove', 'MouseEnter', 'MouseLeave',
      'KeyDown', 'KeyUp', 'KeyPress', 'PreviewKeyDown', 'PreviewKeyUp',
      'Loaded', 'Unloaded', 'Initialized', 'Closing', 'Closed',
      'TextChanged', 'SelectionChanged', 'ValueChanged', 'CheckedChanged',
      'GotFocus', 'LostFocus', 'PreviewGotKeyboardFocus', 'PreviewLostKeyboardFocus',
      'DragEnter', 'DragLeave', 'DragOver', 'Drop',
      'SizeChanged', 'LayoutUpdated', 'Scroll',
    ];
    return eventNames.includes(name) || name.endsWith('Changed') || name.startsWith('Preview');
  }

  /**
   * Extract element name from handler name (e.g., "Button_Click" -> "Button")
   */
  private extractElementFromHandlerName(handlerName: string): string {
    const parts = handlerName.split('_');
    return parts[0] ?? handlerName;
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split('\n').length;
  }
}

/**
 * Factory function
 */
export function createCodeBehindLinker(): CodeBehindLinker {
  return new CodeBehindLinker();
}
