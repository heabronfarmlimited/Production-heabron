# Platform audit — API contract, configuration and observability

Findings and fixes from the cross-cutting pass over the backend: the OpenAPI
layer, startup configuration, logging, and the mobile↔backend contract.

The per-controller backend audit is in `backend/AUDIT_BACKEND.md`, and the
dashboard audit in `frontend/AUDIT_FRONTEND.md`.

---

## Read this before deploying

Two changes alter startup behaviour. Both are deliberate, and one **will block
a deploy** until an environment variable is set.

### 1. The API now refuses to start with an insecure JWT secret

`src/config/index.js` previously guarded required env vars behind
`NODE_ENV === 'production'`. The production deployment reports
`"env": "development"` from `/api/health`, so **that guard never ran**, and
`JWT_SECRET` fell back to:

```js
secret: process.env.JWT_SECRET || 'dev-only-secret-change-me'
```

That placeholder is committed to the repository. Anyone who could read the
source could mint a valid token for any role, including admin.

Startup now fails on any deployed environment when `JWT_SECRET` is missing, is
that placeholder, or is shorter than 32 characters. Deployment is detected from
`VERCEL` / `VERCEL_ENV` / `AWS_LAMBDA_FUNCTION_NAME` / `K_SERVICE` / `RENDER` /
`FLY_APP_NAME` — **not** `NODE_ENV`, precisely because `NODE_ENV` was the thing
that was wrong. A local machine without the variable still boots, with a warning.

`RESEND_API_KEY` is now required on a deployed environment for the same
fail-closed reason, escalated from the backend audit. Without it the email
service logs `[EMAIL DRY RUN]`, returns `{ skipped: true }` and discards the
message — so **every signup OTP and password reset is silently dropped while
the logs look clean.** That is the same failure mode that made the original OTP
complaint so hard to diagnose. A platform that cannot send a verification code
cannot onboard an agent or recover an account, so it does not start in that
state. If email currently arrives in production the key is already set and
nothing changes for you.

**Before deploying:**

```bash
openssl rand -base64 48             # generate a secret
vercel env add JWT_SECRET production
vercel env add NODE_ENV production   # set to: production
vercel env ls production | grep -E 'RESEND_API_KEY|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY'
```

If any of those four are missing, the API will refuse to boot and say which.

Rotating the secret invalidates existing sessions, so users sign in again. If
`JWT_SECRET` is currently unset in production, every live session is already
signed with the public placeholder and must be invalidated anyway.

### 2. CORS warns rather than fails

`ALLOWED_ORIGINS` was read by `src/server.js` but was **not** in
`.env.example`, so there was no sign it existed. Unset, it defaults to `*`,
allowing any website to call the API from a visitor's browser.

Authentication is Bearer-header only — there are no cookies for another origin
to ride on — so this is not a session-theft path, and failing closed would take
down a live dashboard whose origin was never configured. So this one **warns at
startup** instead of refusing, and the variable is now documented. Set it in
production to the admin and partner dashboard origins.

The CORS implementation itself is correct, including the subtlety that a
response cannot carry both `Access-Control-Allow-Origin: *` and
`Access-Control-Allow-Credentials: true`; it echoes the request origin instead.

---

## Production logs were discarding their messages

The most consequential finding, because it explains why the OTP problem could
not be diagnosed from the logs.

83 of the 86 logger call sites use the pino-style form:

```js
logger.error({ err, code, hint, details }, 'OTP insert failed');
```

Winston does not understand that form. It takes the **object** as the message
and pushes the real message string into the splat. `src/utils/logger.js` had a
custom formatter that swapped them back — but it was applied only when
`!isProd`:

```js
config.isProd ? winston.format.json() : devFormat   // devFormat did the swap
```

So in production `format.json()` received the un-swapped record, and every line
came out as:

```json
{"level":"error","message":{"err":"duplicate key value"},"timestamp":"…"}
```

The metadata survived; **the message — the part naming which operation
failed — was dropped on every one of those 83 call sites.** Reading production
logs, you could see that an error occurred and see its details, but not what
had been attempted.

The normalisation now runs in a shared format stage before the dev/prod split,
so both outputs carry the message, with metadata lifted to top-level keys for
log search:

```json
{"code":"23505","err":"duplicate key value","level":"error","message":"OTP insert failed","timestamp":"…"}
```

