# API integration map

Every screen and the endpoints it calls, for smoke-testing against a live
backend. Verified against `backend/src/routes/{auth,agent}.routes.js` and
`backend/src/validators/domain.js` in
[`heabron-coopscore`](https://github.com/devinnov8hub-code/heabron-coopscore).

Base URL must include the `/api` suffix.

---

## Auth

| Screen | Route | Endpoints |
|---|---|---|
| Splash | `/` | `GET /auth/me` (only when a token is cached) |
| Pre-auth | `/pre-auth` | — |
| Login | `/login` | `POST /auth/login`, `GET /auth/me` |
| Register step 1 | `/register` | `POST /auth/signup` |
| Register step 2 | `/register` | `POST /auth/verify-otp`, then `POST /auth/login`; `POST /auth/resend-otp` |
| Selfie capture | `/register/selfie` | — (uploaded in step 3) |
| Register step 3 | `/register` | `POST /auth/uploads/avatar`, `POST /auth/signup/complete` |
| Under review | `/under-review` | `GET /auth/me` on focus, `POST /auth/logout` |
| NIN update | `/nin-update` | `POST /auth/resubmit-nin`, `GET /auth/me` |
| Forgot password | `/forgot-password` | `POST /auth/forgot-password` |
| Verify reset code | `/forgot-password/verify` | — (verified at reset; see note) |
| Reset password | `/forgot-password/reset` | `POST /auth/reset-password` |

Token refresh — `POST /auth/refresh` — is automatic, in the axios interceptor
on any 401. One refresh is shared by all waiting requests; a failure clears the
session and routes to login.

**Note on the OTP step:** the reset code is not verified on its own screen,
because the backend has no verify-only endpoint for the `reset` purpose. An
invalid code surfaces at `POST /auth/reset-password`. Same behaviour as Flutter.

---

## Dashboard & shell

| Screen | Route | Endpoints |
|---|---|---|
| Dashboard (tab 0) | `/(tabs)` | `GET /agent/dashboard`, `GET /agent/notifications/unread-count` |
| Activity logs | `/activity-logs` | `GET /agent/dashboard` (reads `recentActivity`) |
| Notifications | `/notifications` | `GET /agent/notifications`, `/unread-count`, `PATCH /:id/read`, `PATCH /read-all`, `DELETE /agent/notifications` |

---

## Cooperatives

| Screen | Route | Endpoints |
|---|---|---|
| Cooperatives (tab 1) | `/(tabs)/cooperatives` | `GET /agent/cooperatives` |
| Cooperative details | `/cooperatives/[id]` | `GET /agent/cooperatives/:id`, `GET /agent/cooperatives/:id/farmers` |
| Create cooperative | `/cooperatives/create` | `POST /agent/uploads/avatar` (logo), `POST /agent/cooperatives` |
| Edit cooperative | `/cooperatives/[id]/edit` | `PATCH /agent/cooperatives/:id` |
| Delete cooperative | *(sheet)* | `DELETE /agent/cooperatives/:id` |
| Financing request | `/cooperatives/[id]/financing/request` | `GET /agent/cooperatives/:id/farmers`, `POST /agent/financing-requests` |
| Financing history | `/cooperatives/[id]/financing` | `GET /agent/financing-requests?cooperativeId=` |
| Financing details | `/financing/[id]` | `GET /agent/financing-requests/:id` |

---

## Farmers

| Screen | Route | Endpoints |
|---|---|---|
| Farmers (tab 2) | `/(tabs)/farmers` | `GET /agent/farmers` |
| Farmer details | `/farmers/[id]` | `GET /agent/farmers/:id`, `GET /agent/farmers/:id/credit-score` |
| Add farmer | `/farmers/add` | uploads ×4 kinds, `POST /agent/farmers` |
| Edit farmer | `/farmers/[id]/edit` | `PATCH /agent/farmers/:id` |
| Delete farmer | *(sheet)* | `DELETE /agent/farmers/:id` |
| Verify NIN | *(farmer details)* | `POST /agent/farmers/:id/verify-nin` |
| Farm boundary | `/farmers/[id]/boundary` | `POST /agent/farmers/:id/map-farm` |
| Production yields | `/farmers/[id]/yields` | `GET /agent/farmers/:id/seasonal-yield` |
| Record / edit yield | `/farmers/[id]/yields/record` | `POST /agent/productions`, `PATCH /agent/productions/:id`, uploads |
| Yield details | `/productions/[id]` | `GET /agent/productions/:id`, `DELETE /agent/productions/:id` |
| Market access | `/farmers/[id]/market-access` | `GET /agent/farmers/:id/market-access` |
| Add / edit market access | `/farmers/[id]/market-access/add` | `POST /agent/market-access`, `PATCH`/`DELETE /agent/market-access/:id` |
| Field notes | `/farmers/[id]/field-notes` | `GET /agent/farmers/:id/field-notes` |
| Add / edit field note | `/farmers/[id]/field-notes/add` | `POST /agent/field-notes`, `PATCH`/`DELETE /agent/field-notes/:id` |
| Record repayment | `/financing/[id]/repayment` | `GET /agent/financing-requests?farmerId=`, `POST /agent/uploads/transaction_receipt`, `POST /agent/repayments` |
| Bulk CSV upload | `/farmers/bulk-upload` | `GET /agent/imports/template`, `POST /agent/imports`, `GET /agent/imports` |

---

## Wallet

| Screen | Route | Endpoints |
|---|---|---|
| Wallet (tab 4) | `/(tabs)/wallet` | `GET /agent/wallet`, `GET /agent/wallet/transactions` |
| Transaction history | `/wallet/transactions` | `GET /agent/wallet/transactions` |
| Transaction details | `/wallet/transactions/[id]` | `GET /agent/wallet/transactions/:id` |
| Request settlement | `/wallet/settlement/request` | `GET /agent/bank-account`, `POST /agent/wallet/settlements` |
| Settlement history | `/wallet/settlement/history` | `GET /agent/wallet/settlements` |

---

## Activities

| Screen | Route | Endpoints |
|---|---|---|
| Activities (tab 3) | `/(tabs)/activities` | `GET /agent/repayments`, `GET /agent/imports`, `GET /agent/deliveries` |

The **Deliveries** tab is live here. In Flutter it was a hardcoded empty state
with no data source, even though the endpoint existed.

---

## Profile

| Screen | Route | Endpoints |
|---|---|---|
| Profile | `/profile` | `GET /auth/me`, `GET /agent/bank-account` |
| Edit profile | `/profile/edit` | `POST /agent/uploads/avatar`, `PATCH /agent/profile`, `GET /auth/me` |
| Bank account | `/profile/bank-account` | `GET`/`PUT /agent/bank-account` |
| Delete account | *(sheet)* | `DELETE /agent/profile` |
| Logout | *(sheet)* | `POST /auth/logout` |

---

## Available but not wired to UI

These endpoints exist on the backend and are declared in
`src/core/api/endpoints.ts`, but no screen calls them yet. The Flutter app had
no UI for them either.

| Endpoint | What it is | Why it's unwired |
|---|---|---|
| `GET`/`POST /agent/change-requests`, `GET /agent/change-requests/:id` | Field-agent edits that need admin approval before applying | No agreed flow yet. The validator accepts `entityType` of `farmer`/`cooperative`/`farm_profile` with `proposedChanges`. Worth designing: it's the clean alternative to agents editing records directly. |
| `POST /agent/uploads-doc/:kind` | Document (non-image) uploads | All current uploads are images; add this when a screen needs to attach a PDF. |
| `POST /agent/uploads/sign-url` | Pre-signed upload URLs | Only needed for direct-to-storage uploads; current flow posts multipart through the API. |
| `POST /auth/change-password` | Change password while signed in | Wired in `authApi` but no screen yet. The profile screen is the natural home — worth adding, since `mustChangePassword` exists on the user model and nothing currently acts on it. |
| `GET /agent/profile/export` | The agent's own data export | Wired in `profileApi`; no UI entry point yet. |
| `POST /agent/deliveries` | Log a produce delivery | Read path is live on the Activities tab; the create form is not built. The dashboard's "Log delivery" action currently opens the Activities tab. |

---

## Smoke-test order

Follows the data dependencies, so each step has what the next one needs.

1. Sign up → verify OTP → complete profile with NIN → land on "under review"
2. Approve the agent in the web admin → the under-review screen picks it up on
   focus, no reinstall needed
3. Create a cooperative
4. Add a farmer under it, with NIN → confirm the farmer's NIN status updates
5. Capture the farm boundary → confirm the server-computed acreage comes back
6. Record a season / yield for the farmer
7. Submit a financing request
8. Web admin: attach a recipient account, forward to a partner; web partner: approve
9. Web admin: mark disbursed with a reference and proof
10. Mobile: record a repayment with a proof photo
11. Wallet: check the balance and transaction, then request a settlement
12. Turn off the network, add a farmer, turn it back on → confirm it auto-syncs

Step 12 is new. In Flutter the queue never drained automatically.

---

## Payload gotchas

Things the backend is strict about, each enforced client-side so a field agent
never sees a bare 422:

| Field | Rule |
|---|---|
| `season` (financing) | exactly `wet` \| `dry` \| `all_year` |
| `paymentMethod` | `cash` \| `bank_transfer` \| `mobile_money` \| `card` \| `pos` \| `cheque` \| `in_kind` |
| `priceContext` | `distress` \| `market` \| `confirmed` \| `pre_agreed` |
| `noteType` | `assessment` \| `disbursement` \| `repayment` \| `registration` \| `visit` \| `general` |
| `tagVariant` | `green` \| `amber` \| `neutral` |
| `gender` | lowercased `male` \| `female` \| `other` |
| `tier` (list filter) | **uppercase** `A` \| `B` \| `C` \| `D` |
| `nin`, `bvn` | exactly 11 digits |
| `accountNumber` | exactly 10 digits |
| `phone` | `/^\+?[0-9]{7,15}$/` |
| `secondaryCrops` | at most **7** items |
| `repaymentWindowDays` | 30–540, default 180 |
| `pageSize` | 1–100, default 20 |
| `gpsLat` / `gpsLng` | ±90 / ±180 |
| `gpsPolygon` (map-farm) | at least **3** points |
| `householdSize` | minimum 1 |
| `dependents` | minimum **0** |
| `farm.cropType`, `farm.farmSizeAcres` | required whenever `farm` is present |

Requests are **camelCase**; responses are **snake_case** (and some DTOs accept
both). Normalisation happens once, in each module's `parseX` function.

`soilType` and `waterSource` are free TEXT server-side, but the canonical
values are documented in the `createFarmer` validator and
`src/core/api/domainConstants.ts` sends those rather than display labels —
Flutter sent the labels, which is why older rows contain values like
`Lateritic (Red/Brown)`.
