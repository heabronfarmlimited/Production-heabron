'use strict';

/**
 * ESLint flat config (ESLint 9).
 *
 * The project declared `eslint: ^9.0.0` but shipped no config file, so
 * `npm run lint` failed with "couldn't find an eslint.config.js" and the
 * linter had effectively never run. This is the missing config.
 *
 * Globals are listed inline rather than pulled from the `globals` package to
 * avoid adding a dependency for a handful of names.
 */

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  fetch: 'readonly',
  structuredClone: 'readonly',
};

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'docs/**', '.vercel/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // --- correctness: these catch real bugs, so they are errors ---
      'no-unused-vars': ['error', {
        args: 'after-used',
        // Express error middleware must keep its 4-arity signature, and
        // destructured-and-ignored keys are a deliberate idiom.
        argsIgnorePattern: '^(next|_)',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-await-in-loop': 'off', // sequential paging is intentional in places
      'require-atomic-updates': 'error',
      'no-return-await': 'error',
      'no-promise-executor-return': 'error',

      // An empty catch that swallows an error is how the OTP failures stayed
      // invisible, so require at least a comment explaining the intent.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // --- hygiene: warnings, so they never block a deploy ---
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-console': 'off', // scripts/ print to stdout by design
      'consistent-return': 'off',
    },
  },
  {
    // Maintenance scripts are allowed to be chattier and more procedural.
    files: ['scripts/**/*.js'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
