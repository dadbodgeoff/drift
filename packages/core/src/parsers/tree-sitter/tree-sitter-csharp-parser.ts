/**
 * Tree-sitter C# Parser
 *
 * C# parsing using tree-sitter-c-sharp with semantic extraction.
 * Extracts usings, namespaces, classes, records, structs, interfaces,
 * methods, properties, fields, and attributes.
 *
 * @requirements 3.2 - Support C# language
 */

import { BaseParser } from '../base-parser.js';
import { CSharpASTConverter } from './csharp-ast-converter.js';
import { isCSharpTreeSitterAvailable, createCSharpParser, getCSharpLoadingError } from './csharp-loader.js';

import type { AST, ASTNode, Language, ParseResult, Position } from '../types.js';
import type { TreeSitterNode, TreeSitterParser } from './types.js';

// ============================================
// Types
// ============================================

/**
 * Using directive information
 */
export interface CSharpUsingInfo {
  /** The namespace being imported */
  namespace: string;
  /** Alias if using alias directive (e.g., using Foo = Bar.Baz) */
  alias: string | null;
  /** Whether this is a static using */
  isStatic: boolean;
  /** Whether this is a global using */
  isGlobal: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Namespace information
 */
export interface CSharpNamespaceInfo {
  /** Namespace name */
  name: string;
  /** Whether this is file-scoped */
  isFileScoped: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Attribute information
 */
export interface CSharpAttributeInfo {
  /** Attribute name (without 'Attribute' suffix) */
  name: string;
  /** Full attribute name as written */
  fullName: string;
  /** Attribute arguments as strings */
  arguments: string[];
  /** Named arguments */
  namedArguments: Record<string, string>;
  /** Target (class, method, property, etc.) */
  target: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}


/**
 * Parameter information
 */
export interface CSharpParameterInfo {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: string;
  /** Default value if any */
  defaultValue: string | null;
  /** Whether parameter has 'ref' modifier */
  isRef: boolean;
  /** Whether parameter has 'out' modifier */
  isOut: boolean;
  /** Whether parameter has 'in' modifier */
  isIn: boolean;
  /** Whether parameter has 'params' modifier */
  isParams: boolean;
  /** Whether parameter has 'this' modifier (extension method) */
  isThis: boolean;
  /** Attributes on the parameter */
  attributes: CSharpAttributeInfo[];
}

/**
 * Method information
 */
export interface CSharpMethodInfo {
  /** Method name */
  name: string;
  /** Return type */
  returnType: string;
  /** Parameters */
  parameters: CSharpParameterInfo[];
  /** Generic type parameters */
  genericParameters: string[];
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether method is static */
  isStatic: boolean;
  /** Whether method is async */
  isAsync: boolean;
  /** Whether method is virtual */
  isVirtual: boolean;
  /** Whether method is override */
  isOverride: boolean;
  /** Whether method is abstract */
  isAbstract: boolean;
  /** Whether method is sealed */
  isSealed: boolean;
  /** Whether method is extern */
  isExtern: boolean;
  /** Whether method is partial */
  isPartial: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Property information
 */
export interface CSharpPropertyInfo {
  /** Property name */
  name: string;
  /** Property type */
  type: string;
  /** Whether property has getter */
  hasGetter: boolean;
  /** Whether property has setter */
  hasSetter: boolean;
  /** Whether setter is init-only */
  isInit: boolean;
  /** Whether property is required */
  isRequired: boolean;
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether property is static */
  isStatic: boolean;
  /** Whether property is virtual */
  isVirtual: boolean;
  /** Whether property is override */
  isOverride: boolean;
  /** Whether property is abstract */
  isAbstract: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Field information
 */
export interface CSharpFieldInfo {
  /** Field name */
  name: string;
  /** Field type */
  type: string;
  /** Default value if any */
  defaultValue: string | null;
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether field is static */
  isStatic: boolean;
  /** Whether field is readonly */
  isReadonly: boolean;
  /** Whether field is const */
  isConst: boolean;
  /** Whether field is volatile */
  isVolatile: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Constructor information
 */
export interface CSharpConstructorInfo {
  /** Parameters */
  parameters: CSharpParameterInfo[];
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether constructor is static */
  isStatic: boolean;
  /** Base/this initializer call */
  initializer: { type: 'base' | 'this'; arguments: string[] } | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}


/**
 * Class information
 */
export interface CSharpClassInfo {
  /** Class name */
  name: string;
  /** Containing namespace */
  namespace: string | null;
  /** Base class if any */
  baseClass: string | null;
  /** Implemented interfaces */
  interfaces: string[];
  /** Generic type parameters */
  genericParameters: string[];
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Methods */
  methods: CSharpMethodInfo[];
  /** Properties */
  properties: CSharpPropertyInfo[];
  /** Fields */
  fields: CSharpFieldInfo[];
  /** Constructors */
  constructors: CSharpConstructorInfo[];
  /** Nested types */
  nestedTypes: string[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether class is static */
  isStatic: boolean;
  /** Whether class is abstract */
  isAbstract: boolean;
  /** Whether class is sealed */
  isSealed: boolean;
  /** Whether class is partial */
  isPartial: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Record information
 */
export interface CSharpRecordInfo {
  /** Record name */
  name: string;
  /** Containing namespace */
  namespace: string | null;
  /** Whether this is a record struct (vs record class) */
  isStruct: boolean;
  /** Primary constructor parameters */
  primaryConstructorParams: CSharpParameterInfo[];
  /** Base record if any */
  baseRecord: string | null;
  /** Implemented interfaces */
  interfaces: string[];
  /** Generic type parameters */
  genericParameters: string[];
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Additional methods */
  methods: CSharpMethodInfo[];
  /** Additional properties */
  properties: CSharpPropertyInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether record is sealed */
  isSealed: boolean;
  /** Whether record is abstract */
  isAbstract: boolean;
  /** Whether record is partial */
  isPartial: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Struct information
 */
export interface CSharpStructInfo {
  /** Struct name */
  name: string;
  /** Containing namespace */
  namespace: string | null;
  /** Implemented interfaces */
  interfaces: string[];
  /** Generic type parameters */
  genericParameters: string[];
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Methods */
  methods: CSharpMethodInfo[];
  /** Properties */
  properties: CSharpPropertyInfo[];
  /** Fields */
  fields: CSharpFieldInfo[];
  /** Constructors */
  constructors: CSharpConstructorInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether struct is readonly */
  isReadonly: boolean;
  /** Whether struct is ref struct */
  isRef: boolean;
  /** Whether struct is partial */
  isPartial: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Interface information
 */
export interface CSharpInterfaceInfo {
  /** Interface name */
  name: string;
  /** Containing namespace */
  namespace: string | null;
  /** Extended interfaces */
  extends: string[];
  /** Generic type parameters */
  genericParameters: string[];
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Method signatures */
  methods: CSharpMethodInfo[];
  /** Property signatures */
  properties: CSharpPropertyInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Whether interface is partial */
  isPartial: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Enum information
 */
export interface CSharpEnumInfo {
  /** Enum name */
  name: string;
  /** Containing namespace */
  namespace: string | null;
  /** Underlying type if specified */
  underlyingType: string | null;
  /** Enum members */
  members: Array<{ name: string; value: string | null }>;
  /** Attributes */
  attributes: CSharpAttributeInfo[];
  /** Accessibility modifier */
  accessibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Extended parse result with C#-specific information
 */
export interface TreeSitterCSharpParseResult extends ParseResult {
  /** Using directives */
  usings: CSharpUsingInfo[];
  /** Namespace declarations */
  namespaces: CSharpNamespaceInfo[];
  /** Class declarations */
  classes: CSharpClassInfo[];
  /** Record declarations */
  records: CSharpRecordInfo[];
  /** Struct declarations */
  structs: CSharpStructInfo[];
  /** Interface declarations */
  interfaces: CSharpInterfaceInfo[];
  /** Enum declarations */
  enums: CSharpEnumInfo[];
  /** Top-level statements (for minimal APIs) */
  topLevelStatements: boolean;
  /** Global using directives */
  globalUsings: CSharpUsingInfo[];
}


// ============================================
// Parser Implementation
// ============================================

/**
 * Tree-sitter C# Parser
 *
 * Parses C# source code using tree-sitter-c-sharp and extracts
 * semantic information including classes, records, methods, etc.
 */
export class TreeSitterCSharpParser extends BaseParser {
  readonly language: Language = 'csharp';
  readonly extensions: string[] = ['.cs'];

  private parser: TreeSitterParser | null = null;
  private converter: CSharpASTConverter;
  private currentNamespace: string | null = null;

  constructor() {
    super();
    this.converter = new CSharpASTConverter();
  }

  /**
   * Check if tree-sitter-c-sharp is available.
   */
  static isAvailable(): boolean {
    return isCSharpTreeSitterAvailable();
  }

  /**
   * Get the loading error if tree-sitter-c-sharp failed to load.
   */
  static getLoadingError(): string | null {
    return getCSharpLoadingError();
  }

  /**
   * Initialize the parser (lazy loading).
   */
  private ensureParser(): TreeSitterParser {
    if (!this.parser) {
      if (!isCSharpTreeSitterAvailable()) {
        throw new Error(`C# parser not available: ${getCSharpLoadingError() ?? 'unknown error'}`);
      }
      this.parser = createCSharpParser();
    }
    return this.parser;
  }

  /**
   * Parse C# source code.
   */
  parse(source: string, _filePath?: string): TreeSitterCSharpParseResult {
    try {
      const parser = this.ensureParser();
      const tree = parser.parse(source);

      // Convert to drift AST
      const rootNode = this.converter.convert(tree.rootNode);
      const ast: AST = {
        rootNode,
        text: source,
      };

      // Reset namespace tracking
      this.currentNamespace = null;

      // Extract semantic information
      const usings = this.extractUsings(tree.rootNode);
      const globalUsings = usings.filter(u => u.isGlobal);
      const namespaces = this.extractNamespaces(tree.rootNode);
      const classes = this.extractClasses(tree.rootNode);
      const records = this.extractRecords(tree.rootNode);
      const structs = this.extractStructs(tree.rootNode);
      const interfaces = this.extractInterfaces(tree.rootNode);
      const enums = this.extractEnums(tree.rootNode);
      const topLevelStatements = this.hasTopLevelStatements(tree.rootNode);

      return {
        ast,
        language: 'csharp',
        errors: [],
        success: true,
        usings,
        globalUsings,
        namespaces,
        classes,
        records,
        structs,
        interfaces,
        enums,
        topLevelStatements,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        ast: null,
        language: 'csharp',
        errors: [{ message: errorMessage, position: { row: 0, column: 0 } }],
        success: false,
        usings: [],
        globalUsings: [],
        namespaces: [],
        classes: [],
        records: [],
        structs: [],
        interfaces: [],
        enums: [],
        topLevelStatements: false,
      };
    }
  }

  /**
   * Query the AST for nodes matching a pattern.
   */
  query(ast: AST, pattern: string): ASTNode[] {
    return this.findNodesByType(ast, pattern);
  }

  // ============================================
  // Extraction Methods
  // ============================================

  private extractUsings(root: TreeSitterNode): CSharpUsingInfo[] {
    const usings: CSharpUsingInfo[] = [];
    
    for (const child of root.children) {
      if (child.type === 'using_directive') {
        usings.push(this.parseUsingDirective(child));
      } else if (child.type === 'global_statement') {
        // Check for global using
        const usingChild = child.children.find(c => c.type === 'using_directive');
        if (usingChild) {
          const using = this.parseUsingDirective(usingChild);
          using.isGlobal = true;
          usings.push(using);
        }
      }
    }
    
    return usings;
  }

  private parseUsingDirective(node: TreeSitterNode): CSharpUsingInfo {
    let namespace = '';
    let alias: string | null = null;
    let isStatic = false;
    let isGlobal = false;

    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'qualified_name') {
        namespace = child.text;
      } else if (child.type === 'name_equals') {
        alias = child.children.find(c => c.type === 'identifier')?.text ?? null;
      } else if (child.text === 'static') {
        isStatic = true;
      } else if (child.text === 'global') {
        isGlobal = true;
      }
    }

    return {
      namespace,
      alias,
      isStatic,
      isGlobal,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };
  }

  private extractNamespaces(root: TreeSitterNode): CSharpNamespaceInfo[] {
    const namespaces: CSharpNamespaceInfo[] = [];
    
    for (const child of root.children) {
      if (child.type === 'namespace_declaration') {
        namespaces.push(this.parseNamespace(child, false));
      } else if (child.type === 'file_scoped_namespace_declaration') {
        namespaces.push(this.parseNamespace(child, true));
      }
    }
    
    return namespaces;
  }

  private parseNamespace(node: TreeSitterNode, isFileScoped: boolean): CSharpNamespaceInfo {
    let name = '';
    
    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'qualified_name') {
        name = child.text;
        this.currentNamespace = name;
        break;
      }
    }

    return {
      name,
      isFileScoped,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };
  }


  private extractClasses(root: TreeSitterNode): CSharpClassInfo[] {
    const classes: CSharpClassInfo[] = [];
    this.findNodesOfType(root, 'class_declaration', (node) => {
      classes.push(this.parseClass(node));
    });
    return classes;
  }

  private parseClass(node: TreeSitterNode): CSharpClassInfo {
    const info: CSharpClassInfo = {
      name: '',
      namespace: this.currentNamespace,
      baseClass: null,
      interfaces: [],
      genericParameters: [],
      attributes: [],
      methods: [],
      properties: [],
      fields: [],
      constructors: [],
      nestedTypes: [],
      accessibility: 'internal',
      isStatic: false,
      isAbstract: false,
      isSealed: false,
      isPartial: false,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          this.applyModifier(info, child.text);
          break;
        case 'type_parameter_list':
          info.genericParameters = this.parseTypeParameters(child);
          break;
        case 'base_list':
          const bases = this.parseBaseList(child);
          if (bases.length > 0) {
            // First non-interface is base class
            const firstBase = bases[0]!;
            if (!firstBase.startsWith('I') || firstBase.length === 1 || !this.isUpperCase(firstBase[1]!)) {
              info.baseClass = firstBase;
              info.interfaces = bases.slice(1);
            } else {
              info.interfaces = bases;
            }
          }
          break;
        case 'declaration_list':
          this.parseClassMembers(child, info);
          break;
      }
    }

    return info;
  }

  private parseClassMembers(node: TreeSitterNode, classInfo: CSharpClassInfo): void {
    for (const child of node.children) {
      switch (child.type) {
        case 'method_declaration':
          classInfo.methods.push(this.parseMethod(child));
          break;
        case 'property_declaration':
          classInfo.properties.push(this.parseProperty(child));
          break;
        case 'field_declaration':
          classInfo.fields.push(...this.parseField(child));
          break;
        case 'constructor_declaration':
          classInfo.constructors.push(this.parseConstructor(child));
          break;
        case 'class_declaration':
        case 'struct_declaration':
        case 'interface_declaration':
        case 'enum_declaration':
        case 'record_declaration':
          const nestedName = child.children.find(c => c.type === 'identifier')?.text;
          if (nestedName) {
            classInfo.nestedTypes.push(nestedName);
          }
          break;
      }
    }
  }

  private extractRecords(root: TreeSitterNode): CSharpRecordInfo[] {
    const records: CSharpRecordInfo[] = [];
    this.findNodesOfType(root, 'record_declaration', (node) => {
      records.push(this.parseRecord(node));
    });
    return records;
  }

  private parseRecord(node: TreeSitterNode): CSharpRecordInfo {
    const info: CSharpRecordInfo = {
      name: '',
      namespace: this.currentNamespace,
      isStruct: false,
      primaryConstructorParams: [],
      baseRecord: null,
      interfaces: [],
      genericParameters: [],
      attributes: [],
      methods: [],
      properties: [],
      accessibility: 'internal',
      isSealed: false,
      isAbstract: false,
      isPartial: false,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'struct':
          info.isStruct = true;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          this.applyRecordModifier(info, child.text);
          break;
        case 'type_parameter_list':
          info.genericParameters = this.parseTypeParameters(child);
          break;
        case 'parameter_list':
          info.primaryConstructorParams = this.parseParameters(child);
          break;
        case 'base_list':
          const bases = this.parseBaseList(child);
          if (bases.length > 0) {
            info.baseRecord = bases[0] ?? null;
            info.interfaces = bases.slice(1);
          }
          break;
        case 'declaration_list':
          this.parseRecordMembers(child, info);
          break;
      }
    }

    return info;
  }

