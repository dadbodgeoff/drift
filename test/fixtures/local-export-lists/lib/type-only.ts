// `export type { ... }` is erased at compile time, exactly like `import type`. Emitting a runtime
// export for it would claim a value the module does not have at runtime.
type Delta = { value: string };

export type { Delta };
