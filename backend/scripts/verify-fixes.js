'use strict';

/**
 * Heabron CoopScore — verification for the auth / email / NIN fixes
 * -----------------------------------------------------------------
 * Run with:  node scripts/verify-fixes.js
 *
 * Uses Node's built-in test runner and assert, so it adds no dependency.
 * Everything here is offline — no Supabase, no Resend, no network.
 *
 * It proves the parts of the fix that are pure logic:
 *   - the NIN name matcher (single names, transposed names, mismatches)
 *   - that the NIN service fails loudly when credentials are missing, rather
 *     than silently returning "verified"
 *   - that the email service reports a provider error instead of logging
 *     "email sent"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');

const SRC = path.join(__dirname, '..', 'src');

/**
 * Loads a module with selected dependencies replaced. Keeps the test honest:
 * we exercise the real file, only stubbing the outside world.
 */
function loadWithStubs(modulePath, stubs) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    for (const [match, impl] of Object.entries(stubs)) {
      if (request === match || request.endsWith(match)) return impl;
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
  }
}

const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {},
};

/**
 * Stub axios so these tests run even before `npm ci`, and so a bug can never
 * cause a real outbound request. Any call is a test failure by construction.
 */
const axiosStub = {
  get: async () => {
    throw new Error('axios.get should not be reached in these tests');
  },
  post: async () => {
    throw new Error('axios.post should not be reached in these tests');
  },
};

// ───────────────────────────────────────────────────────────── NIN service
test('NIN: missing provider credentials fail loudly instead of returning verified', async () => {
  const nin = loadWithStubs(path.join(SRC, 'services', 'nin', 'index.js'), {
    '../../config': {
      nin: {
        provider: 'dojah',
        devMode: false,                       // NOT explicit dev mode
        dojah: { baseUrl: 'https://api.dojah.io' }, // no appId / secretKey
        ninauth: {},
      },
    },
    '../../utils/logger': silentLogger,
    axios: axiosStub,
  });

  const result = await nin.verifyNin({
    nin: '12345678901',
    firstName: 'Ada',
    lastName: 'Nwosu',
  });

  // The whole point: this must NOT be 'verified'.
  assert.equal(result.status, 'failed');
  assert.equal(result.details, null);
  assert.ok(
    Array.isArray(result.raw.missingEnv) && result.raw.missingEnv.length > 0,
    'the response should name the missing env vars so the cause is visible'
  );
});

test('NIN: explicit NIN_DEV_MODE=true still returns the stub deliberately', async () => {
  const nin = loadWithStubs(path.join(SRC, 'services', 'nin', 'index.js'), {
    '../../config': {
      nin: { provider: 'dojah', devMode: true, dojah: {}, ninauth: {} },
    },
    '../../utils/logger': silentLogger,
    axios: axiosStub,
  });

  const result = await nin.verifyNin({ nin: '12345678901' });
  assert.equal(result.status, 'verified');
  assert.equal(result.raw.devMode, true);
});

test('NIN: a malformed NIN is rejected before any provider call', async () => {
  const nin = loadWithStubs(path.join(SRC, 'services', 'nin', 'index.js'), {
    '../../config': {
      nin: { provider: 'dojah', devMode: true, dojah: {}, ninauth: {} },
    },
    '../../utils/logger': silentLogger,
    axios: axiosStub,
  });

  for (const bad of ['123', '', 'abcdefghijk', '123456789012']) {
    const r = await nin.verifyNin({ nin: bad });
    assert.equal(r.status, 'failed', `"${bad}" should be rejected`);
  }
});

// ─────────────────────────────────────────────────────────── email service
function loadEmailWith(sendImpl) {
  return loadWithStubs(path.join(SRC, 'services', 'email', 'index.js'), {
    resend: {
      Resend: class {
        constructor() {
          this.emails = { send: sendImpl };
        }
      },
    },
    '../../config': {
      resend: {
        apiKey: 'test_key',
        fromEmail: 'Test <no-reply@example.com>',
        replyTo: 'info@example.com',
      },
    },
    '../../utils/logger': silentLogger,
    '../../templates/email/templates': {
      otp: ({ otpCode }) => ({ subject: 'Your code', html: `<p>${otpCode}</p>` }),
    },
  });
}