  private parseRecordMembers(node: TreeSitterNode, recordInfo: CSharpRecordInfo): void {
    for (const child of node.children) {
      switch (child.type) {
        case 'method_declaration':
          recordInfo.methods.push(this.parseMethod(child));
          break;
        case 'property_declaration':
          recordInfo.properties.push(this.parseProperty(child));
          break;
      }
    }
  }

  private extractStructs(root: TreeSitterNode): CSharpStructInfo[] {
    const structs: CSharpStructInfo[] = [];
    this.findNodesOfType(root, 'struct_declaration', (node) => {
      structs.push(this.parseStruct(node));
    });
    return structs;
  }

  private parseStruct(node: TreeSitterNode): CSharpStructInfo {
    const info: CSharpStructInfo = {
      name: '',
      namespace: this.currentNamespace,
      interfaces: [],
      genericParameters: [],
      attributes: [],
      methods: [],
      properties: [],
      fields: [],
      constructors: [],
      accessibility: 'internal',
      isReadonly: false,
      isRef: false,
      isPartial: false,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          this.applyStructModifier(info, child.text);
          break;
        case 'type_parameter_list':
          info.genericParameters = this.parseTypeParameters(child);
          break;
        case 'base_list':
          info.interfaces = this.parseBaseList(child);
          break;
        case 'declaration_list':
          this.parseStructMembers(child, info);
          break;
      }
    }

