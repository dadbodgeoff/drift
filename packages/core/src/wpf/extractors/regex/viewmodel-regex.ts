/**
 * ViewModel Regex Extractor
 *
 * Regex-based fallback extractor for C# ViewModel classes.
 * Detects INotifyPropertyChanged, commands, and observable properties.
 */

import type {
  ViewModelAnalysis,
  ViewModelProperty,
  ViewModelCommand,
} from '../../types.js';

// ============================================================================
// Regex Patterns
// ============================================================================

export const VIEWMODEL_REGEX_PATTERNS = {
  // INotifyPropertyChanged implementation
  inpcImplementation: /:\s*(?:[\w.]+,\s*)*INotifyPropertyChanged/,

  // ViewModelBase / BindableBase inheritance
  viewModelBase: /class\s+(\w+)\s*:\s*(?:ViewModelBase|BindableBase|ObservableObject|BaseViewModel|NotifyPropertyChanged)/,

  // Property with backing field pattern
  propertyWithBacking: /private\s+(\w+(?:<[^>]+>)?)\s+_(\w+);\s*(?:[\s\S]*?)public\s+\1\s+(\w+)\s*\{/g,

  // Auto-property
  autoProperty: /public\s+(\w+(?:<[^>]+>)?(?:\?)?)\s+(\w+)\s*\{\s*get;\s*(?:private\s+)?set;\s*\}/g,

  // OnPropertyChanged/RaisePropertyChanged calls
  propertyChanged: /(?:OnPropertyChanged|RaisePropertyChanged|NotifyPropertyChanged|NotifyOfPropertyChange)\s*\(\s*(?:nameof\s*\(\s*(\w+)\s*\)|["'](\w+)["'])/g,

  // SetProperty pattern (MVVM Toolkit style)
  setProperty: /SetProperty\s*\(\s*ref\s+_?(\w+)\s*,\s*value\s*(?:,\s*nameof\s*\(\s*(\w+)\s*\))?\)/g,

  // Set pattern (Prism style)
  setMethod: /Set\s*\(\s*ref\s+_?(\w+)\s*,\s*value\s*(?:,\s*\(\)\s*=>\s*(\w+))?\)/g,

  // ICommand property declarations
  commandProperty: /public\s+(?:ICommand|IRelayCommand|IAsyncRelayCommand|RelayCommand|DelegateCommand|AsyncRelayCommand|AsyncCommand)(?:<[^>]+>)?\s+(\w+)\s*\{/g,

  // RelayCommand instantiation
  relayCommandInit: /(\w+)\s*=\s*new\s+(?:Relay|Delegate|Async)?Command(?:<[^>]+>)?\s*\(\s*(\w+)(?:\s*,\s*(\w+))?\s*\)/g,

  // Command with lambda
  commandLambda: /(\w+)\s*=\s*new\s+(?:Relay|Delegate|Async)?Command(?:<[^>]+>)?\s*\(\s*(?:async\s*)?\(\s*\)\s*=>/g,

  // ObservableCollection declarations
  observableCollection: /(?:public|private)\s+ObservableCollection<(\w+)>\s+(\w+)/g,

  // [ObservableProperty] attribute (MVVM Toolkit source generators)
  observablePropertyAttr: /\[ObservableProperty\]\s*(?:\[[\w\(\)]+\]\s*)*private\s+(\w+(?:<[^>]+>)?(?:\?)?)\s+_?(\w+)/g,

  // [RelayCommand] attribute
  relayCommandAttr: /\[RelayCommand(?:\([^\)]*\))?\]\s*(?:private|public)?\s*(?:async\s+)?(?:Task|void)\s+(\w+)\s*\(/g,

  // Class declaration
  classDeclaration: /(?:public|internal|private)?\s*(?:partial\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*([^{]+))?\s*\{/g,

  // Namespace declaration
  namespaceDeclaration: /namespace\s+([\w.]+)/,

  // Property getter/setter
  propertyAccessors: /\{\s*(get\s*(?:\{[^}]*\}|;))?\s*(set\s*(?:\{[^}]*\}|;))?\s*\}/,

  // PropertyChanged event declaration
  propertyChangedEvent: /public\s+event\s+PropertyChangedEventHandler\s+PropertyChanged/,

  // CanExecute method pattern
  canExecuteMethod: /(?:private|public)?\s*bool\s+Can(\w+)\s*\(/g,
};

// ============================================================================
// ViewModel Regex Extractor
// ============================================================================

export class ViewModelRegexExtractor {
  /**
   * Extract ViewModel information using regex patterns
   */
  extract(content: string, filePath: string): ViewModelAnalysis | null {
    // Find class declaration
    const classMatch = this.findViewModelClass(content);
    if (!classMatch) {
      return null;
    }

    const { className, baseClass, startLine, endLine } = classMatch;

    // Extract namespace
    const namespaceMatch = content.match(VIEWMODEL_REGEX_PATTERNS.namespaceDeclaration);
    const namespace = namespaceMatch?.[1] ?? '';
    const qualifiedName = namespace ? `${namespace}.${className}` : className;

    // Check for INPC implementation
    const implementsINPC = this.checkINPCImplementation(content, baseClass);

    // Extract properties
    const properties = this.extractProperties(content, filePath);

    // Extract commands
    const commands = this.extractCommands(content, filePath);

    return {
      className,
      qualifiedName,
      filePath,
      properties,
      commands,
      implementsINPC,
      baseClass,
      startLine,
      endLine,
    };
  }

  /**
   * Find ViewModel class in content
   */
  private findViewModelClass(content: string): {
    className: string;
    baseClass?: string | undefined;
    startLine: number;
    endLine: number;
  } | null {
    VIEWMODEL_REGEX_PATTERNS.classDeclaration.lastIndex = 0;

    let match;
    while ((match = VIEWMODEL_REGEX_PATTERNS.classDeclaration.exec(content)) !== null) {
      const className = match[1] ?? '';
      const inheritance = match[2] ?? '';

      // Check if this looks like a ViewModel
      const isViewModel = 
        className.endsWith('ViewModel') ||
        className.endsWith('VM') ||
        inheritance.includes('ViewModel') ||
        inheritance.includes('BindableBase') ||
        inheritance.includes('ObservableObject') ||
        inheritance.includes('INotifyPropertyChanged');

      if (isViewModel) {
        const startLine = this.getLineNumber(content, match.index);
        const endLine = this.findClassEndLine(content, match.index);
        const baseClass = this.extractBaseClass(inheritance);

        return { className, baseClass, startLine, endLine };
      }
    }

    return null;
  }

  /**
   * Extract base class from inheritance string
   */
  private extractBaseClass(inheritance: string): string | undefined {
    if (!inheritance) {return undefined;}

    // Split by comma and get first non-interface
    const parts = inheritance.split(',').map(p => p.trim());
    for (const part of parts) {
      // Skip interfaces (start with I and have capital second letter)
      if (!/^I[A-Z]/.test(part)) {
        return part.replace(/<[^>]+>/, '').trim();
      }
    }

    return undefined;
  }

  /**
   * Check if class implements INotifyPropertyChanged
   */
  private checkINPCImplementation(content: string, baseClass?: string): boolean {
    // Direct implementation
    if (VIEWMODEL_REGEX_PATTERNS.inpcImplementation.test(content)) {
      return true;
    }

    // Through base class
    if (baseClass) {
      const knownINPCBases = [
        'ViewModelBase',
        'BindableBase',
        'ObservableObject',
        'BaseViewModel',
        'NotifyPropertyChanged',
        'ObservableRecipient',
        'Screen', // Caliburn.Micro
        'PropertyChangedBase', // Caliburn.Micro
      ];
      if (knownINPCBases.some(b => baseClass.includes(b))) {
        return true;
      }
    }

    // Has PropertyChanged event
    if (VIEWMODEL_REGEX_PATTERNS.propertyChangedEvent.test(content)) {
      return true;
    }

    return false;
  }

  /**
   * Extract properties from ViewModel
   */
  private extractProperties(content: string, filePath: string): ViewModelProperty[] {
    const properties: ViewModelProperty[] = [];
    const seen = new Set<string>();

    // Extract properties with backing fields
    VIEWMODEL_REGEX_PATTERNS.propertyWithBacking.lastIndex = 0;
    let match;

    while ((match = VIEWMODEL_REGEX_PATTERNS.propertyWithBacking.exec(content)) !== null) {
      const type = match[1] ?? '';
      const backingField = `_${match[2]}`;
      const name = match[3] ?? '';

      if (seen.has(name)) {continue;}
      seen.add(name);

      const line = this.getLineNumber(content, match.index);
      const raisesPropertyChanged = this.checkPropertyRaisesChanged(content, name);

      properties.push({
        name,
        type,
        hasGetter: true,
        hasSetter: true,
        raisesPropertyChanged,
        backingField,
        location: { file: filePath, line },
      });
    }

    // Extract auto-properties
    VIEWMODEL_REGEX_PATTERNS.autoProperty.lastIndex = 0;

    while ((match = VIEWMODEL_REGEX_PATTERNS.autoProperty.exec(content)) !== null) {
      const type = match[1] ?? '';
      const name = match[2] ?? '';

      if (seen.has(name)) {continue;}
      seen.add(name);

      const line = this.getLineNumber(content, match.index);

      properties.push({
        name,
        type,
        hasGetter: true,
        hasSetter: true,
        raisesPropertyChanged: false, // Auto-properties don't raise by default
        location: { file: filePath, line },
      });
    }

    // Extract MVVM Toolkit source-generated properties
    VIEWMODEL_REGEX_PATTERNS.observablePropertyAttr.lastIndex = 0;

    while ((match = VIEWMODEL_REGEX_PATTERNS.observablePropertyAttr.exec(content)) !== null) {
      const type = match[1] ?? '';
      const fieldName = match[2] ?? '';
      const name = this.toPascalCase(fieldName);

      if (seen.has(name)) {continue;}
      seen.add(name);

      const line = this.getLineNumber(content, match.index);

      properties.push({
        name,
        type,
        hasGetter: true,
        hasSetter: true,
        raisesPropertyChanged: true, // Source generator handles this
        backingField: fieldName.startsWith('_') ? fieldName : `_${fieldName}`,
        isSourceGenerated: true,
        location: { file: filePath, line },
      });
    }

    return properties;
  }

  /**
   * Check if a property raises PropertyChanged
   */
  private checkPropertyRaisesChanged(content: string, propertyName: string): boolean {
    // Check for OnPropertyChanged(nameof(PropertyName))
    const namedPattern = new RegExp(
      `(?:OnPropertyChanged|RaisePropertyChanged|NotifyPropertyChanged)\\s*\\(\\s*nameof\\s*\\(\\s*${propertyName}\\s*\\)`,
      'i'
    );
    if (namedPattern.test(content)) {
      return true;
    }

    // Check for OnPropertyChanged("PropertyName")
    const stringPattern = new RegExp(
      `(?:OnPropertyChanged|RaisePropertyChanged|NotifyPropertyChanged)\\s*\\(\\s*["']${propertyName}["']`,
      'i'
    );
    if (stringPattern.test(content)) {
      return true;
    }

    // Check for SetProperty pattern
    const setPropertyPattern = new RegExp(
      `SetProperty\\s*\\([^)]*nameof\\s*\\(\\s*${propertyName}\\s*\\)`,
      'i'
    );
    if (setPropertyPattern.test(content)) {
      return true;
    }

    return false;
  }

  /**
   * Extract commands from ViewModel
   */
  private extractCommands(content: string, filePath: string): ViewModelCommand[] {
    const commands: ViewModelCommand[] = [];
    const seen = new Set<string>();

    // Extract ICommand properties
    VIEWMODEL_REGEX_PATTERNS.commandProperty.lastIndex = 0;
    let match;

    while ((match = VIEWMODEL_REGEX_PATTERNS.commandProperty.exec(content)) !== null) {
      const name = match[1] ?? '';

      if (seen.has(name)) {continue;}
      seen.add(name);

      const line = this.getLineNumber(content, match.index);
      const commandType = this.inferCommandType(content, name);
      const { executeMethod, canExecuteMethod } = this.findCommandMethods(content, name);

      commands.push({
        name,
        commandType,
        executeMethod,
        canExecuteMethod,
        isAsync: commandType.includes('Async'),
        location: { file: filePath, line },
      });
    }

    // Extract commands from RelayCommand instantiation
    VIEWMODEL_REGEX_PATTERNS.relayCommandInit.lastIndex = 0;

    while ((match = VIEWMODEL_REGEX_PATTERNS.relayCommandInit.exec(content)) !== null) {
      const name = match[1] ?? '';
      const executeMethod = match[2];
      const canExecuteMethod = match[3];

      if (seen.has(name)) {continue;}
      seen.add(name);

      const line = this.getLineNumber(content, match.index);

      commands.push({
        name,
        commandType: 'RelayCommand',
        executeMethod,
        canExecuteMethod,
        location: { file: filePath, line },
      });
    }

    // Extract MVVM Toolkit [RelayCommand] attributed methods
    VIEWMODEL_REGEX_PATTERNS.relayCommandAttr.lastIndex = 0;

    while ((match = VIEWMODEL_REGEX_PATTERNS.relayCommandAttr.exec(content)) !== null) {
      const methodName = match[1] ?? '';
      const commandName = `${methodName}Command`;

      if (seen.has(commandName)) {continue;}
      seen.add(commandName);

      const line = this.getLineNumber(content, match.index);
      const isAsync = match[0].includes('async') || match[0].includes('Task');

      // Look for CanExecute method
      const canExecuteMethod = this.findCanExecuteForMethod(content, methodName);

      commands.push({
        name: commandName,
        commandType: isAsync ? 'AsyncRelayCommand' : 'RelayCommand',
        executeMethod: methodName,
        canExecuteMethod,
        isAsync,
        isSourceGenerated: true,
        location: { file: filePath, line },
      } as ViewModelCommand);
    }

    return commands;
  }

  /**
   * Infer command type from content
   */
  private inferCommandType(content: string, commandName: string): string {
    // Look for initialization
    const initPattern = new RegExp(`${commandName}\\s*=\\s*new\\s+(\\w+Command)`, 'i');
    const match = content.match(initPattern);
    if (match?.[1]) {
      return match[1];
    }

    // Look for property type
    const typePattern = new RegExp(`(\\w+Command(?:<[^>]+>)?)\\s+${commandName}\\s*\\{`, 'i');
    const typeMatch = content.match(typePattern);
    if (typeMatch?.[1]) {
      return typeMatch[1];
    }

    return 'ICommand';
  }

  /**
   * Find execute and canExecute methods for a command
   */
  private findCommandMethods(
    content: string,
    commandName: string
  ): { executeMethod?: string | undefined; canExecuteMethod?: string | undefined } {
    // Common naming conventions
    const baseName = commandName.replace(/Command$/, '');

    // Look for execute method
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

    // Look for canExecute method
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
   * Find CanExecute method for a [RelayCommand] attributed method
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
    // Remove leading underscore
    const clean = str.startsWith('_') ? str.slice(1) : str;
    // Capitalize first letter
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    const lines = content.slice(0, index).split('\n');
    return lines.length;
  }

  /**
   * Find class end line
   */
  private findClassEndLine(content: string, startIndex: number): number {
    let depth = 0;
    let inClass = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      if (char === '{') {
        depth++;
        inClass = true;
      } else if (char === '}') {
        depth--;
        if (inClass && depth === 0) {
          return this.getLineNumber(content, i);
        }
      }
    }

    return this.getLineNumber(content, content.length);
  }
}
