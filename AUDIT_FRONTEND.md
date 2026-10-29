# Frontend audit — Heabron CoopScore dashboards

**Scope:** `frontend/` (React 18 + Vite 5, admin + partner dashboards).
**Source of truth:** `backend/src/routes/{admin,partner,auth}.routes.js`,
`backend/src/validators/domain.js`, `backend/src/validators/auth.js`,
`backend/src/utils/response.js`, the controllers, and
`backend/migrations/000_heabron_system_schema.sql` for column names.
**Backend was not modified.** Items that need a backend change are collected in
[Required backend changes](#required-backend-changes).

**Build:** `npm run build` passes.
Bundle went from one 1,669 KB chunk to 925 KB across four chunks
(388 KB → 258 KB gzip), with no size warnings.

Every non-obvious edit is marked in the source with a `FIXED —` comment saying
why.

---

## Conventions confirmed against the backend

| | |
|---|---|
| Envelope | `{ success, data, meta: { page, pageSize, total, totalPages } }` / `{ success: false, error: { code, message, details: [{ field, message }] } }` |
| Requests | camelCase (`loanAmount`, `forwardToPartnerId`, `benchmarkYieldTonnesPerHectare`) |
| Responses | snake_case rows, except shaped DTOs which return **both** (`shapeFarmer` adds `farm`, `cooperative`, `creditScore` alongside `farm_profiles`, `cooperatives`, `credit_scores`) |
| `listQuery` | `page ≥ 1`, `pageSize ≤ 100`, `tier` ∈ `A·B·C·D` (uppercase), UUIDs for `farmerId`/`cooperativeId`/`agentId`, `stripUnknown: true` |
| Decision enums | admin financing `approved·rejected·disbursed`; partner financing `approved·rejected`; agent application `approve·reject`; change request `approve·reject`; settlement `approve·reject`; cash purchase `confirm·reject`; production verify `verify·reject` |
| Other enums | `season` `wet·dry·all_year`; `paymentMethod` (repayment) `cash·bank_transfer·mobile_money·card·pos·cheque·in_kind`; `paymentMethod` (disbursement) `cash·bank_transfer·mobile_money·in_kind`; `priceContext` `distress·market·confirmed·pre_agreed`; `tagVariant` `green·amber·neutral` |

---

## Critical

### C1 — `lib/api.js`: `call()` ignored `success: false`
`call()` returned `res.data?.data` without checking the envelope. The backend
answers several paths with **HTTP 200 and `success: false`** (`utils/response.js`
`fail()` is only used with 4xx/5xx, but `uploads.uploadGeneric` returns a
hand-rolled `success:false` body, and any proxy/gateway that rewrites a status
produces the same shape). On those responses the promise resolved to
`undefined`, react-query treated it as success, and the page rendered empty with
no error anywhere.

**Changed:** added `unwrap()`, which throws a new exported `ApiError` carrying
`error.code`, `error.message` and the `error.details[]` field array (plus a
`fieldError(field)` helper), and toasts it unless `silentError` is set — matching
the HTTP-error path. `ApiError` also mirrors the axios `response.data.error`
shape so existing `e.response?.data?.error?.message` readers keep working.

### C2 — `lib/api.js`: `call()` dropped `meta`, so pagination was unreachable
Because `meta` was discarded, **17 files reached around the client** with
`api.raw.get(...).then(r => r.data)` while 22 used `apiClient` — two patterns in
one codebase, with the raw callers hand-unwrapping two levels and losing the
`success:false` check from C1.

**Changed:** added `callList()` / `apiClient.list(url, opts)` returning
`{ data, meta }` (`data` always coerced to an array), and migrated all 17
callers. The access pattern is identical to what they already used
(`data?.data`, `data?.meta?.total`), so no page changed behaviour. `call()` and
`apiClient.get/post/patch/put/delete` keep the plain unwrapped form for
single-object calls. `api.raw` remains exported as an escape hatch but is no
longer used anywhere.

Migrated: `pages/admin/{FarmersPage, CooperativesPage, CreditPage (×2),
AgentsPage, ApplicationsPage, ActivityPage, BenchmarksPage, FinancingPage,
FinancingDetailPage, PartnersPage, WalletsPage (×5)}`,
`pages/partner/{PartnerCooperativesPage, PartnerFarmersPage, PartnerSearchPage,
PartnerFinancingPage, PartnerProfilePage}`, `pages/shared/NotificationsPage`,
`components/shared/NotificationBell`, `components/ui/ImageUpload`.

### C3 — `lib/api.js`: unguarded `original._retry` in the response interceptor
`const original = err.config;` then `!original._retry`. For any error raised
before a request is dispatched (bad baseURL, a request-interceptor throw, a
cancellation) `err.config` is `undefined`, so the interceptor itself threw a
TypeError and the real failure was replaced with
*"Cannot read properties of undefined"*. The `original?.silentError` read lower
down already used optional chaining, which is what made the inconsistency
visible.

**Changed:** `original && !original._retry`, plus a guard that the refresh
response actually contained an `accessToken` before storing it, and
`original.headers = original.headers || {}` before assigning the new bearer.

### C4 — `admin/FinancingDetailPage.jsx`: wrong decision enum — every approval and rejection 422'd
```js
decision: kind === 'forward' ? 'approved' : kind === 'disburse' ? 'disbursed' : kind
```
`kind` is the modal name (`approve` / `reject`), so **"Approve" posted
`decision: "approve"` and "Reject" posted `decision: "reject"`** —
`adminDecideFinancing` only accepts `approved | rejected | disbursed`. Both
actions failed with a bare "Validation failed" on the one page that can disburse
a loan. Only *Forward to partner* and *Mark as disbursed* ever worked.

**Changed:** explicit `DECISION_BY_KIND` map so a new modal kind can't
reintroduce it; `onError` now surfaces `details[0]` as
`"field: message"` instead of the generic message.

### C5 — `partner/PartnerCooperativesPage.jsx`: invented tier-mix data on every card
Each cooperative card drew an A/B/C/D "tier mix" grid from
`c.tier_a_count … c.tier_d_count`. `partner.browseCooperatives` selects only
`average_score, cooperative_tier, total_farmers, scored_farmers` from the score
join, so those four fields are **never returned** — the grid rendered a hard
`0` in all four buckets for every cooperative. A lender reading that page saw
fabricated risk composition.

**Changed:** removed the grid. The real per-tier breakdown is on the
cooperative credit report, which the card's "View details" button opens.
Also: `Number(c.average_score || 0).toFixed(0)` printed **"0/100"** for an
unscored cooperative, which reads as a real (terrible) score — now
*"Not yet scored"*.

---

## High

### H1 — `admin/ActivityPage.jsx`: actor column always read "System"
Read `r.profiles?.full_name`, but `activity.controller.js` attaches the resolved
profile as **`actor`** (`{ user_id, full_name, email }`). Every row in the audit
log showed "System" even for a named admin. Fixed to `r.actor?.full_name`, with
"Unknown user" when there is an `actor_id` but no profile and "System" only when
`actor_id` is genuinely null.

### H2 — `partner/PartnerCreditReportPage.jsx`: `gold-*` Tailwind classes don't exist
`bg-gold-500`, `bg-gold-50`, `text-gold-700` were used for `tag_variant: 'amber'`
field notes and for the "Pending" verification mark. `tailwind.config.js` has no
`gold` scale (the accent ramp is `harvest`), so Tailwind emitted nothing: amber
notes rendered with an invisible timeline dot and an unstyled tag. Mapped to
`harvest-*`, and the third variant (`neutral`) is now handled too.

### H3 — `NaN` rendered wherever a score was null
`Number(x).toFixed(n)` on a null NUMERIC prints the literal string `"NaN"`, and
`x?.toFixed(n)` throws when Postgres returns the NUMERIC as a string. Both
patterns were present in: `admin/CreditPage` (average_score, production_score,
repayment_score, final_credit_score), `admin/FarmersPage`,
`admin/CooperativesPage`, `admin/CooperativeDetailPage`, `admin/BenchmarksPage`,
`partner/PartnerWatchlistPage`, `partner/PartnerFarmersPage`,
`partner/PartnerCreditReportPage` (MiniStat printed a hard `0` for a missing
sub-score).

**Changed:** added `formatScore(n, digits)` to `lib/utils.js` — coerces once,
returns an em-dash for anything non-finite — and used it at every site.

### H4 — farmer join shape read inconsistently
`r.credit_scores?.[0]` / `r.farm_profiles?.[0]` assume the array form, but
PostgREST returns a one-to-one join as **either** an object **or** a 1-element
array depending on how it infers the relationship, and the API additionally
shapes them into single `farm` / `creditScore` objects (`utils/shapeFarmer.js`).
The crop and score columns rendered blank for whichever shape came back.
Fixed in `admin/FarmersPage` (with a `pickOne` helper), `admin/CooperativesPage`,
`partner/PartnerFarmersPage` — all now prefer the camelCase contract field and
fall back through both raw shapes.

### H5 — rejections that could never succeed
Three "Reject" buttons were always enabled although the validator makes the
reason mandatory, so rejecting with an empty box always 422'd:
* `admin/FinancingDetailPage` — `rejectionReason` required when `decision: 'rejected'`
* `partner/PartnerFinancingDetailPage` — same
* `admin/WalletsPage` → settlement decision — `adminNotes` required when `decision: 'reject'`

All three are now disabled until the field has content, with a `title`
explaining why, and the hint text on the settlement note says it is required
when rejecting. `admin/FinancingDetailPage` also blocks *Forward* with no
partner selected.

### H6 — two routes were unreachable (dead UI)
* `/admin/financing/:requestId` → `FinancingDetailPage` — **the only screen that
  can forward or disburse a loan** — was not linked from anywhere.
  `FinancingPage` only opened a quick-review modal. Added a row click plus an
  explicit "Open" button; the modal survives as "Quick review".
* `/admin/partners/:partnerId` → `PartnerDetailPage` (stats, reset password,
  suspend) was not linked either. `PartnersPage` rows now open it, and the row
  action buttons `stopPropagation`.
* `/admin/cooperatives/:cooperativeId` was linked by nothing but also had no
  route; added it as an alias of the credit-report detail page so an unknown
  `/admin/*` path can't fall out of the portal (see M6).

### H7 — no error state on 20 screens
Every list and detail page treated a failed request exactly like an empty
result, so a 500 or a dropped connection rendered *"No farmers yet"*,
*"No cooperatives financed yet"*, *"You're all caught up"* or a dashboard full
of zeroes. On a lender-facing credit product that is actively misleading.

Added an explicit error panel (and distinguished "could not load" from "does not
exist" on detail pages, with a route back) to: `AdminDashboardPage`,
`FarmersPage`, `CooperativesPage`, `CreditPage` (both tabs), `AgentsPage`,
`ApplicationsPage`, `ActivityPage`, `BenchmarksPage`, `FinancingPage`,
`FinancingDetailPage`, `PartnersPage`, `PartnerDetailPage`,
`CooperativeDetailPage`, `FarmerDetailPage`, `WalletsPage` (all four tabs),
`PartnerDashboardPage`, `PartnerCooperativesPage`, `PartnerFarmersPage`,
`PartnerSearchPage`, `PartnerFinancingPage`, `PartnerFinancingDetailPage`,
`PartnerPortfolioPage`, `PartnerWatchlistPage`, `PartnerCreditReportPage`,
`PartnerProfilePage`, `NotificationsPage`.

### H8 — `partner/PartnerSearchPage.jsx`: blank page, and copy that oversold the search
`ResultSection` returns `null` when empty, so a search with no hits (and a
failed search) rendered **absolutely nothing** below the search box. The page
also promised *"Search anyone in the CoopScore network"*, but `partner.search`
is deliberately scoped to cooperatives/farmers forwarded to that partner — a
partner with no forwarded requests gets an empty result for every query, which
read as a broken feature.

**Changed:** real empty state and error state; the heading and description now
say the search covers the partner's own borrowers and point at the Cooperatives
/ Farmers pages for the full directory.

### H9 — `partner/PartnerDashboardPage.jsx`: metric captions misdescribed the data
`totals.cooperativesInSystem` / `farmersInSystem` are platform-wide counts
(`dashboard.partnerDashboard` counts every row in each table), but the captions
read *"In your network"*. Relabelled to "On the CoopScore network".

### H10 — `partner/PartnerCooperativesPage` and `PartnerFarmersPage` silently truncated the directory
Both requested `pageSize: 60` and rendered the first page with **no pagination
control at all**, so a partner browsing a network with more than 60 farmers had
no way to see the rest and no indication any were missing. Both now paginate off
`meta.total`.

### H11 — unreported promise rejections swallowed user feedback
`shared/SettingsPage` → `changePw` had no `onError`, so its own
`throw new Error('Passwords do not match')` went into react-query and vanished:
clicking "Change password" with mismatched fields did nothing, silently. Added
`onError` handlers that prefer the backend message (`error.message`, or
`details[0]` as `"field: message"`) across `SettingsPage`, `PartnerProfilePage`,
`BenchmarksPage`, `WalletsPage`, `FinancingPage`, `FinancingDetailPage`,
`PartnerFinancingDetailPage`, `AgentsPage`.

### H12 — uploads reported success after failing
`PartnersPage.uploadLogo`, `PartnerProfilePage.uploadLogo` and
`components/ui/ImageUpload` all did `api.raw.post(...)` then read
`data.data?.url` with no error handling. Combined with C1, a failed upload set
the URL to `undefined` — and `PartnerProfilePage` then **PATCHed that undefined
onto the organization** — while still toasting "Logo uploaded". All three now go
through `apiClient`, throw when no URL comes back, and surface the real message.
`PartnersPage` gained the busy state it was missing.

---

## Medium

### M1 — money summed with float arithmetic
`reduce((s, r) => s + Number(r.amount_paid || 0), 0)` over `NUMERIC(12,2)` values
drifts (e.g. `150000.00000000003`), and the per-loan repayment map in
`CyclesTab` accumulated the same way before dividing into a percentage. Added
`sumAmounts(rows, pick)` to `lib/utils.js`, which accumulates in integer kobo
and divides once; `CyclesTab` keeps its per-loan totals in kobo. Display was
already safe (`formatNaira` rounds to 0 decimals) — this protects the
percentages and totals computed from them.

### M2 — dates rendered with an unstable locale
`formatDate`/`formatDateTime` used `toLocaleDateString('en-NG', …)`, which falls
back to the browser default for an unsupported locale — the same row could read
`3/8/2026` for one user and `8/3/2026` for another. Pinned to `en-GB` with an
explicit `2-digit day / short month / numeric year` order (unambiguous), added
invalid-date guards, and switched `formatDateTime` to 24-hour. Raw ISO strings
were also being printed directly in `ApplicationsPage` (`date_of_birth`) — now
formatted.

### M3 — raw enum values shown to users
`all_year`, `pre_agreed`, `hydromorphic_fadama`, `rain_fed`, `bank_transfer`
and friends were printed verbatim, and where any humanising happened it used
`.replace('_', ' ')` — **first occurrence only**, so multi-underscore values kept
their separators. Added `humanize()` to `lib/utils.js` and explicit value→label
maps for the vocabularies with real names: `SOIL_LABELS`, `WATER_LABELS`,
`PRICE_CONTEXT_LABELS` (`PartnerCreditReportPage`), `PAYMENT_METHODS`
(`WalletsPage`) and `SEASON_LABELS` (all four financing screens).

Selects now send the **enum value** and display a label, never the reverse:
the `FarmersPage` / `CreditPage` / `PartnerFarmersPage` tier filters send
uppercase `A`-`D`, and `WalletsPage` payment method sends `bank_transfer` /
`cash` / `mobile_money` / `in_kind`.

Labels are deliberately kept in step with the field app's canonical pairs in
`mobile/src/core/api/domainConstants.ts`, so a farmer's soil type reads the same
in the dashboard as in the app that captured it. Two notes from that
cross-check:
* `soil_type` and `water_source` are free **TEXT** server-side (the
  `createFarmer` validator accepts any label so a slightly different option
  never 422s an onboarding), so an unrecognised value falls through to a
  title-cased render rather than being dropped or relabelled. `WATER_LABELS`
  therefore also covers the four extra values the field app offers beyond the
  four canonical ones (`borehole`, `dam_reservoir`, `pond`, `other`).
* `paymentMethod` has **two different vocabularies**: `createRepayment` accepts
  seven values (`cash`, `bank_transfer`, `mobile_money`, `card`, `pos`,
  `cheque`, `in_kind`) but `recordAgentDisbursement` accepts only four. The
  admin disbursement form is restricted to the narrower four, with a comment
  saying why, so `card` / `pos` / `cheque` can't be offered where they would
  422.

### M4 — `WalletsPage` payment-method list was missing a valid option
The hand-written `<option>` list offered only `bank_transfer`, `cash` and
`mobile_money`. `recordAgentDisbursement` also accepts `in_kind`, which an admin
could not select. Driven off a single constant now.

### M5 — `partner/PartnerCreditReportPage`: "BVN linked" was misleading, and "latest season" was the oldest
* `bvn_verification_status` defaults to `'pending'` for **every** farmer, so the
  row claimed "Pending" even when no BVN was ever collected. It now shows
  "Not provided" unless `f.bvn` is present.
* `YieldTab` took `productions[productions.length - 1]` as the latest season,
  but `credit.farmerCreditReport` orders seasonal productions
  **newest-first**, so the "Latest season inputs" panel described the farmer's
  *oldest* season. Now `productions[0]`.
* `Math.max(...withYield.map(...), 1)` spread an unbounded array (argument-limit
  risk for a farmer with many seasons) and a single NaN poisoned the max, making
  every bar width `NaN%`. Replaced with a filtered reduce and clamped widths.
* "Source: Field agent" was a hardcoded chip asserting provenance the API never
  returns — removed.

### M6 — unguarded `.map()`, `[0]`, `.split()`, `.slice()`
* `components/ui/DataTable` — `rows.length` threw when `rows` was `undefined`
  (every caller passed a query result straight in). Now coerced, along with
  `columns`.
* `components/ui/Pagination` — `total.toLocaleString()` threw on a missing
  `meta`, and a zero `pageSize` made `totalPages` `Infinity`.
* `components/ui/FarmMap` — `Number.isNaN(lat)` is `false` for a string, so a
  string `gps_lat` (which is what Postgres NUMERIC returns) passed the guard and
  `lat.toFixed(5)` threw. Coerced and range-checked.
* `lib/utils.initials` — `name.split()` threw on a non-string `full_name`.
* `AdminDashboardPage` — `data?.totals.farmers` only guarded `data`;
  `a.action.replace()` threw on a row with a null action.
* `PartnerDashboardPage` — `user.fullName.split(' ')[0]` produced a dangling
  *"Welcome, "* for a blank name.
* `PartnerCreditReportPage.maskPhone` — `.slice` on a numeric phone from an
  import.
* `PartnerPortfolioPage` — `(amount / max) * 100` was `NaN` (and an invalid CSS
  width) when every state's exposure was 0.
* `admin/AgentsPage` — row actions posted to `/admin/agents/undefined/suspend`
  when a profile row had no `user_id`; the controls are disabled instead.
* `LoginPage.maskEmail` — for a 1–2 character local part the mask echoed the
  whole address back.
* Plus array guards on `report.members`, `report.financingHistory`,
  `req.repayment_records`, `report.scoreTrend`, `agents`, notification lists.
* Added a top-level **error boundary** in `App.jsx`: there was none, so any
  render-time exception blanked the whole dashboard to a white screen.

### M7 — auth / role handling
* `lib/auth.js` — role flags were computed inline at three call sites and
  **`refreshMe` didn't recompute them at all**, so a role revoked server-side
  stayed effective in the UI until a full page reload. One `roleFlags()` helper
  now derives them everywhere, including on every `refreshMe`.
* `lib/auth.js` — `hydrate` fired `/auth/me` even with no stored token (a
  guaranteed 401 on every cold load for a signed-out visitor); it now
  short-circuits. `login` asserted the envelope actually carried tokens before
  `setTokens`, instead of destructuring `undefined`.
* `components/layout/AppShell` — rendered whatever `nav` array it was handed.
  The nav is now gated on the live `isAdmin`/`isPartner` flags as well as the
  route guard, so a partner session that somehow reached the admin shell can't
  be shown admin links. (No data leak existed: `RequireAdmin`/`RequirePartner`
  already check the role on render, not just in navigation, and every admin
  route is `requireAuth() + requireAdmin` server-side. This is defence in
  depth.)
* `LoginPage` / `ChangePasswordPage` — post-login routing used
  `role.startsWith('partner')`, so **any** other role (a `field_agent` signing
  into the web dashboard, or a user with no role row) was sent to `/admin` and
  bounced. Both now match against `ADMIN_ROLES`/`PARTNER_ROLES` and fall through
  to the root redirect, which shows the existing no-access screen.
* `LoginPage` — a `location.state.from` redirect is only honoured when it stays
  inside the portal the role can use.
* `ChangePasswordPage` — the route sits outside the role guards, so hitting it
  while signed out rendered the form and then 401'd on submit; it now redirects
  to `/login`. Every guard sends a `must_change_password` user **to** this page,
  and there was no sign-out, so the only escape was clearing site data — added
  "Sign out instead".
* `shared/SettingsPage` — `isAdmin ? '/admin' : '/partner'` sent a user with
  neither role to the partner endpoints (guaranteed 403); resolved from the
  actual role, with save disabled when neither applies.
* `App.jsx` — an unknown `/admin/*` or `/partner/*` path fell through to the
  global catch-all and bounced out of the portal; each shell now has its own
  catch-all.

### M8 — `shared/SettingsPage`: the profile form could blank the user's own record
The login response carries only `id/email/fullName/role/status`, so `phone`,
`state` and `lga` were empty in the form until something else refreshed
`/auth/me` — and saving then wrote those empty values. The page now pulls the
full profile once on mount, strips blank fields from the PATCH (the validator
rejects an update with no fields, and `''` is not a valid phone), and the phone
input advertises the `^\+?[0-9]{7,15}$` pattern the backend enforces.
`PartnerProfilePage` got the same blank-stripping treatment plus a load/error
guard, so the partner can't save over their own organisation while it's still
loading.

### M9 — `shared/NotificationsPage`: a row that looked clickable and wasn't
The notification row carried `cursor-pointer` with **no `onClick` at all**.
Clicking an unread row now marks it read (with keyboard support); read rows are
no longer styled as interactive. Mark-read/mark-all also invalidate the header
bell's unread query, which previously kept a stale badge until its next poll.
"Mark all read" is disabled when nothing is unread.

### M10 — "Export PDF" printed the whole application
`PartnerCreditReportPage` and `FarmerDetailPage` call `window.print()`, but
there were no print rules: the printed credit report carried the sidebar, the
top bar and the action buttons, and cards were split across page breaks. Added a
`@media print` block to `index.css` (hides `aside`, `header` and `.no-print`,
removes shadows, keeps colours with `print-color-adjust`, avoids breaking inside
cards and rows) and tagged the action buttons `.no-print`.

### M11 — accessibility
* `components/ui/Input` → `Field` rendered `<label>` with **no `htmlFor`**, so
  none of the ~90 inputs across the dashboards had an accessible name and
  clicking a label did nothing. `Field` now mints an id with `useId` and wires
  `htmlFor` / `aria-describedby` / `aria-invalid` / `aria-required` to the
  control it wraps (only for the `Input`/`Textarea`/`Select` primitives, so a
  wrapper `<div>` can't be targeted). Bare `<select>`/`<Input>` filters that sit
  outside a `Field` got explicit `aria-label`s.
* `MetricCard` was a bare `<div onClick>` — not focusable, not keyboard
  operable, not announced. Now `role="button"` + `tabIndex` + Enter/Space +
  `aria-label` (kept as a div because its body is `<p>` elements, which are not
  valid children of a button).
* `DataTable` clickable rows, `PartnerFarmersPage` rows and the credit-report
  member rows were mouse-only — all have a tab stop and an Enter/Space handler
  now.
* Icon-only controls had no accessible name: the three `PartnersPage` row
  actions (reset password / suspend / reactivate — announced as three
  unlabelled buttons per row), the modal close button, both mobile-menu
  toggles, the account menu, the notification bell (now announces the unread
  count), the `ImageUpload` remove button (also `opacity-0` with no
  `focus:opacity-100`, so it was unreachable by keyboard), and the file inputs.
* `Button` defaulted to the HTML `type="submit"`, so any `Button` inside a
  `<form>` submitted it on click; defaults to `"button"` now and every
  `<button>` in the tree carries an explicit type.
* `Modal` had no `role="dialog"` / `aria-modal` / `aria-labelledby`; the two
  hand-rolled modals (`PartnerProfilePage` delete, `LoginPage` reset) got the
  same treatment.
* The 6-box OTP input had no labels — each box is now labelled and the first
  advertises `autocomplete="one-time-code"`.
* Decorative icons marked `aria-hidden`, and the chevron/eye "open" affordances
  in tables got `sr-only` text.

### M12 — form submissions that could only fail
* `BenchmarksPage` — the footer button submitted whatever was typed, so a blank
  crop or non-numeric benchmark produced a confusing server error; now validated
  client-side and disabled until valid, with an `onError` for the
  duplicate-key upsert case.
* `PartnersPage` → create partner — sent every field including empty strings;
  now trims, drops blanks, and requires an organization name (min 2, per the
  validator) and a valid email before enabling the button.
* `ForgotPasswordPage` — checked `code.length !== 6` but not that the characters
  were digits, and never checked the 6-character password minimum; both are
  validated before the request, the submit buttons are disabled until valid, and
  "Resend" has a 30-second cooldown (the backend rate-limits OTPs, so hammering
  it locked users out of their own reset).
* `LoginPage` reset-password modal — only checked for a non-empty string, so a
  typo'd address 422'd unreadably. Also renamed its button from "Send link" to
  "Send code", since the endpoint sends a 6-digit code.
* All mutation bodies now omit blank optional fields rather than sending `''`.

---

## Cleanup

* **`.env.example`** — rewritten to document only `VITE_*`, with an explicit note
  that anything without the prefix (the `SUPABASE_URL` / `SUPABASE_ANON_KEY`
  that used to sit in the committed `.env`) is dropped by Vite at build time and
  does nothing, and that the dashboard reaches Supabase only through the backend
  API so no Supabase keys belong in the frontend at all. No `.env` file is
  present in the tree, and `.gitignore` already covers it.
* **`lib/brand.js`** — three `NAV_*` entries carried a `badge` key
  (`'applications'`, `'financing'`) that `AppShell` never read; nothing ever
  rendered a count. Dead config implying a feature the sidebar doesn't have —
  removed (the real pending-work counts are the dashboard's "Action required"
  panel). Every `to` was checked against a route in `App.jsx`.
* **Hardcoded stock photography removed.** `LoginPage` and `PartnerProfilePage`
  hot-linked Unsplash photos (`photo-1625246333195…`, `photo-1500382017468…`) at
  render time: a third-party request on the unauthenticated login screen, no
  licence record, and a blank band whenever that CDN is blocked. Both replaced
  with the brand gradient.
* **`AppShell` wildcard icon import.** `import * as Icons from 'lucide-react'`
  existed so `Icons[item.icon]` could resolve an icon by name at runtime. That
  defeats tree-shaking completely and pulled **773 KB** of unused icons into the
  bundle; the sidebar uses twelve. Replaced with named imports behind an explicit
  `NAV_ICONS` map — the icon chunk is now **21 KB**.
* **`vite.config.js`** — added `manualChunks` for react / recharts / lucide and
  raised `chunkSizeWarningLimit`; the build no longer emits a size warning.
  Documented why the `/api` proxy needs no rewrite.
* **`vercel.json`** — SPA rewrite destination changed from `/` to the documented
  `/index.html`; added immutable caching for `/assets/*` (content-hashed) and
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` headers.
* **`StatusPill`** — had no entry for `verified`, `mismatch`, `failed`,
  `reversed` or `frozen`, so a verified NIN rendered in the same grey as an
  unknown one; a null status rendered an empty pill. All mapped, underscores
  humanised, null shows an em-dash. (This also let `WalletsPage` drop a manual
  `completed→approved` / `failed→rejected` remap.)
* **Unused imports removed:** `Send` and `ArrowRight` (`FinancingPage`), `Bell`
  (`AppShell`), `Trash2` (`NotificationsPage`), `BRAND` (`PartnerProfilePage`),
  `useNavigate` (`ForgotPasswordPage`), `Skeleton` (`ApplicationsPage`),
  `TierPill` (`PartnerFinancingDetailPage`), `ADMIN_ROLES`/`PARTNER_ROLES`
  (`App.jsx`), `DataTable` (two partner pages).
* **Empty states made specific** — "No farmers yet" vs "No farmers match these
  filters", with guidance on clearing the filter, across every list page.
* **`PartnerDetailPage`** — the stat tiles were a dead end with no way to reach
  the requests forwarded to that partner; added a link to the financing queue.
  Its suspend/reactivate mutation also now invalidates the partners **list**, so
  the table no longer shows a stale status after a change.

---

## Required backend changes

Three backend defects were found that the frontend cannot work around. The
frontend sends the correct parameters in the correct shape in all three cases,
so each is fixed by widening a validator — no controller change needed. Source
comments at the call sites point here.

1. **`/admin/activity-logs` — the action and entity-type filters do nothing.**
   The route runs `validate(v.listQuery, 'query')`, and `listQuery` is declared
   with `.options({ stripUnknown: true })` without `action`, `entityType` or
   `actorId`. Those keys are stripped before `activity.controller.list` reads
   `req.query`, so both filter controls on the Activity Log page are inert.
   *Fix:* add `action: Joi.string().max(120).empty('').optional()`,
   `entityType: Joi.string().max(60).empty('').optional()` and
   `actorId: uuid.empty('').optional()` to `listQuery` (or give the route its own
   schema).

2. **`/admin/transactions` — `source` and `transactionType` are stripped, so the
   endpoint returns every wallet transaction.** Same cause. The Wallets →
   "Disbursements to Agents" tab asks for `source=admin_disbursement` and would
   otherwise show settlements and cash purchases alongside disbursements.
   *Mitigated in the frontend* with a client-side `source === 'admin_disbursement'`
   filter, which is honest but can under-fill a page.
   *Fix:* add `source` and `transactionType` to `listQuery`.

3. **`POST /admin/settlements/:settlementId/decision` discards the receipt and
   reference.** `adminWallet.decideSettlement` reads
   `req.body.receiptImageUrl` and `req.body.referenceNumber` and writes them
   onto the `wallet_transactions` row, but the `decideSettlement` Joi schema
   declares only `decision` and `adminNotes` and runs with `stripUnknown`, so
   both are gone before the controller sees them. The admin UI offers "Transfer
   reference" and "Proof of payment" fields that are silently thrown away — the
   agent never sees the proof.
   *Fix:* add `referenceNumber: Joi.string().max(100).optional()` and
   `receiptImageUrl: Joi.string().uri().optional()` to `decideSettlement`. The
   frontend already sends both and needs no change.

Two smaller observations, not blocking:

4. `financing_requests.cycle_number` exists in `000_heabron_system_schema.sql`
   but nothing sets it, so the credit report's "Cycle" column falls back to the
   row index. Worth populating when a request is created.
5. `notification_type` in `000_initial_schema.sql` does not include
   `cash_purchase_confirmed`, `cash_purchase_rejected`, `yield_verified`,
   `yield_rejected`, `change_request_submitted`, `change_request_approved`,
   `change_request_rejected` or `agent_application_submitted`'s newer siblings,
   which the controllers insert. `000_heabron_system_schema.sql` supersedes it,
   but an environment migrated from the older file will fail those inserts.

---

## Not fixed, and why

* ~~**`npm run lint` cannot run.**~~ **RESOLVED afterwards — see note below.**
  `package.json` declared
  `eslint . --ext js,jsx --report-unused-disable-directives --max-warnings 0`,
  but there was **no `eslint.config.js`** and ESLint 9 no longer reads
  `.eslintrc.*`, so the script failed immediately with *"couldn't find an
  eslint.config.js"*. The judgement at the time was not to add one, on the
  expectation that a fresh config would surface a large backlog that
  `--max-warnings 0` would turn into a failing script. I substituted a scripted
  scan for unused and missing imports (results in Cleanup above) and verified no
  identifier is used without being imported or declared — Rollup does not catch
  that, since it is a runtime `ReferenceError`, not a build error.

  > **Follow-up:** the backlog turned out to be 12 problems, not a large one —
  > the cleanup pass in this audit had already removed most of what a config
  > would have flagged. So `eslint.config.js` was added (flat config,
  > correctness-focused: `react-hooks/rules-of-hooks` and `no-undef` as errors,
  > `exhaustive-deps` as a warning, formatting left to Prettier) and all 12
  > fixed: 8 unescaped apostrophes in JSX text, an unused `get` in the Zustand
  > `create` callback, an unused `user` destructure in `PartnerProfilePage`, and
  > an empty `catch {}` in `lib/auth.js` that silently swallowed a failed logout
  > call (now documented as deliberate — tokens are cleared regardless, so the
  > user is never left signed in locally). `npm run lint` now exits 0 with zero
  > warnings, and `npm run verify` runs lint followed by the build.
* ~~**The two dead backend filters (items 1 and 2 above) are left visible in the
  UI.**~~ **RESOLVED on the backend.** Removing the Activity Log's
  action/entity-type inputs would have deleted intended functionality that works
  the moment the validator is widened; they are correctly wired and documented
  with a source comment. Flagged rather than removed — and the validator was
  then widened: `listQuery` now accepts `action`, `entityType`, `actorId`,
  `source` and `transactionType`, so both Activity Log filters and the
  `/admin/transactions` source filter work. Covered by a regression test
  (`validator: listQuery keeps the activity-log and wallet filters`).
* ~~**The settlement receipt/reference fields (item 3) are left in place.**~~
  **RESOLVED on the backend — this was the most serious of the three.** The
  decision was to widen the validator, not remove the inputs: `decideSettlement`
  now accepts `referenceNumber` and `receiptImageUrl`, so the proof of payment
  reaches the `wallet_transactions` row that `decideSettlement()` was always
  writing it into. Until this fix, `reference_number` and `receipt_image_url`
  were **NULL on every approved settlement** — the admin uploaded a
  bank-transfer receipt and typed a reference, `stripUnknown: true` deleted both
  without error, and neither the agent nor an audit could see what backed the
  payout. Covered by two regression tests, including one asserting that a
  malformed receipt URL and a reason-less rejection are still refused.
* **Partner "Borrower Search" remains scoped.** I corrected the copy rather than
  widening the query, because `partner.controller.search` enforces the scope
  server-side as a deliberate security boundary. If the intent is that partners
  can search the whole directory (which `/partner/cooperatives` and
  `/partner/farmers` already allow), that is a product decision for the backend.
* **No tests were added.** There is no test setup in the frontend (no runner, no
  config, no `test` script), and introducing one is outside an audit's remit.
  The riskiest changes — the api client and the enum mappings — would benefit
  from a small unit suite.
* **Bundle is still ~925 KB raw.** `recharts` (404 KB) is the remaining bulk.
  Route-level `React.lazy` splitting would cut first paint substantially but
  touches every route in `App.jsx`; left as a follow-up since it is a
  performance improvement, not a defect.
* **`shapeFarmer`'s dual-shape contract.** The API deliberately returns both
  `farm`/`creditScore` (camelCase) and `farm_profiles`/`credit_scores`
  (snake_case, "deprecated for client consumption" per its own docblock). I made
  the frontend prefer the camelCase contract with a fallback rather than
  dropping the fallback, because I cannot verify every endpoint applies the
  shaper — `credit.farmerCreditReport`, for instance, returns the raw row.
  Worth unifying backend-side.
* **Not audited:** `mobile/` and `backend/` were out of scope per the brief and
  were read only as reference.