    return info;
  }

  private parseStructMembers(node: TreeSitterNode, structInfo: CSharpStructInfo): void {
    for (const child of node.children) {
      switch (child.type) {
        case 'method_declaration':
          structInfo.methods.push(this.parseMethod(child));
          break;
        case 'property_declaration':
          structInfo.properties.push(this.parseProperty(child));
          break;
        case 'field_declaration':
          structInfo.fields.push(...this.parseField(child));
          break;
        case 'constructor_declaration':
          structInfo.constructors.push(this.parseConstructor(child));
          break;
      }
    }
  }


  private extractInterfaces(root: TreeSitterNode): CSharpInterfaceInfo[] {
    const interfaces: CSharpInterfaceInfo[] = [];
    this.findNodesOfType(root, 'interface_declaration', (node) => {
      interfaces.push(this.parseInterface(node));
    });
    return interfaces;
  }

  private parseInterface(node: TreeSitterNode): CSharpInterfaceInfo {
    const info: CSharpInterfaceInfo = {
      name: '',
      namespace: this.currentNamespace,
      extends: [],
      genericParameters: [],
      attributes: [],
      methods: [],
      properties: [],
      accessibility: 'internal',
      isPartial: false,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          this.applyInterfaceModifier(info, child.text);
          break;
        case 'type_parameter_list':
          info.genericParameters = this.parseTypeParameters(child);
          break;
        case 'base_list':
          info.extends = this.parseBaseList(child);
          break;
        case 'declaration_list':
          this.parseInterfaceMembers(child, info);
          break;
      }
    }

