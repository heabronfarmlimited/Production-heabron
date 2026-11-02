#!/usr/bin/env node
/**
 * Does every endpoint the dashboards call actually exist?
 *
 * The mobile app has had this check since the first audit; the dashboards did
 * not, and they are the half with no type checking at all — plain JSX, so a
 * path typo or an endpoint that was renamed server-side fails as a 404 toast
 * in front of an admin rather than at build time.
 *
 * It reads the routes the backend registers and the calls the pages make, and
 * reports:
 *
 *   MISSING   — a path the dashboards call that no route serves. Always a bug.
 *   METHOD    — the path exists but not with that verb. Also always a bug.
 *   UNCALLED  — a route nothing calls. Informational: plenty are mobile-only.
 *
 * Exits non-zero on MISSING or METHOD so it can gate a build.
 *
 * Run: node scripts/check-backend-contract.mjs
 * Skips cleanly when no backend is checked out alongside.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const backendRoot = resolve(frontendRoot, '..', 'backend');

if (!existsSync(join(backendRoot, 'src', 'routes'))) {
  console.log('No backend alongside this checkout — skipping the contract check.');
  process.exit(0);
}

/** Every file under a directory, recursively, matching an extension. */
function walk(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

// ─────────────────────────────────────────── what the backend serves

/**
 * Router mount points, read from the app entry rather than assumed: the
 * prefix is half of every path and hardcoding it here is how this check
 * would go quietly wrong after a remount.
 */
function readMounts() {
  const candidates = ['src/app.js', 'src/server.js', 'src/index.js'];
  const mounts = [];
  for (const rel of candidates) {
    const file = join(backendRoot, rel);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(
      /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:[\w.]+\s*,\s*)*(\w+)(?:Routes)?\s*\)/g,
    )) {
      mounts.push({ prefix: m[1], name: m[2] });
    }
  }
  return mounts;
}

const mounts = readMounts();

/** `routerVariable -> mounted prefix`, via the require that defined it. */
function prefixForRouteFile(fileName, src) {
  // e.g. agent.routes.js -> look for a mount whose variable was required from it
  const base = fileName.replace(/\.routes\.js$/, '');
  const direct = mounts.find((m) => m.name.toLowerCase() === base.toLowerCase());
  if (direct) return direct.prefix;
  // Fall back to the router's own file name, which matches the convention.
  const guess = mounts.find((m) => m.prefix.replace(/^\//, '').startsWith(base));
  if (guess) return guess.prefix;
  // Mounted under its own name by convention when nothing else matches.
  void src;
  return `/${base}`;
}

const routes = new Map(); // normalised path -> Set(methods)
/**
 * normalised GET path -> the name of the query validator guarding it.
 *
 * Needed because a query key the validator does not declare is not an error
 * — `stripUnknown: true` deletes it and the request succeeds with the filter
 * silently missing, so every tab shows the same unfiltered rows and looks
 * plausible. That is a worse failure than a 400, and invisible without this.
 */
const queryValidators = new Map();
/** `"<METHOD> <path>"` -> the name of the body validator guarding it. */
const bodyValidators = new Map();

for (const file of walk(join(backendRoot, 'src', 'routes'), '.js')) {
  const src = readFileSync(file, 'utf8');
  const fileName = file.split('/').pop();
  const prefix = prefixForRouteFile(fileName, src);

  for (const m of src.matchAll(
    /router\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]([^\n]*)/g,
  )) {
    const method = m[1].toUpperCase();
    const path = normalise(prefix + (m[2] === '/' ? '' : m[2]));
    if (!routes.has(path)) routes.set(path, new Set());
    routes.get(path).add(method);

    const guard = /validate\(\s*v\.([\w.]+)\s*,\s*'query'\s*\)/.exec(m[3]);
    if (method === 'GET' && guard) queryValidators.set(path, guard[1]);

    // `validate(v.x)` with no second argument guards the BODY.
    const bodyGuard = /validate\(\s*v\.([\w.]+)\s*\)/.exec(m[3]);
    if (method !== 'GET' && bodyGuard) bodyValidators.set(`${method} ${path}`, bodyGuard[1]);
  }
}

/** `:id` and `${x}` collapse to `{}` so paths compare structurally. */
function normalise(path) {
  return path
    .replace(/\$\{[^}]*\}/g, '{}')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
}

// ──────────────────────────────────────── what the dashboards call

const calls = []; // { method, path, file, line, params, body }

