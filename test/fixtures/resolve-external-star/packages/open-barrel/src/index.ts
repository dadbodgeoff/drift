// An OPEN export chain: the star target is an external npm package the scan cannot see into.
// The direct export makes this file's export set "known" to the engine - exactly the condition
// under which the conservative unresolved_import_symbol diagnostic is tempted to fire for any
// name it cannot find. With an unresolvable star, absence is unprovable: the symbol may well
// exist inside some-npm-pkg.
export const OPEN_BARREL_VERSION = "1";

export * from "some-npm-pkg";