    return info;
  }

  private parseInterfaceMembers(node: TreeSitterNode, interfaceInfo: CSharpInterfaceInfo): void {
    for (const child of node.children) {
      switch (child.type) {
        case 'method_declaration':
          interfaceInfo.methods.push(this.parseMethod(child));
          break;
        case 'property_declaration':
          interfaceInfo.properties.push(this.parseProperty(child));
          break;
      }
    }
  }

  private extractEnums(root: TreeSitterNode): CSharpEnumInfo[] {
    const enums: CSharpEnumInfo[] = [];
    this.findNodesOfType(root, 'enum_declaration', (node) => {
      enums.push(this.parseEnum(node));
    });
    return enums;
  }

  private parseEnum(node: TreeSitterNode): CSharpEnumInfo {
    const info: CSharpEnumInfo = {
      name: '',
      namespace: this.currentNamespace,
      underlyingType: null,
      members: [],
      attributes: [],
      accessibility: 'internal',
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          if (child.text === 'public') {info.accessibility = 'public';}
          else if (child.text === 'internal') {info.accessibility = 'internal';}
          else if (child.text === 'private') {info.accessibility = 'private';}
          break;
        case 'base_list':
          const bases = this.parseBaseList(child);
          if (bases.length > 0) {
            info.underlyingType = bases[0] ?? null;
          }
          break;
        case 'enum_member_declaration_list':
          info.members = this.parseEnumMembers(child);
          break;
      }
    }

