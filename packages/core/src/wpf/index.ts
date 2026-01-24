/**
 * WPF Framework Support
 *
 * Comprehensive support for Windows Presentation Foundation (WPF) desktop applications.
 * Enables full call graph analysis, data flow mapping, and pattern detection across
 * the XAML UI layer and C# code-behind/ViewModels.
 *
 * @module wpf
 */

// Types
export * from './types.js';

// Extractors
export {
  XamlHybridExtractor,
  createXamlHybridExtractor,
  type XamlExtractorConfig,
} from './extractors/xaml-hybrid-extractor.js';

export {
  ViewModelHybridExtractor,
  createViewModelHybridExtractor,
  type ViewModelExtractorConfig,
} from './extractors/viewmodel-hybrid-extractor.js';

export {
  CodeBehindLinker,
  createCodeBehindLinker,
  type CodeBehindLink,
  type EventHandlerLink,
  type NamedElementLink,
} from './extractors/code-behind-linker.js';

export {
  ResourceDictionaryParser,
  createResourceDictionaryParser,
  type ResourceDictionary,
  type ResourceResolution,
  type ValueConverterInfo as ResourceConverterInfo,
  type ConverterUsage as ResourceConverterUsage,
} from './extractors/resource-dictionary-parser.js';

export {
  DependencyPropertyExtractor,
  createDependencyPropertyExtractor,
  DEPENDENCY_PROPERTY_PATTERNS,
  type DependencyPropertyExtractionResult,
} from './extractors/dependency-property-extractor.js';

export {
  ValueConverterExtractor,
  createValueConverterExtractor,
  VALUE_CONVERTER_PATTERNS,
  type ValueConverterInfo,
  type ConverterUsage,
  type ConverterMethodInfo,
  type ValueConverterExtractionResult,
} from './extractors/value-converter-extractor.js';

export {
  BindingErrorDetector,
  createBindingErrorDetector,
  type BindingValidationResult,
  type BindingWarning,
  type BindingWarningType,
  type BindingValidationStats,
} from './extractors/binding-error-detector.js';

// Regex extractors (for direct use or testing)
export {
  XamlRegexExtractor,
  XAML_REGEX_PATTERNS,
} from './extractors/regex/xaml-regex.js';

export {
  ViewModelRegexExtractor,
  VIEWMODEL_REGEX_PATTERNS,
} from './extractors/regex/viewmodel-regex.js';

// Linkers
export {
  DataContextResolver,
  createDataContextResolver,
} from './linkers/datacontext-resolver.js';

export {
  ViewModelLinker,
  createViewModelLinker,
  type LinkingResult,
  type UnresolvedBinding,
  type LinkingStats,
} from './linkers/viewmodel-linker.js';

// Integration
export {
  WpfCallGraphAdapter,
  createWpfCallGraphAdapter,
  type WpfCallGraphIntegration,
  type WpfCallGraphStats,
} from './integration/wpf-callgraph-adapter.js';

export {
  WpfDataFlowTracer,
  createWpfDataFlowTracer,
  type DataFlowTrace,
  type DataFlowStep,
  type DataFlowStepType,
  type DataFlowStepDetails,
  type DataFlowAnalysisResult,
  type SensitiveDataSummary,
  type DataFlowStats,
} from './integration/wpf-data-flow-tracer.js';

// Main analyzer
export {
  WpfAnalyzer,
  createWpfAnalyzer,
  type WpfAnalyzerConfig,
  type WpfAnalysisResult,
  type WpfAnalysisStats,
} from './wpf-analyzer.js';
