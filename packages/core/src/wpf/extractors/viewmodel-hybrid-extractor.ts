/**
 * ViewModel Hybrid Extractor
 *
 * Extends C# hybrid extractor with WPF-specific ViewModel patterns.
 * Detects INotifyPropertyChanged, commands, and observable properties.
 */

import { ViewModelRegexExtractor } from './regex/viewmodel-regex.js';
import {
  isCSharpTreeSitterAvailable,
  createCSharpParser,
} from '../../parsers/tree-sitter/csharp-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  ViewModelAnalysis,
  ViewModelProperty,
  ViewModelCommand,
} from '../types.js';

// ============================================================================
// Configuration
// ============================================================================

export interface ViewModelExtractorConfig {
  /** Enable tree-sitter parsing */
  enableTreeSitter?: boolean;
  /** Enable regex fallback */
  enableRegexFallback?: boolean;
}

const DEFAULT_CONFIG: Required<ViewModelExtractorConfig> = {
  enableTreeSitter: true,
  enableRegexFallback: true,
};

// ============================================================================
// ViewModel Hybrid Extractor
// ============================================================================

export class ViewModelHybridExtractor {
  private config: Required<ViewModelExtractorConfig>;
  private regexExtractor: ViewModelRegexExtractor;
  private parser: TreeSitterParser | null = null;