    return info;
  }

  private parseEnumMembers(node: TreeSitterNode): Array<{ name: string; value: string | null }> {
    const members: Array<{ name: string; value: string | null }> = [];
    
    for (const child of node.children) {
      if (child.type === 'enum_member_declaration') {
        let name = '';
        let value: string | null = null;
        
        for (const memberChild of child.children) {
          if (memberChild.type === 'identifier') {
            name = memberChild.text;
          } else if (memberChild.type === 'equals_value_clause') {
            value = memberChild.children.find(c => c.type !== '=')?.text ?? null;
          }
        }
        
        if (name) {
          members.push({ name, value });
        }
      }
    }
    
    return members;
  }

  private hasTopLevelStatements(root: TreeSitterNode): boolean {
    for (const child of root.children) {
      if (child.type === 'global_statement') {
        // Check if it's not just a using directive
        const hasNonUsing = child.children.some(c => c.type !== 'using_directive');
        if (hasNonUsing) {
          return true;
        }
      }
    }
    return false;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private parseAttributeList(node: TreeSitterNode): CSharpAttributeInfo[] {
    const attributes: CSharpAttributeInfo[] = [];
    
    for (const child of node.children) {
      if (child.type === 'attribute') {
        attributes.push(this.parseAttribute(child));
      }
    }
    
    return attributes;
  }

  private parseAttribute(node: TreeSitterNode): CSharpAttributeInfo {
    const info: CSharpAttributeInfo = {
      name: '',
      fullName: '',
      arguments: [],
      namedArguments: {},
      target: null,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'qualified_name') {
        info.fullName = child.text;
        // Remove 'Attribute' suffix if present
        info.name = info.fullName.replace(/Attribute$/, '');
      } else if (child.type === 'attribute_argument_list') {
        this.parseAttributeArguments(child, info);
      }
    }

    return info;
  }

