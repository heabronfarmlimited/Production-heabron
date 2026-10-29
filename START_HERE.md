# Heabron CoopScore v1 — handover

Three codebases, each source-only and installing cleanly with `npm install`.

| Zip | What it is |
|---|---|
| `heabron-backend-20261027.zip` | Node/Express API (Vercel serverless + Supabase) |
| `heabron-frontend-20261027.zip` | Admin and partner dashboards (React + Vite) |
| `heabron-mobile-20261027.zip` | Field-agent app, React Native / Expo (converted from Flutter) |

The three audit documents are alongside them:
`AUDIT_PLATFORM.md`, `AUDIT_BACKEND.md`, `AUDIT_FRONTEND.md`.

---

## Do this before you deploy the backend

The API now **refuses to start** if it is not safely configured, rather than
booting into a state where it looks fine and quietly fails. Four variables are
required on a deployment:

```bash
# JWT_SECRET — generate a new one:
openssl rand -base64 48

vercel env add JWT_SECRET production
vercel env add NODE_ENV production          # value: production

# Confirm these are already set:
vercel env ls production | grep -E 'RESEND_API_KEY|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY'
```

If any are missing the API will not boot and the log will name them.

**Why this is not optional.** `JWT_SECRET` previously fell back to
`dev-only-secret-change-me`, which is committed to the repository — anyone able
to read the source could mint a token for any role, including admin. The guard
that should have caught this only ran when `NODE_ENV === 'production'`, and the
live API reports `"env": "development"`, so it never ran. Setting or rotating
the secret signs everyone out; if it is currently unset, those sessions are
signed with a public secret anyway.

`RESEND_API_KEY` is required for the same reason: without it the email service
logs `[EMAIL DRY RUN]` and discards the message, so **every signup OTP and
password reset vanishes silently** — the original complaint's exact failure
mode.

Also worth setting, though it only warns:

```bash
vercel env add ALLOWED_ORIGINS production   # e.g. https://admin.heabroncoopscore.com,https://partner.heabroncoopscore.com
```

Unset, it defaults to `*`. Authentication is Bearer-header only so this is not
a session-theft path, but it leaves signup, login and password reset callable
from any website.

### One database step

Run `migrations/010_settlement_rejected_notification.sql` in the Supabase SQL
Editor. It adds the `settlement_rejected` enum value so an agent whose cash-out
is refused is actually notified. Safe at any time, **not** a deploy blocker —
until it runs, the notification insert fails the enum check, is logged, and the
rejection itself still succeeds.

A fresh database needs only `migrations/000_heabron_system_schema.sql`, which
already includes the above. See `migrations/README.md`.

---

## Read this before you judge the first numbers you see

These are deliberate corrections, not regressions. `AUDIT_BACKEND.md` has the
full list of 11 under **BREAKING**; the four that will be noticed first:

1. **Credit scores will move on the next recalculation.** Farmers were
   collecting up to 15 unearned points (an approved-but-undisbursed loan closed
   out the first cycle; timeliness and default history defaulted to full marks).
   Some farmers will drop a tier. `model_version` is now `v2.1` so the shift is
   traceable in `credit_score_history`.
2. **Partners can no longer open credit reports outside their own portfolio**
   (now 403). If a dashboard links to reports from the full directory, those
   links will start failing — that is the boundary the route comments always
   described.
3. **Farmer identity values are masked on partner endpoints** — `nin`, `bvn`,
   `phone` come back as `••••••••901`; `date_of_birth`, `address` and
   `id_image_url` come back `null`. Keys and shape unchanged.
4. **`loanAmount` and `outstandingBalance` now measure the disbursed or
   approved principal**, not the amount requested. A loan approved for less than
   requested will show a smaller principal and a smaller outstanding balance.

---

## What was wrong, in one page

The OTP problem had **four independent causes**, three of which reported
success — which is why the logs looked clean:

1. The OTP send was fire-and-forget, and Vercel freezes the function the moment
   the response is written, killing the in-flight request to Resend.
2. Resend v4 resolves with `{ data: null, error }` instead of throwing, so an
   unverified domain, a bad key or a 429 all logged `"email sent"`.
3. `listUsers()` was unpaginated (50 per page) in four places. Past the 50th
   agent, `email_confirm` was never set, so `signInWithPassword` rejected the
   account as unconfirmed, the real reason was logged at `debug`, and the agent
   was told their password was wrong — with every recovery path equally broken.
4. Rate limiters keyed by IP, under Nigerian carrier NAT where hundreds of
   agents share one address.

Three further defect classes, found across the full audit, explain most of the
rest:

- **supabase-js resolves with `{ data, error }` rather than throwing**, and
  ~90 call sites destructured only `data`. A failed write returned HTTP 200 and
  a failed read rendered as an authoritative empty state. Several `try/catch`
  blocks around these were unreachable code.
