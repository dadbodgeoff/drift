/**
 * Java Type Mapping
 *
 * Maps Java types to contract types for FE↔BE matching.
 * Used by Spring MVC contract detection to normalize types.
 *
 * @module types/java-type-mapping
 */

// ============================================
// Type Map Constants
// ============================================

/**
 * Map Java primitive and common types to contract types.
 */
export const JAVA_TYPE_MAP: Record<string, string> = {
  // Primitive types
  'byte': 'number',
  'short': 'number',
  'int': 'number',
  'long': 'number',
  'float': 'number',
  'double': 'number',
  'boolean': 'boolean',
  'char': 'string',

  // Boxed primitives
  'Byte': 'number',
  'Short': 'number',
  'Integer': 'number',
  'Long': 'number',
  'Float': 'number',
  'Double': 'number',
  'Boolean': 'boolean',
  'Character': 'string',

  // String types
  'String': 'string',
  'CharSequence': 'string',
  'StringBuilder': 'string',
  'StringBuffer': 'string',

  // Numeric types
  'BigDecimal': 'number',
  'BigInteger': 'number',
  'Number': 'number',
  'AtomicInteger': 'number',
  'AtomicLong': 'number',

  // Date/Time types (serialized as ISO strings)
  'Date': 'string',
  'LocalDate': 'string',
  'LocalDateTime': 'string',
  'LocalTime': 'string',
  'ZonedDateTime': 'string',
  'OffsetDateTime': 'string',
  'OffsetTime': 'string',
  'Instant': 'string',
  'Duration': 'string',
  'Period': 'string',
  'Year': 'number',
  'YearMonth': 'string',
  'MonthDay': 'string',
  'Calendar': 'string',
  'Timestamp': 'string',

  // UUID
  'UUID': 'string',

  // Void types
  'void': 'void',
  'Void': 'void',

  // Object types
  'Object': 'any',
  'JsonNode': 'any',
  'ObjectNode': 'object',
  'ArrayNode': 'array',

  // Byte arrays (typically base64 encoded)
  'byte[]': 'string',
  'Byte[]': 'string',

  // File types
  'MultipartFile': 'file',
  'File': 'file',
  'InputStream': 'file',
  'Resource': 'file',
};

/**
 * Collection type patterns that map to 'array'.
 */
export const JAVA_COLLECTION_TYPES = [
  'List',
  'ArrayList',
  'LinkedList',
  'Set',
  'HashSet',
  'LinkedHashSet',
  'TreeSet',
  'Collection',
  'Iterable',
  'Stream',
  'Queue',
  'Deque',
  'Vector',
];

/**
 * Map type patterns that map to 'object'.
 */
export const JAVA_MAP_TYPES = [
  'Map',
  'HashMap',
  'LinkedHashMap',
  'TreeMap',
  'ConcurrentHashMap',
  'Hashtable',
  'Properties',
];

// ============================================
// Type Mapping Functions
// ============================================

/**
 * Map a Java type to a contract type.
 *
 * Handles:
 * - Primitive and boxed types
 * - Generic collections (List<T>, Set<T>, etc.)
 * - Maps (Map<K,V>)
 * - Optional<T>
 * - ResponseEntity<T>
 * - Page<T> (Spring Data)
 * - Arrays
 *
 * @param javaType - The Java type string
 * @returns The mapped contract type
 */
