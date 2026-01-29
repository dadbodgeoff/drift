/**
 * DataContext Resolver
 *
 * Resolves DataContext inheritance chain for XAML views.
 * Determines which ViewModel class provides data for bindings.
 */

import * as path from 'node:path';

import type {
  DataContextResolution,
  DataContextStep,
  XamlExtractionResult,
  ViewModelAnalysis,
} from '../types.js';

// ============================================================================
// DataContext Resolver
// ============================================================================

export class DataContextResolver {
  private viewModels: Map<string, ViewModelAnalysis> = new Map();
  private xamlFiles: Map<string, XamlExtractionResult> = new Map();

  /**
   * Register a ViewModel for resolution
   */
  registerViewModel(viewModel: ViewModelAnalysis): void {
    this.viewModels.set(viewModel.className, viewModel);
    this.viewModels.set(viewModel.qualifiedName, viewModel);
    
    // Also register without namespace prefix for XAML matching
    // e.g., "vm:MainViewModel" should match "MainViewModel"
    const shortName = viewModel.className.split('.').pop() ?? viewModel.className;
    if (shortName !== viewModel.className) {
      this.viewModels.set(shortName, viewModel);
    }
  }

  /**
   * Register XAML extraction result
   */
  registerXaml(filePath: string, result: XamlExtractionResult): void {
    this.xamlFiles.set(filePath, result);
  }

  /**
   * Resolve DataContext for a XAML file
   */
  resolve(xamlPath: string, xamlResult: XamlExtractionResult): DataContextResolution {
    const resolutionPath: DataContextStep[] = [];
    let resolvedType: string | null = null;
    let confidence: 'high' | 'medium' | 'low' = 'low';

    // Strategy 1: Design-time DataContext (highest confidence)
    if (xamlResult.dataContextType) {
      // Strip namespace prefix if present (e.g., "vm:MainViewModel" -> "MainViewModel")
      const strippedType = this.stripNamespacePrefix(xamlResult.dataContextType);
      
      // Try to find the ViewModel
      const vm = this.viewModels.get(strippedType) ?? this.viewModels.get(xamlResult.dataContextType);
      
      if (vm) {
        resolvedType = vm.className;
        resolutionPath.push({
          source: 'design-time',
          type: resolvedType,
        });
        confidence = 'high';
      } else {
        // Still record the type even if we can't find the ViewModel
        resolvedType = strippedType;
        resolutionPath.push({
          source: 'design-time',
          type: resolvedType,
        });
        confidence = 'medium';
      }
    }

    // Strategy 2: Convention-based (View → ViewModel naming)
    if (!resolvedType) {
      const conventionResult = this.resolveByConvention(xamlPath);
      if (conventionResult) {
        resolvedType = conventionResult;
        resolutionPath.push({
          source: 'inherited', // Convention is a form of implicit inheritance
          type: resolvedType,
        });
        confidence = 'medium';
      }
    }

    // Strategy 3: x:Class based code-behind analysis
    if (!resolvedType && xamlResult.xClass) {
      const codeBehindResult = this.resolveFromCodeBehind(xamlResult.xClass, xamlPath);
      if (codeBehindResult) {
        resolvedType = codeBehindResult.type;
        resolutionPath.push({
          source: 'code-behind',
          type: resolvedType,
          location: codeBehindResult.location,
        });
        confidence = codeBehindResult.confidence;
      }
    }

    return {
      xamlFile: xamlPath,
      element: 'root',
      resolvedType,
      resolutionPath,
      confidence,
    };
  }

  /**
   * Strip namespace prefix from type name
   * e.g., "vm:MainViewModel" -> "MainViewModel"
   * e.g., "local:Converters.BoolToVisibility" -> "Converters.BoolToVisibility"
   */
  private stripNamespacePrefix(typeName: string): string {
    const colonIndex = typeName.indexOf(':');
    if (colonIndex !== -1) {
      return typeName.slice(colonIndex + 1);
    }
    return typeName;
  }

  /**
   * Resolve all registered XAML files
   */
  resolveAll(): DataContextResolution[] {
    const results: DataContextResolution[] = [];

    for (const [filePath, xamlResult] of this.xamlFiles) {
      results.push(this.resolve(filePath, xamlResult));
    }

    return results;
  }

