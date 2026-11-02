'use strict';

/**
 * Heabron CoopScore — duplicate-safe creation verification
 * --------------------------------------------------------
 * Run with:  node scripts/verify-idempotency.js
 *
 * The v2 flow asks for a "duplicate-safe client UUID" on registration. Two
 * records for one farmer is not a cosmetic problem: it is two credit scores,
 * a wrong cooperative member count, and a lender reading one of the two.
 *
 * The cases that matter are the ones that are easy to get wrong:
 *
 *   - the SECOND request must not create anything, and must be answerable
 *     with the row the first one made;
 *   - the side effects must not run again on a replay, or one farmer ends up
 *     with three "farmer onboarded" entries in the audit log;
 *   - a concurrent retry that loses the race to the unique index must be
 *     absorbed, not surfaced as a 409;
 *   - a duplicate REGISTRATION NUMBER is also a 23505 and must NOT be
 *     absorbed — that one is a real conflict the agent has to resolve.
 *
 * The Supabase client is faked here: these are the control-flow decisions,
 * and they are the part that breaks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  createOnce,
  findByClientRequestId,
  isClientRequestIdConflict,
} = require(path.join(__dirname, '..', 'src', 'utils', 'idempotency.js'));

const KEY = '3f1c9e74-5a2b-4c8d-9e0f-1a2b3c4d5e6f';

/**
 * A fake `supabaseAdmin()` whose table holds `rows`, recording every select.
 */
function fakeSb(rows = []) {
  const calls = { selects: 0 };
  return {
    calls,
    from() {
      const q = {
        _eq: null,
        select() {
          return q;
        },
        eq(_column, value) {
          q._eq = value;
          return q;
        },
        limit() {
          calls.selects += 1;
          const match = rows.filter((r) => r.client_request_id === q._eq);
          return Promise.resolve({ data: match, error: null });
        },
      };
      return q;
    },
  };
}

// ───────────────────────────────────────────── find

test('a key with no row yet finds nothing, without erroring', async () => {
  const { row, error } = await findByClientRequestId(fakeSb(), 'farmers', KEY);
  assert.equal(row, null);
  assert.equal(error, null);
});

test('no key is not an error and costs no query', async () => {
  // An older app build sends none; creation then proceeds unprotected, as it
  // did before this existed.
  const sb = fakeSb();
  const { row, error } = await findByClientRequestId(sb, 'farmers', undefined);
  assert.equal(row, null);
  assert.equal(error, null);
  assert.equal(sb.calls.selects, 0);
});

// ───────────────────────────────────────────── create once

test('the first request inserts', async () => {
  let inserted = 0;
  const { row, replayed, error } = await createOnce(fakeSb(), 'farmers', KEY, async () => {
    inserted += 1;
    return { data: { id: 'f-1', client_request_id: KEY }, error: null };
  });
  assert.equal(error, null);
  assert.equal(inserted, 1);
  assert.equal(replayed, false);
  assert.equal(row.id, 'f-1');
});

test('the second request inserts nothing and returns the first row', async () => {
  const sb = fakeSb([{ id: 'f-1', client_request_id: KEY, full_name: 'Ada Nwosu' }]);
  let inserted = 0;
  const { row, replayed, error } = await createOnce(sb, 'farmers', KEY, async () => {
    inserted += 1;
    return { data: { id: 'f-2' }, error: null };
  });
  assert.equal(error, null);
  assert.equal(inserted, 0, 'a replay must not insert');
  assert.equal(replayed, true);
  assert.equal(row.id, 'f-1');
});

test('replayed is what tells the caller to skip the side effects', async () => {
  // The notification, the activity log and the score recalculation already
  // ran the first time. Firing them again is how one farmer gets three
  // "onboarded" entries in the audit log.
  const sb = fakeSb([{ id: 'f-1', client_request_id: KEY }]);
  const { replayed } = await createOnce(sb, 'farmers', KEY, async () => ({
    data: null,
    error: null,
  }));
  assert.equal(replayed, true);
});

test('without a key, every call inserts — unchanged behaviour', async () => {
  let inserted = 0;
  for (let i = 0; i < 2; i += 1) {
    await createOnce(fakeSb(), 'farmers', null, async () => {
      inserted += 1;
      return { data: { id: `f-${i}` }, error: null };
    });
  }
  assert.equal(inserted, 2);
});

// ──────────────────────────────────── losing the race to the index

test('a concurrent retry that loses the race is absorbed, not surfaced', async () => {
  // Both retries read "nothing there", then one commits first. The loser's
  // insert is rejected by the unique index; the winner's row is the answer.
  let selectCount = 0;
  const sb = {
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => {
          selectCount += 1;
          // Empty on the pre-insert check, populated on the post-conflict
          // read — which is exactly the race being modelled.
          return Promise.resolve({
            data: selectCount === 1 ? [] : [{ id: 'f-winner', client_request_id: KEY }],
            error: null,
          });
        },
      };
      return q;
    },
  };

  const { row, replayed, error } = await createOnce(sb, 'farmers', KEY, async () => ({
    data: null,
    error: {
      code: '23505',
      constraint: 'uq_farmers_client_request_id',
      message: 'duplicate key value violates unique constraint "uq_farmers_client_request_id"',
    },
  }));

  assert.equal(error, null);
  assert.equal(replayed, true);
  assert.equal(row.id, 'f-winner');
});