test('email: a provider error is returned, not swallowed as success', async () => {
  // Resend v4 resolves with { data: null, error } — it does not throw. The old
  // code only caught throws, so this path logged "email sent" and returned
  // undefined.
  const email = loadEmailWith(async () => ({
    data: null,
    error: { message: 'The example.com domain is not verified', statusCode: 403 },
  }));

  const result = await email.sendOtp('agent@example.com', {
    otpCode: '123456',
    purpose: 'signup',
  });

  assert.ok(result.error, 'a rejected send must surface an error');
  assert.match(result.error, /not verified/);
});

test('email: a 429 is retried and can succeed on a later attempt', async () => {
  let attempts = 0;
  const email = loadEmailWith(async () => {
    attempts += 1;
    if (attempts < 2) {
      return { data: null, error: { message: 'Too many requests', statusCode: 429 } };
    }
    return { data: { id: 'msg_ok' }, error: null };
  });

  const result = await email.sendOtp('agent@example.com', {
    otpCode: '123456',
    purpose: 'signup',
  });

  assert.equal(attempts, 2, 'the 429 should have been retried once');
  assert.equal(result.id, 'msg_ok');
});

test('email: a persistent failure gives up and reports the error', async () => {
  let attempts = 0;
  const email = loadEmailWith(async () => {
    attempts += 1;
    return { data: null, error: { message: 'Service unavailable', statusCode: 503 } };
  });

  const result = await email.sendOtp('agent@example.com', {
    otpCode: '123456',
    purpose: 'signup',
  });

  assert.equal(attempts, 3, 'should stop after MAX_ATTEMPTS');
  assert.ok(result.error);
});

test('email: a thrown network error is reported, not lost', async () => {
  const email = loadEmailWith(async () => {
    throw new Error('ECONNRESET');
  });

  const result = await email.sendOtp('agent@example.com', {
    otpCode: '123456',
    purpose: 'signup',
  });

  assert.ok(result.error);
  assert.match(result.error, /ECONNRESET/);
});

test('email: no API key reports skipped rather than pretending to send', async () => {
  const email = loadWithStubs(path.join(SRC, 'services', 'email', 'index.js'), {
    resend: { Resend: class {} },
    '../../config': { resend: { apiKey: null, fromEmail: 'x@example.com' } },
    '../../utils/logger': silentLogger,
    '../../templates/email/templates': {
      otp: () => ({ subject: 's', html: 'h' }),
    },
  });

  const result = await email.sendOtp('agent@example.com', { otpCode: '1' });
  assert.equal(result.skipped, true);
});

// ──────────────────────────────────────────────── NIN token cache (single flight)
/**
 * Exercises the token cache through the public `verifyNin`, since
 * `getNinAuthToken` is intentionally private. The stub answers both the OAuth
 * token call and the verification call, and counts each separately.
 */
function loadNinCounting({ expiresIn = 3600, latencyMs = 0, failFirstToken = false } = {}) {
  const calls = { token: 0, verify: 0 };

  const axiosCounting = {
    post: async (url, _body, _opts) => {
      if (/oauth\/token/.test(url)) {
        calls.token += 1;
        if (failFirstToken && calls.token === 1) throw new Error('ECONNRESET');
        if (latencyMs) await new Promise((r) => { setTimeout(r, latencyMs); });
        return { data: { access_token: `tok_${calls.token}`, expires_in: expiresIn } };
      }
      if (/verification\/nin\/match/.test(url)) {
        calls.verify += 1;
        return {
          data: {
            status: true,
            reference: `ref_${calls.verify}`,
            data: { firstname: 'Ada', surname: 'Nwosu' },
          },
        };
      }
      throw new Error(`unexpected POST ${url}`);
    },
    get: async () => {
      throw new Error('axios.get should not be reached');
    },
  };

  const nin = loadWithStubs(path.join(SRC, 'services', 'nin', 'index.js'), {
    '../../config': {
      nin: {
        provider: 'ninauth',
        devMode: false,
        dojah: {},
        ninauth: {
          clientId: 'id',
          clientSecret: 'secret',
          baseUrl: 'https://ninauth.example.com',
        },
      },
    },
    '../../utils/logger': silentLogger,
    axios: axiosCounting,
  });

  return { nin, calls };
}

