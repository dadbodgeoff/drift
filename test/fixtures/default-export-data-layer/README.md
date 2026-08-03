# default-export-data-layer

EW-4. The largest measured parser-gap contributor, as a fixture.

`packages/prisma/index.ts` ends with `export default prisma;` - a default export of an identifier
declared earlier, wrapping no declaration. The extractor recognised default exports only when they
wrapped a declaration, so this emitted no export fact, and `import prisma from "@acme/prisma"` raised
`unresolved_import_symbol` on the importing route.

Measured on cal.com before the fix: 242 such diagnostics against that one file. Because the module is
the *data layer*, the unresolved symbol landed on exactly the import each finding rests on - so after
EW-2 scoped demotion to a finding's own chain, those findings were still withheld and the check still
refused, on edits as small as adding a comment. cal.com refused 3 of 8 ordinary edits for this single
reason; after the fix, 0 of 8.
