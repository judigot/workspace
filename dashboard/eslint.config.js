import reactRefresh from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noTypeAssertion from 'eslint-plugin-no-type-assertion';
import react from 'eslint-plugin-react';

import { defineConfig, globalIgnores } from 'eslint/config';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// prettier-ignore
const isNextJs = (() => { try { const p = require(`${process.cwd()}/package.json`); return ( 'next' in (p.dependencies ?? {}) || 'next' in (p.devDependencies ?? {}) || [ 'next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs', ].some((f) => require('fs').existsSync(f)) ); } catch { return false; } })();
// prettier-ignore
const nextConfigs = (() => { if (!isNextJs) return []; try { const nextVitals = require('eslint-config-next/core-web-vitals'); const nextTs = require('eslint-config-next/typescript'); return [...nextVitals, ...nextTs]; } catch { return []; } })();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig([
  globalIgnores([
    // Default ignores of eslint-config-next:
    '**/dist',
    '**/eslint.config.js',
    '**/vite.config.ts',
    '**/vitest.config.ts',
    '**/tailwind.config.js',
    '**/postcss.config.js',
    '**/vitest.setup.ts',
    '**/docs',

    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',

    '**/api',
    '**/src/files',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'no-type-assertion': noTypeAssertion,
      'react-hooks': reactHooks,
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      ...(() =>
        isNextJs
          ? [reactRefresh.configs.next]
          : [
              importPlugin.flatConfigs.recommended,
              reactRefresh.configs.vite,
            ])(),
    ],

    languageOptions: {
      globals: {
        ...globals.browser,

        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        test: 'readonly',
        vi: 'readonly',
      },

      parser: tseslint.parser,
      ecmaVersion: 12,
      sourceType: 'module',

      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },

        project: [
          './tsconfig.json',
          ...(() => {
            if (!isNextJs) {
              return ['./tsconfig.app.json', './tsconfig.node.json'];
            }
            return [];
          })(),
        ],
        tsconfigRootDir: __dirname,
      },
    },

    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['./tsconfig.json'],
        },
      },
    },

    rules: {
      'import/extensions': [
        'error',
        'ignorePackages', // Always require extensions in imports
        {
          ts: 'always', // Always require .ts extension for TypeScript files
          tsx: 'always', // Always require .tsx extension for React files
          index: 'never',
        },
      ],
      curly: ['error', 'all'],
      'no-type-assertion/no-type-assertion': 'error',
      'object-shorthand': ['error', 'always'],

      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Enums are not allowed. Use object literals instead.',
        },
      ],

      'no-alert': ['error'],

      'no-console': [
        'error',
        {
          allow: ['warn', 'error'],
        },
      ],

      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': ['error'],

      'no-unused-vars': 'off', // Disable this base rule in favor of @typescript-eslint/no-unused-vars (recommended)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      'react/jsx-props-no-spreading': 'error',

      'react/jsx-filename-extension': [
        1,
        {
          extensions: ['.tsx'],
        },
      ],

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react/jsx-pascal-case': 'error',

      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'function',
          modifiers: ['exported'],
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'class',
          format: ['PascalCase'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'interface',
          format: ['PascalCase'],
          prefix: ['I'],
        },
      ],
    },
  },
  ...nextConfigs,
]);
