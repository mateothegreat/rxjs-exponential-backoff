// import * as espree from "espree";
import tseslintParser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
// TODO: I wasn't able to get the parser for extra files working, but maybe we don't need it?
// import * as tseslintExtraParser from 'typescript-eslint-parser-for-extra-files';
import markdown from "eslint-plugin-markdown";
import globals from "globals";

const ignores = [
  "node_modules/**/*",
  "dist/**/*",
  ".env*",
  "pnpm-lock.yaml",
  "package-lock.json",
  ".pnpm-store/**/*"
];

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
  ...tseslint.configs.strict,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  ...markdown.configs.recommended,
  {
    ignores
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      globals: {
        $bindable: "readonly",
        ...globals.node,
        ...globals.es6
      }
    }
  },
  // Configure typescript-eslint-parser for typescript.
  {
    files: ["*.ts", "*.tsx"],
    ignores,
    languageOptions: {
      sourceType: "module",
      parser: tseslintParser,
      // parser: tseslintExtraParser,
      parserOptions: {
        project: "./tsconfig.json"
      }
    }
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off"
    }
  }
);