  private parseAttributeArguments(node: TreeSitterNode, info: CSharpAttributeInfo): void {
    for (const child of node.children) {
      if (child.type === 'attribute_argument') {
        const nameEquals = child.children.find(c => c.type === 'name_equals');
        if (nameEquals) {
          const name = nameEquals.children.find(c => c.type === 'identifier')?.text;
          const value = child.children.find(c => c.type !== 'name_equals')?.text;
          if (name && value) {
            info.namedArguments[name] = value;
          }
        } else {
          const value = child.text;
          if (value) {
            info.arguments.push(value);
          }
        }
      }
    }
  }


  private parseMethod(node: TreeSitterNode): CSharpMethodInfo {
    const info: CSharpMethodInfo = {
      name: '',
      returnType: 'void',
      parameters: [],
      genericParameters: [],
      attributes: [],
      accessibility: 'private',
      isStatic: false,
      isAsync: false,
      isVirtual: false,
      isOverride: false,
      isAbstract: false,
      isSealed: false,
      isExtern: false,
      isPartial: false,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          this.applyMethodModifier(info, child.text);
          break;
        case 'type_parameter_list':
          info.genericParameters = this.parseTypeParameters(child);
          break;
        case 'parameter_list':
          info.parameters = this.parseParameters(child);
          break;
        case 'predefined_type':
        case 'identifier':
        case 'qualified_name':
        case 'generic_name':
        case 'nullable_type':
        case 'array_type':
        case 'tuple_type':
          // Return type - take the first type we find before the method name
          if (!info.name) {
            info.returnType = child.text;
          }
          break;
      }
    }

    // Handle return type more carefully
    const returnTypeNode = node.childForFieldName?.('type') ?? 
      node.children.find(c => 
        ['predefined_type', 'generic_name', 'qualified_name', 'nullable_type', 'array_type', 'tuple_type'].includes(c.type)
      );
    if (returnTypeNode) {
      info.returnType = returnTypeNode.text;
    }

    return info;
  }

  private parseProperty(node: TreeSitterNode): CSharpPropertyInfo {
    const info: CSharpPropertyInfo = {
      name: '',
      type: '',
      hasGetter: false,
      hasSetter: false,
      isInit: false,
      isRequired: false,
      attributes: [],
      accessibility: 'private',
      isStatic: false,
      isVirtual: false,
      isOverride: false,
      isAbstract: false,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          this.applyPropertyModifier(info, child.text);
          break;
        case 'predefined_type':
        case 'generic_name':
        case 'qualified_name':
        case 'nullable_type':
        case 'array_type':
        case 'tuple_type':
          info.type = child.text;
          break;
        case 'accessor_list':
          this.parseAccessors(child, info);
          break;
      }
    }

    return info;
  }

  private parseAccessors(node: TreeSitterNode, propertyInfo: CSharpPropertyInfo): void {
    for (const child of node.children) {
      if (child.type === 'accessor_declaration') {
        const accessorType = child.children.find(c => c.type === 'identifier' || c.text === 'get' || c.text === 'set' || c.text === 'init');
        if (accessorType) {
          if (accessorType.text === 'get') {
            propertyInfo.hasGetter = true;
          } else if (accessorType.text === 'set') {
            propertyInfo.hasSetter = true;
          } else if (accessorType.text === 'init') {
            propertyInfo.hasSetter = true;
            propertyInfo.isInit = true;
          }
        }
      }
    }
  }

