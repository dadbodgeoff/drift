/**
 * Binding Error Detector
 *
 * Detects potential binding errors in XAML files.
 * Validates bindings against ViewModels and identifies common issues.
 */

import type {
  BindingError,
  XamlExtractionResult,
  ViewModelAnalysis,
  XamlBinding,
  SourceLocation,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface BindingValidationResult {
  /** All detected errors */
  errors: BindingError[];
  /** Warnings (less severe issues) */
  warnings: BindingWarning[];
  /** Statistics */
  stats: BindingValidationStats;
}

export interface BindingWarning {
  /** Warning type */
  type: BindingWarningType;
  /** XAML file */
  xamlFile: string;
  /** Line number */
  line: number;
  /** Binding path */
  bindingPath: string;
  /** Warning message */
  message: string;
  /** Suggestion */
  suggestion?: string | undefined;
}

export type BindingWarningType =
  | 'missing-mode'
  | 'unnecessary-twoway'
  | 'missing-update-trigger'
  | 'complex-path'
  | 'potential-performance';

export interface BindingValidationStats {
  /** Total bindings checked */
  totalChecked: number;
  /** Valid bindings */
  valid: number;
  /** Errors found */
  errors: number;
  /** Warnings found */
  warnings: number;
}

// ============================================================================
// Common Binding Patterns
// ============================================================================

const READONLY_PROPERTIES = new Set([
  'Count', 'Length', 'IsEnabled', 'IsVisible', 'IsReadOnly',
  'HasItems', 'IsLoaded', 'ActualWidth', 'ActualHeight',
]);

const TWOWAY_PROPERTIES = new Set([
  'Text', 'SelectedItem', 'SelectedIndex', 'SelectedValue',
  'IsChecked', 'Value', 'Password', 'SelectedDate',
]);

// ============================================================================
// Binding Error Detector
// ============================================================================

export class BindingErrorDetector {
  /**
   * Detect binding errors in XAML
   */
  detect(
    xamlFile: string,
    xamlResult: XamlExtractionResult,
    viewModel: ViewModelAnalysis | null
  ): BindingValidationResult {
    const errors: BindingError[] = [];
    const warnings: BindingWarning[] = [];

    // Check each binding
    for (const binding of xamlResult.bindings) {
      const bindingErrors = this.validateBinding(xamlFile, binding.parsed, viewModel);
      errors.push(...bindingErrors.errors);
      warnings.push(...bindingErrors.warnings);
    }

    // Check commands
    for (const command of xamlResult.commands) {
      const commandErrors = this.validateCommand(xamlFile, command, viewModel);
      errors.push(...commandErrors);
    }

    return {
      errors,
      warnings,
      stats: {
        totalChecked: xamlResult.bindings.length + xamlResult.commands.length,
        valid: xamlResult.bindings.length + xamlResult.commands.length - errors.length,
        errors: errors.length,
        warnings: warnings.length,
      },
    };
  }

  /**
   * Validate a single binding
   */
  private validateBinding(
    xamlFile: string,
    binding: XamlBinding,
    viewModel: ViewModelAnalysis | null
  ): { errors: BindingError[]; warnings: BindingWarning[] } {
    const errors: BindingError[] = [];
    const warnings: BindingWarning[] = [];
    const location: SourceLocation = binding.location;

    // Skip if no ViewModel to validate against
    if (!viewModel) {
      errors.push({
        type: 'missing-datacontext',
        xamlFile,
        line: location.line,
        bindingPath: binding.path,
        message: 'Could not resolve DataContext for binding validation',
      });
      return { errors, warnings };
    }

    // Parse binding path
    const pathParts = binding.path.split('.');
    const rootProperty = pathParts[0] ?? '';

    // Check if property exists
    const property = viewModel.properties.find(p => p.name === rootProperty);
    const command = viewModel.commands.find(c => c.name === rootProperty);

    if (!property && !command) {
      errors.push({
        type: 'missing-property',
        xamlFile,
        line: location.line,
        bindingPath: binding.path,
        message: `Property '${rootProperty}' not found in ${viewModel.className}`,
        suggestion: this.suggestSimilarProperty(rootProperty, viewModel),
      });
      return { errors, warnings };
    }

    // Validate binding mode
    if (property) {
      const modeErrors = this.validateBindingMode(xamlFile, binding, property);
      errors.push(...modeErrors.errors);
      warnings.push(...modeErrors.warnings);
    }

    // Check for complex paths
    if (pathParts.length > 3) {
      warnings.push({
        type: 'complex-path',
        xamlFile,
        line: location.line,
        bindingPath: binding.path,
        message: 'Complex binding path may indicate tight coupling',
        suggestion: 'Consider exposing a flattened property in the ViewModel',
      });
    }

    // Check for potential performance issues
    if (binding.mode === 'TwoWay' && binding.updateSourceTrigger === 'PropertyChanged') {
      if (binding.property === 'Text') {
        warnings.push({
          type: 'potential-performance',
          xamlFile,
          line: location.line,
          bindingPath: binding.path,
          message: 'TwoWay binding with PropertyChanged trigger may cause performance issues',
          suggestion: 'Consider using LostFocus trigger for text inputs',
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate binding mode against property
   */
  private validateBindingMode(
    xamlFile: string,
    binding: XamlBinding,
    property: { name: string; hasGetter: boolean; hasSetter: boolean; raisesPropertyChanged: boolean }
  ): { errors: BindingError[]; warnings: BindingWarning[] } {
    const errors: BindingError[] = [];
    const warnings: BindingWarning[] = [];

    // TwoWay binding to read-only property
    if (binding.mode === 'TwoWay' && !property.hasSetter) {
      errors.push({
        type: 'readonly-twoway',
        xamlFile,
        line: binding.location.line,
        bindingPath: binding.path,
        message: `TwoWay binding to read-only property '${property.name}'`,
        suggestion: 'Change binding mode to OneWay or add a setter to the property',
      });
    }

    // TwoWay binding to property that doesn't notify
    if (binding.mode === 'TwoWay' && property.hasSetter && !property.raisesPropertyChanged) {
      warnings.push({
        type: 'missing-update-trigger',
        xamlFile,
        line: binding.location.line,
        bindingPath: binding.path,
        message: `Property '${property.name}' doesn't raise PropertyChanged, TwoWay binding may not update UI`,
        suggestion: 'Add OnPropertyChanged call to the property setter',
      });
    }

    // Unnecessary TwoWay on typically read-only properties
    if (binding.mode === 'TwoWay' && READONLY_PROPERTIES.has(binding.property)) {
      warnings.push({
        type: 'unnecessary-twoway',
        xamlFile,
        line: binding.location.line,
        bindingPath: binding.path,
        message: `TwoWay binding on typically read-only property '${binding.property}'`,
        suggestion: 'Consider using OneWay binding',
      });
    }

    // Missing explicit mode on properties that typically need TwoWay
    if (binding.mode === 'Default' && TWOWAY_PROPERTIES.has(binding.property)) {
      warnings.push({
        type: 'missing-mode',
        xamlFile,
        line: binding.location.line,
        bindingPath: binding.path,
        message: `Property '${binding.property}' typically needs explicit TwoWay mode`,
        suggestion: 'Add Mode=TwoWay to the binding',
      });
    }

    return { errors, warnings };
  }

  /**
   * Validate a command binding
   */
  private validateCommand(
    xamlFile: string,
    command: { binding: string; location: SourceLocation },
    viewModel: ViewModelAnalysis | null
  ): BindingError[] {
    const errors: BindingError[] = [];

    if (!viewModel) {
      return errors; // Already reported in binding validation
    }

    const vmCommand = viewModel.commands.find(c => c.name === command.binding);
    const vmProperty = viewModel.properties.find(p => p.name === command.binding);

    if (!vmCommand && !vmProperty) {
      errors.push({
        type: 'missing-property',
        xamlFile,
        line: command.location.line,
        bindingPath: command.binding,
        message: `Command '${command.binding}' not found in ${viewModel.className}`,
        suggestion: this.suggestSimilarCommand(command.binding, viewModel),
      });
    } else if (vmProperty && !vmCommand) {
      // Property exists but it's not a command
      if (!vmProperty.type.includes('Command') && !vmProperty.type.includes('ICommand')) {
        errors.push({
          type: 'wrong-type',
          xamlFile,
          line: command.location.line,
          bindingPath: command.binding,
          message: `'${command.binding}' is not a command (type: ${vmProperty.type})`,
          suggestion: 'Ensure the property implements ICommand',
        });
      }
    }

    return errors;
  }

  /**
   * Suggest similar property name
   */
  private suggestSimilarProperty(name: string, viewModel: ViewModelAnalysis): string | undefined {
    const lowerName = name.toLowerCase();
    const allNames = [
      ...viewModel.properties.map(p => p.name),
      ...viewModel.commands.map(c => c.name),
    ];

    for (const candidate of allNames) {
      const lowerCandidate = candidate.toLowerCase();
      
      // Exact match with different case
      if (lowerCandidate === lowerName) {
        return `Did you mean '${candidate}'? (case mismatch)`;
      }
      
      // Starts with same prefix
      if (lowerCandidate.startsWith(lowerName.slice(0, 3)) ||
          lowerName.startsWith(lowerCandidate.slice(0, 3))) {
        return `Did you mean '${candidate}'?`;
      }
      
      // Contains the name
      if (lowerCandidate.includes(lowerName) || lowerName.includes(lowerCandidate)) {
        return `Did you mean '${candidate}'?`;
      }
      
      // Levenshtein distance <= 2
      if (this.levenshteinDistance(lowerName, lowerCandidate) <= 2) {
        return `Did you mean '${candidate}'?`;
      }
    }

    return undefined;
  }

  /**
   * Suggest similar command name
   */
  private suggestSimilarCommand(name: string, viewModel: ViewModelAnalysis): string | undefined {
    const commands = viewModel.commands.map(c => c.name);
    const lowerName = name.toLowerCase();

    for (const candidate of commands) {
      const lowerCandidate = candidate.toLowerCase();
      
      if (lowerCandidate === lowerName) {
        return `Did you mean '${candidate}'? (case mismatch)`;
      }
      
      if (this.levenshteinDistance(lowerName, lowerCandidate) <= 2) {
        return `Did you mean '${candidate}'?`;
      }
    }

    // Suggest adding "Command" suffix if missing
    if (!name.endsWith('Command')) {
      const withSuffix = `${name}Command`;
      const match = commands.find(c => c.toLowerCase() === withSuffix.toLowerCase());
      if (match) {
        return `Did you mean '${match}'?`;
      }
    }

    return undefined;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1,
            matrix[i]![j - 1]! + 1,
            matrix[i - 1]![j]! + 1
          );
        }
      }
    }

    return matrix[b.length]![a.length]!;
  }
}

/**
 * Factory function
 */
export function createBindingErrorDetector(): BindingErrorDetector {
  return new BindingErrorDetector();
}
