# Heabron CoopScore — Backend Audit

Scope: `backend/src`, excluding the four files already patched before this audit
(`controllers/auth.controller.js`, `services/email/index.js`, `services/nin/index.js`,
`middleware/rateLimit.js`) — except where a **new** bug was found in them, which is
called out explicitly (see C4).

Every fix is marked `FIXED —` at the site with the reason. `npm run verify`
(lint + swagger check + 33 tests) is green.

A second pass ran in parallel on the OpenAPI layer, the lint gate and the
config guard. Three of its findings are backend defects that belong in this
record and are **not** duplicated in my sections below — they are listed under
*Found in the parallel pass* at the end of **High**.

Status legend: **[fixed]** changed in place · **[noted]** deliberately not changed, reason given.

---

## The one-paragraph version

Three defect classes account for most of what was wrong. **(1)** supabase-js
*resolves* with `{ data, error }` rather than throwing, and roughly 90 call
sites destructured only `data` — so a failed write returned HTTP 200 and a
failed read rendered as an authoritative empty state. Several `try/catch`
blocks wrapped these calls and were therefore unreachable code. **(2)** Nine
controllers called `safeRecalculateFarmer()` without `await`, and fifteen
called `email.safe()`, which was fire-and-forget by construction — on Vercel
the lambda freezes when the response is written, so credit scores silently
stopped updating in production and most of the app's email was killed in
flight. This is the same defect the OTP path was already fixed for. **(3)** No
state machine on any money or approval flow: settlements could be
double-approved, loans double-disbursed, repayments double-counted.

---

## Critical

### C1 · Credit scores silently stopped updating in production
`services/credit-score/index.js` + 9 call sites

`safeRecalculateFarmer()` / `safeRecalculateCooperative()` were called **without
`await`** from `farmers.create`, `farmers.update`, `farmers.remove`,
`farmers.mapFarm`, `repayments.create`, `repayments.voidRepayment`,
`deliveries.create`, `productions.verify`, `changeRequests.decide` and
`imports.bulkImport`.

On Vercel the lambda is frozen the instant the response is written, so the
recalculation was killed mid-query. Whether a score updated at all depended on
whether the instance happened to stay warm. Nothing was ever logged, because
the promise was never observed. The worst case is `productions.verify`:
verified yield is **60% of the entire score**, and confirming a harvest did not
move it.

**[fixed]** Every call site awaits. The `safe*` wrappers already swallow
failures, so awaiting cannot break the request — that was always the point of
the wrapper. Added `safeRecalculateMany()` so the bulk-import path scores once
after the loop instead of firing N un-awaited recalcs inside it.

### C2 · Every PATCH silently reset fields to their creation defaults
`validators/domain.js` — 8 update schemas

Joi's `.fork(keys, s => s.optional())` makes keys optional but **keeps their
`.default()`**. Joi injected the creation defaults into every PATCH body and the
controllers wrote them:

| Request | Also silently wrote |
|---|---|
| `PATCH /cooperatives/:id {"name":"X"}` | `crops_supported: []` — **wiped the crop list** |
| `PATCH /farmers/:id {"phone":"…"}` | `household_size: 1`, `dependents: 0` |
| `PATCH /farmers/:id {"farm":{"soilType":"…"}}` | `plot_count: 1`, `irrigation_access: false`, `water_source: 'rain_fed'`, `years_experience: 0` |
| `PATCH /productions/:id {"notes":"…"}` | `cycle_number: 1` |

**[fixed]** All patch schemas carry `.options({ noDefaults: true })` and
`.min(1)`. Creation schemas keep their defaults; both directions are covered by
tests. The `.min(1)` guard previously could never fire, because the injected
defaults meant the body was never empty.

### C3 · `PATCH /productions/:id` destroyed the record it was editing
`controllers/productions.controller.js:117` (old)

```js
const shaped = shapeProduction({ ...existing, ...req.body });
```

`existing` is a **snake_case** database row; `shapeProduction` read
**camelCase** input. For every multi-word field the spread contributed nothing,
so the mapper fell through to its `?? null` and the UPDATE wrote NULL over:

- `actual_yield_tonnes` — **the verified harvest the credit score is built on**
- `expected_yield_tonnes`, `benchmark_yield_tonnes`, `farm_size_acres`
- `harvest_date`, `harvest_photo_urls`, `warehouse_receipt_url`,
  `buyer_receipt_url`, `agent_signature_url` — the entire evidence trail
- `seed_type`, `fertilizer_used`, `herbicide_used`, `post_harvest_storage`,
  `estimated_farm_income`

Only `season`, `crop` and `notes` survived, because those three spell
identically in both cases. A field agent fixing a typo in the notes destroyed
the season's yield data, and the farmer's score dropped to yield-zero at the
next recalculation.

**[fixed]** `productionPatch()` builds the patch from only the keys present in
the request body. Same split applied to `farmPatch()` in
`farmers.controller.js`, which had the identical bug via a shared insert
builder (it was wiping farm photos, the crop list and the GPS boundary).

### C4 · `email.safe()` was fire-and-forget — 15 flows, including both password deliveries
`services/email/index.js` — **new finding in an already-patched file**

```js
function safe(fn) {
  return (...args) => {
    Promise.resolve(fn(...args)).catch(...);   // returns undefined
  };
}
```

The OTP path had been fixed by awaiting `email.sendOtp` directly, but every
*other* email in the application went through `safe()`, which starts the send
and returns `undefined`. On Vercel all of these were killed when the response
was written:

agent approved / rejected / suspended · **partner created — the only copy of
the auto-generated password** · **partner password reset — likewise** ·
financing submitted / approved / rejected / disbursed / forwarded to partner ·
partner decision to admin · repayment recorded · settlement requested /
approved · cash purchase decision · change request decision · yield
verification decision

The two password flows are the most damaging: the generated password is never
stored anywhere, so a killed send left an account that **nobody could access**
and no one could recover — it had to be reset before first use, and the admin
saw only "partner created".