test('a conflict whose row cannot be read back surfaces the error', async () => {
  // Rather than invent a success. If the index rejected the insert and the
  // row is not there, something is wrong that the caller must hear about.
  const sb = fakeSb();
  const insertError = {
    code: '23505',
    constraint: 'uq_farmers_client_request_id',
  };
  const { row, error } = await createOnce(sb, 'farmers', KEY, async () => ({
    data: null,
    error: insertError,
  }));
  assert.equal(row, null);
  assert.equal(error, insertError);
});

// ─────────────────────────── which 23505 is a replay, and which is not

test('a duplicate registration number is NOT absorbed as a replay', async () => {
  // It is also a 23505, but it is a real conflict: the agent has to change
  // the number or open the existing cooperative. Swallowing it would make
  // the create silently return the wrong cooperative.
  const regConflict = {
    code: '23505',
    constraint: 'cooperatives_registration_number_key',
    message:
      'duplicate key value violates unique constraint "cooperatives_registration_number_key"',
  };
  assert.equal(isClientRequestIdConflict(regConflict, 'cooperatives'), false);

  const { row, error } = await createOnce(fakeSb(), 'cooperatives', KEY, async () => ({
    data: null,
    error: regConflict,
  }));
  assert.equal(row, null);
  assert.equal(error, regConflict);
});

test('the constraint is recognised from the message when not passed through', () => {
  // PostgREST often drops the structured `constraint` field.
  assert.equal(
    isClientRequestIdConflict(
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_farmers_client_request_id"',
      },
      'farmers'
    ),
    true
  );
});

test('each table recognises only its own key constraint', () => {
  const farmerConflict = { code: '23505', constraint: 'uq_farmers_client_request_id' };
  assert.equal(isClientRequestIdConflict(farmerConflict, 'farmers'), true);
  assert.equal(isClientRequestIdConflict(farmerConflict, 'cooperatives'), false);
});

// ─────────────────────── the replay check must come before the gates

test('the create controllers check the key BEFORE the consent gate', () => {
  // A bug I made and caught: the FIRST request back-links its consent record
  // to the record it created, so by the time a retry arrives that consent has
  // an `entity_id` and the gate rejects it with "already attached". With the
  // replay check after the gate, every retry got a 409 the agent could do
  // nothing about and the idempotency key was never reached at all.
  //
  // Asserted against the source, because the ordering is the whole fix and
  // nothing else would notice it moving: a unit test of the handler would
  // need the entire Supabase surface stubbed, and a reader re-tidying the
  // imports could undo it silently.
  const fs = require('node:fs');
  for (const file of ['farmers.controller.js', 'cooperatives.controller.js']) {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'controllers', file),
      'utf8'
    );
    const createAt = src.indexOf('async function create(req, res)');
    assert.notEqual(createAt, -1, `no create handler in ${file}`);

    const replayAt = src.indexOf('findByClientRequestId', createAt);
    // Matched on the `return conflict(...)` itself, not on the phrase: the
    // comment above the replay check explains this very bug and contains the
    // same words, so a looser search found the comment and passed while the
    // code was still in the wrong order.
    const gateAt = src.indexOf(
      "return conflict(res, 'That consent record is already attached",
      createAt
    );

    assert.notEqual(replayAt, -1, `${file} does not check the client request id`);
    assert.notEqual(gateAt, -1, `${file} has no consent-attachment gate`);
    assert.ok(
      replayAt < gateAt,
      `${file}: the replay check must come before the consent-attachment gate, ` +
        'or every retry is rejected as "consent already attached"'
    );
  }
});

test('a replayed record is only returned to the agent who created it', () => {
  // The key is client-chosen, so without an ownership check an agent who
  // guessed another agent's key would be handed their farmer.
  const fs = require('node:fs');
  for (const file of ['farmers.controller.js', 'cooperatives.controller.js']) {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'controllers', file),
      'utf8'
    );
    const replayAt = src.indexOf('findByClientRequestId', src.indexOf('async function create'));
    const block = src.slice(replayAt, replayAt + 1600);
    assert.match(
      block,
      /created_by_agent_id !== req\.user\.userId/,
      `${file}: the replay branch does not check ownership`
    );
  }
});

test('errors that are not unique violations are never replays', () => {
  for (const err of [null, undefined, {}, { code: '23503' }, new Error('boom')]) {
    assert.equal(isClientRequestIdConflict(err, 'farmers'), false);
  }
});
