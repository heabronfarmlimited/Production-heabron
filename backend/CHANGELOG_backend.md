# Heabron CoopScore — Backend (complete, updated)

This is the full backend with every change applied. It boots clean, all 165
endpoints mount, and each new piece was tested in isolation.

## How to run
1. `npm install`
2. Copy `.env.example` → `.env` and fill in Supabase, Resend, JWT, Dojah keys.
3. Run `migrations/000_heabron_system_schema.sql` once in the Supabase SQL Editor.
4. `npm run dev` (or deploy to Vercel as before).

## Migrations
- `migrations/` now contains a SINGLE consolidated, idempotent migration
  (`000_heabron_system_schema.sql`) that replaces the old 000–009 and all the
  scattered `migration */` folders. Tested fresh / re-run / upgrade — all clean.

## Credit engine — v2.0 (Yield 60 / Repayment 40)
`src/services/credit-score/index.js`
- Yield Performance 0–60, Repayment 0–40 (Rate /25 + Time /10 + Def /5), Final = sum.
- First cycle = yield only. Context-flagged late repayments not penalised.
- Tier bands match the live UI (A≥80, B≥65, C≥50, D<50) via one `TIER_THRESHOLDS`
  constant. Prefers a VERIFIED yield record as the scoring source.
- Adds `computeRecommendedLoan()` for the financing-summary card.

## Email templates — restyled + extended
`src/templates/email/_base.js`, `templates.js`, `src/services/email/index.js`
- New design system (gold accent, eyebrow labels, detailTable/pill/credentials/box helpers).
- 5 new emails wired into their flows: partner decision → admin, manual cash
  purchase submitted + confirmed/rejected, change-request decision, yield-verification decision.

## New / changed endpoints

### Seasonal yield (farmers) + verification
`src/controllers/productions.controller.js`
- `GET  /agent|admin/productions`, `GET /…/productions/:id`, `PATCH /…/productions/:id`
- `POST /agent/productions` (full fields: harvest evidence, input usage)
- `POST /admin/productions/:id/verify`  — verify/reject actual yield (feeds score + emails agent)
- `GET  /agent|admin|partner/farmers/:id/seasonal-yield`  — per-farmer history + summary
- `GET  /admin/cooperatives/:id/yield-volume`  — Seasonal Yield Volume card

### Farm mapping (polygon → area)
`src/utils/geo.js`, `farmers.controller.js`
- `POST /agent|admin/farmers/:id/map-farm` — computes acreage + centroid from the
  GPS boundary, stores `gps_mapped` / `computed_area_acres`, recalculates score.
- `farmRow()` auto-derives area when a polygon is supplied on create/update.

### Market access (offtake history)
`src/controllers/marketAccess.controller.js`
- `GET /…/farmers/:id/market-access`, `POST/PATCH/DELETE /agent/market-access[/:id]`

### Field notes (timeline)
`src/controllers/fieldNotes.controller.js`
- `GET /…/farmers/:id/field-notes`, `POST/DELETE /agent/field-notes[/:id]`

### Pending changes (agent edit → admin approve)
`src/controllers/changeRequests.controller.js`
- `POST /agent/change-requests`, `GET /agent|admin/change-requests[/:id]`
- `POST /admin/change-requests/:id/decision` — applies the change on approve
  (protected-field whitelist; never touches NIN/BVN/verification/score).

### Validators
`src/validators/domain.js`
- Expanded farmer.farm (plotCount, soil/water enums, secondaryCrops max 7),
  delivery (buyerName/warehouse), production (harvest + input fields).
- Added the validators the routes were silently skipping: `voidRepayment`,
  `decideSettlement`, `recordAgentDisbursement`, `confirmCashPurchase`,
  `updatePartnerSelf` — plus `mapFarm`, `updateProduction`, `verifyProduction`,
  `createMarketAccess`, `createFieldNote`, `createChangeRequest`, `decideChangeRequest`.

## Loan flow (already present, now complete)
Agent submits → admin reviews/matches to a partner → partner approves/declines
→ admin notified (now with email) → admin records manual disbursement →
status flows back to the agent. Manual payment path is the active one; wallet
tables remain dormant per instruction.
