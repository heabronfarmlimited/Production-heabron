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

for (const file of walk(join(backendRoot, 'src', 'routes'), '.js')) {
  const src = readFileSync(file, 'utf8');
  const fileName = file.split('/').pop();
  const prefix = prefixForRouteFile(fileName, src);

  for (const m of src.matchAll(
    /router\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]/g,
  )) {
    const method = m[1].toUpperCase();
    const path = normalise(prefix + (m[2] === '/' ? '' : m[2]));
    if (!routes.has(path)) routes.set(path, new Set());
    routes.get(path).add(method);
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

const calls = []; // { method, path, file, line }

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
    const where = { file: file.replace(frontendRoot + '/', ''), line: lineNumber };

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

console.log(`\n${line}`);
if (missing.length || wrongMethod.length) {
  console.log(
    `Contract broken: ${missing.length} missing, ${wrongMethod.length} wrong method.`,
  );
  console.log(line);
  process.exit(1);
}
console.log(
  `Contract holds: all ${calls.length} dashboard calls exist with the method used.`,
);
console.log(line);