/**
 * The keys of the `params: { … }` object of a call, or null when there is
 * none or it is not a plain literal.
 *
 * Three outcomes, deliberately distinct:
 *   an array    — the keys, checkable;
 *   `undefined` — the call passes no `params` object at all, nothing to do;
 *   `null`      — there IS one but it cannot be read statically (a spread, a
 *                 computed key). Counted and reported, never guessed at: a
 *                 checker that invents findings gets switched off, and one
 *                 that hides how little it covered is worse than none.
 */
function paramKeysAfter(src, start) {
  return objectKeysIn(argumentsTextAfter(src, start), 'params');
}

/**
 * The keys of the request BODY of a post/patch/put call.
 *
 * Same three outcomes as `paramKeysAfter`. A body key the validator does not
 * declare is not stripped quietly the way a query key is — `stripUnknown`
 * removes it, so a required field arrives missing and the call comes back
 * 422 with a message about a field the page thought it had sent. (The admin
 * change-request reject sent `reviewNote`; the validator wants `reviewNotes`,
 * required, so every rejection failed.)
 */
function bodyKeysAfter(src, start) {
  return objectKeysIn(argumentsTextAfter(src, start), null);
}

/** The text of a call's argument list, from just after the path string. */
function argumentsTextAfter(src, start) {
  // The call's own argument list, balanced.
  let depth = 1;
  let i = start;
  let quote = null;
  for (; i < src.length && depth > 0; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
  }
  return src.slice(start, i - 1);
}

/**
 * The top-level keys of an object literal inside a call's argument text.
 *
 * `key` names the property holding it (`'params'`), or null for the second
 * positional argument — the request body.
 */
