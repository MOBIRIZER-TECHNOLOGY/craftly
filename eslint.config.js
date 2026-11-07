import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * What the linter looks for: mistakes that the tests and the compiler do not see (unused code, hooks used wrongly, the
 * dependencies of an effect, markup that a keyboard or a screen reader cannot use). Formatting is Prettier's job
 * (`.prettierrc.json`). `npm run lint` fails on an error and on a warning, so a finding is fixed, or switched off at the place
 * where it is meant, with the reason after `--`.
 */

// An underscore marks a name that is there on purpose and not used (a callback's argument, a destructured field).
const unused = ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }];

// A container that only listens to keys, which bubble up from the focusable controls inside it, is how the composite widgets
// here (tab lists, option lists, the page strip) move focus with the arrow keys. It is not an interactive element itself, so
// only handlers of the pointer count for the two rules below.
const pointerHandlers = ["onClick", "onMouseDown", "onMouseUp"];

export default defineConfig([
  globalIgnores(["dist/", "dist-*/", "coverage/", "node_modules/", "reports/", "research_notes/", "docs/images/"]),

  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs,ts,tsx}"],
    // best-effort work (storage, a browser step that may not be there) ends in `catch {}` on purpose
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },

  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: { "@typescript-eslint/no-unused-vars": unused },
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    rules: { "no-unused-vars": unused },
  },

  {
    // the app: a browser, React, and markup that has to work with a keyboard and a screen reader (the tests are not checked for the latter)
    files: ["src/**/*.{ts,tsx}"],
    extends: [jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // `autoFocus` on one of our own components moves the focus into a dialog's field on purpose (docs/ACCESSIBILITY.md); a bare
      // <input autoFocus> is what the rule is about
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
      "jsx-a11y/no-static-element-interactions": ["error", { handlers: pointerHandlers, allowExpressionValues: true }],
      "jsx-a11y/no-noninteractive-element-interactions": ["error", { handlers: pointerHandlers }],
      // a region that scrolls has to be reachable by a keyboard (WCAG 2.1.1), and the design canvas is a named stop of the tab order
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel", "region", "group"] }],
    },
  },
  {
    // the tests hold stand-in markup
    files: ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    rules: Object.fromEntries(Object.keys(jsxA11y.rules).map((name) => [`jsx-a11y/${name}`, "off"])),
  },
  {
    // the harness and the tests run in Node or jsdom and stand in for the browser
    files: ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    // the browser journeys and the scripts: Node, and code that runs in the page
    files: ["e2e/**/*.cjs", "scripts/**/*.mjs", "*.config.{js,ts}", "vite.*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },

  {
    // the service worker
    files: ["public/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
]);
