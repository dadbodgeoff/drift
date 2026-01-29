/**
 * Pydantic Inheritance Resolver
 *
 * Resolves model inheritance chains and merges fields from parent classes.
 * Handles multiple inheritance and generic type substitution.
 *
 * @module pydantic/inheritance-resolver
 */

import { PYDANTIC_BASE_CLASSES } from './types.js';

import type { PydanticModelInfo, PydanticFieldInfo, TypeInfo } from '../types.js';
import type { BaseClassInfo } from './types.js';

// ============================================
// Inheritance Resolver Class
// ============================================

/**
 * Resolves Pydantic model inheritance.
 *
 * Handles:
 * - Single inheritance: class Child(Parent)
 * - Multiple inheritance: class Child(Parent1, Parent2)
 * - Generic inheritance: class Child(Response[User])
 * - Mixin classes
 */
export class InheritanceResolver {
  /**
   * Resolve all fields for a model including inherited fields.
   *
   * @param model - The model to resolve fields for
   * @param allModels - Map of all known models by name
   * @returns Array of all fields (inherited + own)
   */
  resolveFields(
    model: PydanticModelInfo,
    allModels: Map<string, PydanticModelInfo>
  ): PydanticFieldInfo[] {
    const visited = new Set<string>();
    return this.resolveFieldsRecursive(model, allModels, visited);
  }

  /**
   * Recursively resolve fields from inheritance chain.
   */
  private resolveFieldsRecursive(
    model: PydanticModelInfo,
    allModels: Map<string, PydanticModelInfo>,
    visited: Set<string>
  ): PydanticFieldInfo[] {
    // Prevent infinite recursion
    if (visited.has(model.name)) {
      return [];
    }
    visited.add(model.name);

    const inheritedFields: PydanticFieldInfo[] = [];

    // Process base classes in order (MRO)
    for (const baseName of model.bases) {
      const baseInfo = this.parseBaseClass(baseName);

      // Skip Pydantic base classes
      if (baseInfo.isPydanticBase) {
        continue;
      }

      // Skip Generic[T]
      if (baseInfo.isGeneric) {
        continue;
      }

      // Find the parent model
      const parentModel = allModels.get(baseInfo.name);
      if (!parentModel) {
        continue;
      }

      // Recursively get parent fields
      const parentFields = this.resolveFieldsRecursive(
        parentModel,
        allModels,
        visited
      );

      // Apply generic type substitution if needed
      const substitutedFields = baseInfo.typeArgs.length > 0
        ? this.substituteGenericTypes(parentFields, parentModel, baseInfo.typeArgs)
        : parentFields;

      // Add parent fields (avoiding duplicates)
      for (const field of substitutedFields) {
        if (!inheritedFields.some((f) => f.name === field.name)) {
          inheritedFields.push({ ...field });
        }
      }
    }

    // Add own fields (override inherited)
    const allFields = [...inheritedFields];
    for (const field of model.fields) {
      const existingIndex = allFields.findIndex((f) => f.name === field.name);
      if (existingIndex >= 0) {
        allFields[existingIndex] = field;
      } else {
        allFields.push(field);
      }
    }

    return allFields;
  }

  /**
   * Parse a base class string into structured info.
   */
  parseBaseClass(baseStr: string): BaseClassInfo {
    // Check for generic: Parent[T, U]
    const genericMatch = baseStr.match(/^(\w+(?:\.\w+)*)\s*\[(.+)\]$/);

    if (genericMatch) {
      const [, name, argsStr] = genericMatch;
      const typeArgs = this.parseTypeArgs(argsStr ?? '');

      return {
        name: name ?? '',
        fullName: null,
        typeArgs,
        isPydanticBase: PYDANTIC_BASE_CLASSES.has(name ?? ''),
        isGeneric: name === 'Generic',
      };
    }

    // Simple base class
    return {
      name: baseStr,
      fullName: null,
      typeArgs: [],
      isPydanticBase: PYDANTIC_BASE_CLASSES.has(baseStr),
      isGeneric: baseStr === 'Generic',
    };
  }

