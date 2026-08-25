# Heabron Mobile — Developer Handoff


---
---

## 2. Files changed in the app

### `lib/src/core/utils/api_constants.dart`
Added endpoint constants for new backend features:
- `verifyFarmerNinEndpoint(farmerId)` → `POST /agent/farmers/:id/verify-nin`
- `mapFarmEndpoint(farmerId)` → `POST /agent/farmers/:id/map-farm`
- `farmerSeasonalYieldEndpoint`, `farmerMarketAccessEndpoint`, `farmerFieldNotesEndpoint`
- `productionByIdEndpoint(id)` → `GET/PATCH /agent/productions/:id`
- `marketAccessEndpoint`, `fieldNotesEndpoint`, `changeRequestsEndpoint`
- `walletSettlementsEndpoint` → `/agent/wallet/settlements`

### `lib/src/modules/farmers/domain/repository/farmers_repository.dart` (interface)
Added two methods:
- `Future<String> verifyFarmerNin(String farmerId)` — returns the status string
  (`verified` | `mismatch` | `failed`).
- `Future<double?> mapFarm(String farmerId, List<Map<String,double>> polygon)` —
  returns the server-computed area in acres.

### `lib/src/modules/farmers/data/repository/farmers_remote_repository_impl.dart`
- Implemented `verifyFarmerNin` and `mapFarm`.
- **Bug fix:** `getFarmersbyCooperativeId` was passing `page`/`pageSize` as a GET
  **request body**, which the backend reads from the query string and therefore
  ignored (pagination silently didn't work). Now sent via `queryParameters`.

### `lib/src/modules/farmers/presentation/view/add_farmer_view.dart` and `edit_farmer_view.dart`
- Soil-type dropdown options aligned to the documented Nigerian soil
  classifications: `Sandy`, `Lateritic (Red/Brown)`, `Forest`, `Alluvial`,
  `Hydromorphic (Fadama)` (was `Sandy/Loamy/Clay/Silty`). Display labels only —
  the backend stores them as free text, so no value-mapping is required.

### `env_example.json`
Rewritten to document the `/api` base-URL requirement.

---

## 3. Verified in sync (no change needed)

- **Auth** end to end: signup → verify-otp → signup/complete → login → refresh →
  me → forgot/reset-password → resubmit-nin. Endpoints, request payloads, and
  response shapes (`accessToken`, `refreshToken`, `user`, `application`) all match.
- **Uploads**: `UploadService` posts to `/agent/uploads/:kind` and reads
  `data.url`. All `kind` values you use (`avatar`, `farmer_photo`, `farmer_id`,
  `land_doc`, `farm_photo`, `transaction_receipt`) match backend buckets.
- **Repayment proof flow**: pick image → upload as `transaction_receipt` → send
  `proofPhotoUrl` in `POST /agent/repayments`. Works.
- **Financing request**, **record yields/productions**, **create/edit cooperative**,
  **add/edit farmer** payloads validate against the backend.

### Validation behaviour you can now rely on (handled on the backend)
You do **not** need to change the app for these — the backend was made tolerant:
- Blank optional fields (`referenceNumber: ""`, `altPhone: ""`, etc.) are treated
  as “not provided” instead of erroring.
- `gender` is accepted in any case; `soilType` / `waterSource` accept free text;
  repayment `paymentMethod` accepts `cash`, `bank_transfer`, `mobile_money`,
  `card`, `pos`, `cheque`, `in_kind`.

---

## 4. NIN — how it behaves in the app

- **Field agent**: the NIN entered at registration (`signup/complete`) is verified
  by the backend automatically. The app already sends the 11-digit `nin`.
- **Farmer (entered by the agent)**: the NIN is verified automatically when the
  farmer is created (`POST /agent/farmers`). The app already sends `nin`.
- A manual re-verify is also available now via `verifyFarmerNin(farmerId)` if you
  want to add a button on the farmer details screen (optional — not yet wired to UI).

---

## 5. Intentionally left for you (not bugs)

These are **not** wired to screens yet. The endpoint constants and/or repo hooks
exist so you can add the UI when ready; the backend is ready for all of them.

- **Request Settlement screen** (`request_settlement_view.dart`): currently a stub —
  its Submit button only validates and closes. To make it live, call
  `POST /agent/wallet/settlements` with `{ amount, bankName, accountNumber, accountName }`
  (the constant is `walletSettlementsEndpoint`). It does **not** error as-is.
- **Map farm UI**: `mapFarm()` exists in the repo; add a “capture boundary” screen
  (geolocator is already a dependency) and call it to auto-compute farm size.
- **Market access / field notes / change requests**: create endpoints + constants
  exist (`marketAccessEndpoint`, `fieldNotesEndpoint`, `changeRequestsEndpoint`);
  no agent screens yet. These are mainly admin/partner-facing today.
- **Deliveries**: backend has `/agent/deliveries`; there is no delivery screen in
  the app. Add later if field agents should log produce deliveries from mobile.

---

## 6. Suggested smoke test order (matches the data flow)

1. Sign up → verify OTP → complete profile with NIN → see “under review”.
2. Admin approves the agent (web) → log in on the app.
3. Create a cooperative.
4. Add a farmer (with NIN) under it → confirm the farmer’s NIN status updates.
5. Map / set the farm details.
6. Record a season/yield for the farmer.
7. Submit a financing request.
8. (Web admin) attach recipient account, forward to a partner; (web partner) approve.
9. (Web admin) mark disbursed with reference + proof.
10. On the app, record a repayment with a proof photo.

---

## 7. Onboarding image upload + rejection→NIN routing (fixed this round)

### The upload bug ("requires admin to approve")
**Cause:** during onboarding the app logs in right after OTP (so a token
exists), but the avatar upload was sent to `/auth/uploads/:kind` **without** the
token. That route requires a token (it just doesn't require an *active*
account), so it failed; and the alternative `/agent/uploads/:kind` route is
gated by `requireFieldAgent`, which returns exactly *"Account is pending.
Awaiting admin approval."* for a not-yet-approved agent.

**Fix (in `lib/src/services/upload/upload_service.dart`):**
`uploadFileWithoutAuth` now sends the bearer token (uses `imageHeaders`). The
backend `/auth/uploads/:kind` route accepts a token for a **pending** account
(`requireActive: false`) and allows the `avatar`/`selfie` kinds — so a field
agent can upload during onboarding, before approval. (This mirrors how every
other upload in the app already works.)

So the intended flow now works: **enter email/password → OTP → fill form +
upload profile image → submit → "Profile under review" → admin approves/rejects.**

### Rejection → correction routing
**Cause:** the post-login routing only sent the agent to the NIN screen when
`nin_verification_status == 'failed'`. But a NIN **name mismatch** is
`'mismatch'`, and an admin rejection for any reason sets the account status to
`'rejected'` (NIN may even be `'verified'`). Those cases fell through to
"Profile under review", leaving a rejected agent **stuck with no way to fix
anything**.

**Fix (in `login_controller.dart`):** after login + profile refresh:
- `status == 'active'` → Home
- `status == 'rejected'` **or** NIN status is `'failed'`/`'mismatch'` →
  **NIN correction screen** (shows the rejection reason from
  `user.nin.rejectionReason`, which `/auth/me` already returns)
- otherwise (`pending`/`suspended`) → "Profile under review"

The token is **no longer cleared** before showing those screens, so the
correction screen can authenticate the resubmit + profile refresh.

**Fix (in `nin_update_controller.dart`):** after a successful resubmit (which
flips the account back to `pending` on the backend via `/auth/resubmit-nin`),
the app now lands on "Profile under review" instead of returning to the login
screen.

This means rejection is **not NIN-only**: any rejected agent can open the app,
log in, read the reason, correct their details (name / NIN / DOB), and resubmit
for re-review. The backend re-runs the live NIN check on resubmit.

> Reminder: the correction screen lets the agent edit name, NIN and DOB. If you
> want non-NIN rejections (e.g. a bad selfie) to also let them re-upload the
> image, you can extend that screen later — the backend simply needs the agent
> back in `pending`, which resubmit already does.