Metadata keys that collide with Winston's own fields (`level`, `message`,
`timestamp`, `stack`) are preserved under a `meta_` prefix rather than
overwriting the record, so a stray `level` key in a metadata object cannot
disguise an error as an info line.

`LOG_LEVEL` now overrides the level, so production can be turned up to `debug`
temporarily without a code change.

---

## OpenAPI: the spec and the routes disagreed in both directions

The docs are assembled at request time by `src/config/swagger.js`, which inlines
every `*.yaml` under `docs/swagger/paths/` and `docs/swagger/schemas/`. Nothing
checked that against the real Express route table, and it had drifted badly.

`scripts/check-swagger.js` (new) reconciles the two and fails non-zero when they
disagree. It also verifies that every `$ref` resolves and every tag used is
declared — both of which fail silently in Swagger UI, as an empty schema and a
stray ungrouped section respectively.

### Before

```
registered routes : 171
documented ops    : 118
coverage          : 65%
phantom           : 6     (documented, not registered — a client gets a 404)
undocumented      : 59
```

### After

```
registered routes : 173
documented ops    : 173
coverage          : 100%
phantom           : 0
undocumented      : 0
$refs resolved    : 56/56
```

### The six phantom endpoints

`docs/swagger/paths/new-endpoints.yaml` declared twelve paths, six of which were
not registered. This is what produced the earlier impression that the deployed
API was ahead of the repository. It was a documentation bug, not deployment
drift — and it could not be caught by probing the live API, because
`agent.routes.js` mounts `requireAuth()` **before** all its routes, so any
`/agent/*` path returns 401 whether it exists or not.

Four were the same operation documented under the wrong mount — implemented on
the admin router, documented under `/agent`:

| Documented | Actually registered |
|---|---|
| `GET /agent/farmers/{farmerId}/financing-history` | `GET /admin/farmers/{farmerId}/financing-history` |
| `GET /agent/exports/agent` | `GET /admin/exports/agent` |
| `GET /agent/exports/farmer/{farmerId}` | `GET /admin/exports/farmer/{farmerId}` |
| `GET /agent/exports/cooperative/{cooperativeId}` | `GET /admin/exports/cooperative/{cooperativeId}` |

The mobile app needs none of these: it reads a farmer's financing through
`GET /agent/financing-requests?farmerId=…`, and renders its PDFs on-device from
data it has already loaded (`useFarmerExport`). The spec was re-scoped to
`/admin`, with a note recording why.

### The other two were a feature that had never been wired up

`GET` and `POST /agent/wallet/cash-purchases` were documented, and
`recordCashPurchase` / `listCashPurchases` were fully implemented and exported
in `wallet.controller.js` — but no route ever registered them, and nothing
outside the controller referenced them.

That mattered more than a missing doc, because the **admin half of the flow is
wired**: `GET /admin/cash-purchases` and
`POST /admin/cash-purchases/{transactionId}/confirm`. With no way for an agent
to file a purchase, the admin list was always empty and the confirm endpoint was
unreachable. The whole manual money flow — admin disburses to agent, agent buys
inputs for a farmer and files proof, admin confirms — was dead from the agent
side.

Both routes are now registered, with a `recordCashPurchase` Joi validator added
to match the documented contract (it was the only piece genuinely missing). A
stale comment in the controller header claiming `status = 'completed'` was
corrected; the code correctly inserts `pending` for admin confirmation.

**Open question for you, not fixed:** nothing checks a recorded purchase against
the agent's wallet balance or the approved amount of the related financing
request, so an agent can file purchases exceeding what was disbursed to them.
Whether that should be rejected, or allowed and flagged for the admin to catch
at confirmation, is a policy decision. Flagged to the backend audit as well.

### The 55 undocumented operations

Rather than hand-write these, `scripts/gen-swagger-stubs.js` (new) generates
them from the code: path parameters from the route, query parameters and request
bodies from the **same Joi validators Express validates against** (via
`schema.describe()`), summaries from the controller handler names, and the
upload `kind` enum from the controller's own `BUCKETS` export. Because the
shapes come from the validators, the generated spec cannot describe a request
the API would reject. Output lands in
`docs/swagger/paths/generated-coverage.yaml`; regenerate with `npm run gen:docs`
and move entries into the hand-written files as they get real prose.

