import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "api/**",
    "node_modules/**",
    "research_notes/**",
    "reports/**",
    "public/**",
    // Vendored beUI components (copied from https://beui.dev); kept as published so updates stay easy.
    "src/components/beui/**",
  ]),
]);

export default eslintConfig;
