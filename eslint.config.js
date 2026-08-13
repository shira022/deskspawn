// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/coverage/",
      "**/projects/",
      "**/workspace/",
      "eslint.config.js",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.ts",
      // Playwright specs are not React code — react-hooks rules do not apply
      "e2e/",
    ],
  },
  {
    // React apps + shared packages
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["apps/web/src/**/*.{ts,tsx}", "apps/desktop/src/**/*.{ts,tsx}", "packages/shared/src/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}", "packages/ai-core/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/gating": "warn",
      "react-hooks/config": "warn",

      "no-constant-condition": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-constant-binary-expression": "warn",
      "preserve-caught-error": "warn",
    },
  },
  {
    // Bun sidecar (non-React TypeScript)
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["apps/desktop/sidecar/src/**/*.ts", "apps/desktop/sidecar/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
    },
  },
);
