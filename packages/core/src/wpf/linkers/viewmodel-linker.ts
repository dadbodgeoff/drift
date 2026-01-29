/**
 * ViewModel Linker
 *
 * Links XAML bindings to ViewModel properties and commands.
 * Creates edges for the call graph integration.
 */

import { DataContextResolver } from './datacontext-resolver.js';

import type {
  ViewModelLink,
  XamlExtractionResult,
  ViewModelAnalysis,
  ExtractedBinding,
  ExtractedCommand,
  SourceLocation,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface LinkingResult {
  /** Successfully linked bindings */
  links: ViewModelLink[];
  /** Unresolved bindings */
  unresolved: UnresolvedBinding[];
  /** Statistics */
  stats: LinkingStats;
}

export interface UnresolvedBinding {
  /** XAML file */
  xamlFile: string;
  /** Binding path */
  bindingPath: string;
  /** Reason for failure */
  reason: string;
  /** Suggested fix */
  suggestion?: string | undefined;
  /** Location */
  location: SourceLocation;
}

export interface LinkingStats {
  /** Total bindings processed */
  totalBindings: number;
  /** Successfully linked */
  linkedCount: number;
  /** Unresolved */
  unresolvedCount: number;
  /** Link rate */
  linkRate: number;
}

// ============================================================================
// ViewModel Linker
// ============================================================================

export class ViewModelLinker {
  private resolver: DataContextResolver;

  constructor(resolver?: DataContextResolver) {
    this.resolver = resolver ?? new DataContextResolver();
  }

  /**
   * Link all bindings in a XAML file to ViewModel properties
   */
  linkBindings(
    xamlPath: string,
    xamlResult: XamlExtractionResult,
    viewModel: ViewModelAnalysis | null
  ): LinkingResult {
    const links: ViewModelLink[] = [];
    const unresolved: UnresolvedBinding[] = [];

    // Process data bindings
    for (const binding of xamlResult.bindings) {
      const result = this.linkBinding(xamlPath, binding, viewModel);
      if (result.link) {
        links.push(result.link);
      } else if (result.unresolved) {
        unresolved.push(result.unresolved);
      }
    }

    // Process command bindings
    for (const command of xamlResult.commands) {
      const result = this.linkCommand(xamlPath, command, viewModel);
      if (result.link) {
        links.push(result.link);
      } else if (result.unresolved) {
        unresolved.push(result.unresolved);
      }
    }

    const totalBindings = xamlResult.bindings.length + xamlResult.commands.length;

    return {
      links,
      unresolved,
      stats: {
        totalBindings,
        linkedCount: links.length,
        unresolvedCount: unresolved.length,
        linkRate: totalBindings > 0 ? links.length / totalBindings : 1,
      },
    };
  }

  /**
   * Link a single binding to ViewModel property
   */
  private linkBinding(
    xamlPath: string,
    binding: ExtractedBinding,
    viewModel: ViewModelAnalysis | null
  ): { link?: ViewModelLink; unresolved?: UnresolvedBinding } {
    const bindingPath = binding.parsed.path;

    if (!bindingPath) {
      return {
        unresolved: {
          xamlFile: xamlPath,
          bindingPath: binding.bindingExpression,
          reason: 'Empty binding path',
          location: binding.location,
        },
      };
    }

    if (!viewModel) {
      return {
        unresolved: {
          xamlFile: xamlPath,
          bindingPath,
          reason: 'Could not resolve DataContext',
          location: binding.location,
        },
      };
    }

    // Handle nested paths (e.g., "User.Name")
    const pathParts = bindingPath.split('.');
    const propertyName = pathParts[0];

    if (!propertyName) {
      return {
        unresolved: {
          xamlFile: xamlPath,
          bindingPath,
          reason: 'Invalid binding path',
          location: binding.location,
        },
      };
    }

    // Find property in ViewModel
    const property = viewModel.properties.find(p => p.name === propertyName);

    if (!property) {
      // Check if it's a command being used as a binding (unusual but possible)
      const command = viewModel.commands.find(c => c.name === propertyName);
      if (command) {
        return {
          link: {
            xamlFile: xamlPath,
            xamlElement: binding.elementName,
            bindingPath,
            viewModelClass: viewModel.className,
            viewModelProperty: command.name,
            propertyType: command.commandType,
            notifiesChange: false,
            locations: {
              xaml: binding.location,
              csharp: command.location,
            },
            confidence: 0.8,
          },
        };
      }

      // Property not found
      const suggestion = this.findSimilarProperty(propertyName, viewModel);
      return {
        unresolved: {
          xamlFile: xamlPath,
          bindingPath,
          reason: `Property '${propertyName}' not found in ${viewModel.className}`,
          suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
          location: binding.location,
        },
      };
    }

    // Check for TwoWay binding on readonly property
    if (binding.parsed.mode === 'TwoWay' && !property.hasSetter) {
      return {
        unresolved: {
          xamlFile: xamlPath,
          bindingPath,
          reason: `TwoWay binding on readonly property '${propertyName}'`,
          suggestion: 'Change binding mode to OneWay or add setter to property',
          location: binding.location,
        },
      };
    }

    return {
      link: {
        xamlFile: xamlPath,
        xamlElement: binding.elementName,
        bindingPath,
        viewModelClass: viewModel.className,
        viewModelProperty: property.name,
        propertyType: property.type,
        notifiesChange: property.raisesPropertyChanged,
        locations: {
          xaml: binding.location,
          csharp: property.location,
        },
        confidence: 0.9,
      },
    };
  }

  /**
   * Link a command binding to ViewModel command
   */
  private linkCommand(
    xamlPath: string,
    command: ExtractedCommand,
    viewModel: ViewModelAnalysis | null
  ): { link?: ViewModelLink; unresolved?: UnresolvedBinding } {
    const commandPath = command.binding;

    if (!viewModel) {
      return {
        unresolved: {
          xamlFile: xamlPath,
          bindingPath: commandPath,
          reason: 'Could not resolve DataContext',
          location: command.location,
        },
      };
    }

    // Find command in ViewModel
    const vmCommand = viewModel.commands.find(c => c.name === commandPath);

    if (!vmCommand) {
      // Check if it's a property that might be a command
      const property = viewModel.properties.find(p => p.name === commandPath);
      if (property?.type.includes('Command')) {
        return {
          link: {
            xamlFile: xamlPath,
            xamlElement: command.elementName,
            bindingPath: commandPath,
            viewModelClass: viewModel.className,
            viewModelProperty: property.name,
            propertyType: property.type,
            notifiesChange: false,
            locations: {
              xaml: command.location,
              csharp: property.location,
            },
            confidence: 0.85,
          },
        };
      }

      // Command not found
      const suggestion = this.findSimilarCommand(commandPath, viewModel);
      return {
        unresolved: {
          xamlFile: xamlPath,
          bindingPath: commandPath,
          reason: `Command '${commandPath}' not found in ${viewModel.className}`,
          suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
          location: command.location,
        },
      };
    }

    return {
      link: {
        xamlFile: xamlPath,
        xamlElement: command.elementName,
        bindingPath: commandPath,
        viewModelClass: viewModel.className,
        viewModelProperty: vmCommand.name,
        propertyType: vmCommand.commandType,
        notifiesChange: false,
        locations: {
          xaml: command.location,
          csharp: vmCommand.location,
        },
        confidence: 0.95,
      },
    };
  }

  /**
   * Find similar property name for suggestions
   */
  private findSimilarProperty(name: string, viewModel: ViewModelAnalysis): string | null {
    const lowerName = name.toLowerCase();
    const candidates = viewModel.properties.map(p => p.name);

    for (const candidate of candidates) {
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
   * Find similar command name for suggestions
   */
  private findSimilarCommand(name: string, viewModel: ViewModelAnalysis): string | null {
    const lowerName = name.toLowerCase();
    const candidates = viewModel.commands.map(c => c.name);

    for (const candidate of candidates) {
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
   * Get the DataContext resolver
   */
  getResolver(): DataContextResolver {
    return this.resolver;
  }
}

/**
 * Factory function
 */
export function createViewModelLinker(resolver?: DataContextResolver): ViewModelLinker {
  return new ViewModelLinker(resolver);
}
