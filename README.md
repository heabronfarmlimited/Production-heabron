# Heabron CoopScore — Backend

REST API for the Heabron CoopScore platform: field-agent app, admin web,
and partner (lender/investor) portal.

- **Stack:** Node.js + Express, Supabase (Postgres + Auth + Storage), Resend (email), NINAuth (NIMC official NIN verification)
- **Lang:** JavaScript (CommonJS, Node 18+)
- **Deploy target:** Vercel (Serverless Functions)
- **Docs:** Swagger UI at `/api/docs`

---

## 1. Quick start (local)

```bash
cd backend
cp .env.example .env       # fill in the values described below
npm install
npm run dev                # http://localhost:4000
```

Open <http://localhost:4000/api/docs> to view the full Swagger UI.

## 2. Required environment variables

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server only — never expose) |
| `SUPABASE_ANON_KEY` | Anon key (only used as a reference) |
| `JWT_SECRET` | A long random string for signing JWTs |
| `RESEND_API_KEY` | Resend API key. Without it, emails are dry-run logged. |
| `RESEND_FROM_EMAIL` | Defaults to `Heabron CoopScore <onboarding@resend.dev>` |
| `PUBLIC_APP_URL` | Frontend URL used in email links |
| `NINAUTH_CLIENT_ID` | Your NIMC NINAuth client ID (see below) |
| `NINAUTH_CLIENT_SECRET` | Your NIMC NINAuth client secret |
| `NIN_DEV_MODE` | Set to `true` to stub NIN verification while building |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow list (default `*`) |
| `BRAND_*` | Optional brand overrides (logo, colors, support email) |

## 3. Database setup

The entire schema lives in a **single migration file**:

```
backend/migrations/000_initial_schema.sql
```

Open the Supabase dashboard for your project → **SQL Editor** → paste the
file contents → run. The script is idempotent and creates everything from
scratch: types, tables, indexes, RLS policies, helper functions, storage
buckets, and seed benchmark rows.

> After running the migration, manually create at least one super_admin:
> in **Auth → Users**, invite/create a user with the admin email, then in
> the SQL editor run:
>
> ```sql
> -- After the user logs in once (creates profile), promote them:
> update user_roles set role = 'super_admin' where user_id = '<USER_UUID>';
> update profiles  set status = 'active'      where user_id = '<USER_UUID>';
> ```

## 4. NINAuth (NIMC) — applying for credentials

The platform uses **NINAuth** for NIN verification — NIMC's official,
free-to-integrate service. Apply at:

> <https://app.ninauth.nimc.gov.ng/developers>

After approval you receive a **Client ID** and **Client Secret**. Put them
in `.env`:

```
NINAUTH_CLIENT_ID=...
NINAUTH_CLIENT_SECRET=...
NIN_DEV_MODE=false
```

While waiting for approval, keep `NIN_DEV_MODE=true` so verification
returns a deterministic stub and the rest of the app works end-to-end.

> If/when NIMC ships breaking changes to NINAuth's wire format, only
> `src/services/nin/index.js` needs to be updated — every caller speaks
> through that wrapper.

## 5. Resend (email) — setup

1. Create a free account at <https://resend.com>.
2. Add your domain (the dashboard walks you through DNS records).
3. Copy your API key into `.env` as `RESEND_API_KEY`.
4. Update `RESEND_FROM_EMAIL` to `Heabron CoopScore <noreply@yourdomain.com>` once the domain is verified.

Until a domain is verified, the default `onboarding@resend.dev` sender
works for testing.

## 6. Deploying to Vercel

```bash
# from /backend
vercel
# answer the prompts; framework preset = Other
```

Add the same environment variables in the Vercel project settings, then
push to your main branch — Vercel auto-deploys.

The repo already includes `vercel.json` which routes every request to
`src/server.js` (Express handles its own routing).

## 7. Project layout

```
backend/
├── docs/swagger/                  ← All OpenAPI docs live here (YAML files, not in code)
│   ├── openapi.yaml
│   ├── paths/                     ← one file per audience
│   │   ├── auth.yaml
│   │   ├── agent.yaml
│   │   ├── admin.yaml
│   │   └── partner.yaml
│   └── schemas/
│       ├── _common.yaml
│       ├── auth.yaml
│       └── domain.yaml
├── migrations/000_initial_schema.sql   ← single consolidated migration
└── src/
    ├── config/                    ← env, supabase client, swagger loader
    ├── middleware/                ← auth, validate, rateLimit, upload, error
    ├── controllers/               ← one file per resource
    ├── services/
    │   ├── credit-score/          ← Heabron credit formula (PDF v1.0)
    │   ├── email/                 ← Resend integration
    │   ├── nin/                   ← NINAuth wrapper
    │   └── storage/               ← Supabase storage helpers
    ├── templates/email/           ← branded HTML email templates
    ├── routes/                    ← express routers per audience
    ├── utils/                     ← logger, response envelope, jwt, crypto, etc.
    ├── validators/                ← Joi schemas
    └── server.js                  ← entry point
```

## 8. API audiences

| Mount | Audience | Auth |
|---|---|---|
| `/api/auth/*` | Anyone (sign-up, login, OTP) | None for sign-up/login; bearer for `/me` |
| `/api/agent/*` | Field-agent mobile app | Bearer JWT, role `field_agent`, status `active` |
| `/api/admin/*` | Admin web | Bearer JWT, role `super_admin` / `ops_admin` / `finance_admin` |
| `/api/partner/*` | Partner portal | Bearer JWT, role `partner_admin` / `partner_analyst` |

## 9. Standard response envelope

Success:
```json
{ "success": true, "data": <any>, "meta": { "page": 1, "pageSize": 20, "total": 87, "totalPages": 5 } }
```

Failure:
```json
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...] } }
```

## 10. Credit score engine

`src/services/credit-score/index.js` implements the formula from the Heabron
Credit Score System Technical Specification (v1.0):

```
Production Score   = min(actualYield / benchmarkYield, 1.0) × 100
Repayment Score    = Rate(60) + Timeliness(25) + DefaultHistory(15)
Final Score        = (Production + Repayment) / 2
```

- First-cycle farmers use Production Score only, capped at Tier C (84%).
- Repayments flagged as `weather` / `market` / `health` (context_flag) are
  excluded from the timeliness penalty.
- Cooperative average score uses the first-cycle members' Production Score
  and the regular members' Final Score.

## 11. Useful endpoints to test first

| Request | What it does |
|---|---|
| `GET  /api/health` | Sanity check |
| `POST /api/auth/signup` then `/verify-otp` then `/signup/complete` | 3-step field-agent registration |
| `POST /api/auth/login` | Get tokens |
| `GET  /api/auth/me` | Inspect role, status, partner |
| `POST /api/admin/partners` | Create a partner (auto-emails credentials) |
| `POST /api/agent/imports` (multipart CSV) | Bulk-onboard farmers |
| `POST /api/admin/financing-requests/{id}/decision` | Approve & forward to partner |

## 12. License

Proprietary — © Heabron Farm Limited.
