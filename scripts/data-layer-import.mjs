/**
 * How a repo's routes import its data layer, as a source line.
 *
 * EW-4 uncovered why this has to be per repo rather than assumed. papermark's `lib/prisma.ts`
 * contains only `export default prisma;`, and all 204 of its real routes write
 * `import prisma from "@/lib/prisma"`. The harnesses injected the named form,
 * `import { prisma } from "@/lib/prisma"`, which names a symbol that module does not have and would
 * not compile - yet it passed, because the extractor recognised default exports only when they
 * wrapped a declaration. The module therefore appeared to export nothing at all, symbol resolution
 * was skipped, and nothing objected.
 *
 * Once the extractor learned about `export default <identifier>`, the engine correctly reported the
 * injected import as unresolved and the check correctly withheld a finding whose own import could not
 * be placed. The fixture was wrong all along; the bug had been covering for it. An injection that
 * does not compile in the repo it is injected into cannot measure anything about that repo.
 */

/** The import statement, in whichever form the repo actually uses. */
export function dataLayerImport(cfg, { symbol = cfg.dataSymbol, module = cfg.dataModule } = {}) {
  return cfg.dataImportKind === "default"
    ? `import ${symbol} from "${module}";`
    : `import { ${symbol} } from "${module}";`;
}

/** The same, for an arbitrary specifier - the negative controls import lookalikes and subpaths. */
export function importOf(cfg, module, symbol = cfg.dataSymbol) {
  return dataLayerImport(cfg, { module, symbol });
}