- **Un-awaited async work on a frozen lambda.** Nine controllers called
  `safeRecalculateFarmer()` without `await` and sixteen called `email.safe()`,
  which was fire-and-forget by construction. So **credit scores silently
  stopped updating in production** and most of the app's email was killed in
  flight — including both password deliveries, where the generated password is
  never stored, so a killed send left an account nobody could reach.
- **No state machine on any money or approval flow**: settlements could be
  double-approved, loans double-disbursed, repayments double-counted.

And three things that were simply never wired up: the agent-side cash-purchase
routes were implemented, exported and documented but registered on no router —
which left the admin cash-purchase queue permanently empty and its confirm
endpoint unreachable; `decideSettlement` dropped the admin's proof of payment
because the validator omitted two fields the controller writes; and in
production, 83 of 86 log calls were discarding their message text, keeping the
metadata and losing the part that said which operation had failed.

---

## Checking it yourself

Each codebase has one command:

```bash
cd backend  && npm install && npm run verify   # lint + OpenAPI reconciliation + 35 tests
cd frontend && npm install && npm run verify   # lint + production build
cd mobile   && npm install && npm run verify   # typecheck + lint + 93 tests + API contract check
```

All three pass. Two of these gates are new and worth knowing about:

- `backend: npm run check:docs` reconciles the OpenAPI spec against the real
  Express route table in both directions, and fails on a documented-but-missing
  endpoint, a registered-but-undocumented one, a dangling `$ref` or an
  undeclared tag. Coverage went from 65% to 100% with 6 phantom endpoints
  removed. `npm run gen:docs` regenerates the spec for new routes from the Joi
  validators themselves, so the docs cannot describe a request the API rejects.
- `mobile: npm run check:contract` verifies every endpoint the app calls exists
  on the backend **with the method the app uses**, which otherwise only surfaces
  as a 404 or 405 when a user taps the button. Currently clean across 47
  endpoints.

Two diagnostics need your real credentials, so they could not be run here:

```bash
cd backend
node scripts/diagnose-email.js you@example.com   # checks the Resend sending domain is VERIFIED
node scripts/diagnose-otp.js                     # checks the otp_codes insert path
```

The sending-domain check matters: an unverified domain is rejected on every
send, and that is the one OTP cause which cannot be confirmed from the code.

Also worth running once against production:

```sql
-- Agents stranded by cause 3 above: they verified their OTP but cannot log in.
-- Their next login now self-heals, but this shows the backlog.
select u.email, u.created_at, p.status
from auth.users u
left join public.profiles p on p.user_id = u.id
where u.email_confirmed_at is null
order by u.created_at desc;

-- Farmers "verified" by the NIN dev stub, if DOJAH credentials were ever unset.
-- These need re-verification: the stub returned status 'verified' with
-- fabricated details ("Test User", 1990-01-01, "Lagos, Nigeria").
select id, full_name, nin, nin_verification_status, created_at
from public.farmers
where nin_verification_payload->>'devMode' = 'true'
order by created_at desc;
```

---

## Open decisions

Four things were deliberately left for you rather than decided here.

1. **Cash purchases are not checked against anything.** Nothing stops an agent
   filing purchases totalling more than was ever disbursed to them. The backend
   audit's recommendation, with reasoning, is *allow it, flag it, block at
   confirmation*: an agent filing a purchase is reporting money already spent,
   so refusing the filing does not un-spend it — it just means the spend goes
   unrecorded, which is worse for the audit trail. Compute the over-claim
   server-side, surface it in the admin queue, and have the confirm endpoint
   refuse an over-claim without an explicit override reason. The alternative —
   making confirmed purchases a real wallet debit — is the more honest ledger,
   but it changes a number both dashboards display and deserves its own
   migration.
2. **Partner "Borrower Search" stays scoped** to a partner's own portfolio. The
   frontend copy was corrected to match rather than widening the query, because
   the scope is enforced server-side as a deliberate boundary. If partners are
   meant to search the whole directory, that is a product decision.
3. **`brand.logoUrl` defaults to an imgur URL** (`i.imgur.com/RIpNqJw.png`) —
   a third-party image host embedded in every outbound email. It should be a
   real asset on your own domain before launch.
4. **`src/assets/images/auth_bg.png` is 6.5 MB** (carried over from the Flutter
   app, along with a 2 MB app-bar background). That ships inside the app
   bundle; for field agents on mobile data it is worth compressing. Left
   untouched because they are your design assets.

Smaller items noted but not fixed, each with reasoning, are in the **Open** and
**Not fixed** sections of the two audit documents — including the per-instance
rate-limit store on serverless, `credit_score_history` being misused as a
cooperative trend, and inconsistent delete semantics.
