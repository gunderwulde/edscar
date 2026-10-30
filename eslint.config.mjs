// Configuración flat de ESLint (ADR-002). Solo TypeScript del workspace, con información de tipos.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
  },
  {
    // tests/verification tiene su propio tsconfig (alias de @edscar/*) para el servicio de tipos.
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts", "apps/*/src/**/*.tsx", "tests/verification/**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
);