const SAMPLE = { nin: '12345678901', firstName: 'Ada', lastName: 'Nwosu' };

test('NIN token: concurrent verifications share one token request (single flight)', async () => {
  const { nin, calls } = loadNinCounting({ latencyMs: 25 });

  const results = await Promise.all([
    nin.verifyNin(SAMPLE),
    nin.verifyNin(SAMPLE),
    nin.verifyNin(SAMPLE),
    nin.verifyNin(SAMPLE),
  ]);

  assert.equal(calls.verify, 4, 'each caller still performs its own verification');
  assert.equal(calls.token, 1, 'but the four of them share a single token fetch');
  results.forEach((r) => assert.equal(r.status, 'verified'));
});

test('NIN token: a live token is reused across sequential verifications', async () => {
  const { nin, calls } = loadNinCounting();

  await nin.verifyNin(SAMPLE);
  await nin.verifyNin(SAMPLE);
  await nin.verifyNin(SAMPLE);

  assert.equal(calls.verify, 3);
  assert.equal(calls.token, 1, 'the cached token should be reused');
});

test('NIN token: a failed token fetch does not poison later attempts', async () => {
  const { nin, calls } = loadNinCounting({ failFirstToken: true });

  // The first attempt fails while fetching the token. verifyNin catches
  // provider errors and reports status 'failed' rather than throwing.
  const first = await nin.verifyNin(SAMPLE);
  assert.notEqual(first.status, 'verified');

  // The in-flight latch must have been cleared, so a retry can fetch again.
  const second = await nin.verifyNin(SAMPLE);
  assert.equal(second.status, 'verified', 'a retry after a failed token fetch should succeed');
  assert.equal(calls.token, 2, 'the second attempt must actually retry the token fetch');
});

// ───────────────────────────────────────────── cash-purchase validator (agent)
test('validator: recordCashPurchase enforces the documented contract', () => {
  const v = require(path.join(SRC, 'validators', 'domain'));
  assert.ok(v.recordCashPurchase, 'the validator must be exported for the route to use it');

  const uuid = '3f6d9c1e-9b2a-4f7e-8c21-5a7b3d9e4c10';

  // farmerId and amount are required.
  assert.ok(v.recordCashPurchase.validate({}).error);
  assert.ok(v.recordCashPurchase.validate({ farmerId: uuid }).error);
  assert.ok(v.recordCashPurchase.validate({ amount: 2500 }).error);

  // A non-positive amount must be refused — this writes a money row.
  assert.ok(v.recordCashPurchase.validate({ farmerId: uuid, amount: 0 }).error);
  assert.ok(v.recordCashPurchase.validate({ farmerId: uuid, amount: -500 }).error);

  // A malformed farmerId must be refused before it reaches the database.
  assert.ok(v.recordCashPurchase.validate({ farmerId: 'not-a-uuid', amount: 10 }).error);

  // The happy path, and the documented default for paymentMethod.
  const okResult = v.recordCashPurchase.validate({ farmerId: uuid, amount: 25000 });
  assert.equal(okResult.error, undefined);
  assert.equal(okResult.value.paymentMethod, 'cash');

  // Only the documented payment methods are accepted.
  assert.ok(
    v.recordCashPurchase.validate({ farmerId: uuid, amount: 10, paymentMethod: 'crypto' }).error
  );
});

// ───────────────────────────────────────────────── config guard (fail closed)
/**
 * Loads src/config/index.js under a given set of environment variables.
 * The module reads process.env at require time, so the environment is swapped
 * around a fresh require and restored afterwards.
 */
