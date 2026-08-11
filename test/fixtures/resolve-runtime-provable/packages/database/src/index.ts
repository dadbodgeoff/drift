// A direct export plus an `export *` chain: the direct export makes the file's export set
// "known" to the engine, which is exactly the condition under which the conservative
// unresolved_import_symbol diagnostic used to fire for symbols that arrive via the chain.
export const DATABASE_VERSION = "1";

export * from "./client";
