// Lint for the JavaScript workspace (packages/ui, apps/studio).
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import boundaries from "./apps/studio/eslint/boundaries.js";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-fixture/**", "**/dist-electron/**", "**/node_modules/**", "**/fixtures/**", "**/.local-work/**", "target/**", "npm/**", "eval/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, studio: boundaries },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Repository and transcript text is untrusted: never as HTML.
      "no-restricted-syntax": [
        "error",
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "Untrusted content must be rendered as text." },
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: "Untrusted content must be rendered as text." },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Untrusted content must be rendered as text." },
      ],
      "no-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    files: ["apps/studio/src/**/*.{ts,tsx}"],
    rules: { "studio/boundaries": "error" },
  },
);
