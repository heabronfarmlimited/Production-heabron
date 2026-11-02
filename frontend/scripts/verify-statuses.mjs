#!/usr/bin/env node
/**
 * The status guard, pinned.
 *
 * Run: node --test scripts/verify-statuses.mjs
 *
 * `statusTabs` is the thing standing between a mistyped filter value and a
 * screen that returns 400 instead of data — the failure the Yield
 * Verification page shipped with. A guard that silently stops guarding is
 * worse than none, so its refusals are asserted here rather than assumed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATUS_LABELS, statusTabs, statusValues } from '../src/lib/statuses.js';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the value that broke Yield Verification is refused', () => {
  assert.throws(
    () => statusTabs('yield_verification_status', [['unverified', 'Unverified']]),
    /not a valid status/,
  );
  // And the message says what IS allowed, so the fix is obvious.
  assert.throws(
    () => statusTabs('yield_verification_status', [['unverified', 'Unverified']]),
    /pending, verified, rejected/,
  );
});

test('a label from a different enum is still refused', () => {
  // `disbursed` is real — on financing_status. Being a real word somewhere
  // else is exactly how a wrong value looks right in review.
  assert.throws(() => statusValues('yield_verification_status', ['disbursed']), /not a valid status/);
  assert.throws(() => statusValues('settlement_status', ['disbursed']), /not a valid status/);
});

test("the empty string is allowed — it is the All tab, which filters nothing", () => {
  assert.doesNotThrow(() => statusTabs('user_status', [['', 'All'], ['active', 'Active']]));
});

test('every label of every type is accepted', () => {
  for (const [type, labels] of Object.entries(STATUS_LABELS)) {
    assert.doesNotThrow(
      () => statusValues(type, [...labels]),
      `${type} must accept its own labels`,
    );
  }
});

test('an unknown status type is refused, not quietly waved through', () => {
  assert.throws(() => statusTabs('made_up_status', [['x', 'X']]), /not a known status type/);
});

test('the pairs come back unchanged, so a page can render them', () => {
  const pairs = [['pending', 'Unverified'], ['', 'All']];
  assert.deepEqual(statusTabs('yield_verification_status', pairs), pairs);
  assert.deepEqual(statusValues('user_status', ['active']), ['active']);
});

/**
 * No page may go back to spelling its own status strings.
 *
 * This is the test that outlasts the fix: `statuses.js` only helps the pages
 * that use it, and the original bug was a page that did not.
 */
test('every page that filters on status goes through the guard', () => {
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith('.jsx')) out.push(full);
    }
    return out;
  };

  const offenders = [];
  for (const file of walk(join(frontendRoot, 'src', 'pages'))) {
    const src = readFileSync(file, 'utf8');
    // Does this page send a `status` filter to the API at all?
    if (!/params:\s*\{[^}]*\bstatus\b/.test(src)) continue;
    if (!/from '@\/lib\/statuses'/.test(src)) {
      offenders.push(file.replace(`${frontendRoot}/`, ''));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'these pages filter on status without going through statusTabs/statusValues, '
      + 'so a mistyped value would reach the database again',
  );
});
