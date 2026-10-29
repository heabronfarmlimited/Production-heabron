#!/usr/bin/env node
/**
 * Heabron CoopScore — mobile ↔ backend contract check
 * ---------------------------------------------------
 * Run with:  node scripts/check-backend-contract.mjs [path-to-backend]
 *
 * Defaults to ../backend.
 *
 * Verifies that every endpoint the app calls actually exists on the backend,
 * with the HTTP method the app uses. It reads both sides from source:
 *
 *   app      src/core/api/endpoints.ts      — the endpoint map
 *            src/**  (api.get / post / …)   — which method hits which endpoint
 *   backend  src/routes/*.js                — the registered Express routes
 *
 * This catches the class of bug that is invisible until a user taps the button:
 * a path that was renamed on the backend, or a method the route does not accept
 * (a PATCH where the server only registered PUT). Those surface as a 404 or 405
 * at runtime, and `/agent/*` mounts auth before the routes, so an unauthenticated
 * probe cannot tell a missing route from a protected one.
 *
 * Exits non-zero on any mismatch, so it can gate CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MOBILE_ROOT = path.resolve(import.meta.dirname, '..');
const BACKEND_ROOT = path.resolve(
  process.argv[2] ? path.resolve(process.argv[2]) : path.join(MOBILE_ROOT, '..', 'backend')
);

const MOUNTS = {
  'public.routes.js': '',
  'auth.routes.js': '/auth',
  'agent.routes.js': '/agent',
  'admin.routes.js': '/admin',
  'partner.routes.js': '/partner',
};

const canonical = (p) =>
  p
    .replace(/:[A-Za-z0-9_]+/g, '{}')
    .replace(/\$\{[^}]*\}/g, '{}')
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/') || '/';

// ───────────────────────────────────────────────────────── backend route table

function backendRoutes() {
  const routesDir = path.join(BACKEND_ROOT, 'src', 'routes');
  if (!fs.existsSync(routesDir)) {
    console.error(`Backend routes not found at ${routesDir}`);
    console.error('Pass the backend path: node scripts/check-backend-contract.mjs ../backend');
    process.exit(2);
  }

  const byPath = new Map(); // canonical path -> Set(METHOD)
  for (const [file, prefix] of Object.entries(MOUNTS)) {
    const full = path.join(routesDir, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const key = canonical(prefix + m[2]);
      if (!byPath.has(key)) byPath.set(key, new Set());
      byPath.get(key).add(m[1].toUpperCase());
    }
  }
  return byPath;
}

// ──────────────────────────────────────────────────────────── app endpoint map

/**
 * Parses the `endpoints` object out of endpoints.ts. Entries are either a
 * string literal or an arrow function returning a template literal, so both
 * forms are read and reduced to a canonical path.
 */
function appEndpoints() {
  const file = path.join(MOBILE_ROOT, 'src', 'core', 'api', 'endpoints.ts');
  const src = fs.readFileSync(file, 'utf8');

  const start = src.indexOf('export const endpoints');
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(open + 1, end);

  const map = new Map(); // endpoint key -> canonical path
  // `key: '/literal/path'`
  for (const m of body.matchAll(/(\w+)\s*:\s*'([^']+)'/g)) {
    map.set(m[1], canonical(m[2]));
  }
  // `key: (args) => `/template/${x}``
  for (const m of body.matchAll(/(\w+)\s*:\s*\([^)]*\)\s*=>\s*`([^`]+)`/g)) {
    map.set(m[1], canonical(m[2]));
  }
  return map;
}

// ───────────────────────────────────────────────── which method hits which key

const METHOD_OF_CALL = {
  get: 'GET',
  getPaginated: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
};

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Finds `api.<method>(endpoints.<key>` and `api.<method>(endpoints.<key>(…)`
 * call sites and records the method used against each endpoint key.
 */
function callSites() {
  const uses = new Map(); // key -> Map(METHOD -> [files])
  // The optional generic is matched as `<...>` containing no `(`, so a nested
  // one such as `api.post<Record<string, unknown>>(…)` is consumed whole. An
  // earlier `<[^>]*>` stopped at the first `>` and silently missed every call
  // with a nested generic, which is most of them.
  const re =
    /\bapi\s*\.\s*(get|getPaginated|post|put|patch|delete)\s*(?:<[^(]*>)?\s*\(\s*endpoints\.(\w+)/g;

  for (const file of walkFiles(path.join(MOBILE_ROOT, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(src)) !== null) {
      const method = METHOD_OF_CALL[m[1]];
      const key = m[2];
      if (!method || !key) continue;
      if (!uses.has(key)) uses.set(key, new Map());
      const byMethod = uses.get(key);
      if (!byMethod.has(method)) byMethod.set(method, []);
      byMethod.get(method).push(path.relative(MOBILE_ROOT, file));
    }
  }
  return uses;
}

// ───────────────────────────────────────────────────────────────────── report

function main() {
  const backend = backendRoutes();
  const endpoints = appEndpoints();
  const uses = callSites();

  const missingPath = [];
  const methodMismatch = [];
  const unused = [];

  for (const [key, p] of endpoints) {
    const methods = backend.get(p);
    const used = uses.get(key);

    if (!methods) {
      missingPath.push({ key, path: p, usedIn: used ? [...used.keys()] : [] });
      continue;
    }
    if (!used) {
      unused.push({ key, path: p });
      continue;
    }
    for (const [method, files] of used) {
      if (!methods.has(method)) {
        methodMismatch.push({
          key,
          path: p,
          used: method,
          accepts: [...methods].sort(),
          files: [...new Set(files)],
        });
      }
    }
  }

  const line = (c = '─') => console.log(c.repeat(74));

  line();
  console.log('mobile ↔ backend contract');
  line();
  console.log(`  app endpoints defined : ${endpoints.size}`);
  console.log(`  backend route paths   : ${backend.size}`);
  console.log(`  endpoints with calls  : ${uses.size}`);

  console.log('');
  line();
  console.log(`NO SUCH ROUTE ON THE BACKEND  (${missingPath.length})`);
  line();
  if (!missingPath.length) console.log('  none');
  for (const r of missingPath) {
    console.log(`  endpoints.${r.key}  ->  ${r.path}`);
    if (r.usedIn.length) console.log(`      called with: ${r.usedIn.join(', ')}`);
    else console.log('      (defined but never called — would 404 if it were)');
  }

  console.log('');
  line();
  console.log(`METHOD NOT ACCEPTED BY THAT ROUTE  (${methodMismatch.length})`);
  line();
  if (!methodMismatch.length) console.log('  none');
  for (const r of methodMismatch) {
    console.log(`  endpoints.${r.key}  ->  ${r.path}`);
    console.log(`      app sends : ${r.used}`);
    console.log(`      route has : ${r.accepts.join(', ')}`);
    r.files.forEach((f) => console.log(`      at        : ${f}`));
  }

  console.log('');
  line();
  console.log(`DEFINED BUT NEVER CALLED  (${unused.length})`);
  line();
  if (!unused.length) console.log('  none');
  // Not a failure: a valid endpoint may be reached through a helper rather than
  // a direct api.* call, so this is listed for review only.
  for (const r of unused) console.log(`  endpoints.${r.key}  ->  ${r.path}`);

  console.log('');
  line();
  const failures = missingPath.length + methodMismatch.length;
  console.log(
    failures === 0
      ? 'Contract holds: every called endpoint exists with the method used.'
      : `${failures} contract violation(s) — these fail at runtime, not at build time.`
  );
  line();

  if (failures > 0) process.exitCode = 1;
}

main();
