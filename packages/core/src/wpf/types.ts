/**
 * WPF Framework Support Types
 *
 * Core types for WPF XAML parsing, binding extraction, and ViewModel linking.
 * Enables full call graph analysis across XAML UI layer and C# code-behind/ViewModels.
 */

// ============================================================================
// XAML Element Types
// ============================================================================

/**
 * A parsed XAML element
 */
export interface XamlElement {
  /** Element name (e.g., "Button", "TextBox") */
  name: string;
  /** XML namespace */
  namespace: string;
  /** Element attributes */
  attributes: Map<string, string>;
  /** Data bindings on this element */
  bindings: XamlBinding[];
  /** Command bindings on this element */
  commands: XamlCommand[];
  /** Child elements */
  children: XamlElement[];
  /** Source location */
  location: SourceLocation;
  /** x:Name if specified */
  xName?: string;
}

/**
 * A data binding expression
 */
export interface XamlBinding {
  /** Target property (e.g., "Text", "ItemsSource") */
  property: string;
  /** Binding path (e.g., "UserName", "Items[0].Name") */
  path: string;
  /** Binding mode */
  mode: BindingMode;
  /** Value converter resource key */
  converter?: string | undefined;
  /** Converter parameter */
  converterParameter?: string | undefined;
  /** Binding source type */
  sourceType?: BindingSourceType | undefined;
  /** Source value (StaticResource key, ElementName, etc.) */
  sourceValue?: string | undefined;
  /** Fallback value */
  fallbackValue?: string | undefined;
  /** Target null value */
  targetNullValue?: string | undefined;
  /** Update source trigger */
  updateSourceTrigger?: UpdateSourceTrigger | undefined;
  /** Raw binding expression */
  raw: string;
  /** Source location */
  location: SourceLocation;
}

export type BindingMode = 'OneWay' | 'TwoWay' | 'OneTime' | 'OneWayToSource' | 'Default';
export type BindingSourceType = 'DataContext' | 'StaticResource' | 'DynamicResource' | 'RelativeSource' | 'ElementName' | 'Self';
export type UpdateSourceTrigger = 'PropertyChanged' | 'LostFocus' | 'Explicit' | 'Default';

/**
 * A command binding
 */
export interface XamlCommand {
  /** Target property (usually "Command") */
  property: string;
  /** Command binding path */
  binding: string;
  /** Command parameter binding */
  commandParameter?: string;
  /** Raw expression */
  raw: string;
  /** Source location */
  location: SourceLocation;
}

/**
 * A parsed XAML file
 */
export interface XamlFile {
  /** File path */
  path: string;
  /** Root element */
  rootElement: XamlElement | null;
  /** x:Class attribute - links to code-behind */
  xClass: string | null;
  /** DataContext type (from d:DataContext or explicit binding) */
  dataContextType: string | null;
  /** Resources defined in this file */
  resources: XamlResource[];
  /** XML namespace declarations */
  namespaces: Map<string, string>;
  /** All bindings in the file (flattened) */
  allBindings: XamlBinding[];
  /** All commands in the file (flattened) */
  allCommands: XamlCommand[];
  /** Parse errors */
  errors: string[];
}

/**
 * A XAML resource
 */
export interface XamlResource {
  /** Resource key */
  key: string;
  /** Resource type */
  type: XamlResourceType;
  /** Target type for styles/templates */
  targetType?: string | undefined;
  /** C# class for converters */
  converterType?: string | undefined;
  /** Source location */
  location: SourceLocation;
}

export type XamlResourceType = 'Style' | 'DataTemplate' | 'ControlTemplate' | 'Converter' | 'Brush' | 'Other';

// ============================================================================
// ViewModel Types
// ============================================================================

/**
 * Analysis result for a ViewModel class
 */
export interface ViewModelAnalysis {
  /** Class name */
  className: string;
  /** Full qualified name */
  qualifiedName: string;
  /** File path */
  filePath: string;
  /** Properties */
  properties: ViewModelProperty[];
  /** Commands */
  commands: ViewModelCommand[];
  /** Implements INotifyPropertyChanged */
  implementsINPC: boolean;
  /** Base class */
  baseClass?: string | undefined;
  /** Class start line */
  startLine: number;
  /** Class end line */
  endLine: number;
}