  /**
   * Parse generic type arguments.
   */
  private parseTypeArgs(argsStr: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of argsStr) {
      if (char === '[' || char === '(') {
        depth++;
        current += char;
      } else if (char === ']' || char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        if (current.trim()) {
          args.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }

  /**
   * Substitute generic type parameters in fields.
   */
  private substituteGenericTypes(
    fields: PydanticFieldInfo[],
    parentModel: PydanticModelInfo,
    typeArgs: string[]
  ): PydanticFieldInfo[] {
    // Find generic parameters from parent (e.g., T, U from Generic[T, U])
    const genericParams = this.findGenericParams(parentModel);

    if (genericParams.length === 0 || genericParams.length !== typeArgs.length) {
      return fields;
    }

    // Create substitution map
    const substitutions = new Map<string, string>();
    for (let i = 0; i < genericParams.length; i++) {
      substitutions.set(genericParams[i]!, typeArgs[i]!);
    }

    // Apply substitutions to fields
    return fields.map((field) => ({
      ...field,
      type: this.substituteType(field.type, substitutions),
    }));
  }

  /**
   * Find generic type parameters from a model's bases.
   */
  private findGenericParams(model: PydanticModelInfo): string[] {
    for (const base of model.bases) {
      if (base.startsWith('Generic[')) {
        const match = base.match(/^Generic\[(.+)\]$/);
        if (match) {
          return this.parseTypeArgs(match[1] ?? '');
        }
      }
    }
    return [];
  }

  /**
   * Substitute type parameters in a TypeInfo.
   */
  private substituteType(
    type: TypeInfo,
    substitutions: Map<string, string>
  ): TypeInfo {
    // Check if base type should be substituted
    const substituted = substitutions.get(type.base);
    if (substituted) {
      return {
        ...type,
        base: substituted,
        raw: type.raw.replace(type.base, substituted),
      };
    }

    // Recursively substitute in type arguments
    if (type.args.length > 0) {
      return {
        ...type,
        args: type.args.map((arg) => this.substituteType(arg, substitutions)),
      };
    }

    return type;
  }

  /**
   * Get the full inheritance chain for a model.
   */
  getInheritanceChain(
    model: PydanticModelInfo,
    allModels: Map<string, PydanticModelInfo>
  ): PydanticModelInfo[] {
    const chain: PydanticModelInfo[] = [];
    const visited = new Set<string>();

    this.buildInheritanceChain(model, allModels, chain, visited);

    return chain;
  }

  /**
   * Recursively build inheritance chain.
   */
  private buildInheritanceChain(
    model: PydanticModelInfo,
    allModels: Map<string, PydanticModelInfo>,
    chain: PydanticModelInfo[],
    visited: Set<string>
  ): void {
    if (visited.has(model.name)) {
      return;
    }
    visited.add(model.name);

    // Add parents first (depth-first)
    for (const baseName of model.bases) {
      const baseInfo = this.parseBaseClass(baseName);

      if (baseInfo.isPydanticBase || baseInfo.isGeneric) {
        continue;
      }

      const parentModel = allModels.get(baseInfo.name);
      if (parentModel) {
        this.buildInheritanceChain(parentModel, allModels, chain, visited);
      }
    }

    // Add this model
    chain.push(model);
  }

  /**
   * Check if a model inherits from another.
   */
  inheritsFrom(
    model: PydanticModelInfo,
    ancestorName: string,
    allModels: Map<string, PydanticModelInfo>
  ): boolean {
    const chain = this.getInheritanceChain(model, allModels);
    return chain.some((m) => m.name === ancestorName);
  }

  /**
   * Find all models that inherit from a given model.
   */
  findDescendants(
    ancestorName: string,
    allModels: Map<string, PydanticModelInfo>
  ): PydanticModelInfo[] {
    const descendants: PydanticModelInfo[] = [];

    for (const model of allModels.values()) {
      if (model.name !== ancestorName && 
          this.inheritsFrom(model, ancestorName, allModels)) {
        descendants.push(model);
      }
    }

    return descendants;
  }
}
