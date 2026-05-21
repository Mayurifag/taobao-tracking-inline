import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        CSS: "readonly",
        NodeFilter: "readonly",
        document: "readonly",
        fetch: "readonly",
        HTMLElement: "readonly",
        localStorage: "readonly",
        MutationObserver: "readonly",
        requestAnimationFrame: "readonly",
        requestIdleCallback: "readonly",
        TextDecoder: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { caughtErrorsIgnorePattern: "^_" }],
    },
  },
];
