# Heabron CoopScore — Field Agent App

React Native (Expo + TypeScript) app for Heabron CoopScore field agents:
cooperative and farmer onboarding, production yields, financing, repayments,
wallet settlements and offline data capture.

This replaces the Flutter app (`devinnov8hub-code/heabron_mobile`). The design
system, screen flow and copy are carried over; the data layer was rebuilt
against the backend contract in
[`heabron-coopscore`](https://github.com/devinnov8hub-code/heabron-coopscore).

---

## Quick start

```bash
npm install

cp .env.example .env
# Fill in STAGING_BASE_URL / PRODUCTION_BASE_URL — the URL MUST include /api
#   e.g. https://heabron-coopscore.vercel.app/api

npx expo start            # Metro, then press i / a, or scan with Expo Go
npm run ios               # native build
npm run android
```

### Verify before you push

```bash
npm run verify            # typecheck + lint + tests
```

All three must be clean. They are, as of the last commit.

---

## Requirements

| | |
|---|---|
| Node | 20 LTS or newer |
| Expo SDK | 52 |
| React Native | 0.76 |
| Xcode | 15+ (iOS) |
| Android SDK | API 34, min 21 |

Android and iOS only — the Flutter app dropped web and Windows, and so does this.

---

## Environment

Values are read in `src/core/config/env.ts` via `app.config.ts` → `expo-constants`,
which replaces Flutter's `--dart-define-from-file=env.json`.

| Variable | Notes |
|---|---|
| `STAGING_BASE_URL` | **Must include the `/api` suffix** |
| `PRODUCTION_BASE_URL` | Same |
| `USE_STAGING` | `false` to build against production; defaults to staging in dev |

There is deliberately **no fallback base URL**. A missing value throws at
startup rather than failing quietly — the Flutter app defaulted to an unrelated
project's domain, so a missing `env.json` sent live traffic to the wrong host.

---

## Architecture

```
src/
  app/                    expo-router routes (thin re-exports; screens live in features/)
  core/
    api/                  client, endpoints, response envelope, AppError,
                          domainConstants, queryClient
    config/               env
    hooks/                usePaginatedList, useMediaPicker, useLocation
    navigation/           routes
    storage/              MMKV wrappers, token/session storage
    theme/                colors, typography, responsive, assets
    utils/                format, toast
  components/             shared widgets (the lib/src/shared equivalents)
  features/<module>/
    api/      model/      hooks/      screens/      components/
  assets/                 fonts, images, icons, json
```

### What replaced what

| Flutter | Here | Why |
|---|---|---|
| `hooks_riverpod` + `ChangeNotifier` | TanStack Query + Zustand | Server state needs caching, retry and pagination; session state needs one reactive source. The Dart controllers hand-rolled all of it per screen. |
| Dio + `NetworkInterceptor` | axios + interceptors | Same contract: bearer token per request, single-flight 401 refresh, retry once. |
| Hive | MMKV | Synchronous, native-backed. Tokens live in a separate encrypted instance. |
| `get_it` service locator | plain module imports | DI by import; no registry to keep in sync. |
| named routes + a 300-line `switch` | expo-router | File-based, typed, deep-linkable. |
| `flutter_screenutil` | `core/theme/responsive.ts` | Same 383×852 design size; `.w/.h/.r/.sp/.spMin` → `w()/h()/r()/sp()/spMin()`. |
| `form_builder_validators` | React Hook Form + Zod | Schemas are shared and testable. |
| `toastification` | `react-native-toast-message` | — |
| `fl_chart` | *(dropped)* | Declared in `pubspec.yaml` but never used anywhere in `lib/`. |

---

## The API contract

`src/core/api/endpoints.ts` holds all ~60 agent endpoints, cross-checked
line by line against `backend/src/routes/{auth,agent}.routes.js`.

Every response is wrapped in the standard envelope:

```jsonc
{ "success": true, "data": …, "meta": { "page", "pageSize", "total", "totalPages" }, "error": null }
```

`src/core/api/client.ts` unwraps it once, so feature code deals in plain
payloads and throws `AppError` on failure. Note that the backend returns
HTTP 200 with `success: false` on some paths — the client treats that as an
error, which the Dart repositories did by checking `isSuccess` by hand.

### Labels vs values — read this before adding a dropdown

`src/core/api/domainConstants.ts` pairs every **display label** with the
**value the Joi validator accepts**:

```ts
export const SOIL_TYPES = [
  { label: 'Lateritic (Red/Brown)', value: 'lateritic_red_brown' },
  …
];
```

This matters. The Flutter app sent display labels straight to the API, so
`soilType: 'Lateritic (Red/Brown)'` and `waterSource: 'River / Stream'` landed
in the database as free text, and the strictly validated fields (`season`,
`paymentMethod`, `priceContext`, `noteType`, `tagVariant`, `gender`, `tier`)
would reject a mismatched label outright with a 422.

**Never pass a label to the API.** Use these constants.
`src/core/api/__tests__/domainConstants.test.ts` fails if a validator drifts.

### Pagination

Use `usePaginatedList`. Do not hand-roll page counters — the Dart controllers
each had this bug:

```dart
hasMore = page < (meta?.totalPages ?? 1);
if (hasMore) page++;    // cursor stops advancing on the last page
```

so once the final page loaded, every further scroll re-fetched it and appended
duplicates. `useInfiniteQuery` derives the next page from the server's `meta`.

---

## Auth flow

```
/  (splash)
 ├─ no token ───────────────────────► /pre-auth ─► /login or /register
 └─ token ─► GET /auth/me ─► status?
              ├─ active ───────────► /(tabs)
              ├─ pending ──────────► /under-review
              ├─ rejected ─────────► /nin-update
              └─ nin failed|mismatch ► /nin-update
```

Registration is three steps sharing a small draft store, because the selfie is
captured on its own route:

1. `POST /auth/signup` — email + password
2. `POST /auth/verify-otp`, then `POST /auth/login` immediately — step 3 and the
   avatar upload both need a bearer token
3. `POST /auth/uploads/avatar` (the pre-approval route), then
   `POST /auth/signup/complete`

`resolveSessionRoute` in `src/features/auth/model/authStore.ts` is the single
place this is decided, shared by splash and login.

### Uploads

`POST /agent/uploads/:kind` for an approved agent;
`POST /auth/uploads/:kind` during onboarding, which accepts a token for a
not-yet-active account and allows only `avatar` and `selfie`. Both require the
bearer token — sending none returns 401, and the `/agent` route returns
"Account is pending. Awaiting admin approval." before approval.

Buckets: `avatar`, `selfie`, `farmer_id`, `farmer_photo`, `farm_photo`,
`land_doc`, `delivery_proof`, `transaction_receipt`.

---

## Offline onboarding

A farmer onboarded without a connection is queued in MMKV with the local URIs
of its image fields. `useOfflineFarmerQueue` attaches a NetInfo listener in the
root layout and drains the queue on every offline → online transition,
uploading the files then POSTing each farmer.

In Flutter this whole mechanism existed but `FarmersController.init()` was never
called, so the listener never attached and auto-sync never ran — the queue only
drained if an agent happened to open a cooperative and tap "Sync Now".

---

## Conventions

See [`CONVENTIONS.md`](./CONVENTIONS.md) — binding for new code. The short
version:

- No fake, demo or placeholder data. Ever. Empty states instead.
- All requests through `api` from `core/api/client.ts`.
- Scale every dimension with `r()` / `w()` / `h()` / `spMin()`; no raw pixels.
- Colours from `colors`, type from `textTheme`; no hex literals in screens.
- Copy is preserved verbatim from the Flutter screens.
- Strict TypeScript, no `any`. Parse API responses through a `parseX` function.
- Comment the *why*. Mark divergences from Flutter with `NOTE —` or `FIXED —`.

---

## Testing

```bash
npm test                  # jest
npm run test:watch
```

Covered so far: session-route resolution and the full label↔value mapping
against the validators. Both are logic that fails silently and expensively in
the field, which is why they come first.

---

## Builds

EAS, configured in `app.config.ts`:

```bash
npx eas build --platform android --profile preview
npx eas build --platform ios --profile preview
```

Bundle IDs: `com.heabron.mobile` on both platforms. Portrait only. Permissions
declared for location (farm boundary mapping), camera and photo library
(farmer photos, ID documents, receipts).

---

## Carried over from the Flutter app

Faithfully: every colour token, the Manrope type scale, all 24 assets, every
screen and its layout, every form field with its exact label and validation
message, every dropdown option list (18 crops, 5 Nigerian soil classifications,
water sources, land ownership, payment methods, context flags), the full auth
flow including NIN verification routing, and the offline queue.

Deliberately not carried over:

- **Fake data.** The Flutter `FarmerExportService` rendered a hardcoded
  repayments table (`LN-34055`, "25kg Rice", "50kg Beans") and five invented
  financing rows into every exported PDF, plus a `455` land-size fallback.
  `CooperativeExportService` had `'76'` and `'12'` as literal stat tiles.
  New cooperatives got leader name "Dev innov8" / phone "08067543299".
- **Committed credentials.** `kDebugMode` prefills in `RegisterController` and
  `LoginController` contained real-looking accounts and a password.
- **Unrelated product code.** An onboarding controller, entity and view from a
  cycle-tracking app ("UteriFlow"), a `PeriodStates` enum, commented-out
  period-log PDF code, and `uteriflow.com` base-URL defaults. The onboarding
  view was 197 lines of fully commented-out code behind no route, so none of it
  ever rendered.
- **Dead code.** `CooperativeExportService` (500 LOC, its only call site
  commented out), an orphaned duplicate `personal_info_step.dart`, `AppState.error`
  (never assigned), `WalletController.requestSettlement` (never called).

### Defects fixed

| Defect in Flutter | Fix |
|---|---|
| Pagination re-fetched the last page forever, appending duplicates | cursor derived from `meta` |
| `EditFarmer` submitted `''`/`0` for unprefilled farm fields, wiping server data | every field prefilled |
| Cooperative lat/lng regex rejected a leading `-` and truncated to 2 dp | signed decimals, validated ±90/±180 |
| `tier` filter was free text; the validator only accepts `A`–`D` | fixed four-option picker |
| Reset-password fields were unmasked and allowed weaker passwords than signup | masked, same complexity schema |
| A rejected agent could never reach the NIN screen from a cold start | shared `resolveSessionRoute` |
| Offline auto-sync never started | wired to NetInfo in the root layout |
| Sync aborted the whole batch on one failure, despite a comment saying otherwise | per-record isolation |
| `FieldNotes`/`MarketAccess` never cleared loading on success | mutations handle it |
| `EditCooperative` called `fetchMore()`, so edits never refreshed | targeted invalidation |
| Dashboard "Add farmer" opened the Cooperatives tab | routes to the add-farmer flow |
| Financing farmer dropdown showed a raw UUID | shows the farmer's name |
| `signup/complete` was sent without the bearer token | client attaches it |
| Repayment proof was labelled "(Optional)" but required | labelled required |
| `dependents` forced a minimum of 1; the backend allows 0 | minimum 0 |
| `secondaryCrops` was unbounded; the validator caps it at 7 | enforced at 7 |
| Only 4 of 7 payment methods offered, shown as raw snake_case | all 7, readable labels |
| Deliveries tab was a hardcoded empty state | wired to `GET /agent/deliveries` |
| Notification badge rendered with no count | reads the real unread count |
| Delete account was a TODO with a dead button | wired, with typed confirmation |
| `User.toJson` serialised the NIN object wrongly, breaking the cache round-trip | correct serialisation |
| Four screens rendered their title twice | single title |

---

## Features the backend supports that now have UI

These endpoints existed and worked, but no Flutter screen reached them:

- **Farm boundary mapping** — `POST /agent/farmers/:id/map-farm`. Walk the
  boundary collecting GPS points (≥3); the server computes acreage and centroid.
- **Manual NIN re-verification** — `POST /agent/farmers/:id/verify-nin`, from
  farmer details, showing `verified` / `mismatch` / `failed`.
- **Deliveries** — `GET`/`POST /agent/deliveries`.
- **Delete flows** — farmer, cooperative, production, field note, market access.
  All were commented out in the Flutter UI; all are supported server-side.