  private parseField(node: TreeSitterNode): CSharpFieldInfo[] {
    const fields: CSharpFieldInfo[] = [];
    const baseInfo: Partial<CSharpFieldInfo> = {
      type: '',
      defaultValue: null,
      attributes: [],
      accessibility: 'private',
      isStatic: false,
      isReadonly: false,
      isConst: false,
      isVolatile: false,
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'attribute_list':
          baseInfo.attributes = [...(baseInfo.attributes ?? []), ...this.parseAttributeList(child)];
          break;
        case 'modifier':
          this.applyFieldModifier(baseInfo as CSharpFieldInfo, child.text);
          break;
        case 'predefined_type':
        case 'generic_name':
        case 'qualified_name':
        case 'nullable_type':
        case 'array_type':
        case 'tuple_type':
          baseInfo.type = child.text;
          break;
        case 'variable_declaration':
          for (const varChild of child.children) {
            if (varChild.type === 'variable_declarator') {
              const fieldInfo: CSharpFieldInfo = {
                name: '',
                type: baseInfo.type ?? '',
                defaultValue: null,
                attributes: baseInfo.attributes ?? [],
                accessibility: baseInfo.accessibility ?? 'private',
                isStatic: baseInfo.isStatic ?? false,
                isReadonly: baseInfo.isReadonly ?? false,
                isConst: baseInfo.isConst ?? false,
                isVolatile: baseInfo.isVolatile ?? false,
                startPosition: { row: node.startPosition.row, column: node.startPosition.column },
                endPosition: { row: node.endPosition.row, column: node.endPosition.column },
              };
              
              for (const declChild of varChild.children) {
                if (declChild.type === 'identifier') {
                  fieldInfo.name = declChild.text;
                } else if (declChild.type === 'equals_value_clause') {
                  fieldInfo.defaultValue = declChild.children.find(c => c.type !== '=')?.text ?? null;
                }
              }
              
              if (fieldInfo.name) {
                fields.push(fieldInfo);
              }
            }
          }
          break;
      }
    }