/**
 * A ViewModel property
 */
export interface ViewModelProperty {
  /** Property name */
  name: string;
  /** Property type */
  type: string;
  /** Has getter */
  hasGetter: boolean;
  /** Has setter */
  hasSetter: boolean;
  /** Raises PropertyChanged notification */
  raisesPropertyChanged: boolean;
  /** Backing field name */
  backingField?: string | undefined;
  /** Is source-generated (MVVM Toolkit) */
  isSourceGenerated?: boolean | undefined;
  /** Source location */
  location: SourceLocation;
}

/**
 * A ViewModel command
 */
export interface ViewModelCommand {
  /** Command property name */
  name: string;
  /** Command type (RelayCommand, DelegateCommand, etc.) */
  commandType: string;
  /** Execute method name */
  executeMethod?: string | undefined;
  /** CanExecute method name */
  canExecuteMethod?: string | undefined;
  /** Is async command */
  isAsync?: boolean | undefined;
  /** Source location */
  location: SourceLocation;
}

// ============================================================================
// Dependency Property Types
// ============================================================================

/**
 * A dependency property definition
 */
export interface DependencyPropertyInfo {
  /** Property name */
  name: string;
  /** Static field name (e.g., "MyPropertyProperty") */
  fieldName: string;
  /** Property type */
  propertyType: string;
  /** Owner type */
  ownerType?: string;
  /** Is attached property */
  isAttached: boolean;
  /** Default value */
  defaultValue?: string;
  /** Callbacks */
  callbacks: DependencyPropertyCallback[];
  /** Source location */
  location: SourceLocation;
}

export interface DependencyPropertyCallback {
  type: 'PropertyChanged' | 'CoerceValue' | 'Validate';
  methodName: string;
}

// ============================================================================
// Linking Types
// ============================================================================

/**
 * Link between XAML binding and ViewModel property
 */
export interface ViewModelLink {
  /** XAML file path */
  xamlFile: string;
  /** XAML element name/type */
  xamlElement: string;
  /** Binding path */
  bindingPath: string;
  /** ViewModel class name */
  viewModelClass: string;
  /** ViewModel property name */
  viewModelProperty: string;
  /** Property type */
  propertyType: string;
  /** Whether property notifies changes */
  notifiesChange: boolean;
  /** Locations */
  locations: {
    xaml: SourceLocation;
    csharp: SourceLocation;
  };
  /** Link confidence */
  confidence: number;
}

/**
 * Link between XAML and code-behind
 */
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

/**
 * DataContext resolution result
 */
export interface DataContextResolution {
  /** XAML file */
  xamlFile: string;
  /** Element path */
  element: string;
  /** Resolved type */
  resolvedType: string | null;
  /** Resolution path */
  resolutionPath: DataContextStep[];
  /** Resolution confidence */
  confidence: 'high' | 'medium' | 'low';
}

export interface DataContextStep {
  /** How DataContext was determined */
  source: 'explicit' | 'inherited' | 'design-time' | 'code-behind';
  /** Element where DataContext is set */
  element?: string | undefined;
  /** DataContext type */
  type: string;
  /** Location */
  location?: SourceLocation | undefined;
}

// ============================================================================
// Call Graph Integration Types
// ============================================================================

export type WpfNodeType =
  | 'xaml-element'
  | 'xaml-binding'
  | 'xaml-command'
  | 'viewmodel-property'
  | 'viewmodel-command'
  | 'dependency-property'
  | 'value-converter'
  | 'code-behind-handler';

export interface WpfCallGraphNode {
  /** Unique ID */
  id: string;
  /** Node type */
  type: WpfNodeType;
  /** Display name */
  name: string;
  /** Source file */
  file: string;
  /** Line number */
  line: number;
  /** Additional metadata */
  metadata: WpfNodeMetadata;
}

export interface WpfNodeMetadata {
  /** For xaml-binding */
  bindingPath?: string;
  bindingMode?: string;
  /** For viewmodel-property */
  propertyType?: string;
  notifiesChange?: boolean;
  /** For viewmodel-command */
  executeMethod?: string;
  canExecuteMethod?: string;
  /** For dependency-property */
  ownerType?: string;
  defaultValue?: string;
  callbacks?: string[];
}