export function mapJavaType(javaType: string): string {
  if (!javaType) {return 'unknown';}

  // Clean up whitespace
  const cleanType = javaType.trim();

  // Handle nullable types (remove trailing ?)
  const baseType = cleanType.replace(/\?$/, '');

  // Handle arrays (Type[])
  if (baseType.endsWith('[]')) {
    return 'array';
  }

  // Handle Optional<T>
  const optionalMatch = baseType.match(/^Optional<(.+)>$/);
  if (optionalMatch?.[1]) {
    const innerType = mapJavaType(optionalMatch[1]);
    return `${innerType} | null`;
  }

  // Handle ResponseEntity<T> - unwrap to inner type
  const responseEntityMatch = baseType.match(/^ResponseEntity<(.+)>$/);
  if (responseEntityMatch?.[1]) {
    return mapJavaType(responseEntityMatch[1]);
  }

  // Handle HttpEntity<T> - unwrap to inner type
  const httpEntityMatch = baseType.match(/^HttpEntity<(.+)>$/);
  if (httpEntityMatch?.[1]) {
    return mapJavaType(httpEntityMatch[1]);
  }

  // Handle Page<T> (Spring Data pagination)
  const pageMatch = baseType.match(/^Page<(.+)>$/);
  if (pageMatch) {
    // Page has content array + pagination metadata
    return 'object';
  }

  // Handle Slice<T> (Spring Data)
  const sliceMatch = baseType.match(/^Slice<(.+)>$/);
  if (sliceMatch) {
    return 'object';
  }

  // Handle Mono<T> and Flux<T> (WebFlux reactive types)
  const monoMatch = baseType.match(/^Mono<(.+)>$/);
  if (monoMatch?.[1]) {
    return mapJavaType(monoMatch[1]);
  }

  const fluxMatch = baseType.match(/^Flux<(.+)>$/);
  if (fluxMatch) {
    return 'array';
  }

  // Handle CompletableFuture<T>
  const futureMatch = baseType.match(/^(?:CompletableFuture|Future|ListenableFuture)<(.+)>$/);
  if (futureMatch?.[1]) {
    return mapJavaType(futureMatch[1]);
  }

  // Handle collection types (List<T>, Set<T>, etc.)
  for (const collectionType of JAVA_COLLECTION_TYPES) {
    const collectionMatch = baseType.match(new RegExp(`^${collectionType}<(.+)>$`));
    if (collectionMatch) {
      return 'array';
    }
  }

  // Handle map types (Map<K,V>, etc.)
  for (const mapType of JAVA_MAP_TYPES) {
    const mapMatch = baseType.match(new RegExp(`^${mapType}<.+,.+>$`));
    if (mapMatch) {
      return 'object';
    }
  }

  // Handle raw collection types without generics
  if (JAVA_COLLECTION_TYPES.includes(baseType)) {
    return 'array';
  }

  if (JAVA_MAP_TYPES.includes(baseType)) {
    return 'object';
  }

  // Direct mapping from type map
  if (JAVA_TYPE_MAP[baseType]) {
    return JAVA_TYPE_MAP[baseType];
  }

  // Handle generic types we don't recognize - return the base type name in lowercase
  // This allows custom DTOs to be identified
  const genericMatch = baseType.match(/^(\w+)<.+>$/);
  if (genericMatch?.[1]) {
    return genericMatch[1].toLowerCase();
  }

  // Return the type name in lowercase for custom types (DTOs, etc.)
  return baseType.toLowerCase();
}

/**
 * Extract the inner type from a generic type.
 *
 * @param javaType - The Java type string (e.g., "List<User>")
 * @returns The inner type or null if not generic
 */
export function extractGenericType(javaType: string): string | null {
  const match = javaType.match(/<(.+)>$/);
  return match?.[1] ?? null;
}

/**
 * Check if a Java type is a collection type.
 *
 * @param javaType - The Java type string
 * @returns True if the type is a collection
 */
export function isCollectionType(javaType: string): boolean {
  const baseType = javaType.replace(/<.+>$/, '');
  return JAVA_COLLECTION_TYPES.includes(baseType) || javaType.endsWith('[]');
}

/**
 * Check if a Java type is a map type.
 *
 * @param javaType - The Java type string
 * @returns True if the type is a map
 */
export function isMapType(javaType: string): boolean {
  const baseType = javaType.replace(/<.+>$/, '');
  return JAVA_MAP_TYPES.includes(baseType);
}

/**
 * Check if a Java type is Optional.
 *
 * @param javaType - The Java type string
 * @returns True if the type is Optional
 */
export function isOptionalType(javaType: string): boolean {
  return javaType.startsWith('Optional<');
}

/**
 * Check if a Java type is a wrapper type (ResponseEntity, HttpEntity, etc.).
 *
 * @param javaType - The Java type string
 * @returns True if the type is a wrapper
 */
export function isWrapperType(javaType: string): boolean {
  return (
    javaType.startsWith('ResponseEntity<') ||
    javaType.startsWith('HttpEntity<') ||
    javaType.startsWith('Mono<') ||
    javaType.startsWith('Flux<') ||
    javaType.startsWith('CompletableFuture<') ||
    javaType.startsWith('Future<')
  );
}

/**
 * Unwrap a wrapper type to get the inner type.
 *
 * @param javaType - The Java type string
 * @returns The unwrapped type or the original type if not a wrapper
 */
export function unwrapType(javaType: string): string {
  const wrapperPatterns = [
    /^ResponseEntity<(.+)>$/,
    /^HttpEntity<(.+)>$/,
    /^Mono<(.+)>$/,
    /^CompletableFuture<(.+)>$/,
    /^Future<(.+)>$/,
    /^ListenableFuture<(.+)>$/,
  ];

  for (const pattern of wrapperPatterns) {
    const match = javaType.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return javaType;
}