    return fields;
  }

  private parseConstructor(node: TreeSitterNode): CSharpConstructorInfo {
    const info: CSharpConstructorInfo = {
      parameters: [],
      attributes: [],
      accessibility: 'private',
      isStatic: false,
      initializer: null,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'modifier':
          if (child.text === 'public') {info.accessibility = 'public';}
          else if (child.text === 'private') {info.accessibility = 'private';}
          else if (child.text === 'protected') {info.accessibility = 'protected';}
          else if (child.text === 'internal') {info.accessibility = 'internal';}
          else if (child.text === 'static') {info.isStatic = true;}
          break;
        case 'parameter_list':
          info.parameters = this.parseParameters(child);
          break;
        case 'constructor_initializer':
          const initType = child.children.find(c => c.text === 'base' || c.text === 'this');
          if (initType) {
            info.initializer = {
              type: initType.text as 'base' | 'this',
              arguments: [],
            };
            const argList = child.children.find(c => c.type === 'argument_list');
            if (argList) {
              info.initializer.arguments = argList.children
                .filter(c => c.type === 'argument')
                .map(c => c.text);
            }
          }
          break;
      }
    }

    return info;
  }


  private parseParameters(node: TreeSitterNode): CSharpParameterInfo[] {
    const params: CSharpParameterInfo[] = [];
    
    for (const child of node.children) {
      if (child.type === 'parameter') {
        params.push(this.parseParameter(child));
      }
    }
    
    return params;
  }

  private parseParameter(node: TreeSitterNode): CSharpParameterInfo {
    const info: CSharpParameterInfo = {
      name: '',
      type: '',
      defaultValue: null,
      isRef: false,
      isOut: false,
      isIn: false,
      isParams: false,
      isThis: false,
      attributes: [],
    };

    for (const child of node.children) {
      switch (child.type) {
        case 'identifier':
          info.name = child.text;
          break;
        case 'attribute_list':
          info.attributes.push(...this.parseAttributeList(child));
          break;
        case 'parameter_modifier':
        case 'modifier':
          if (child.text === 'ref') {info.isRef = true;}
          else if (child.text === 'out') {info.isOut = true;}
          else if (child.text === 'in') {info.isIn = true;}
          else if (child.text === 'params') {info.isParams = true;}
          else if (child.text === 'this') {info.isThis = true;}
          break;
        case 'predefined_type':
        case 'generic_name':
        case 'qualified_name':
        case 'nullable_type':
        case 'array_type':
        case 'tuple_type':
          info.type = child.text;
          break;
        case 'equals_value_clause':
          info.defaultValue = child.children.find(c => c.type !== '=')?.text ?? null;
          break;
      }
    }

    return info;
  }

  private parseTypeParameters(node: TreeSitterNode): string[] {
    const params: string[] = [];
    
    for (const child of node.children) {
      if (child.type === 'type_parameter') {
        const name = child.children.find(c => c.type === 'identifier')?.text;
        if (name) {
          params.push(name);
        }
      }
    }
    
    return params;
  }

  private parseBaseList(node: TreeSitterNode): string[] {
    const bases: string[] = [];
    
    for (const child of node.children) {
      if (child.type === 'simple_base_type' || child.type === 'primary_constructor_base_type') {
        const typeName = child.children.find(c => 
          c.type === 'identifier' || c.type === 'generic_name' || c.type === 'qualified_name'
        )?.text;
        if (typeName) {
          bases.push(typeName);
        }
      }
    }
    
    return bases;
  }

  // ============================================
  // Modifier Application
  // ============================================

  private applyModifier(info: CSharpClassInfo, modifier: string): void {
    switch (modifier) {
      case 'public': info.accessibility = 'public'; break;
      case 'private': info.accessibility = 'private'; break;
      case 'protected': info.accessibility = 'protected'; break;
      case 'internal': info.accessibility = 'internal'; break;
      case 'static': info.isStatic = true; break;
      case 'abstract': info.isAbstract = true; break;
      case 'sealed': info.isSealed = true; break;
      case 'partial': info.isPartial = true; break;
    }
  }

  private applyRecordModifier(info: CSharpRecordInfo, modifier: string): void {
    switch (modifier) {
      case 'public': info.accessibility = 'public'; break;
      case 'private': info.accessibility = 'private'; break;
      case 'protected': info.accessibility = 'protected'; break;
      case 'internal': info.accessibility = 'internal'; break;
      case 'sealed': info.isSealed = true; break;
      case 'abstract': info.isAbstract = true; break;
      case 'partial': info.isPartial = true; break;
    }
  }

  private applyStructModifier(info: CSharpStructInfo, modifier: string): void {
    switch (modifier) {
      case 'public': info.accessibility = 'public'; break;
      case 'private': info.accessibility = 'private'; break;
      case 'protected': info.accessibility = 'protected'; break;
      case 'internal': info.accessibility = 'internal'; break;
      case 'readonly': info.isReadonly = true; break;
      case 'ref': info.isRef = true; break;
      case 'partial': info.isPartial = true; break;
    }
  }

  private applyInterfaceModifier(info: CSharpInterfaceInfo, modifier: string): void {
    switch (modifier) {
      case 'public': info.accessibility = 'public'; break;
      case 'private': info.accessibility = 'private'; break;
      case 'protected': info.accessibility = 'protected'; break;
      case 'internal': info.accessibility = 'internal'; break;
      case 'partial': info.isPartial = true; break;
    }
  }

  private applyMethodModifier(info: CSharpMethodInfo, modifier: string): void {
    switch (modifier) {
      case 'public': info.accessibility = 'public'; break;
      case 'private': info.accessibility = 'private'; break;
      case 'protected': info.accessibility = 'protected'; break;
      case 'internal': info.accessibility = 'internal'; break;
      case 'static': info.isStatic = true; break;
      case 'async': info.isAsync = true; break;
      case 'virtual': info.isVirtual = true; break;
      case 'override': info.isOverride = true; break;
      case 'abstract': info.isAbstract = true; break;
      case 'sealed': info.isSealed = true; break;
      case 'extern': info.isExtern = true; break;
      case 'partial': info.isPartial = true; break;
    }
  }

  private applyPropertyModifier(info: CSharpPropertyInfo, modifier: string): void {
    switch (modifier) {
      case 'public': info.accessibility = 'public'; break;
      case 'private': info.accessibility = 'private'; break;
      case 'protected': info.accessibility = 'protected'; break;
      case 'internal': info.accessibility = 'internal'; break;
      case 'static': info.isStatic = true; break;
      case 'virtual': info.isVirtual = true; break;
      case 'override': info.isOverride = true; break;
      case 'abstract': info.isAbstract = true; break;
      case 'required': info.isRequired = true; break;
    }
  }

  private applyFieldModifier(info: CSharpFieldInfo, modifier: string): void {
    switch (modifier) {
      case 'public': info.accessibility = 'public'; break;
      case 'private': info.accessibility = 'private'; break;
      case 'protected': info.accessibility = 'protected'; break;
      case 'internal': info.accessibility = 'internal'; break;
      case 'static': info.isStatic = true; break;
      case 'readonly': info.isReadonly = true; break;
      case 'const': info.isConst = true; break;
      case 'volatile': info.isVolatile = true; break;
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  private findNodesOfType(node: TreeSitterNode, type: string, callback: (node: TreeSitterNode) => void): void {
    if (node.type === type) {
      callback(node);
    }
    for (const child of node.children) {
      this.findNodesOfType(child, type, callback);
    }
  }

  private isUpperCase(char: string): boolean {
    return char === char.toUpperCase() && char !== char.toLowerCase();
  }
}