function objectKeysIn(args, key) {
  const at = key ? args.indexOf(`${key}:`) : args.indexOf(',');
  if (at === -1) return undefined;
  const open = args.indexOf('{', at);
  if (open === -1) {
    // A body argument that is not an object literal at all (a variable) is
    // unreadable, not absent — the difference decides whether this check
    // reports honest coverage or a comfortable zero.
    return !key && args.slice(at + 1).trim() !== '' ? null : undefined;
  }
  // For a body, the `{` must be the start of that argument, not something
  // further along (an options object after a non-literal body).
  if (!key && args.slice(at + 1, open).trim() !== '') return null;

  let d = 1;
  let j = open + 1;
  let q = null;
  for (; j < args.length && d > 0; j += 1) {
    const ch = args[j];
    if (q) {
      if (ch === '\\') j += 1;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if (ch === '{') d += 1;
    else if (ch === '}') d -= 1;
  }
  /**
   * Comments go BEFORE the split, not after.
   *
   * Stripping them per-part is too late: a comment containing a comma —
   * "would silently do nothing, showing every season under every tab" — is a
   * top-level comma, so the split lands mid-sentence and the part that
   * follows begins with prose instead of a key. The whole call then reads as
   * unparseable and is skipped, which is how this check quietly covered
   * nothing on its first run. (The backend's schema checker was bitten by the
   * identical mistake, which is why it is worth saying twice.)
   */
  const body = args
    .slice(open + 1, j - 1)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  if (body.includes('...')) return null; // spread — not statically readable

  // Top-level keys only: `name:` or the shorthand `name,`.
  const keys = [];
  let depth2 = 0;
  let buf = '';
  let q2 = null;
  for (let k = 0; k < body.length; k += 1) {
    const ch = body[k];
    if (q2) {
      buf += ch;
      if (ch === '\\') { buf += body[k + 1] ?? ''; k += 1; }
      else if (ch === q2) q2 = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { q2 = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth2 += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth2 -= 1;
    if (ch === ',' && depth2 === 0) { keys.push(buf); buf = ''; continue; }
    buf += ch;
  }
  keys.push(buf);

  const out = [];
  for (const raw of keys) {
    const part = raw.trim();
    if (!part) continue;
    const named = /^(\w+)\s*:/.exec(part);
    if (named) { out.push(named[1]); continue; }
    if (/^\w+$/.test(part)) { out.push(part); continue; }
    return null; // computed key — do not guess at the rest
  }
  return out;
}

for (const file of walk(join(frontendRoot, 'src'), '.jsx').concat(
  walk(join(frontendRoot, 'src'), '.js'),
)) {
  if (file.includes('/scripts/')) continue;
  const src = readFileSync(file, 'utf8');

  /**
   * Matched against the WHOLE FILE, not line by line.
   *
   * Prettier wraps a long call, so the path often sits on the line after
   * `api.patch(` — and a per-line scan missed every one of those. The
   * settings page's profile update was invisible for exactly that reason,
   * which made `PATCH /admin/profile` look like an unreachable endpoint.
   *
   * `[\s\S]*?` spans the newline; the line number is recovered from the
   * match offset so the report still points at the call.
   */
  for (const m of src.matchAll(
    /\bapi\.(get|post|patch|put|delete|list)\s*(?:<[^(]*>)?\(\s*([`'"])([^`'"]+)\2/g,
  )) {
    const raw = m[3];
    // Query strings are not part of the route.
    const path = normalise(raw.split('?')[0]);
    const lineNumber = src.slice(0, m.index).split('\n').length;
    const method = m[1] === 'list' ? 'GET' : m[1].toUpperCase();
    const after = m.index + m[0].length;
    const params = paramKeysAfter(src, after);
    const body = method === 'GET' || method === 'DELETE' ? undefined : bodyKeysAfter(src, after);
    const where = { file: file.replace(frontendRoot + '/', ''), line: lineNumber, params, body };

    /**
     * A path built on an audience prefix — `` `${base}/notifications` ``,
     * where `base` is '/admin' or '/partner' — does not start with a slash
     * once normalised. The leading placeholder is expanded to the two real
     * prefixes and the call is accepted if either resolves, which is what
     * happens at runtime.
     */
    if (path.startsWith('{}/')) {
      for (const prefix of ['/admin', '/partner']) {
        calls.push({ method, path: prefix + path.slice(2), ...where });
      }
      continue;
    }

    if (!path.startsWith('/')) continue;
    calls.push({ method, path, ...where });
  }
}

// ───────────────────────────────────────────────────── compare

/**
 * Does a call path match a registered route?
 *
 * Compared SEGMENT BY SEGMENT with `{}` as a single-segment wildcard on
 * either side, not by string equality — which is what the first version of
 * this script did, and it produced three false positives immediately:
 *
 *   - `/admin/uploads/partner_logo` is served by `/admin/uploads/:kind`. The
 *     route's parameter normalises to `{}` while the call carries a literal
 *     segment, so string equality said "missing" for a call that works.
 *   - `api.post(`/admin/partners/${partnerId}/${action}`)` normalises to
 *     `/admin/partners/{}/{}`, where the second `{}` is really one of two
 *     literals (`suspend`, `reactivate`). A template variable in the call has
 *     to be allowed to stand for a literal route segment too.
 *
 * A checker that cries wolf gets ignored, so this matters more than the
 * couple of lines it costs.
 */
function matches(callPath, routePath) {
  const a = callPath.split('/');
  const b = routePath.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i] || seg === '{}' || b[i] === '{}');
}

/** All routes a call could be hitting, most specific first. */
function candidatesFor(callPath) {
  const found = [];
  for (const [path, methods] of routes) {
    if (matches(callPath, path)) found.push({ path, methods });
  }
  // A literal route beats a parameterised one, as Express resolves it.
  return found.sort(
    (x, y) => (x.path.match(/\{\}/g) || []).length - (y.path.match(/\{\}/g) || []).length,
  );
}

const missing = [];
const wrongMethod = [];

for (const call of calls) {
  const candidates = candidatesFor(call.path);
  if (candidates.length === 0) {
    missing.push(call);
    continue;
  }
  // Accepted if ANY matching route takes the verb: a call with a template
  // variable can legitimately resolve to several routes.
  if (!candidates.some((c) => c.methods.has(call.method))) {
    const allowed = [...new Set(candidates.flatMap((c) => [...c.methods]))].sort().join(', ');
    wrongMethod.push({ ...call, allowed });
  }
}

const uncalled = [...routes.keys()]
  .filter((routePath) => !calls.some((c) => matches(c.path, routePath)))
  .sort();

const line = '─'.repeat(74);
const section = (title, count) =>
  console.log(`\n${line}\n${title}  (${count})\n${line}`);

section('MISSING — called by the dashboards, served by no route', missing.length);
if (missing.length === 0) console.log('  none');
for (const c of missing) {
  console.log(`  ${c.method.padEnd(6)} ${c.path.padEnd(54)} ${c.file}:${c.line}`);
}

section('METHOD NOT ACCEPTED BY THAT ROUTE', wrongMethod.length);
if (wrongMethod.length === 0) console.log('  none');
for (const c of wrongMethod) {
  console.log(`  ${c.method.padEnd(6)} ${c.path.padEnd(44)} allows: ${c.allowed}  (${c.file}:${c.line})`);
}

section('ROUTES NO DASHBOARD CALLS — informational, many are mobile-only', uncalled.length);
console.log(`  ${uncalled.length} of ${routes.size} registered paths`);

/**
 * The admin-only ones are listed in full.
 *
 * An uncalled /agent route is expected — those are the mobile app's. An
 * uncalled /admin route is a feature the backend serves that no screen
 * reaches, which is how four whole admin features came to be unreachable, so
 * it is worth seeing rather than hiding behind a count.
 */
const uncalledAdmin = uncalled.filter((p) => p.startsWith('/admin'));
if (uncalledAdmin.length) {
  console.log(`\n  Admin routes with no screen (${uncalledAdmin.length}):`);
  for (const p of uncalledAdmin) {
    console.log(`    ${[...routes.get(p)].sort().join('/').padEnd(12)} ${p}`);
  }
}

// ───────────────────────── filters the backend would silently throw away

/**
 * Is every query parameter a page sends one the route's validator declares?
 *
 * The validators run with `stripUnknown: true`, so an undeclared key is not
 * refused — it is deleted. The request then succeeds, the filter does
 * nothing, and every tab shows the same unfiltered rows. Nothing anywhere
 * reports it: not the network panel, not the server log, not the screen.
 *
 * (The productions list is the example: its filter parameter is `status`,
 * and a page sending `verificationStatus` would get a 200 with every season
 * in it under all four tabs.)
 */
/**
 * The backend's own Joi schemas, loaded rather than re-described here.
 *
 * Re-listing the accepted keys in this file would mean two places to keep in
 * step, which is the shape of the bug this whole check exists to find.
 */
const { pathToFileURL } = await import('node:url');
let validators = null;
try {
  validators = (
    await import(pathToFileURL(join(backendRoot, 'src', 'validators', 'domain.js')).href)
  ).default;
} catch {
  // The backend's validators need nothing but Joi; if that is not installed
  // over there, say so rather than passing silently.
  console.log('\n  (could not load the backend validators — request keys not checked)');
}

/** The keys a named validator declares, or null if it is not a Joi object. */
const keysOf = (name) => {
  const schema = name.split('.').reduce((o, k) => (o ? o[k] : undefined), validators);
  if (!schema || typeof schema.describe !== 'function') return null;
  return new Set(Object.keys(schema.describe().keys || {}));
};

const strippedParams = [];
let paramsChecked = 0;
let paramsUnreadable = 0;
{
  if (validators) {
    const cache = new Map();
    for (const call of calls) {
      if (call.method !== 'GET') continue;
      if (call.params === undefined) continue; // no params object at all
      if (call.params === null) {
        paramsUnreadable += 1;
        continue;
      }
      // `candidatesFor` yields `{ path, methods }`, not strings.
      const route = candidatesFor(call.path).find((r) => queryValidators.has(r.path))?.path;
      if (!route) continue;
      const name = queryValidators.get(route);
      if (!cache.has(name)) cache.set(name, keysOf(name));
      const allowed = cache.get(name);
      if (!allowed) continue;
      for (const key of call.params) {
        paramsChecked += 1;
        if (!allowed.has(key)) {
          strippedParams.push({ ...call, key, route, validator: name });
        }
      }
    }
  }
}

/**
 * And the same question for request bodies.
 *
 * A body field the validator does not declare is stripped, so the field the
 * page believed it sent never arrives. When that field was required the call
 * comes back 422 naming it — which reads as the backend asking for something
 * the form already filled in. (`reviewNote` vs `reviewNotes` on the
 * change-request reject was exactly this: every rejection failed.)
 */
const strippedBody = [];
let bodyFieldsChecked = 0;
let bodyUnreadable = 0;
if (validators) {
  const cache = new Map();
  for (const call of calls) {
    if (call.method === 'GET' || call.method === 'DELETE') continue;
    if (call.body === undefined) continue;
    if (call.body === null) {
      bodyUnreadable += 1;
      continue;
    }
    const route = candidatesFor(call.path).find((r) =>
      bodyValidators.has(`${call.method} ${r.path}`),
    )?.path;
    if (!route) continue;
    const name = bodyValidators.get(`${call.method} ${route}`);
    if (!cache.has(name)) cache.set(name, keysOf(name));
    const allowed = cache.get(name);
    if (!allowed) continue;
    for (const field of call.body) {
      bodyFieldsChecked += 1;
      if (!allowed.has(field)) {
        strippedBody.push({ ...call, field, route, validator: name });
      }
    }
  }
}

section('BODY FIELDS THE BACKEND WOULD THROW AWAY', strippedBody.length);
if (bodyUnreadable) {
  console.log(`  (${bodyUnreadable} body object(s) built dynamically — not checkable)`);
}
if (strippedBody.length === 0) {
  console.log(
    `  all ${bodyFieldsChecked} body field(s) the dashboards send are declared by their route`,
  );
} else {
  for (const b of strippedBody) {
    console.log(`  ${b.field.padEnd(22)} ${b.method} ${b.path}   ${b.file}:${b.line}`);
    console.log(`      v.${b.validator} does not declare it, so stripUnknown deletes it`);
  }
}

section('FILTERS THE BACKEND WOULD THROW AWAY', strippedParams.length);
if (paramsUnreadable) {
  console.log(`  (${paramsUnreadable} params object(s) built dynamically — not checkable)`);
}
if (strippedParams.length === 0) {
  console.log(
    `  all ${paramsChecked} query parameter(s) the dashboards send are declared by their route`,
  );
} else {
  for (const s of strippedParams) {
    console.log(`  ${s.key.padEnd(22)} ${s.method} ${s.path}   ${s.file}:${s.line}`);
    console.log(`      v.${s.validator} does not declare it, so stripUnknown deletes it`);
  }
}

// ──────────────────────────────── status values against the real enums

/**
 * Do the dashboards' filter tabs use values the database actually has?
 *
 * A path that exists is only half the contract. The Yield Verification screen
 * called a real endpoint with a real method and still returned 400 on every
 * load, because it filtered `status=unverified` and
 * `yield_verification_status` has no such label — Postgres answers that with
 * 22P02 and the request fails outright.
 *
 * `src/lib/statuses.js` now holds those values once and refuses an unknown
 * one at import. That only helps while it agrees with the database, so it is
 * compared here against the backend's `src/utils/enums.js`, which is itself
 * checked against the migrations by `npm run check:schema` over there. Add a
 * label to the schema and this fails until it is added here too.
 */
const statusProblems = [];
{
  const frontendFile = join(frontendRoot, 'src', 'lib', 'statuses.js');
  const backendFile = join(backendRoot, 'src', 'utils', 'enums.js');

  /** `name: [...]` label lists out of either file, without importing them. */
  const readLabels = (file) => {
    const src = readFileSync(file, 'utf8');
    const out = new Map();
    for (const m of src.matchAll(/(\w+):\s*(?:Object\.freeze\()?\[([^\]]*)\]/g)) {
      out.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]));
    }
    return out;
  };

  if (!existsSync(frontendFile)) {
    statusProblems.push('src/lib/statuses.js is missing — the status values have no single source.');
  } else if (!existsSync(backendFile)) {
    statusProblems.push('backend/src/utils/enums.js is missing — cannot verify the status values.');
  } else {
    const mine = readLabels(frontendFile);
    const theirs = readLabels(backendFile);
    for (const [type, labels] of mine) {
      const actual = theirs.get(type);
      if (!actual) {
        statusProblems.push(`${type}: declared here but not an enum in the backend`);
        continue;
      }
      const extra = labels.filter((l) => !actual.includes(l));
      const missingLabels = actual.filter((l) => !labels.includes(l));
      if (extra.length) statusProblems.push(`${type}: "${extra.join('", "')}" is not a label the database has`);
      if (missingLabels.length) {
        statusProblems.push(`${type}: the database also has "${missingLabels.join('", "')}" — add it here`);
      }
    }
  }
}

section('STATUS VALUES AGAINST THE DATABASE ENUMS', statusProblems.length);
if (statusProblems.length === 0) {
  console.log('  every status value the dashboards send is a real enum label');
} else {
  for (const p of statusProblems) console.log(`  ${p}`);
}

console.log(`\n${line}`);
if (
  missing.length
  || wrongMethod.length
  || statusProblems.length
  || strippedParams.length
  || strippedBody.length
) {
  const parts = [];
  if (missing.length) parts.push(`${missing.length} missing`);
  if (wrongMethod.length) parts.push(`${wrongMethod.length} wrong method`);
  if (strippedParams.length) parts.push(`${strippedParams.length} filter(s) silently stripped`);
  if (strippedBody.length) parts.push(`${strippedBody.length} body field(s) silently stripped`);
  if (statusProblems.length) parts.push(`${statusProblems.length} status mismatch(es)`);
  console.log(`Contract broken: ${parts.join(', ')}.`);
  console.log(line);
  process.exit(1);
}
console.log(`Contract holds: all ${calls.length} dashboard calls exist with the method used.`);
console.log(
  `${paramsChecked} query parameter(s) and ${bodyFieldsChecked} body field(s) are declared by their`,
);
console.log('route, and every status value they filter on is a real label on its enum.');
console.log(line);