### Also corrected

- `Admin — Wallet` vs `Admin — Wallets` — both were in use, only the plural was
  declared. Normalised to the declared form.
- 18 tags were used but never declared, so they rendered as stray ungrouped
  sections at the bottom of the docs page. All now declared.
- The production server URL was `heabron-coopscore-api.vercel.app`; it is now
  `api.heabroncoopscore.com`. (`deriveBaseUrl` overrides this per request, so
  this only affects consumers of the raw YAML — but it was wrong.)
- No duplicate path or schema keys across files. Worth knowing that
  `swagger.js` merges with `Object.assign`, so a duplicate key in two files
  would silently take the last one; there are none today.

---

## The migrations folder had an ambiguous starting point

`backend/migrations/` contained **two different files both numbered `000`** —
`000_initial_schema.sql` (34 KB) and `000_heabron_system_schema.sql` (52 KB) —
so which one to run first was a coin flip. Alongside them were five duplicate
snapshot directories from repeated downloads: `migration 3`, `migration c`,
`migration new 2`, `migration new correction`, `migrations 4`.

The top level was also missing `005`, `006` and `008` entirely; they existed
only inside those subdirectories. That looked alarming at first, because the
code depends on all three — `005` defines the `cash_purchase_submitted`
notification type that the cash-purchase route inserts, and `008` adds the
`voided` column that repayment queries filter on. In fact the README explained
it: `000_heabron_system_schema.sql` is a consolidated replacement for the whole
`001`–`009` series, and it does contain all of them. Verified token by token
rather than taken on trust.

What was genuinely missing was the other direction: the consolidated schema did
**not** include `settlement_rejected`, the enum value added by the new
`010_settlement_rejected_notification.sql`. So a fresh database created from the
consolidated file would have been missing it, and settlement-rejection
notifications would have failed the enum check from day one. Added, in both the
`CREATE TYPE` list and the `ADD VALUE IF NOT EXISTS` upgrade block, matching the
file's existing pattern.

Reorganised to remove the ambiguity: `000_heabron_system_schema.sql` and `010`
at the top level, the superseded `000_initial_schema.sql` and `001`–`009` moved
to `legacy/` rather than deleted (they are the record of what was applied to the
live database), the five duplicate directories removed, and the README rewritten
to say plainly which file to run. Nothing was deleted without first checking
every file in those directories against its top-level counterpart: all byte
identical except `007`, whose SQL matched and whose comments differed only in
that the duplicate contradicted itself about two buckets being public.

### Which led to a real inconsistency

The schema marked `delivery-proofs` and `transaction-receipts` as **public**,
with a comment explaining the intent — proof URLs should never expire, because
an admin and an agent must be able to view them in history indefinitely. But
`BUCKETS` in `uploads.controller.js` has always had `isPublic: false` for every
kind that writes to them.

That combination was the worst of both. Because the bucket was public, the
object was readable by anyone with the URL, so the signed URL bought no
protection at all — and because the controller treated it as private, the URL it
stored **expired anyway**. The link against a delivery or a payment receipt
stopped working after its lifetime while the file itself stayed publicly
fetchable. (The lifetime had just been cut from ten years to one by the backend
audit, which makes the expiry a live problem rather than a theoretical one.)

These two buckets hold financial evidence — payment receipts, disbursement and
delivery proof — so the schema now marks them private, matching the code. This
changes **no API behaviour**: the controller already issued signed URLs for
them. It only stops the objects being readable outside this API's authorisation.
Existing signed URLs keep working, because a signed URL does not depend on the
public flag, and `POST /agent/uploads/sign-url` re-mints a link for an older
record. `partner-logos` stays public — logos are rendered in `<img>` tags and
are not sensitive.

`npm test` now enforces the correspondence: a check asserts that every bucket an
upload kind targets exists in the schema **and** that its public flag matches
`isPublic`, so this cannot drift again in either direction. Mutation-checked.

---

## The linter had never run

`package.json` declared `eslint: ^9.0.0` but the repository contained no
`eslint.config.js`, so `npm run lint` failed with *"ESLint couldn't find an
eslint.config.js file"* — meaning the linter had effectively never run on this
codebase.

Added a flat config (CommonJS, Node globals, correctness rules as errors and
style as warnings). It surfaced 10 errors on first run, all now fixed:

