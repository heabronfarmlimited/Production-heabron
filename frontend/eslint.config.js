import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint flat config (ESLint 9).
 *
 * `package.json` declared eslint, eslint-plugin-react and
 * eslint-plugin-react-hooks, and defined a `lint` script — but the repository
 * contained no config file, so `npm run lint` failed with "couldn't find an
 * eslint.config.js" and the linter had never actually run.
 *
 * The emphasis here is on rules that catch bugs rather than style:
 *   - react-hooks/rules-of-hooks   a conditional hook is a real crash
 *   - react-hooks/exhaustive-deps  stale closures over query params / ids
 *   - no-undef                     a used-but-unimported identifier is a
 *                                  runtime ReferenceError that Vite's build
 *                                  does NOT catch, because Rollup only
 *                                  resolves imports it can see
 *
 * Formatting is left to Prettier. JSX-specific stylistic rules are off.
 */

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  Image: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  MutationObserver: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  structuredClone: 'readonly',
  process: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', 'coverage/**', '*.config.js'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      ...react.configs.flat.recommended.rules,

      // --- bugs ---
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
      }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-self-compare': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-constant-binary-expression': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // Vite's JSX transform needs neither import in scope.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // This codebase does not use propTypes; it is a TypeScript-free app and
      // the shapes come from the API, so propTypes would be duplicated guesses.
      'react/prop-types': 'off',

      // --- hygiene ---
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