  /**
   * Resolve by naming convention (View → ViewModel)
   */
  private resolveByConvention(xamlPath: string): string | null {
    const fileName = path.basename(xamlPath, '.xaml');

    // Common conventions:
    // MainWindow → MainWindowViewModel or MainViewModel
    // UserView → UserViewModel
    // SettingsPage → SettingsPageViewModel or SettingsViewModel

    const conventions = [
      `${fileName}ViewModel`,
      fileName.replace(/View$/, 'ViewModel'),
      fileName.replace(/Window$/, 'ViewModel'),
      fileName.replace(/Page$/, 'ViewModel'),
      fileName.replace(/Control$/, 'ViewModel'),
    ];

    for (const vmName of conventions) {
      if (this.viewModels.has(vmName)) {
        return vmName;
      }
    }

    return null;
  }

  /**
   * Resolve from code-behind file
   */
  private resolveFromCodeBehind(
    xClass: string,
    _xamlPath: string
  ): { type: string; location?: { file: string; line: number } | undefined; confidence: 'high' | 'medium' | 'low' } | null {
    // We can't read the file synchronously here, but we can infer
    // based on the x:Class and registered ViewModels

    // Extract class name from x:Class
    const className = xClass.split('.').pop() ?? xClass;

    // Look for matching ViewModel by convention
    const vmName = className.replace(/(?:View|Window|Page|Control)$/, '') + 'ViewModel';

    if (this.viewModels.has(vmName)) {
      return {
        type: vmName,
        confidence: 'medium',
      };
    }

    return null;
  }

  /**
   * Find ViewModel for a binding path
   */
  findViewModelForBinding(
    xamlPath: string,
    _bindingPath: string
  ): ViewModelAnalysis | null {
    const resolution = this.xamlFiles.get(xamlPath);
    if (!resolution) {return null;}

    const dcResolution = this.resolve(xamlPath, resolution);
    if (!dcResolution.resolvedType) {return null;}

    return this.viewModels.get(dcResolution.resolvedType) ?? null;
  }

  /**
   * Validate a binding against its ViewModel
   */
  validateBinding(
    xamlPath: string,
    bindingPath: string
  ): { valid: boolean; property?: string; error?: string } {
    const viewModel = this.findViewModelForBinding(xamlPath, bindingPath);

    if (!viewModel) {
      return {
        valid: false,
        error: 'Could not resolve DataContext',
      };
    }

    // Handle nested paths (e.g., "User.Name")
    const pathParts = bindingPath.split('.');
    const propertyName = pathParts[0];

    if (!propertyName) {
      return { valid: false, error: 'Empty binding path' };
    }

    // Check if property exists
    const property = viewModel.properties.find(p => p.name === propertyName);
    const command = viewModel.commands.find(c => c.name === propertyName);

    if (property) {
      return { valid: true, property: property.name };
    }

    if (command) {
      return { valid: true, property: command.name };
    }

    // Property not found - suggest similar
    const similar = this.findSimilarProperty(propertyName, viewModel);

    return {
      valid: false,
      error: `Property '${propertyName}' not found in ${viewModel.className}`,
      ...(similar && { suggestion: `Did you mean '${similar}'?` }),
    };
  }

  /**
   * Find similar property name (for suggestions)
   */
  private findSimilarProperty(
    name: string,
    viewModel: ViewModelAnalysis
  ): string | null {
    const lowerName = name.toLowerCase();
    const allNames = [
      ...viewModel.properties.map(p => p.name),
      ...viewModel.commands.map(c => c.name),
    ];

    // Simple similarity: starts with same letters or contains
    for (const candidate of allNames) {
      const lowerCandidate = candidate.toLowerCase();
      if (lowerCandidate.startsWith(lowerName.slice(0, 3)) ||
          lowerCandidate.includes(lowerName) ||
          lowerName.includes(lowerCandidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Clear all registered data
   */
  clear(): void {
    this.viewModels.clear();
    this.xamlFiles.clear();
  }
}

/**
 * Factory function
 */
export function createDataContextResolver(): DataContextResolver {
  return new DataContextResolver();
}
