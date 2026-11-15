// Write src/styles/tokens.css from src/tokens/index.ts.  Run: npm run tokens -w @drift/ui
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tokensCss } from "../src/tokens/css.ts";

const out = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
writeFileSync(out, tokensCss());
console.log("wrote", out);