export type WpfEdgeType =
  | 'binds-to'           // XAML binding → ViewModel property
  | 'invokes-command'    // XAML command → ViewModel ICommand
  | 'converts-with'      // Binding → ValueConverter
  | 'handles-event'      // XAML event → Code-behind handler
  | 'inherits-context'   // Child element → Parent DataContext
  | 'accesses-data';     // ViewModel → Entity Framework

export interface WpfCallGraphEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Edge type */
  type: WpfEdgeType;
  /** Confidence score (0-1) */
  confidence: number;
}

// ============================================================================
// Pattern Detection Types
// ============================================================================

export interface MvvmComplianceResult {
  /** Compliance score (0-100) */
  score: number;
  /** Violations found */
  violations: MvvmViolation[];
  /** Recommendations */
  recommendations: string[];
}

export interface MvvmViolation {
  /** Violation type */
  type: MvvmViolationType;
  /** Severity */
  severity: 'error' | 'warning' | 'info';
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Description */
  message: string;
  /** Suggested fix */
  suggestion?: string;
}

export type MvvmViolationType =
  | 'logic-in-code-behind'
  | 'direct-ui-manipulation'
  | 'missing-inpc'
  | 'tight-coupling'
  | 'missing-command'
  | 'event-handler-with-logic'
  | 'property-without-notification';

export interface BindingError {
  /** Error type */
  type: BindingErrorType;
  /** XAML file */
  xamlFile: string;
  /** Line number */
  line: number;
  /** Binding path */
  bindingPath: string;
  /** Error message */
  message: string;
  /** Suggested fix */
  suggestion?: string | undefined;
}

export type BindingErrorType =
  | 'missing-property'
  | 'wrong-type'
  | 'missing-converter'
  | 'invalid-path'
  | 'missing-datacontext'
  | 'readonly-twoway';

// ============================================================================
// Project Detection Types
// ============================================================================

export interface WpfProjectInfo {
  /** Is this a WPF project */
  isWpfProject: boolean;
  /** Project file path */
  projectFile: string;
  /** Target framework */
  targetFramework: string;
  /** XAML files */
  xamlFiles: string[];
  /** ViewModel files */
  viewModels: string[];
  /** Value converter files */
  converters: string[];
  /** Resource dictionary files */
  resourceDictionaries: string[];
  /** App.xaml path */
  appXaml: string | null;
}

// ============================================================================
// Extraction Result Types
// ============================================================================

export interface XamlExtractionResult {
  /** x:Class value */
  xClass: string | null;
  /** DataContext type */
  dataContextType: string | null;
  /** Extracted bindings */
  bindings: ExtractedBinding[];
  /** Extracted commands */
  commands: ExtractedCommand[];
  /** Extracted resources */
  resources: XamlResource[];
  /** Extraction confidence (0-1) */
  confidence: number;
  /** Extraction method */
  method: 'ast' | 'regex' | 'hybrid';
  /** Parse errors */
  errors: string[];
}

export interface ExtractedBinding {
  /** Element name/type */
  elementName: string;
  /** Element type */
  elementType: string;
  /** Target property */
  property: string;
  /** Raw binding expression */
  bindingExpression: string;
  /** Parsed binding */
  parsed: XamlBinding;
  /** Source location */
  location: SourceLocation;
}

export interface ExtractedCommand {
  /** Element name/type */
  elementName: string;
  /** Command binding path */
  binding: string;
  /** Command parameter */
  parameter?: string | undefined;
  /** Raw expression */
  raw: string;
  /** Source location */
  location: SourceLocation;
}

// ============================================================================
// Common Types
// ============================================================================

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

/**
 * Extraction quality metrics
 */
export interface WpfExtractionQuality {
  /** Confidence score (0-1) */
  confidence: number;
  /** Extraction method used */
  method: 'ast' | 'regex' | 'hybrid';
  /** Items extracted */
  itemsExtracted: number;
  /** Parse errors */
  parseErrors: number;
  /** Warnings */
  warnings: string[];
  /** Used fallback */
  usedFallback: boolean;
  /** Extraction time in ms */
  extractionTimeMs: number;
}