function loadConfigWithEnv(env) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, env);

  const resolved = require.resolve(path.join(SRC, 'config', 'index.js'));
  delete require.cache[resolved];

  // dotenv would read a developer's real .env and defeat the test.
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'dotenv') return { config: () => ({ parsed: {} }) };
    return originalLoad(request, parent, isMain);
  };

  const originalError = console.error;
  const originalWarn = console.warn;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));

  try {
    const config = require(resolved);
    return { config, logs, threw: null };
  } catch (err) {
    return { config: null, logs, threw: err };
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    Module._load = originalLoad;
    delete require.cache[resolved];
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const GOOD_SECRET = 'K2s9Qv7bX1pR4mT8nZ6yL3wF5hJ0cD9gB7aE2uY4iO6kN8rS1vP3xM5tQ7zC';
const PLACEHOLDER = 'dev-only-secret-change-me';

test('config: a deployment with the committed placeholder secret refuses to start', () => {
  const { threw, logs } = loadConfigWithEnv({
    VERCEL: '1',
    JWT_SECRET: PLACEHOLDER,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'key',
  });

  assert.ok(threw, 'startup must fail rather than sign tokens with a public secret');
  assert.match(logs.join('\n'), /placeholder/i);
});

test('config: a deployment is detected even when NODE_ENV is unset', () => {
  // This is the observed production state: /api/health reported
  // "env": "development", so the old NODE_ENV-only guard never ran.
  const { threw, logs } = loadConfigWithEnv({ VERCEL: '1' });

  assert.ok(threw, 'a deployed environment without secrets must not boot');
  assert.match(logs.join('\n'), /missing env vars/i);
  assert.match(logs.join('\n'), /JWT_SECRET/);
});

test('config: a deployment rejects a too-short secret', () => {
  const { threw } = loadConfigWithEnv({
    VERCEL_ENV: 'production',
    JWT_SECRET: 'short',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'key',
  });
  assert.ok(threw);
});

test('config: a properly configured deployment boots and reports production', () => {
  const { config, threw } = loadConfigWithEnv({
    VERCEL: '1',
    VERCEL_ENV: 'production',
    NODE_ENV: 'production',
    JWT_SECRET: GOOD_SECRET,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'key',
    RESEND_API_KEY: 're_test_key',
  });

  assert.equal(threw, null);
  assert.equal(config.isProd, true);
  assert.equal(config.isDeployed, true);
  assert.equal(config.jwt.secret, GOOD_SECRET);
});

test('config: local development still boots without a secret, but warns', () => {
  const { config, threw, logs } = loadConfigWithEnv({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'key',
  });

  assert.equal(threw, null, 'a developer machine must not be blocked');
  assert.equal(config.isDeployed, false);
  assert.match(logs.join('\n'), /development placeholder/i);
});

// ──────────────────────────────────────────────────────── logger (pino style)
/**
 * Loads the logger with a chosen `isProd` and captures what the Console
 * transport writes, so the serialised output can be asserted on directly.
 */
function captureLogger(isProd, emit) {
  const logger = loadWithStubs(path.join(SRC, 'utils', 'logger.js'), {
    '../config': { isProd },
  });

  const lines = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  const capture = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  process.stdout.write = capture;
  process.stderr.write = capture;

  try {
    emit(logger);
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
  }

  return lines.join('');
}

test('logger: production keeps the message of a pino-style call', () => {
  // The bug: the message/meta swap lived inside the dev-only formatter, so in
  // production `format.json()` saw the meta object as the message and the real
  // message string was dropped. 83 of 86 call sites use this pattern.
  const out = captureLogger(true, (logger) => {
    logger.error({ err: 'duplicate key value', code: '23505' }, 'OTP insert failed');
  });

  const record = JSON.parse(out.trim().split('\n').pop());
  assert.equal(record.message, 'OTP insert failed', 'the message must survive');
  assert.equal(record.err, 'duplicate key value', 'and the metadata must too');
  assert.equal(record.code, '23505');
  assert.equal(record.level, 'error');
});

test('logger: production still handles a plain string call', () => {
  const out = captureLogger(true, (logger) => {
    logger.info('swagger mounted');
  });
  const record = JSON.parse(out.trim().split('\n').pop());
  assert.equal(record.message, 'swagger mounted');
});

test('logger: metadata cannot overwrite reserved winston fields', () => {
  const out = captureLogger(true, (logger) => {
    logger.warn({ level: 'spoofed', message: 'spoofed', real: 1 }, 'the actual message');
  });

  const record = JSON.parse(out.trim().split('\n').pop());
  assert.equal(record.level, 'warn', 'level must not be spoofable by metadata');
  assert.equal(record.message, 'the actual message');
  assert.equal(record.real, 1);
  // The colliding keys are preserved under a prefix rather than discarded.
  assert.equal(record.meta_level, 'spoofed');
  assert.equal(record.meta_message, 'spoofed');
});

test('logger: development output carries both message and metadata', () => {
  const out = captureLogger(false, (logger) => {
    logger.error({ err: 'boom', code: 'E1' }, 'upload failed');
  });

  assert.match(out, /upload failed/);
  assert.match(out, /boom/);
  assert.match(out, /E1/);
});

// ──────────────────────────── validators vs stripUnknown (silent field loss)
/**
 * The validate middleware runs every schema with `stripUnknown: true`, so a
 * field a controller reads but its validator omits is deleted from the request
 * without any error. These guard the cases where that was happening.
 */
const STRIP = { abortEarly: false, stripUnknown: true, convert: true };

test('validator: decideSettlement keeps the payout proof fields', () => {
  const v = require(path.join(SRC, 'validators', 'domain'));

  const { error, value } = v.decideSettlement.validate(
    {
      decision: 'approve',
      referenceNumber: 'TRF-99812',
      receiptImageUrl: 'https://files.example.com/receipt.png',
    },
    STRIP
  );

  assert.equal(error, undefined);
  // decideSettlement() writes these into wallet_transactions as
  // reference_number / receipt_image_url. They were being stripped, so the
  // payout ledger recorded NULL proof on every approved settlement.
  assert.equal(value.referenceNumber, 'TRF-99812');
  assert.equal(value.receiptImageUrl, 'https://files.example.com/receipt.png');
});

test('validator: decideSettlement still enforces its own rules', () => {
  const v = require(path.join(SRC, 'validators', 'domain'));

  assert.ok(
    v.decideSettlement.validate({ decision: 'approve', receiptImageUrl: 'not-a-url' }, STRIP).error,
    'a malformed receipt URL must be refused'
  );
  assert.ok(
    v.decideSettlement.validate({ decision: 'reject' }, STRIP).error,
    'rejecting without a reason must be refused'
  );
  assert.ok(
    v.decideSettlement.validate({ decision: 'maybe' }, STRIP).error,
    'an unknown decision must be refused'
  );
});

test('validator: listQuery keeps the activity-log and wallet filters', () => {
  const v = require(path.join(SRC, 'validators', 'domain'));

  const { error, value } = v.listQuery.validate(
    {
      action: 'cash_purchase_recorded',
      entityType: 'wallet_transaction',
      actorId: '3f6d9c1e-9b2a-4f7e-8c21-5a7b3d9e4c10',
      source: 'cash_purchase',
      transactionType: 'debit',
    },
    STRIP
  );

  assert.equal(error, undefined);
  // Stripped, these made the admin Activity Log filters inert and caused
  // /admin/transactions to ignore `source` and return every transaction.
  assert.equal(value.action, 'cash_purchase_recorded');
  assert.equal(value.entityType, 'wallet_transaction');
  assert.equal(value.actorId, '3f6d9c1e-9b2a-4f7e-8c21-5a7b3d9e4c10');
  assert.equal(value.source, 'cash_purchase');
  assert.equal(value.transactionType, 'debit');
});

// ───────────────────────────────────────────────── email: safe() is awaitable
test('email: safe() returns a promise so callers can await delivery', async () => {
  // `safe()` used to be fire-and-forget — it started the send, attached a
  // .catch and returned undefined. On Vercel the lambda is frozen when the
  // response is written, so every non-OTP email in the app (partner
  // credentials, agent approval, financing decisions...) was killed in flight.
  const email = loadEmailWith(async () => ({
    data: null,
    error: { message: 'domain not verified', statusCode: 403 },
  }));

  const returned = email.safe(email.sendOtp)('agent@example.com', { otpCode: '123456' });
  assert.ok(typeof returned?.then === 'function', 'safe() must return a promise');

  const result = await returned;
  assert.ok(result?.error, 'an awaited safe() send must surface the provider error');
  assert.match(result.error, /not verified/);
});

test('email: safe() still never rejects, so a mail failure cannot break a request', async () => {
  const email = loadEmailWith(async () => {
    throw new Error('socket hang up');
  });

  // Must resolve, not reject — that is the whole point of the wrapper.
  const result = await email.safe(email.sendOtp)('agent@example.com', { otpCode: '1' });
  assert.ok(result?.error);
  assert.match(result.error, /socket hang up/);
});

// ──────────────────────────────────────────────── credit score: pure functions
const score = require(path.join(SRC, 'services', 'credit-score', 'index.js'));

test('credit score: a negative or NaN yield cannot escape the 0-60 band', () => {
  // `Math.min(actual / benchmark, 1.0)` happily returns a NEGATIVE ratio, so a
  // negative actual yield produced a negative production score and a final
  // score below zero that was then presented as a tier-D assessment.
  assert.deepEqual(score.computeProductionScore({ actualYield: -5, benchmarkYield: 2 }), { score: 0, yieldRatio: 0 });
  assert.deepEqual(score.computeProductionScore({ actualYield: NaN, benchmarkYield: 2 }), { score: 0, yieldRatio: 0 });
  assert.deepEqual(score.computeProductionScore({ actualYield: 5, benchmarkYield: 0 }), { score: 0, yieldRatio: 0 });

  // At or above benchmark is capped at the full 60.
  assert.equal(score.computeProductionScore({ actualYield: 10, benchmarkYield: 2 }).score, 60);
  assert.equal(score.computeProductionScore({ actualYield: 1, benchmarkYield: 2 }).score, 30);
});

test('credit score: no repayment evidence scores zero, not full marks', () => {
  // Timeliness and default history both used to DEFAULT to the maximum, so a
  // farmer with a disbursed loan, no due date and no payments banked
  // 0 + 10 + 5 = 15 points for nothing.
  const bare = score.computeRepaymentScore({ repayments: [], loanAmount: 100000, dueDate: null });
  assert.equal(bare.components.timeliness, 0, 'an unassessable due date is not punctuality');
  assert.equal(bare.components.defaultHistory, 0, 'no completed cycle cannot vouch for a clean record');
  assert.equal(bare.score, 0);
  assert.equal(bare.timelinessBasis, 'no_due_date');
});

test('credit score: a full on-time repayment earns the whole 40', () => {
  const paid = score.computeRepaymentScore({
    repayments: [{ amount_paid: 100000, payment_date: '2026-01-01' }],
    loanAmount: 100000,
    dueDate: '2026-02-01',
    priorDefaults: { active: false, recoveredCleanCycles: 2 },
  });
  assert.equal(paid.components.repaymentRate, 25);
  assert.equal(paid.components.timeliness, 10);
  assert.equal(paid.components.defaultHistory, 5);
  assert.equal(paid.score, 40);
});

test('credit score: a negative amount_paid cannot inflate or NaN the rate', () => {
  const r = score.computeRepaymentScore({
    repayments: [{ amount_paid: -50000, payment_date: '2026-01-01' }, { amount_paid: 'abc' }],
    loanAmount: 100000,
    dueDate: '2026-02-01',
  });
  assert.equal(r.components.repaymentRate, 0);
  assert.ok(Number.isFinite(r.score));
});

test('credit score: the principal is what was disbursed, not what was asked for', () => {
  // The engine measured repayment against `loan_amount` (the REQUEST), so a
  // farmer who repaid a reduced approval in full scored as a part-payer.
  assert.equal(score.loanPrincipal({ loan_amount: 500000, approved_amount: 200000 }), 200000);
  assert.equal(
    score.loanPrincipal({ loan_amount: 500000, approved_amount: 200000, disbursed_amount: 180000 }),
    180000
  );
  // 0 and null both mean "not set" — no loan is legitimately zero.
  assert.equal(score.loanPrincipal({ loan_amount: 500000, approved_amount: 0 }), 500000);
  assert.equal(score.loanPrincipal({ loan_amount: 500000, approved_amount: null }), 500000);
  assert.equal(score.loanPrincipal(null), 0);
});

test('credit score: a missing due date falls back to disbursement + window', () => {
  const due = score.effectiveDueDate({
    due_date: null,
    disbursed_at: '2026-01-01T00:00:00.000Z',
    repayment_window_days: 180,
  });
  assert.ok(due instanceof Date);
  assert.equal(due.toISOString().slice(0, 10), '2026-06-30');

  // Nothing to derive from stays unassessable rather than inventing a date.
  assert.equal(score.effectiveDueDate({ due_date: null, disbursed_at: null }), null);
});

test('credit score: tier bands are contiguous and bounded', () => {
  assert.equal(score.tierForScore(100), 'A');
  assert.equal(score.tierForScore(80), 'A');
  assert.equal(score.tierForScore(79.9), 'B');
  assert.equal(score.tierForScore(65), 'B');
  assert.equal(score.tierForScore(64.9), 'C');
  assert.equal(score.tierForScore(50), 'C');
  assert.equal(score.tierForScore(49.9), 'D');
  assert.equal(score.tierForScore(0), 'D');
});

test('config: a deployment without a mail API key refuses to start', () => {
  // Without RESEND_API_KEY the email service logs "[EMAIL DRY RUN]" and
  // returns { skipped: true }, discarding every OTP and password reset while
  // the logs look clean. A platform that cannot send a verification code
  // cannot onboard an agent, so this must not boot.
  const { threw, logs } = loadConfigWithEnv({
    VERCEL: '1',
    JWT_SECRET: GOOD_SECRET,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'key',
  });

  assert.ok(threw, 'a deployment that cannot send email must not start');
  assert.match(logs.join('\n'), /RESEND_API_KEY/);
});

// ───────────────────────────────── storage buckets: migration vs controller
test('storage: every bucket the code writes to is created by the schema', () => {
  const uploads = require(path.join(SRC, 'controllers', 'uploads.controller'));
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '000_heabron_system_schema.sql'),
    'utf8'
  );

  const insert = schema.match(/INSERT INTO storage\.buckets[\s\S]*?ON CONFLICT/);
  assert.ok(insert, 'the schema must create the storage buckets');

  const created = new Map(
    [...insert[0].matchAll(/\('([a-z-]+)',\s*'[a-z-]+',\s*(true|false)\)/g)].map((m) => [
      m[1],
      m[2] === 'true',
    ])
  );

  for (const [kind, spec] of Object.entries(uploads.BUCKETS)) {
    assert.ok(
      created.has(spec.bucket),
      `bucket "${spec.bucket}" (upload kind "${kind}") is not created by the schema — ` +
        'uploads to it fail with "Bucket not found"'
    );

    // The public flag must agree with isPublic, or the API hands out a URL
    // whose lifetime does not match the object's actual visibility: a private
    // bucket marked public leaks, and a public bucket treated as private gets
    // an expiring link to a file that is readable anyway.
    assert.equal(
      created.get(spec.bucket),
      Boolean(spec.isPublic),
      `bucket "${spec.bucket}" is public=${created.get(spec.bucket)} in the schema but ` +
        `isPublic=${Boolean(spec.isPublic)} for upload kind "${kind}"`
    );
  }
});