| Finding | Resolution |
|---|---|
| 6 unused imports (`config`, `ok` ×2, `ADMIN_ROLES`, `notFound`, unused `farmer` destructure) | Removed. Each checked first — the unused `farmer` in `productions.controller.js` could have meant a skipped ownership check, but `assertFarmerAccess` is correctly called and its verdict checked; only the binding was dead. |
| `no-promise-executor-return` in the email backoff `sleep` | Braced the arrow body. |
| `require-atomic-updates` in the NIN token cache | A real bug — see below. |
| `require-atomic-updates` on `req.user` and on a fetched row | False positives on per-request objects; annotated with a one-line disable and the reason, rather than switching the rule off, since it caught the real one. |

### The real one: the NIN token cache

```js
const now = Date.now();
// …
const res = await axios.post(url, …);     // network round-trip
cachedToken = res.data.access_token;
cachedTokenExpiresAt = now + (res.data.expires_in || 3600) * 1000;
```

Two problems. The expiry was measured from **before** the request was sent, so a
slow handshake silently shortened the cached lifetime by its own duration. And
with no cached token, every concurrent verification started its own token
request.

Now a single-flight latch: concurrent callers share one round-trip, the expiry
is measured from the response, the latch is cleared in a `finally` so a failed
fetch does not pin later callers to a rejected promise, and a response with no
`access_token` is treated as an error instead of caching `undefined`.

---

## Mobile ↔ backend contract: holds

`mobile/scripts/check-backend-contract.mjs` (new) reads the app's endpoint map
and its `api.*` call sites, reads the backend's registered routes, and verifies
every endpoint the app calls exists **with the method the app uses**. This
catches renamed paths and method mismatches (a `PATCH` where the route only
registered `PUT`), which otherwise surface as a 404 or 405 only when a user taps
the button.

```
app endpoints defined : 55
backend route paths   : 142
endpoints with calls  : 47

NO SUCH ROUTE ON THE BACKEND     : 0
METHOD NOT ACCEPTED BY THAT ROUTE: 0
```

Worth noting about the checker itself: the first version matched
`api.post<T>(…)` with `<[^>]*>`, which stops at the first `>` and so missed
every call using a nested generic such as `api.post<Record<string, unknown>>(…)`
— most of them. Fixed before drawing any conclusion from the clean result;
coverage went from 44 to 47 endpoints and the result stayed clean.

### Three backend features the app never calls

Defined in the endpoint map but never invoked, and **absent from the Flutter app
too**, so this is faithful to the original rather than a conversion gap:

| Endpoint | Backend support |
|---|---|
| `/agent/change-requests` (+ by id) | Implemented: agent proposes an edit to a locked record, admin approves or rejects |
| `/agent/uploads/sign-url` | Implemented: signed URL for private-bucket files |
| `/agent/uploads-doc/{kind}` | Implemented: document (non-image) upload |

In Flutter, change-requests existed only as a constant in `api_constants.dart`
with no UI; the two upload routes appear nowhere at all. These are working
backend capabilities with no client — good candidates for the feature work you
want to start on.

---

## What now gates each codebase

```bash
cd backend && npm run verify     # lint + OpenAPI reconciliation + 21 tests
cd mobile  && npm run verify     # typecheck + lint + 93 tests + contract check
```

Both pass. The backend test suite went from 8 tests to 21, covering the NIN
token cache, the `recordCashPurchase` validator, the config guard and the logger.

Each new test was mutation-checked — the fix was reverted to confirm the test
actually fails without it — because three of the tests I first wrote for the
token cache passed **vacuously**: they called a function that was never
exported, hit an early `return`, and reported green. A test that cannot fail is
worse than no test, so they were rewritten to go through the public `verifyNin`.

### Still requires your action

| Item | Why it needs you |
|---|---|
| Set `JWT_SECRET` and `NODE_ENV=production` in Vercel | The API will not start without the first; see the top of this document |
| Set `ALLOWED_ORIGINS` | Currently open to every origin |
| `node scripts/diagnose-email.js you@example.com` | Needs the real Resend key; checks sending-domain verification, which is the one OTP cause that cannot be confirmed from the code |
| `vercel env ls production \| grep DOJAH` | If unset, no NIN has ever been genuinely verified |
| The `email_confirmed_at IS NULL` backfill | Writes to your production database |
