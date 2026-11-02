#!/usr/bin/env node
/**
 * CSV export verification.
 *
 * Run: node --test scripts/verify-export-csv.mjs
 *
 * There is no test runner in this package and adding one (vitest, its config,
 * its dependencies) is a bigger change than this needed — so this uses
 * `node:test`, which ships with Node, the same way the backend's verify-*
 * scripts do. `exportPayloadToCsv` is deliberately free of any DOM so it can
 * be imported here directly.
 *
 * Worth testing because a CSV corrupts quietly. A single unquoted comma in a
 * cooperative's address shifts every column after it, and the numbers still
 * look plausible in the spreadsheet an admin then sends to a lender.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { exportPayloadToCsv, exportFilename } from '../src/lib/exportCsv.js';

const lines = (csv) => csv.split('\r\n');

test('every cell is quoted, so a comma in a name cannot shift columns', () => {
  const csv = exportPayloadToCsv({
    tables: {
      farmers: [{ name: 'Nwosu, Ada', lga: 'Oju' }],
    },
  });
  assert.match(csv, /"Nwosu, Ada","Oju"/);
});

test('a quote inside a value is escaped by doubling', () => {
  // Otherwise the field terminates early and the rest of the row becomes
  // columns of its own.
  const csv = exportPayloadToCsv({
    tables: { notes: [{ note: 'He said "the harvest failed"' }] },
  });
  assert.match(csv, /"He said ""the harvest failed"""/);
});

test('a newline inside a value stays inside its quoted field', () => {
  const csv = exportPayloadToCsv({
    tables: { notes: [{ note: 'line one\nline two' }] },
  });
  assert.ok(csv.includes('"line one\nline two"'));
});

test('columns are the union of all rows, not just the first', () => {
  // A row missing an optional field would otherwise shift every later
  // column — the failure mode that makes a CSV wrong rather than broken.
  const csv = exportPayloadToCsv({
    tables: {
      farmers: [
        { name: 'Ada' },
        { name: 'Bio', phone: '08030000000' },
      ],
    },
  });
  const rows = lines(csv);
  const header = rows.find((l) => l.includes('Name'));
  assert.match(header, /"Name","Phone"/);
  // Ada has no phone, so her row must still carry an empty second column.
  assert.ok(rows.some((l) => l === '"Ada",""'));
});

test('nulls, booleans and arrays render readably', () => {
  const csv = exportPayloadToCsv({
    tables: {
      rows: [{ missing: null, flag: true, off: false, crops: ['maize', 'yam'] }],
    },
  });
  assert.match(csv, /"","Yes","No","maize; yam"/);
});

test('an empty table says so rather than vanishing', () => {
  // A heading with nothing under it tells an admin the export ran and the
  // table is empty; omitting it looks like the export failed.
  const csv = exportPayloadToCsv({ tables: { repayments: [] } });
  assert.match(csv, /"Repayments"/);
  assert.match(csv, /"\(no rows\)"/);
});

test('summary groups come before the tables', () => {
  const csv = exportPayloadToCsv({
    counts: { farmers: 12 },
    tables: { farmers: [{ name: 'Ada' }] },
  });
  const rows = lines(csv);
  assert.ok(
    rows.findIndex((l) => l.includes('Counts')) <
      rows.findIndex((l) => l.includes('"Farmers"')),
  );
});

test('a nested summary group is flattened one level, not dumped as JSON', () => {
  // `financing: { pending: 3, approved: 1 }` as JSON in a cell is unreadable
  // in a spreadsheet, which is the only place this file is ever opened.
  const csv = exportPayloadToCsv({
    totals: { financing: { pending: 3, approved: 1 } },
  });
  assert.match(csv, /"Financing — Pending","3"/);
  assert.match(csv, /"Financing — Approved","1"/);
  assert.equal(csv.includes('{'), false);
});

test('camelCase keys become readable headings', () => {
  const csv = exportPayloadToCsv({ tables: { rows: [{ farmSizeAcres: 2 }] } });
  assert.match(csv, /"Farm Size Acres"/);
});

test('a malformed payload produces an empty file, not a crash', () => {
  // The export endpoints are shaped differently from each other, and a
  // thrown error inside a click handler would leave the button spinning.
  for (const payload of [null, undefined, {}, { tables: null }, []]) {
    assert.doesNotThrow(() => exportPayloadToCsv(payload));
  }
});

test('the filename is safe, dated and not endless', () => {
  const name = exportFilename('farmer', 'Nwosu, Ada — Oju/Benue');
  assert.match(name, /^heabron-farmer-nwosu-ada-oju-benue-\d{4}-\d{2}-\d{2}\.csv$/);
  // No path separators or quotes could survive into a filename.
  assert.equal(/[/\\"']/.test(name), false);
});

test('a nameless export still gets a usable filename', () => {
  assert.match(exportFilename('agent', ''), /^heabron-agent-agent-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.match(exportFilename('agent', null), /^heabron-agent-agent-/);
});