  constructor(config?: ViewModelExtractorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.regexExtractor = new ViewModelRegexExtractor();
  }

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.cs');
  }

  /**
   * Check if file is likely a ViewModel
   */
  isLikelyViewModel(filePath: string, content: string): boolean {
    // Check filename
    if (filePath.includes('ViewModel') || filePath.includes('VM.cs')) {
      return true;
    }

    // Check content for ViewModel indicators
    const indicators = [
      /class\s+\w+ViewModel/,
      /:\s*(?:ViewModelBase|BindableBase|ObservableObject|INotifyPropertyChanged)/,
      /\[ObservableProperty\]/,
      /\[RelayCommand\]/,
      /public\s+ICommand\s+\w+/,
      /OnPropertyChanged\s*\(/,
    ];

    return indicators.some(pattern => pattern.test(content));
  }

  /**
   * Extract ViewModel information with hybrid approach
   */
  async extract(filePath: string, content: string): Promise<ViewModelAnalysis | null> {
    // Quick check if this is a ViewModel
    if (!this.isLikelyViewModel(filePath, content)) {
      return null;
    }

    // Try tree-sitter first
    if (this.config.enableTreeSitter && isCSharpTreeSitterAvailable()) {
      try {
        const treeSitterResult = this.extractWithTreeSitter(content, filePath);
        if (treeSitterResult) {
          return treeSitterResult;
        }
      } catch (error) {
        // Fall through to regex
      }
    }

    // Regex fallback
    if (this.config.enableRegexFallback) {
      return this.regexExtractor.extract(content, filePath);
    }

    return null;
  }

  /**
   * Extract using tree-sitter
   */
  private extractWithTreeSitter(content: string, filePath: string): ViewModelAnalysis | null {
    if (!this.parser) {
      this.parser = createCSharpParser();
    }

    const tree = this.parser.parse(content);
    const rootNode = tree.rootNode;

    // Find namespace
    let namespace = '';
    const namespaceNode = this.findNode(rootNode, 'namespace_declaration') ||
                          this.findNode(rootNode, 'file_scoped_namespace_declaration');
    if (namespaceNode) {
      const nameNode = namespaceNode.childForFieldName('name');
      namespace = nameNode?.text ?? '';
    }

    // Find ViewModel class
    const classNode = this.findViewModelClass(rootNode);
    if (!classNode) {
      return null;
    }

    const nameNode = classNode.childForFieldName('name');
    const className = nameNode?.text ?? '';
    const qualifiedName = namespace ? `${namespace}.${className}` : className;

    // Extract base class
    const baseClass = this.extractBaseClass(classNode);

    // Check INPC implementation
    const implementsINPC = this.checkINPCImplementation(classNode, content);

    // Extract properties
    const properties = this.extractProperties(classNode, filePath, content);

    // Extract commands
    const commands = this.extractCommands(classNode, filePath, content);

    return {
      className,
      qualifiedName,
      filePath,
      properties,
      commands,
      implementsINPC,
      baseClass,
      startLine: classNode.startPosition.row + 1,
      endLine: classNode.endPosition.row + 1,
    };
  }

  /**
   * Find ViewModel class in AST
   */
  private findViewModelClass(rootNode: TreeSitterNode): TreeSitterNode | null {
    const classes = this.findAllNodes(rootNode, 'class_declaration');

    for (const classNode of classes) {
      const nameNode = classNode.childForFieldName('name');
      const className = nameNode?.text ?? '';

      // Check if name suggests ViewModel
      if (className.includes('ViewModel') || className.endsWith('VM')) {
        return classNode;
      }

      // Check base classes
      const basesNode = classNode.childForFieldName('bases');
      if (basesNode) {
        const baseText = basesNode.text;
        if (baseText.includes('ViewModel') ||
            baseText.includes('BindableBase') ||
            baseText.includes('ObservableObject') ||
            baseText.includes('INotifyPropertyChanged')) {
          return classNode;
        }
      }
    }

    return null;
  }

  /**
   * Extract base class from class declaration
   */
  private extractBaseClass(classNode: TreeSitterNode): string | undefined {
    const basesNode = classNode.childForFieldName('bases');
    if (!basesNode) {return undefined;}

    // Find first non-interface base
    for (const child of basesNode.children) {
      if (child.type === 'identifier' || child.type === 'qualified_name' || child.type === 'generic_name') {
        const name = child.text;
        // Skip interfaces (start with I and have capital second letter)
        if (!/^I[A-Z]/.test(name)) {
          return name;
        }
      }
    }

    return undefined;
  }

  /**
   * Check if class implements INotifyPropertyChanged
   */
  private checkINPCImplementation(classNode: TreeSitterNode, _content: string): boolean {
    const basesNode = classNode.childForFieldName('bases');
    if (basesNode) {
      const baseText = basesNode.text;
      if (baseText.includes('INotifyPropertyChanged')) {
        return true;
      }

      // Known INPC base classes
      const inpcBases = [
        'ViewModelBase', 'BindableBase', 'ObservableObject',
        'BaseViewModel', 'NotifyPropertyChanged', 'ObservableRecipient',
        'Screen', 'PropertyChangedBase',
      ];
      if (inpcBases.some(b => baseText.includes(b))) {
        return true;
      }
    }

    // Check for PropertyChanged event
    const bodyNode = classNode.children.find(c => c.type === 'declaration_list');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'event_declaration' || member.type === 'event_field_declaration') {
          if (member.text.includes('PropertyChangedEventHandler')) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Extract properties from class
   */
  private extractProperties(
    classNode: TreeSitterNode,
    filePath: string,
    content: string
  ): ViewModelProperty[] {
    const properties: ViewModelProperty[] = [];
    const bodyNode = classNode.children.find(c => c.type === 'declaration_list');
    if (!bodyNode) {return properties;}

    for (const member of bodyNode.children) {
      if (member.type === 'property_declaration') {
        const property = this.extractProperty(member, filePath, content);
        if (property) {
          properties.push(property);
        }
      } else if (member.type === 'field_declaration') {
        // Check for [ObservableProperty] attribute
        const property = this.extractObservableProperty(member, filePath);
        if (property) {
          properties.push(property);
        }
      }
    }

    return properties;
  }

  /**
   * Extract a single property
   */
  private extractProperty(
    node: TreeSitterNode,
    filePath: string,
    content: string
  ): ViewModelProperty | null {
    const nameNode = node.childForFieldName('name');
    const typeNode = node.childForFieldName('type');

    if (!nameNode || !typeNode) {return null;}

    const name = nameNode.text;
    const type = typeNode.text;

    // Check for getter/setter
    let hasGetter = false;
    let hasSetter = false;
    const accessorList = node.children.find(c => c.type === 'accessor_list');
    if (accessorList) {
      for (const accessor of accessorList.children) {
        if (accessor.type === 'accessor_declaration') {
          const accessorName = accessor.children[0]?.text;
          if (accessorName === 'get') {hasGetter = true;}
          if (accessorName === 'set') {hasSetter = true;}
        }
      }
    }

    // Check if property raises PropertyChanged
    const raisesPropertyChanged = this.checkPropertyRaisesChanged(content, name);

    // Try to find backing field
    const backingField = this.findBackingField(content, name);

    return {
      name,
      type,
      hasGetter,
      hasSetter,
      raisesPropertyChanged,
      backingField,
      location: {
        file: filePath,
        line: node.startPosition.row + 1,
      },
    };
  }

  /**
   * Extract [ObservableProperty] attributed field
   */
  private extractObservableProperty(
    node: TreeSitterNode,
    filePath: string
  ): ViewModelProperty | null {
    // Check for [ObservableProperty] attribute
    let hasObservableAttr = false;
    let sibling = node.previousNamedSibling;
    while (sibling?.type === 'attribute_list') {
      if (sibling.text.includes('ObservableProperty')) {
        hasObservableAttr = true;
        break;
      }
      sibling = sibling.previousNamedSibling;
    }

    if (!hasObservableAttr) {return null;}

    // Extract field info
    const declarator = node.children.find(c => c.type === 'variable_declaration');
    if (!declarator) {return null;}

    const typeNode = declarator.childForFieldName('type');
    const varDeclarator = declarator.children.find(c => c.type === 'variable_declarator');
    const nameNode = varDeclarator?.childForFieldName('name');

    if (!typeNode || !nameNode) {return null;}

    const fieldName = nameNode.text;
    const type = typeNode.text;

    // Convert field name to property name (PascalCase)
    const propertyName = this.toPascalCase(fieldName);

    return {
      name: propertyName,
      type,
      hasGetter: true,
      hasSetter: true,
      raisesPropertyChanged: true, // Source generator handles this
      backingField: fieldName,
      isSourceGenerated: true,
      location: {
        file: filePath,
        line: node.startPosition.row + 1,
      },
    };
  }

  /**
   * Extract commands from class
   */
  private extractCommands(
    classNode: TreeSitterNode,
    filePath: string,
    content: string
  ): ViewModelCommand[] {
    const commands: ViewModelCommand[] = [];
    const bodyNode = classNode.children.find(c => c.type === 'declaration_list');
    if (!bodyNode) {return commands;}

    for (const member of bodyNode.children) {
      if (member.type === 'property_declaration') {
        const command = this.extractCommandProperty(member, filePath, content);
        if (command) {
          commands.push(command);
        }
      } else if (member.type === 'method_declaration') {
        // Check for [RelayCommand] attribute
        const command = this.extractRelayCommandMethod(member, filePath, content);
        if (command) {
          commands.push(command);
        }
      }
    }

    return commands;
  }

  /**
   * Extract ICommand property
   */
  private extractCommandProperty(
    node: TreeSitterNode,
    filePath: string,
    content: string
  ): ViewModelCommand | null {
    const typeNode = node.childForFieldName('type');
    const nameNode = node.childForFieldName('name');

    if (!typeNode || !nameNode) {return null;}

    const type = typeNode.text;
    const name = nameNode.text;

    // Check if this is a command type
    const commandTypes = ['ICommand', 'IRelayCommand', 'IAsyncRelayCommand', 'RelayCommand', 'DelegateCommand', 'AsyncRelayCommand'];
    const isCommand = commandTypes.some(ct => type.includes(ct));

    if (!isCommand) {return null;}

    // Find execute and canExecute methods
    const { executeMethod, canExecuteMethod } = this.findCommandMethods(content, name);

    return {
      name,
      commandType: type,
      executeMethod,
      canExecuteMethod,
      isAsync: type.includes('Async'),
      location: {
        file: filePath,
        line: node.startPosition.row + 1,
      },
    };
  }

  /**
   * Extract [RelayCommand] attributed method
   */
  private extractRelayCommandMethod(
    node: TreeSitterNode,
    filePath: string,
    content: string
  ): ViewModelCommand | null {
    // Check for [RelayCommand] attribute
    let hasRelayCommandAttr = false;
    let sibling = node.previousNamedSibling;
    while (sibling?.type === 'attribute_list') {
      if (sibling.text.includes('RelayCommand')) {
        hasRelayCommandAttr = true;
        break;
      }
      sibling = sibling.previousNamedSibling;
    }

    if (!hasRelayCommandAttr) {return null;}

    const nameNode = node.childForFieldName('name');
    const returnTypeNode = node.childForFieldName('type');

    if (!nameNode) {return null;}

    const methodName = nameNode.text;
    const returnType = returnTypeNode?.text ?? 'void';
    const isAsync = returnType.includes('Task') || node.text.includes('async');

    // Command name is method name + "Command"
    const commandName = `${methodName}Command`;

    // Look for CanExecute method
    const canExecuteMethod = this.findCanExecuteForMethod(content, methodName);

    return {
      name: commandName,
      commandType: isAsync ? 'AsyncRelayCommand' : 'RelayCommand',
      executeMethod: methodName,
      canExecuteMethod,
      isAsync,
      location: {
        file: filePath,
        line: node.startPosition.row + 1,
      },
    };
  }

  /**
   * Check if property raises PropertyChanged
   */
  private checkPropertyRaisesChanged(content: string, propertyName: string): boolean {
    const patterns = [
      new RegExp(`OnPropertyChanged\\s*\\(\\s*nameof\\s*\\(\\s*${propertyName}\\s*\\)`, 'i'),
      new RegExp(`RaisePropertyChanged\\s*\\(\\s*nameof\\s*\\(\\s*${propertyName}\\s*\\)`, 'i'),
      new RegExp(`OnPropertyChanged\\s*\\(\\s*["']${propertyName}["']`, 'i'),
      new RegExp(`SetProperty\\s*\\([^)]*nameof\\s*\\(\\s*${propertyName}\\s*\\)`, 'i'),
    ];

    return patterns.some(p => p.test(content));
  }

  /**
   * Find backing field for a property
   */
  private findBackingField(content: string, propertyName: string): string | undefined {
    // Common patterns: _propertyName, m_propertyName, propertyName (lowercase)
    const patterns = [
      new RegExp(`private\\s+\\w+\\s+(_${propertyName.charAt(0).toLowerCase()}${propertyName.slice(1)})\\s*[;=]`, 'i'),
      new RegExp(`private\\s+\\w+\\s+(m_${propertyName})\\s*[;=]`, 'i'),
      new RegExp(`private\\s+\\w+\\s+(${propertyName.charAt(0).toLowerCase()}${propertyName.slice(1)})\\s*[;=]`),
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Find execute and canExecute methods for a command
   */
  private findCommandMethods(
    content: string,
    commandName: string
  ): { executeMethod?: string | undefined; canExecuteMethod?: string | undefined } {
    const baseName = commandName.replace(/Command$/, '');

    // Execute method patterns
    const executePatterns = [
      new RegExp(`(?:private|public)?\\s*(?:async\\s+)?(?:Task|void)\\s+(${baseName})\\s*\\(`),
      new RegExp(`(?:private|public)?\\s*(?:async\\s+)?(?:Task|void)\\s+(Execute${baseName})\\s*\\(`),
      new RegExp(`(?:private|public)?\\s*(?:async\\s+)?(?:Task|void)\\s+(On${baseName})\\s*\\(`),
    ];

    let executeMethod: string | undefined;
    for (const pattern of executePatterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        executeMethod = match[1];
        break;
      }
    }

    // CanExecute method patterns
    const canExecutePatterns = [
      new RegExp(`(?:private|public)?\\s*bool\\s+(Can${baseName})\\s*\\(`),
      new RegExp(`(?:private|public)?\\s*bool\\s+(${baseName}CanExecute)\\s*\\(`),
    ];

    let canExecuteMethod: string | undefined;
    for (const pattern of canExecutePatterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        canExecuteMethod = match[1];
        break;
      }
    }

    return { executeMethod, canExecuteMethod };
  }

  /**
   * Find CanExecute method for a [RelayCommand] method
   */
  private findCanExecuteForMethod(content: string, methodName: string): string | undefined {
    const pattern = new RegExp(`(?:private|public)?\\s*bool\\s+(Can${methodName})\\s*\\(`);
    const match = content.match(pattern);
    return match?.[1];
  }

  /**
   * Convert to PascalCase
   */
  private toPascalCase(str: string): string {
    const clean = str.startsWith('_') ? str.slice(1) : str;
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  /**
   * Find a node of specific type
   */
  private findNode(node: TreeSitterNode, type: string): TreeSitterNode | null {
    if (node.type === type) {return node;}
    for (const child of node.children) {
      const found = this.findNode(child, type);
      if (found) {return found;}
    }
    return null;
  }

  /**
   * Find all nodes of specific type
   */
  private findAllNodes(node: TreeSitterNode, type: string): TreeSitterNode[] {
    const results: TreeSitterNode[] = [];
    if (node.type === type) {
      results.push(node);
    }
    for (const child of node.children) {
      results.push(...this.findAllNodes(child, type));
    }
    return results;
  }
}

/**
 * Factory function
 */
export function createViewModelHybridExtractor(
  config?: ViewModelExtractorConfig
): ViewModelHybridExtractor {
  return new ViewModelHybridExtractor(config);
}
