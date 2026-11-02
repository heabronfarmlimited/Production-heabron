'use strict';

/**
 * Heabron CoopScore — error translation verification
 * --------------------------------------------------
 * Run with:  node scripts/verify-errors.js
 *
 * The user flow's exception list calls out duplicate registration number as a
 * flow of its own. A 23505 reaching the client as "That record already
 * exists" is true and useless: the agent is looking at a form of fifteen
 * fields and is not told which one collided.
 *
 * These tests pin that a known unique constraint becomes a message naming
 * what to do, plus the `details` ARRAY the app parses into a field error —
 * the array shape matters, because `AppError` only reads `details` when
 * `Array.isArray`, so wrapping it in an object would silently leave the field
 * unmarked.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { errorHandler } = require(path.join(__dirname, '..', 'src', 'middleware', 'error.js'));

function run(err) {
  const res = {};
  res.status = (status) => {
    res._status = status;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  errorHandler(err, { originalUrl: '/agent/cooperatives', method: 'POST' }, res, () => {});
  return { status: res._status, body: res._body };
}

const duplicateRegistration = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "cooperatives_registration_number_key"',
};

test('a duplicate registration number names the field and what to do', () => {
  const { status, body } = run(duplicateRegistration);
  assert.equal(status, 409);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'CONFLICT');
  assert.match(body.error.message, /registration number already exists/i);
  // The agent is told the way out, not just that something clashed.
  assert.match(body.error.message, /open the existing cooperative/i);
});

test('the field error is an ARRAY, which is the only shape the app reads', () => {
  // `AppError` checks `Array.isArray(e.details)`. An object here would leave
  // the input unmarked and the message toast-only.
  const { body } = run(duplicateRegistration);
  assert.ok(Array.isArray(body.error.details));
  assert.deepEqual(body.error.details[0].field, 'registrationNumber');
  assert.ok(body.error.details[0].message.length > 0);
});

test('the field name is the camelCase the form uses, not the column', () => {
  // `applyServerFieldErrors` matches against form paths; `registration_number`
  // would match nothing and the error would vanish.
  const { body } = run(duplicateRegistration);
  assert.equal(body.error.details[0].field, 'registrationNumber');
});

test('the constraint name is read from PostgREST message text', () => {
  // Postgres puts it in `constraint`, but PostgREST often passes it through
  // only inside the message, so both routes must work.
  const fromField = run({ code: '23505', constraint: 'cooperatives_registration_number_key' });
  assert.match(fromField.body.error.message, /registration number/i);

  const fromDetails = run({
    code: '23505',
    details: 'Key (registration_number)=(RC-1) already exists. unique constraint "cooperatives_registration_number_key"',
  });
  assert.match(fromDetails.body.error.message, /registration number/i);
});

test('an unknown unique constraint keeps the generic conflict message', () => {
  // Better a true generic message than a confidently wrong specific one.
  const { status, body } = run({
    code: '23505',
    message: 'duplicate key value violates unique constraint "some_table_some_col_key"',
  });
  assert.equal(status, 409);
  assert.equal(body.error.message, 'That record already exists');
  assert.equal(body.error.details, undefined);
});

test('a second main farm explains the promote path instead of the constraint', () => {
  const { status, body } = run({
    code: '23505',
    constraint: 'uq_farm_profiles_one_primary',
  });
  assert.equal(status, 409);
  assert.match(body.error.message, /already has a main farm/i);
  assert.match(body.error.message, /promote/i);
});

test('a duplicate active consent says to withdraw the old one first', () => {
  const { body } = run({ code: '23505', constraint: 'uq_consent_one_active' });
  assert.match(body.error.message, /withdraw/i);
});

test('other Postgres codes still map as before', () => {
  assert.equal(run({ code: '23503' }).status, 409);
  assert.equal(run({ code: '23502' }).status, 400);
  assert.equal(run({ code: 'PGRST116' }).status, 404);
  assert.equal(run({ code: '42501' }).status, 403);
});

test('an ordinary crash is still a 500 and leaks nothing', () => {
  const { status, body } = run(new Error('connection reset by peer'));
  assert.equal(status, 500);
  assert.equal(body.error.message, 'Something went wrong');
  // The real message stays in the logs, not in the response.
  assert.equal(JSON.stringify(body).includes('connection reset'), false);
});

test('an upload that is too large is a 413, not a crash', () => {
  // Part of the same exception family: an agent on a field connection
  // uploading ten farm photos needs to be told the file is too big.
  const { status, body } = run({ code: 'LIMIT_FILE_SIZE' });
  assert.equal(status, 413);
  assert.match(body.error.message, /too large/i);
});