**[fixed]** `safe()` returns the promise and still never rejects. All 15 call
sites now `await` and log `result.error`. A 16th was found in
`auth.controller.js` (`sendAgentApplicationSubmitted` — the agent's "we
received your application" confirmation); fixed there too, since it is the same
new bug and leaving one inconsistent would invite the next person to copy it.
That handler also notified only `super_admin`, so ops_admin and finance_admin
were never told an application had arrived — now `ADMIN_ROLES`, matching every
other broadcast. `createPartner` and
`resetPartnerPassword` surface a delivery failure to the caller
(`credentialsEmailError` additive field, and a `502 EMAIL_DELIVERY_FAILED`
respectively) so an admin is never told a password was sent when it was not.
Two tests added.

### C5 · Authorisation hole — any agent could read any other agent's farmer roster
`controllers/cooperatives.controller.js` · `listFarmers`

`GET /api/agent/cooperatives/:cooperativeId/farmers` sits behind
`requireFieldAgent` but never checked who owns the cooperative. Any active
field agent could enumerate **any** other agent's entire farmer roster by
cooperative id. Because the select is `*`, each row carried the farmer's NIN,
BVN, phone, address, date of birth and the stored `nin_verification_payload`
from the identity provider. `cooperatives.getById`, two functions above, does
check — this was the unguarded route to the same data.

**[fixed]** `assertCooperativeAccess()` before the query.

### C6 · Authorisation hole — any agent could read any farmer's credit score
`controllers/farmers.controller.js` · `getCreditScore`

`GET /api/agent/farmers/:farmerId/credit-score` had no ownership check, while
every other farmer endpoint in the same file had one. Returned the full score
plus 20 entries of score history for any farmer id.

**[fixed]** `assertFarmerAccess()` before the query.

### C7 · Authorisation hole — any partner could read any farmer's full credit file
`controllers/credit.controller.js` · `farmerCreditReport`, `cooperativeCreditReport`

`routes/partner.routes.js` mounts these under the comment *"Credit reports —
partner-scoped (enforced in credit.controller.js)"*. **Nothing was enforced.**
Any partner user could pull the complete credit file for any farmer in the
system by id: the raw `farmers` row (NIN, BVN, phone, address, date of birth),
every loan, every repayment, every field note.

**[fixed]** Both endpoints now apply the same visibility rule
`partner.controller.search` already used — a farmer named in a financing
request forwarded to this partner, or a member of a cooperative so forwarded.
Admins are unaffected. **Listed under BREAKING.**

### C8 · Partner browse endpoints leaked farmer identity documents to every lender
`controllers/partner.controller.js` · `browseFarmers`, `browseCooperativeFarmers`

The comment above these endpoints reads: *"Identity columns (NIN/BVN/phone) are
returned the same masked way the report screens already handle."* Nothing was
masked anywhere. All three browse endpoints did `select('*')` on `farmers`, so
any lender with a login could page the whole population and read, per farmer:
`nin`, `bvn`, `nin_verification_payload` (the provider response, carrying the
resident's photograph and home address), `id_image_url` (a signed URL to a
photo of their ID document), `phone`, `alt_phone`, `address`, `date_of_birth`.

**[fixed]** `maskFarmerIdentity()` in `utils/shapeFarmer.js`. A lender needs to
know identity is *verified*, not what the identity is. Keys are preserved and
only values are redacted, so the response shape is unchanged. **Listed under
BREAKING** (values change).

### C9 · Settlement double-approval and silent overdraft
`controllers/admin.wallet.controller.js` · `decideSettlement`

Four money bugs in one handler:

1. **No status check.** Approving the same settlement twice — an impatient
   admin, a double-tapped button, a retried request — debited the wallet twice
   and wrote two `settlement` transactions for one payout.
2. **Unchecked writes.** The status update, the balance update and the
   transaction insert all discarded their `error`. A failed balance update
   still marked the settlement approved and emailed the agent "your settlement
   was approved" — money owed, nothing recorded.
3. **Silent overdraft.** `balance: Math.max(0, balance - amount)` clamped a
   negative result to zero, so an over-approval vanished instead of surfacing.
4. Combined with C10, the clamp is what *hid* the over-request.

**[fixed]** Status guarded, and the guard enforced in the UPDATE itself
(`.eq('status','pending')` plus a row-count check) so two concurrent approvals
cannot both win. Ledger row written before the balance is derived; if the
transaction insert fails the request is returned to `pending` rather than left
marked paid with nothing behind it.

### C10 · An agent could request their balance many times over
`controllers/wallet.controller.js` · `requestSettlement`

`if (amount > Number(wallet.balance))` against the stored balance only, with
nothing reserving the funds. An agent with ₦100k could file ten separate ₦100k
requests, each passing the check. The admin then approved them one at a time
and C9's `Math.max(0, …)` clamp absorbed the ₦900k overdraft without a trace.

**[fixed]** Pending requests count against the available balance; the response
reports `balance`, `pendingSettlements`, `available` and `requested` so the app
can explain the refusal.

### C11 · Wallet balance was a drifting counter, not a derived figure
`controllers/admin.wallet.controller.js` · `recordAgentDisbursement` + `decideSettlement`

`agent_wallets.balance` was mutated with read-then-write arithmetic in two
places (`balance = Number(wallet.balance) + amount`). Two concurrent writes
lost one update, and a failed follow-up insert left the counter ahead of the
ledger with nothing to reconcile against. The wallet lazily created itself
through two further unchecked queries, so a create race returned `undefined`
and every caller then dereferenced `wallet.id`.

**[fixed]** `recomputeWalletBalance()` derives the balance from the
transaction ledger (`completed credit − completed settlement`, exactly what the
two writers intended), making both operations idempotent and self-healing.
`ensureWallet()` checks its errors and recovers from a unique-violation race by
reading back the row the other request created.

### C12 · Financing had no state machine at all
`controllers/financing.controller.js` · `adminDecide`, `partnerDecide`

`adminDecide` applied whichever branch the body asked for, regardless of
current state. All silently possible:

- `rejected → approved` — a refused loan resurrected
- `completed → approved` — a repaid loan reopened, discarding the repayment
  position the score depends on
- `disbursed → disbursed` — **double disbursement**: `disbursed_at` reset,
  `disbursed_amount` overwritten, and a second "funds disbursed" email sent

`partnerDecide` had no guard on `partner_decision`, so a partner could flip
approved → rejected → approved indefinitely, re-notifying and re-emailing every
admin and the agent on each pass; and could "approve" a request an admin had
already rejected, because only the `status` write was conditional while
`partner_decision` was overwritten regardless.

**[fixed]** `ADMIN_TRANSITIONS` declared once and enforced before any write;
`PARTNER_DECIDABLE_STATUSES` plus a `partner_decision IS NULL` guard on the
partner side. Both updates are conditional on the state they validated against,
so concurrent deciders cannot both apply a transition. Every update's error is
checked. `forwardToPartnerId` is validated (a typo previously forwarded the
request into a void — it left the admin queue, no partner could see it, nobody
was told).

### C13 · Repayments could be double-counted and credited to the wrong farmer
`controllers/repayments.controller.js` · `create`

- **No idempotency.** The mobile app retries on a dropped connection — the
  common case in the field — and each retry inserted another
  `repayment_record`. The duplicate counted twice toward `total_paid`, which
  feeds the repayment-rate score component and can auto-complete a loan that
  is not actually repaid.
- **No check that the farmer was the borrower**, or that the agent may touch
  that farmer. An agent could record farmer A's repayment against farmer B's
  loan, moving credit between farmers and corrupting both histories.
- The auto-complete write was wrapped in `try/catch`, but supabase-js resolves
  with `{ error }` rather than throwing, so the catch was **unreachable** and a
  failed "mark completed" was discarded. The loan stayed `disbursed` forever
  while showing a zero balance.

**[fixed]** Reference number must be unique per loan (409 on repeat); borrower
identity and agent ownership both verified; all writes error-checked.

### C14 · `financing_requests.total_repaid` was never maintained
Schema declares it `NUMERIC(12,2) DEFAULT 0` with the comment *"cached;
maintained by app"*. **Nothing in the codebase ever wrote it.** It sat at 0 for
every loan ever created. It is returned by `financing.getById` via `select('*')`
and both dashboards receive the request object, so any consumer trusting that
column reported a fully repaid loan as having repaid nothing.

**[fixed]** `recomputeLoanPosition()` maintains it on every repayment and every
void.

### C15 · `signUrl` would sign any object in any bucket
`controllers/uploads.controller.js`

Took `bucket` and `path` straight from the request body with **no validator on
the route** and signed whatever it was handed. Any authenticated field agent
could mint a readable URL for any object in any bucket in the Supabase project:
another agent's selfie, any farmer's ID document or land title, any receipt
image.

Compounding it, the route was **unreachable** — see H1 — so this was a latent
hole that would have opened the moment the ordering was fixed. Both are fixed
together, deliberately.

**[fixed]** Bucket must be in the allow-list derived from `BUCKETS`; path must
match the shape this API generates (`<folder>/<uuid>.<ext>`), blocking
traversal and probing; expiry pinned to one hour; Joi validator added to the
route. **Residual risk noted below.**

### C16 · Private document URLs were signed for ten years
`services/storage/index.js`

`signedExpirySeconds = 60 * 60 * 24 * 365 * 10`. Every private upload — farmer
ID documents, land titles, selfies, receipt images — had its **ten-year** URL
written into a database column. Anyone who ever saw one of those rows, or any
later export, PDF or screenshot of it, held a working and effectively permanent
link to the document, entirely outside any authorisation check this API
performs.

**[fixed]** Default reduced to one year (long enough to live on a record for a
full lending cycle); `getSignedUrl` remains for short-lived on-demand links.

### C17 · "Delete my account" erased the agent's wallet and money ledger
`controllers/profile.controller.js` · `deleteAccount`

The comment said *"Soft-suspend rather than hard delete to preserve audit
trail"* and the code did **both**: suspended the profile *and* called
`auth.admin.deleteUser()`, with the failure swallowed by `.catch(() => null)`.

`agent_wallets.agent_id` references `auth.users(id)` **ON DELETE CASCADE**, and
`wallet_transactions` cascades from the wallet. So an agent tapping "delete my
account" destroyed their own wallet and its entire transaction ledger — the
record of real money disbursed to them — while the farmers, loans and
repayments they had created were left pointing at a user id that no longer
existed. `profiles`, `user_roles` and `agent_applications` cascade too.

**[fixed]** Suspension only, which is what the comment always claimed.
`requireAuth` already refuses a suspended account, so access ends immediately
either way. **Listed under BREAKING.**

---

## High

### H1 · `POST /agent/uploads/sign-url` was unreachable
`routes/agent.routes.js` — registered **after** `/uploads/:kind`, so Express
matched the parameterised route first with `kind = 'sign-url'`. Every call went
to `uploadGeneric` and got `400 Unknown upload kind: sign-url`. The endpoint
has never worked.
**[fixed]** Specific path declared before the parameter that swallowed it.

### H2 · `POST /admin/benchmarks` had no validator
`routes/admin.routes.js` · `controllers/benchmarks.controller.js`

Every farmer's yield score divides by `benchmark_yield_tonnes_per_hectare`. An
admin typing `"4,5"` wrote a non-numeric value and a blank field wrote NULL —
silently zeroing the production score of **every farmer growing that crop in
that state**.
**[fixed]** `upsertBenchmark` Joi schema (`Joi.number().greater(0)`), wired to
the route.

### H3 · Benchmark upsert created duplicate rows instead of updating
`controllers/benchmarks.controller.js`

`onConflict: 'crop,state,lga,season'` relies on `UNIQUE (crop, state, lga,
season)`, but Postgres treats NULLs as **distinct** by default: two rows with
`lga IS NULL` do not conflict. State-level benchmarks — the common case, since
`lga` and `season` are both optional — inserted a **new duplicate row on every
save** rather than updating, and `lookupBenchmark` then picked between the
duplicates arbitrarily.
**[fixed]** When either key is NULL the row is located explicitly and updated.

### H4 · Four list endpoints filtered *after* paginating
`credit.listFarmerScores` (`cooperativeId`) · `admin.wallet.listAllTransactions`
(`agentId`) · `deliveries.list` (farmer-name `search`) ·
`admin.wallet.listCashPurchases` (`agentId`, added)

Each fetched page N of the **unfiltered** table and then dropped non-matching
rows in JavaScript, while `meta.total` reported the unfiltered count. Filtering
a 40-farmer cooperative out of 2000 scores returned an empty first page under a
headline of "2000 results", and paging forward found scattered single entries.
**[fixed]** All filters moved into the query, before `.range()`.

### H5 · Six admin/agent filters were being silently stripped before the controller ran
`validators/domain.js` · `listQuery`

`stripUnknown: true` deletes any key not declared in the schema. These were
read by controllers but never declared, so they did nothing at all, with no
error anywhere:

| Filter | Endpoint | Effect |
|---|---|---|
| `actorId`, `action`, `entityType` | `GET /admin/activity-logs` | all three audit-log filters inert |
| `source`, `transactionType` | `GET /admin/transactions` | returned every transaction regardless |
| `unread` | `GET /agent/notifications` | the mobile app's "unread only" toggle did nothing |

**[fixed]** Declared (plus `q`/`type` for partner search and date filters for
activity). Covered by a test the coordinator added.

### H6 · The admin dashboard's money figures stopped being correct past 1000 rows
`controllers/dashboard.controller.js`

PostgREST truncates an un-ranged select at `db-max-rows` (1000 by default) and
returns the truncated page **with no error**. The dashboard summed
`wallet_transactions.amount` and `repayment_records.amount_paid` with plain
un-ranged selects, so both headline money numbers were "the sum of the first
1000 rows" and froze once the platform passed that many transactions. Status
counts were tallied the same way from the whole `financing_requests` table.
**[fixed]** `sumColumn()`/`fetchAllRows()` page through every row and round
away float drift; status counts use cheap HEAD counts. The response reports
nothing new, but the numbers are now the real ones.

### H7 · Cooperative averages were computed from at most 1000 members, and one NULL poisoned them
`services/credit-score/index.js` · `recalculateCooperativeScore`

`select('id').eq('cooperative_id', …)` with no range (silently capped), error
discarded (read as "this cooperative has no members", writing a 0 average over
a real score), a single `.in()` with every member id (long enough to overflow
the request URL for a large cooperative), and `sum += Number(s.final_credit_score)`
which turned the whole average into **NaN** if one row had a NULL score — NaN
then written to `cooperatives.average_credit_score` and rendered to lenders.
**[fixed]** Paged member fetch, chunked `.in()`, non-finite scores skipped,
errors checked, result clamped.

### H8 · Credit engine: unearned points and unchecked reads
`services/credit-score/index.js`

- **Approved-but-not-disbursed loans ended the first cycle.** The cycle query
  included `'approved'`, so a request an admin had merely approved — no money
  moved, no due date, no repayments possible — made `isFirstCycle` false and
  handed the farmer the default timeliness and default-history points
  immediately. The documented rule is *"no disbursed/completed loan yet"*.
- **Timeliness defaulted to full marks** whenever `due_date` was NULL, which is
  the common case (`dueDate` is optional in the admin decision schema). A
  farmer with a disbursed loan, zero repayments and no due date collected
  `0 + 10 + 5 = 15` points for nothing.
- **Default history also defaulted to full marks** — a farmer with no
  repayment record at all was scored as having a clean record.
- **Negative/NaN yield escaped the band.** `Math.min(actual / benchmark, 1.0)`
  returns a *negative* ratio for a negative actual yield, producing a negative
  production score and a final score below zero presented as a tier-D
  assessment. Same for negative `amount_paid`.
- **Benchmark lookup discarded its error** — a renamed column or RLS change
  meant "no benchmark found" for every crop in the country, silently zeroing
  every farmer's production score. The broader lookup attempts also simply
  omitted the `lga`/`season` filters and used `.limit(1)` with no `ORDER BY`,
  so the same farmer could score differently between two runs.
- **Both production lookups and the two post-upsert writes discarded errors.**

**[fixed]** All of the above, each marked at the site. Timeliness now derives a
due date from `disbursed_at + repayment_window_days` when `due_date` is absent,
and scores 0 with a reported `timelinessBasis` when neither exists. Model
version bumped to `v2.1`. Eight tests added for the pure functions.
**Scores will move — listed under BREAKING.**

### H9 · "How much is owed" meant three different things
`services/credit-score` used `loan_amount` · `farmers.getFinancingHistory` used
`approved_amount || disbursed_amount || loan_amount` · `repayments.create` used
a third variant · `dashboard` and `admin.partners` summed `loan_amount` and
labelled it disbursed/committed.

So the same loan showed a different outstanding balance depending on which
screen you were on, and a farmer who repaid a reduced approval in full was
scored as a part-payer (₦200k approved against a ₦500k ask → 10/25 instead of
25/25, one tier down).
**[fixed]** Single `loanPrincipal()` definition — disbursed, else approved, else
requested, treating 0/null as unset — exported from the credit-score service
and used by all five consumers. **Listed under BREAKING** (values change).

### H10 · `user_roles → profiles` embeds silently returned null, so admins were never emailed
`financing.controller.js` (3 sites) · `changeRequests.controller.js`

`user_roles.select('user_id, profiles(email, full_name)')` — but
`user_roles.user_id` references `auth.users`, **not** `profiles`. PostgREST
cannot infer that relationship and resolves `profiles: null` rather than
erroring. This repo documents the problem in two *other* controllers and works
around it there. Consequently **no admin was ever emailed** about a new
financing request or a partner decision, and no partner seat was emailed about
a forwarded request.

Also: `financing.create` filtered `.eq('role','super_admin')` and
`changeRequests.create` used `['super_admin','ops_admin']`, excluding
`finance_admin` — unlike every other admin broadcast. And the partner
notification insert was nested *inside* `if (pu.profiles?.email)`, so a seat
with no email address got no in-app notification either.
**[fixed]** `utils/profiles.js` provides `getUsersWithRoles()` /
`getPartnerUsers()` doing the correct two-step lookup. All broadcasts use
`ADMIN_ROLES`.

### H11 · `changeRequests.decide` applied changes to live data before claiming the request
The status write came **after** the entity change, with its own error
discarded. If the entity update succeeded and the status write failed, the
change was applied to live data while the request stayed `pending` — so an
admin could approve it again and apply it twice.
**[fixed]** Request claimed first, conditionally on still being `pending`; the
entity change is rolled back to `pending` if applying it fails.

### H12 · `farm_profile` change requests skipped the ownership check entirely
`controllers/changeRequests.controller.js` · `create`

```js
const ownerField = entityType === 'farm_profile' ? null : 'created_by_agent_id';
if (ownerField && entity[ownerField] && ...)
```

`farm_profiles` has no `created_by_agent_id`, so `ownerField` was `null` and the
check was **skipped**. Any field agent could submit a change request against
any farmer's farm profile by id — farm size and crop type, the inputs to the
credit score — and an admin approving it in good faith applied a stranger's
edit to another agent's farmer.

Separately, `entity[ownerField] && entity[ownerField] !== userId` meant a row
with a NULL `created_by_agent_id` (any legacy or imported record) passed the
check for **every** agent.
**[fixed]** Ownership resolved through the parent farmer; NULL owner no longer
grants access.

### H13 · `requireAuth` logged everyone out on a transient database error
`middleware/auth.js`

Both lookups discarded their error. `profile` came back `undefined` on any
transient problem and the middleware answered `401 Account not found`, which
the clients treat as a logout. The role lookup then fell back to
`payload.role` — the role baked into the token — which defeats the stated
purpose of re-reading from the database ("so revoked / suspended users can't
keep using an old token's claims"): a demoted admin whose role read happened to
fail kept their admin claim.
**[fixed]** Fails closed with `503` on a query error. A genuinely absent role
row still falls back to the token claim (a freshly created agent may hit this
before the profile trigger runs) but now logs a warning.

### H14 · Only field agents' account status was checked
`middleware/auth.js` — `requireAdmin` and `requirePartner` checked the role but
not the status, so a `rejected` admin or partner kept full access to their side
of the API (`requireAuth` blocks only `suspended`).
**[fixed]** Both require `status === 'active'`, matching `requireFieldAgent`.

### H15 · Search was broken by any `%`, `_` or `,` in the term
7 endpoints: `farmers.list`, `cooperatives.list`, `partner.search`,
`partner.browseCooperatives`, `partner.browseFarmers`,
`admin.agents.listAgents`, `admin.partners.listPartners`

All interpolated the term straight into `` `%${search}%` ``. In a PostgREST
filter value `%` and `_` are LIKE wildcards (searching `"100%"` matched **every
row** and presented it as a result), and `,` separates filter values — a name
with a comma ("Okafor, Emeka") terminated the filter early and produced a
malformed query that came back as a 400 the dashboards rendered as "no
results".
**[fixed]** `utils/search.js` · `containsPattern()` escapes the metacharacters;
applied at all 7 sites.

### H16 · Agent and cooperative assignment was unverified
- `farmers.create` never verified the cooperative — an agent could attach a new
  farmer to **any** cooperative id, counting that farmer toward another agent's
  member total and their cooperative's average score. **[fixed]**
- `farmers.update` let a farmer be moved into any cooperative, transferring
  them and their score into that rollup. **[fixed]** (both rollups refreshed)
- `financing.create` wrote `farmerId` through with no checks — an agent who
  owned any cooperative could raise a loan naming any farmer in the system.
  **[fixed]** (ownership + cooperative membership)
- `wallet.recordCashPurchase` allowed a purchase to be attached to a loan
  belonging to a different farmer, mis-attributing the spend in every report
  joining on `related_financing_id`. **[fixed]**

### H17 · Hard deletes destroyed financial history
- `farmers.remove` — delete error discarded; `repayment_records.farmer_id`
  cascades, so deleting a farmer who had borrowed either failed silently (the
  API answered `{deleted:true}` and the farmer reappeared) or **destroyed the
  repayment history behind a live loan**. **[fixed]** 409 when financing or
  repayments exist.
- `cooperatives.remove` — `financing_requests.cooperative_id` is **ON DELETE
  CASCADE**, so deleting a cooperative destroyed every loan raised against it
  and, through the repayment cascade, their entire repayment history.
  `farmers.cooperative_id` is ON DELETE SET NULL, so members were silently
  orphaned out of every rollup. **[fixed]** 409 when members or financing
  exist. **Listed under BREAKING.**

### H18 · Double-processing across four more flows
- `admin.wallet.confirmCashPurchase` — no status guard; a purchase could be
  confirmed then rejected, and each pass appended the admin note to
  `description` again, so the stored description grew a new "— note" tail per
  decision. **[fixed]**
- `admin.agents.decideApplication` — no status guard; an application could be
  approved, rejected, approved again, flipping the agent's status and firing
  another "Application approved 🎉" email each time. The `profiles.status`
  write — the thing that decides whether the agent can use the app at all —
  discarded its error, so a failure left the application approved while the
  agent still got "Account is pending". **[fixed]** + rollback.
- `productions.verify` — no status guard; verify/reject cycles moved the score
  up and down and re-emailed each time. **[fixed]**
- `repayments.voidRepayment` — void write discarded its error, so a failed void
  still reported `{voided:true}` and "recomputed" a balance from unchanged
  records. **[fixed]** + conditional claim.

### H19 · `createPartner` could produce an account nobody can log into
`controllers/admin.partners.controller.js`

The profile write was an `UPDATE` against a row created by a database trigger.
An UPDATE matching no rows is **not an error** in PostgREST, so if the trigger
had not run the partner ended up with an auth user and **no profile row** —
and `requireAuth` reads the profile, so that partner could never sign in, with
nothing reporting a problem. Both `user_roles` writes also discarded errors; a
failed insert after a successful delete left the user with no role, which
`requirePartner` rejects.
**[fixed]** Upsert for the profile, errors checked, auth user and partner row
rolled back on failure.

### H20 · Suspending a partner left every partner user with full access
`admin.partners.suspendPartner` / `reactivatePartner` updated by id with the
error discarded and no existence check, so acting on a non-existent id answered
`{suspended:true}`. Suspension is the control that stops a lender seeing
borrower data, making a silently failed suspend a security-relevant false
confirmation. It also only flagged the organisation — every `partner_admin`
seat kept portal access.
**[fixed]** Existence checked, errors checked, and seats suspended with the
organisation.

### H21 · `updatePartner` silently dropped half the fields it accepted
Mapped only 5 of the 9 fields its validator accepts, so an admin editing a
partner's contact name, website or tax ID got a 200 with the change discarded —
the admin form was strictly less capable than the partner's own self-edit.
**[fixed]** All fields mapped; empty patch returns 422 rather than a 500 from
`update({})`.

### H22 · `agent_wallets` lazy creation, N+1 and unbounded `.in()` lists
`changeRequests.list` issued **one query per row** to resolve the entity name
(20 extra round trips for a default page, each error discarded) —
**[fixed]** grouped by table, at most 3 queries.
`partner.search` selected **every member id** of every forwarded cooperative
into a JS Set and sent them all back as one `.in()`; past a few thousand
members the URL exceeded PostgREST's limit, the error was discarded, and search
returned no farmers, looking like "no matches" — **[fixed]** filter runs in the
database per branch. Chunked `.in()` helper (`utils/profiles.chunk`) applied to
`partnerDashboard`, `farmers.getFinancingHistory`, `partner.fieldAgents` and
the cooperative score rollup.

### H23 · `mapFarm` accepted a zero farm size
`overrideSizeAcres` went straight through as the farm size — the denominator of
the yield-per-hectare calculation — and the validator allows `min(0)`. A zero
produced a division by zero; the engine's guard then scored the farmer 0 on
yield with no indication why. Both `farm_profiles` writes also discarded their
errors, so a failed save still returned the computed acreage to the app as
though it had been stored: the agent walked the boundary, saw the area, and
nothing was persisted.
**[fixed]** Both.

### Found in the parallel pass

These three were found and fixed alongside this audit, by the pass working on
the OpenAPI layer and tooling. Recorded here so the backend defect list is
complete in one place.

- **Every approved settlement recorded NULL proof of payment.**
  `validators/domain.js` · `decideSettlement` omitted `referenceNumber` and
  `receiptImageUrl`, while `admin.wallet.decideSettlement` writes both into the
  `wallet_transactions` row. Because `validate()` runs `stripUnknown: true`,
  the middleware deleted them from the body before the controller ran — so the
  bank transfer reference and the receipt image an admin attached to a payout
  were discarded on every single settlement, and the transaction was stored
  with no evidence behind it. Two regression tests. *(This is the exact
  counterpart of H5: a `stripUnknown` schema silently eating fields the
  controller depends on — there it was query filters, here it was payout
  proof.)*

- **Production logs lost the message on 83 of 86 logger call sites.**
  `utils/logger.js` — the pino-style message/meta swap (which un-swaps
  `logger.error({ err }, 'what happened')` into Winston's argument order) ran
  **only** in the `!isProd` branch. In production `format.json()` therefore saw
  the meta *object* as the message and the real message string was dropped
  entirely. Every structured log line this audit added — and every
  pre-existing one — would have reached production without its message. The
  swap now runs in a shared format stage before the dev/prod split. Four tests.

- **`config/index.js` now fails closed on deployed environments.** It refuses
  to boot when `JWT_SECRET` is missing, is the committed
  `dev-only-secret-change-me` placeholder, or is under 32 characters, and
  `RESEND_API_KEY` has joined the required list — without it the email service
  logs `[EMAIL DRY RUN]`, returns `{ skipped: true }` and discards the message,
  so every signup OTP and every password reset was silently dropped while the
  logs looked clean. Since this API's OTP, agent-approval and
  partner-credential flows are all email, an unset key on a deploy is close to
  a total outage of onboarding. (I had flagged this as a recommendation while
  auditing `config/index.js`; it was implemented in the parallel pass, with
  regression tests for both the missing-key case and the newly stricter
  "properly configured deployment" case.)
  Deployment is detected via `VERCEL` / `VERCEL_ENV` /
  `AWS_LAMBDA_FUNCTION_NAME` rather than `NODE_ENV`, because production was
  observed reporting `env=development` — which means the previous
  `if (isProd)` guard was not running in production at all, and a deploy with
  no `JWT_SECRET` would have signed every access token with a secret that is
  public in this repository. Five tests. **I deliberately left this alone**
  when auditing `config/index.js`; see *Not fixed, with reasons*.

---

## Medium

- **`generateAutoPassword` had ~31M of entropy.** `crypto.randomBytes(1).toString('hex')`
  yields two hex characters from **one byte**, so the documented "XX suffix" was
  256 possibilities; with 12 adjectives, 12 nouns and 9000 digits the whole
  space was brute-forceable — and this is the password a partner logs in with.
  **[fixed]** 5 bytes of base36, total space past 10^14. `utils/crypto.js`
- **`deliveries.create` computed money in binary floating point.**
  `quantityKg * pricePerKg` into a `NUMERIC(12,2)` column: 1234.5 × 87.30 gives
  `107772.44999999999`, which Postgres then rounds, so the stored total could
  disagree with the same multiplication done anywhere else. **[fixed]** rounded
  to kobo before writing. Same rounding applied to every money sum added in
  this audit.
- **Multer file-type rejections surfaced as 500s.** `fileFilter` produced a bare
  `Error`, indistinguishable from a crash, so an agent who picked a HEIC photo
  got "Something went wrong". **[fixed]** tagged `INVALID_FILE_TYPE`, mapped to
  400 with the real reason. `middleware/upload.js`, `middleware/error.js`
- **Every Postgres error collapsed into a 500.** A duplicate NIN, a deleted
  cooperative still referenced by a loan, or a `.single()` matching no rows all
  looked identical to a crash, to the client and in the logs. **[fixed]** code
  map (23505→409, 23503→409, 23502/22P02→400, PGRST116→404, 42501→403) and the
  logger now records `code`/`details`/`hint`. `middleware/error.js`
- **A rejected CORS origin returned 500.** `cb(new Error(...))` routes into the
  error handler, so a browser from a non-allowed origin got "Something went
  wrong" logged as an unhandled server error. **[fixed]** `cb(null, false)`
  plus a 403 mapping. `server.js`
- **No process-level rejection handler.** On recent Node versions
  `unhandledRejection` terminates the process by default, so a stray promise
  could take the API down with nothing in the logs. **[fixed]** handlers that
  log and do not exit (the platform owns the lifecycle on serverless).
- **`getPublicUrl` dereferenced without checking.** Returns `{ data: null }`
  for a non-public bucket, throwing a bare TypeError reported as a misleading
  storage failure. **[fixed]** `services/storage/index.js`
- **Bulk import had no row cap.** A 50k-row CSV issued 50k sequential inserts
  in one request; Vercel kills the function long before that, leaving thousands
  of farmers created, no `import_logs` row, and no way to tell what landed.
  **[fixed]** 2000-row limit with a clear error. The `import_logs` insert and
  the per-row farm-profile insert also discarded their errors. **[fixed]**
- **Imported cooperatives were inconsistent with created ones.**
  `cooperatives.create` seeds `cooperative_tier: 'D'`, `average_credit_score: 0`
  and a `cooperative_credit_scores` row; the import path did none of it, so an
  imported cooperative had a NULL tier that lists rendered blank while a
  hand-created one showed 'D'. **[fixed]** + member counts refreshed after import.
- **`notifications.markRead` always answered `{marked:true}`**, including for a
  notification that did not exist or belonged to another user; `unreadCount`
  discarded its error and reported `0`, silently clearing the app's badge.
  **[fixed]**
- **`farmerSeasonalYield` averaged NULL achievement rates as zero.** The
  generated column is NULL when `expected_yield_tonnes` is absent, so one
  season with no expectation recorded dragged the farmer's average achievement
  down. **[fixed]**
- **`farmerCreditReport` score-drop flag never fired after a NULL.**
  `Number(h.final_score)` → NaN, and `NaN < x - 10` is false. **[fixed]**
- **NaN written into three dashboard charts.** `tierCounts[tier] += 1` on an
  unexpected tier value evaluates `undefined + 1`. **[fixed]** in
  `adminDashboard`, `partnerDashboard` and `partner.portfolio`.
- **`partner.portfolio` averaged unscored cooperatives as zero**, so one
  unscored cooperative in a portfolio of three dragged the headline average
  down by a third. **[fixed]** averages only cooperatives that have a score,
  returning `null` when none do.
- **Unbounded report queries.** `farmerCreditReport` had five selects with no
  `.limit()`, silently truncated at 1000 and presented as complete;
  `profile.exportMyData` had five more, so a productive agent's "export all my
  data" returned the first 1000 of each table as a complete export.
  **[fixed]** explicit limits / paged with a `truncated` flag.
- **`productions.update` left a withdrawn verification standing.** Editing the
  actual yield reset verification to `pending` but never rescored, so the score
  kept standing on evidence that had just been withdrawn. Deleting a verified
  yield had the same problem. **[fixed]**
- **`verifyNin` reported results it had not persisted** (update error
  discarded) and pulled the whole farmer row, including the stored
  `nin_verification_payload`, to read three fields. **[fixed]**
- **Empty PATCH bodies produced 500s** in `cooperatives.update`,
  `farmers.update`, `marketAccess.update`, `fieldNotes.update`,
  `profile.updateProfile` and `updatePartner` — `update({})` errors in
  PostgREST and `.single()` turned it into "Something went wrong".
  **[fixed]** 400/422 with a real message; `.single()` → `.maybeSingle()` + 404
  where a missing row is possible.
- **`farmers.create` hid a failed farm-profile insert.** The farmer was
  committed and 201 returned; without a farm profile the farmer can never be
  scored (farm size is the yield denominator). **[fixed]** still non-fatal (the
  farmer row is already committed and losing it is worse) but an additive
  `farmProfileError` field now tells the agent.
- **`settlement_rejected` notification type did not exist**, so a refused
  cash-out told the agent nothing — the request just changed state in the admin
  dashboard. **[fixed]** notification added + `migrations/010_settlement_rejected_notification.sql`.
  Until that migration runs the insert fails the enum check, which is logged
  and non-fatal; the previous behaviour was no notification at all, so it
  cannot regress.
- **`field_notes` delete was not audit-logged**, unlike every other destructive
  action. **[fixed]**

---

## Cleanup (dead code, duplication, inconsistency)

**Deleted as unreferenced:**
- `middleware/auth.js` — `requireRole()`, `requireSuperAdmin` (mounted on no route)
- `middleware/validate.js` — `validateMany()`
- `utils/crypto.js` — `hashPassword`, `verifyPassword` (and the `bcryptjs`
  import behind them) and `generateToken`. Supabase Auth owns every password
  here; dead crypto invites the next person to introduce a second, unmanaged
  credential store.
- `services/storage/index.js` — `deleteFile()` (nothing ever deletes an object,
  and it swallowed its error)
- `controllers/farmers.controller.js` — `recalculateScore()` (the admin route
  uses `credit.recalcFarmer`)
- `services/email/index.js` — `sendCreditScoreAlert` + its
  `templates.creditScoreAlert` template
- `utils/geo.js` — trimmed exports to `measureFarm`; the other five were
  internals exposed as public API

**De-duplicated:**
- `getProfilesForMany` existed in **three** controllers (wallet, admin.wallet,
  activity) with different select lists and none checking the query error;
  `getProfileFor` in two. → `utils/profiles.js`
- `assertFarmerAccess` existed in **three** controllers (productions,
  marketAccess, fieldNotes) with three different select lists, while several
  endpoints that needed the same check had none (C5, C6). →
  `utils/ownership.js`, so a new endpoint cannot forget it.

**Placeholder / invented data removed:**
- `routes/public.routes.js` — `build: '2026-06-26-fieldnote-update-fix'`, a
  hand-bumped string that had **not** been bumped: the one field devs used to
  confirm which build was live was actively lying. Now the real
  `VERCEL_GIT_COMMIT_SHA`, or `local`. The `features` capability block was
  hand-maintained and unverified, and two of the filters it advertised were in
  fact being stripped (H5) — a dev asserting against it would have concluded
  the opposite of the truth. Removed. Two hardcoded `'1.0.0'` strings now read
  `package.json`.
- `imports.downloadTemplate` — shipped two fabricated people ("Adaeze Nwosu",
  "Emeka Okafor") with invented 11-digit NINs against a real-sounding company
  name. An agent filling this in is likely to leave a row behind, and a
  syntactically valid NIN belonging to nobody is exactly what gets submitted to
  an identity provider and then sits in the farmers table. Now one
  unmistakable `EXAMPLE - DELETE THIS ROW` placeholder with no NIN.
- `dashboard.agentExport` — `agent: profileRes.data || { full_name: 'Unknown
  agent' }` printed "Unknown agent" onto an exported PDF as if it were a name.
  Now `null` so the client can render an empty state.
- `dashboard.farmerExport` — hardcoded `counts.cooperative: 1`, so a farmer
  with no cooperative exported as belonging to one.
- **Unscored ≠ tier D.** `farmerExport`, `cooperativeExport` and the
  cooperative list defaulted a missing tier to `'D'`. 'D' is a real assessment
  ("high risk"); a farmer with no score is unassessed, and printing 'D' put a
  judgement on the page the model never made. Now `null` in the exports.
  *(The two defensive fill-ins in `cooperatives.list`/`getById` are left as-is —
  they are documented back-compat for pre-migration rows and the mobile client
  relies on them. Noted, not changed.)*
- `cropsCount` in both exports counted farm-profile **rows**, not crops. A
  farmer has exactly one profile, so every farmer's "crops" column read 1 (or
  0) regardless of growing one crop or six. The cooperative crop list also
  ignored `secondary_crops` entirely. **[fixed]** `cropsForFarmer()`.

**Inconsistencies fixed:**
- `wallet.recordCashPurchase` answered `400 BAD_REQUEST` for ownership
  failures; being refused someone else's record is `403 FORBIDDEN`, and the 400
  made the mobile client show a form-validation error for an authorisation
  problem.
- `notFound(res)` with no message in ~15 places → named messages.
- `related_farmer_id` on `wallet_transactions` was a real column nothing used,
  so a purchase proof could not be traced to its farmer. Now populated, along
  with `created_by_user_id` / `confirmed_by_admin_id` / `confirmed_at`.
- `fieldNotes.update` carried a `// DELETE /field-notes/:noteId` comment.
- `activity.controller.js` had a stray whitespace-only line.
- `admin.wallet.listCashPurchases` gained the `agentId` filter its sibling had.
- `repayments.list` / `productions.list` gained the `farmerId` / `status`
  filters already declared in `listQuery`.

---

## BREAKING

Response **shapes** are unchanged throughout. These change **values, status
codes or permissions**, and all are deliberate corrections:

1. **Credit scores will move on next recalculation** (H8). An
   approved-but-undisbursed loan no longer ends the first cycle; timeliness and
   default history no longer default to full marks. Farmers who were carrying
   up to 15 unearned points will drop; some will change tier. First-cycle
   farmers are capped at 60 (tier C) as the model always documented.
   `model_version` is now `v2.1` so the change is traceable in
   `credit_score_history`.
2. **Partners can no longer read credit reports outside their portfolio** (C7)
   — `GET /partner/credit/farmers/:id/report` and
   `/partner/credit/cooperatives/:id/report` now return 403 outside the
   forwarded set. Directory browse is unaffected. If a dashboard links to
   reports from the full directory, those links will 403 — that is the boundary
   the route comments always claimed.
3. **Farmer identity values are masked on partner endpoints** (C8) — `nin`,
   `bvn`, `phone`, `alt_phone` come back as `••••••••901`;
   `nin_verification_payload`, `id_image_url`, `address` and `date_of_birth`
   come back `null`. Keys and shape unchanged.
4. **`loanAmount` / `outstandingBalance` now measure the disbursed/approved
   principal** (H9), not the requested amount — in `repayments.create`,
   `farmers.getFinancingHistory`, both dashboards and `admin.partners.getPartner`.
   Same keys, corrected values. Loans approved for less than requested will
   show a smaller principal and a smaller outstanding balance.
5. **`DELETE /agent/profile` no longer deletes the auth user** (C17) — it
   suspends only, as its own comment always said. Access still ends
   immediately. The auth user and the wallet ledger now survive.
6. **Deletes return 409 when financial history exists** (H17) —
   `DELETE /farmers/:id` with financing or repayments, and
   `DELETE /cooperatives/:id` with members or financing.
7. **New 409 CONFLICT responses** where flows were previously re-runnable:
   settlement decide, cash-purchase confirm, financing admin/partner decide,
   agent application decide, production verify, repayment void, change-request
   decide, agent suspend/reactivate, partner suspend/reactivate, and duplicate
   reference numbers on repayments / cash purchases / disbursements.
8. **`GET /api/health`** no longer returns `build` as a hand-maintained string
   or the `features` block; `version` now comes from `package.json`.
9. **`POST /admin/benchmarks`** now validates (H2) — previously-accepted
   malformed payloads will 422.
10. **`POST /agent/uploads/sign-url`** starts working (H1) and is restricted to
    known buckets and well-formed paths (C15). Signed URLs from `uploadFile`
    now last 1 year instead of 10 (C16) — **any URL already stored in the
    database keeps its original 10-year expiry**; only newly minted ones change.

11. **`POST /auth/signup/complete`** now notifies all admin roles, not just
    `super_admin` (C4 follow-up in `auth.controller.js` — see below).

**Requires a manual step:** `migrations/010_settlement_rejected_notification.sql`
adds the `settlement_rejected` enum value. Safe to apply at any time; not a
deploy blocker (the insert fails the enum check and is logged until then).

---

## Open — for the API owner

### Cash-purchase amounts are not validated against anything
`wallet.recordCashPurchase` — flagged rather than fixed, as requested.

Nothing constrains the amount an agent can file. There is no check against
their wallet balance, and none against the related loan's `disbursed_amount`,
so an agent can file purchases totalling more than they were ever given. The
amounts also never touch `agent_wallets.balance`: `recomputeWalletBalance()`
deliberately projects only `completed credit − completed settlement`, exactly
reproducing what the two existing writers intended, so this audit did not
change what any balance means.

The decision is what the proof log *is*:

- **(a) An audit trail only** — current behaviour. Then the amount should
  probably still be capped at the related loan's disbursed amount (an agent
  cannot spend more than was released for that loan), and the admin's
  confirmation screen should show running total vs disbursed so an
  over-claim is visible at the point of decision.
- **(b) A real debit** — then confirmed `cash_purchase` rows join the balance
  projection (one line in `BALANCE_DEBIT_TYPES`), `recordCashPurchase` checks
  available balance the way `requestSettlement` now does, and
  `confirmCashPurchase` recomputes the balance. This makes the wallet mean
  "cash this agent still holds", which is probably what an operator expects.

**My view, since it was asked for: allow it, flag it, and block it only at
confirmation.** Not a hard rejection at `POST /agent/wallet/cash-purchases`.

The reasoning is about where the authority sits and what a rejection costs.
A field agent filing a purchase is *reporting something that already
happened* — the seeds are bought, the money is spent. Refusing the filing
does not undo the purchase, it only means the purchase goes unrecorded, and an
unrecorded spend is strictly worse for the audit trail than an over-claimed
one. The agent is also the person least able to resolve the discrepancy: they
cannot see `disbursed_amount`, they may have legitimately topped up from
another disbursement, and the admin may simply not have recorded a transfer
yet (the whole flow is manual — step 2 is an admin typing in a bank transfer
after the fact). A hard 400 in the field, on a phone, with no way to proceed,
is the kind of refusal that ends with the agent not filing at all.

So: accept the filing, compute the over-claim server-side, and surface it to
the admin — who *does* have the authority and the full picture — at the
decision point that already exists. Concretely:

1. On `recordCashPurchase`, compute the running confirmed + pending total for
   the related loan and compare against `loanPrincipal(financing)`. Store the
   verdict on the row (an `exceeds_disbursed` boolean, or just let the admin
   endpoint derive it) and return it in the response so the mobile app can warn
   the agent *before* they submit — a warning they can act on, not a wall.
2. On `GET /admin/cash-purchases`, return `disbursedAmount`, `alreadyFiled` and
   `overBy` per row so the queue can sort and highlight over-claims.
3. On `POST /admin/cash-purchases/:id/confirm`, **refuse `decision: 'confirm'`
   for an over-claiming purchase unless the body carries an explicit
   acknowledgement** (e.g. `overrideReason`, recorded in `admin_notes` and the
   activity log). That is where a hard block belongs: the admin can see the
   numbers, can record the missing disbursement first, and every override
   leaves a named audit entry.

This keeps the field path permissive and the money path strict, which matches
how the rest of this flow already works — the agent files proof, the admin
decides. It also needs no schema change beyond one optional column.

The alternative, **(b) make it a real debit**, is the more honest ledger model
and I would want it eventually — "balance" would then mean "cash this agent
still holds", which is what an operator reading the admin wallet screen almost
certainly assumes it already means. But it changes the meaning of a number both
dashboards display today, so it should be a deliberate migration rather than a
side effect of this audit. The pieces are in place either way:
`recomputeWalletBalance()` is exported, idempotent, and adding confirmed
`cash_purchase` rows to it is one line in `BALANCE_DEBIT_TYPES`.

### Changes made inside the four already-patched files

The brief said to leave `auth.controller.js`, `services/email/index.js`,
`services/nin/index.js` and `middleware/rateLimit.js` alone unless a **new**
bug turned up. Two did. Both are recorded above; listed here explicitly so the
exception is visible rather than buried.

1. **`services/email/index.js` — `safe()` was fire-and-forget (C4).** This is
   the big one: it is the same defect the OTP send in `auth.controller.js` had
   already been fixed for, except `safe()` is the wrapper the *other fifteen*
   email flows go through, including both password deliveries. The earlier
   patch fixed the one call site and left the wrapper that reproduced the bug
   everywhere else. `safe()` now returns its promise and still never rejects.

2. **`auth.controller.js:325` — the sixteenth fire-and-forget email.**
   `email.safe(email.sendAgentApplicationSubmitted)(req.user.email, { fullName })`
   in `completeSignup`, un-awaited, so the agent's "we received your
   application" confirmation was killed when the response was written. Fixed
   by awaiting it (now possible, given 1) and logging a delivery failure. While
   there, the admin notification in the same handler filtered
   `.eq('role', 'super_admin')`, so `ops_admin` and `finance_admin` were never
   told a new application had arrived — unlike every other admin broadcast in
   the codebase, which use `ADMIN_ROLES`. That is now `ADMIN_ROLES` too, and
   the lookup's error is checked.

Nothing else in those four files was touched: `services/nin/index.js` and
`middleware/rateLimit.js` are unmodified, and the nine pre-existing
`FIXED —` markers in `auth.controller.js` are intact.

### Not fixed, with reasons

- **`credit_score_history` is misused as a cooperative trend.** The table holds
  one row **per farmer** per recalculation, tagged with that farmer's
  cooperative. `cooperativeCreditReport` queries it by `cooperative_id` and
  labels the result `scoreTrend`, so the "cooperative score over time" chart is
  actually a stream of individual farmers' scores interleaved. Fixing it needs
  a cooperative-level history table; changing the shape here would break the
  dashboard chart. Noted at the site.
- **`signUrl` residual risk.** An agent who has legitimately seen an object path
  can still re-sign it later. Closing that needs per-object ownership, which
  the storage layer does not record. The bucket allow-list and path shape check
  bound the damage; a `storage_objects(path, owner_id)` table would close it.
- **`admin.agents.listAgents` `.in()` list.** Past ~200 field agents the id list
  risks the PostgREST URL limit. Paging properly needs a join the schema cannot
  express (`user_roles.user_id → auth.users`, not `profiles`). Noted at the site.
- **`express-rate-limit` MemoryStore is per-instance** on Vercel, so limits are
  `(instances × max)`. Already documented in `middleware/rateLimit.js`; needs a
  shared store, which needs a dependency.
- **`brand.logoUrl` defaults to `https://i.imgur.com/RIpNqJw.png`** — a
  third-party image host embedded in every outbound email. Not changed (no
  correct value available here), but it should be a real asset on the brand
  domain before launch.
- **Overpayment is allowed.** `repayments.create` does not reject an amount
  exceeding the outstanding balance; the rate is clamped at 1.0 so the score is
  unaffected. Could be legitimate (interest, fees) — left as behaviour, not a
  bug.
- **Delete semantics are inconsistent**: `marketAccess.remove` and
  `fieldNotes.remove` return `204`, while `farmers.remove` and
  `cooperatives.remove` return `200 {deleted:true}`. Odd rather than wrong, and
  changing either breaks a client. Noted only.
- **`imports.bulkImport` is N+1 by design** (one insert per CSV row). Correct
  for per-row error reporting; now bounded at 2000 rows instead of unbounded.
