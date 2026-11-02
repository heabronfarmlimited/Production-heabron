#!/usr/bin/env node
'use strict';

/**
 * Enum-valued filters, pinned.
 *
 * Run: node --test scripts/verify-enums.js
 *
 * WHY
 *
 * The admin Yield Verification screen returned 400 on the tab it opens on,
 * for every administrator, from the day it shipped. It sent
 * `?status=unverified`; `seasonal_productions.verification_status` is of type
 * `yield_verification_status`, whose labels are `pending | verified |
 * rejected`. Postgres answers a comparison against a label that does not
 * exist with 22P02, this API mapped that to a flat 400 "A value had the wrong
 * type", and the table under the error rendered "No unverified production
 * records" — which is also exactly what a working, empty list looks like.
 *
 * Three things now stand between that and a repeat, and each is asserted
 * here:
 *
 *   1. every list route's `status` filter is narrowed to the labels of the
 *      column it filters, so a wrong value is a 422 naming the field;
 *   2. a 22P02 that still reaches the error handler is translated into a
 *      message that names the value and the labels allowed;
 *   3. no list route that filters an enum may keep the loose `listQuery`.
 *
 * (3) is the one that matters long term: (1) and (2) only hold while someone
 * remembers to use them, and this test is what remembers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'src', 'validators', 'domain.js'));
const { ENUM_LABELS, parseEnumViolation } = require(path.join(ROOT, 'src', 'utils', 'enums.js'));
const { errorHandler } = require(path.join(ROOT, 'src', 'middleware', 'error.js'));

// ───────────────────────────────────────────── 1. the validators

test('the productions filter rejects the exact value that broke the screen', () => {
  const { error } = v.listQueries.productions.validate({ status: 'unverified' });
  assert.ok(error, 'status=unverified must not reach the query builder');
  assert.match(error.message, /status/);
  // The message has to name what IS allowed, or the next person guesses too.
  assert.match(error.message, /pending/);
});

test('the productions filter accepts every label on its enum, and nothing else', () => {
  for (const label of ENUM_LABELS.yield_verification_status) {
    const { error, value } = v.listQueries.productions.validate({ status: label });
    assert.equal(error, undefined, `${label} must be accepted`);
    assert.equal(value.status, label);
  }
  for (const wrong of ['unverified', 'approved', 'PENDING', 'pending ', 'draft']) {
    assert.ok(v.listQueries.productions.validate({ status: wrong }).error, `${wrong} must be refused`);
  }
});

test('an omitted or empty status is still "no filter", not an error', () => {
  // The "All" tab sends nothing. If `.empty('')` were lost here, that tab
  // would start failing instead of showing everything.
  for (const query of [{}, { status: '' }]) {
    const { error, value } = v.listQueries.productions.validate(query);
    assert.equal(error, undefined);
    assert.equal(value.status, undefined);
  }
});

test('every list endpoint is pinned to the labels of the column it filters', () => {
  const expected = {
    agentApplications: 'user_status',
    agents: 'user_status',
    partners: 'user_status',
    productions: 'yield_verification_status',
    financing: 'financing_status',
    changeRequests: 'change_request_status',
    consent: 'consent_status',
    settlements: 'settlement_status',
    transactions: 'transaction_status',
  };
  assert.deepEqual(Object.keys(v.listQueries).sort(), Object.keys(expected).sort());

  for (const [name, type] of Object.entries(expected)) {
    const schema = v.listQueries[name];
    for (const label of ENUM_LABELS[type]) {
      assert.equal(
        schema.validate({ status: label }).error,
        undefined,
        `${name} must accept ${type} label "${label}"`,
      );
    }
    // A label from a DIFFERENT enum must be refused — otherwise the pinning
    // is decorative. `disbursed` is on financing_status and nothing else.
    const foreign = ['disbursed', 'superseded', 'reversed', 'suspended'].find(
      (l) => !ENUM_LABELS[type].includes(l),
    );
    assert.ok(schema.validate({ status: foreign }).error, `${name} must refuse "${foreign}"`);
  }
});

test('the other list filters survive the narrowing', () => {
  // `.keys()` replaces one key; if it were `Joi.object({status})` instead,
  // pagination and search would be stripped and every list would silently
  // return page 1 of 20 forever.
  const { error, value } = v.listQueries.productions.validate({
    status: 'verified',
    page: '3',
    pageSize: '50',
    search: 'ada',
    crop: 'maize',
  });
  assert.equal(error, undefined);
  assert.equal(value.page, 3);
  assert.equal(value.pageSize, 50);
  assert.equal(value.search, 'ada');
  assert.equal(value.crop, 'maize');
});

test('transactionType is pinned too', () => {
  assert.equal(v.listQuery.validate({ transactionType: 'credit' }).error, undefined);
  assert.ok(v.listQuery.validate({ transactionType: 'withdrawal' }).error);
});

// ───────────────────────────────────────────── 2. the error handler

test('a 22P02 on an enum is reported with the value and the allowed labels', () => {
  const err = {
    code: '22P02',
    message: 'invalid input value for enum yield_verification_status: "unverified"',
  };
  let body = null;
  const res = {
    status() { return this; },
    json(payload) { body = payload; return this; },
  };
  errorHandler(err, { originalUrl: '/admin/productions', method: 'GET' }, res, () => {});

  assert.equal(body.success, false);
  assert.match(body.error.message, /"unverified"/);
  assert.match(body.error.message, /pending, verified, rejected/);
  // Never the old message, which named nothing.
  assert.doesNotMatch(body.error.message, /A value had the wrong type/);
});

test('a 22P02 that is NOT an enum keeps the generic message', () => {
  // A malformed UUID is also 22P02. Claiming an enum problem there would send
  // the next person looking in the wrong place.
  let body = null;
  const res = { status() { return this; }, json(p) { body = p; return this; } };
  errorHandler(
    { code: '22P02', message: 'invalid input syntax for type uuid: "abc"' },
    { originalUrl: '/x', method: 'GET' },
    res,
    () => {},
  );
  assert.match(body.error.message, /A value had the wrong type/);
});

test('parseEnumViolation reads the type and value out of either field', () => {
  assert.deepEqual(
    parseEnumViolation({ message: 'invalid input value for enum consent_status: "live"' }),
    { type: 'consent_status', value: 'live', allowed: ENUM_LABELS.consent_status },
  );
  // PostgREST sometimes carries it in `details` instead.
  assert.equal(
    parseEnumViolation({ details: 'invalid input value for enum user_status: "approved"' })?.value,
    'approved',
  );
  assert.equal(parseEnumViolation({ message: 'something else entirely' }), null);
  assert.equal(parseEnumViolation(null), null);
  // An enum the code does not know about still reports the value, with no
  // invented list of labels.
  assert.equal(parseEnumViolation({ message: 'invalid input value for enum made_up: "x"' })?.allowed, null);
});

// ───────────────────────────────────────────── 3. the routes

/**
 * Which route files may use the loose `v.listQuery`, and which may not.
 *
 * A route is read out of the source rather than mounted, because mounting the
 * app needs Supabase credentials and this has to run in CI without them.
 */
