#!/usr/bin/env node
/**
 * Is package-lock.json in sync with package.json?
 *
 * Run: node scripts/check-lockfile.mjs
 *
 * WHY
 *
 * EAS installs dependencies with `npm ci`, which refuses to run at all when
 * the lock does not match package.json — it does not resolve, it does not
 * fall back to `npm install`, it exits:
 *
 *   npm error `npm ci` can only install packages when your package.json and
 *   npm error package-lock.json ... are in sync.
 *   npm error Missing: typescript@7.0.2 from lock file
 *
 * That is a build failure: queue, spin-up, install, fail — minutes gone,
 * before a single line of the app is compiled. And it is invisible locally,
 * because `npm install` and `expo start` both happily repair the lock as they
 * go. The only thing that notices is the builder.
 *
 * So this runs the builder's own check — `npm ci --dry-run`, which resolves
 * the full tree and touches nothing — before the build is submitted.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bar = '─'.repeat(70);

const fail = (msg) => {
  console.error(`\n${bar}\n${msg}\n${bar}\n`);
  // Not process.exit(): on Windows, exiting while a handle is closing trips a
  // libuv assertion that prints after the message and looks like a crash.
  process.exitCode = 1;
};

if (!existsSync(join(root, 'package-lock.json'))) {
  fail(
    'There is no package-lock.json.\n\n' +
      'EAS installs with `npm ci`, which cannot run without one. Run `npm install`\n' +
      'and make sure the lock file is committed.',
  );
} else {
  console.log(`\n${bar}\nchecking  : package-lock.json against package.json\n${bar}`);

  /**
   * `npm ci --dry-run` is the real check, not an approximation: it is the
   * same code path the builder runs, minus the writing. On Windows npm is a
   * .cmd shim, hence `shell: true`.
   */
  const res = spawnSync(
    'npm',
    ['ci', '--include=dev', '--dry-run', '--no-audit', '--no-fund'],
    { cwd: root, encoding: 'utf8', shell: true },
  );

  if (res.status === 0) {
    console.log('  OK — the lock file matches package.json');
    console.log(`${bar}\n`);
  } else {
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    // The useful part is the "Missing:" / "Invalid:" lines; the rest is the
    // usage block npm prints after an EUSAGE error.
    const detail = out
      .split('\n')
      .filter((l) => /npm error (Missing|Invalid|Added|Removed)|can only install/.test(l))
      .slice(0, 12)
      .join('\n');

    fail(
      'package-lock.json is NOT in sync with package.json.\n\n' +
        (detail || out.slice(0, 600)) +
        '\n\nEAS installs with `npm ci` and would fail on this after queueing and\n' +
        'spinning up a builder. Fix it here instead:\n\n' +
        '    npm install\n\n' +
        'then commit the updated package-lock.json and build again.',
    );
  }
}