const ROUTE_FILES = ['admin.routes.js', 'agent.routes.js', 'partner.routes.js'];

/** Route paths whose handler filters an enum column from `req.query.status`. */
const MUST_BE_PINNED = {
  'admin.routes.js': {
    '/agent-applications': 'agentApplications',
    '/agents': 'agents',
    '/partners': 'partners',
    '/productions': 'productions',
    '/change-requests': 'changeRequests',
    '/financing-requests': 'financing',
    '/settlements': 'settlements',
    '/cash-purchases': 'transactions',
    '/consent': 'consent',
  },
  'agent.routes.js': {
    '/productions': 'productions',
    '/change-requests': 'changeRequests',
    '/financing-requests': 'financing',
    '/wallet/settlements': 'settlements',
    '/wallet/cash-purchases': 'transactions',
  },
  'partner.routes.js': {
    '/financing-requests': 'financing',
  },
};

test('every route that filters an enum uses the pinned validator', () => {
  for (const file of ROUTE_FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', file), 'utf8');
    for (const [route, validator] of Object.entries(MUST_BE_PINNED[file])) {
      const line = src
        .split('\n')
        .find((l) => l.includes(`router.get('${route}'`));
      assert.ok(line, `${file}: no GET ${route}`);
      assert.ok(
        line.includes(`v.listQueries.${validator}`),
        `${file} GET ${route} must validate with v.listQueries.${validator}, not the loose listQuery`,
      );
    }
  }
});

/**
 * The guard that catches the NEXT one.
 *
 * If a controller starts reading `status` off the query string, this test
 * fails until the route feeding it is added above with the right enum. The
 * alternative — remembering — is what produced the original bug.
 */
test('no controller reads a status filter without a route pinned for it', () => {
  const controllers = path.join(ROOT, 'src', 'controllers');
  const reading = [];
  for (const file of fs.readdirSync(controllers)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(controllers, file), 'utf8');
    // `const { status } = req.query` / `req.query.status`
    if (/\{[^}]*\bstatus\b[^}]*\}\s*=\s*req\.query/.test(src) || /req\.query\.status/.test(src)) {
      reading.push(file);
    }
  }
  const known = [
    'admin.agents.controller.js',
    'admin.partners.controller.js',
    'admin.wallet.controller.js',
    'changeRequests.controller.js',
    'consent.controller.js',
    'financing.controller.js',
    'productions.controller.js',
    'wallet.controller.js',
  ];
  assert.deepEqual(
    reading.sort(),
    known.sort(),
    'a controller started (or stopped) filtering on status — add its route to MUST_BE_PINNED above with the enum of the column it filters',
  );
});
