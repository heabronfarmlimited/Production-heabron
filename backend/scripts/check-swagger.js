'use strict';

/**
 * Heabron CoopScore — OpenAPI ↔ route-table reconciler
 * ----------------------------------------------------
 * Run with:  node scripts/check-swagger.js
 *            node scripts/check-swagger.js --json
 *
 * Compares what `docs/swagger/**` documents against what `src/routes/*.js`
 * actually registers, and reports both directions:
 *
 *   PHANTOM    documented but not registered — callers trust it and get a 404
 *   UNDOCUMENTED  registered but not documented — invisible to API consumers
 *
 * Why this exists: the docs had drifted badly in both directions. Several
 * endpoints were documented under `/agent/...` while only being implemented on
 * the admin router, so a mobile/web client reading the spec would build
 * against a path that does not exist. And because `/agent` mounts
 * `requireAuth()` before any route, an unauthenticated probe of a phantom path
 * returns 401 rather than 404 — so the mistake could not be caught by poking
 * the live API. It needed a static check.
 *
 * Exits non-zero when anything is out of sync, so it can gate CI.
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'src', 'routes');
const PATHS_DIR = path.join(ROOT, 'docs', 'swagger', 'paths');

/** Mount prefixes, from src/routes/index.js. */
const MOUNTS = {
  'public.routes.js': '',
  'auth.routes.js': '/auth',
  'agent.routes.js': '/agent',
  'admin.routes.js': '/admin',
  'partner.routes.js': '/partner',
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** `/agent/farmers/:farmerId` and `/agent/farmers/{farmerId}` both -> `/agent/farmers/{}`. */
function canonical(p) {
  return p
    .replace(/:[A-Za-z0-9_]+/g, '{}')
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/') || '/';
}

function readRegisteredRoutes() {
  const found = new Map(); // "METHOD path" -> { method, path, file }

  for (const [file, prefix] of Object.entries(MOUNTS)) {
    const full = path.join(ROUTES_DIR, file);
    if (!fs.existsSync(full)) continue;

    const src = fs.readFileSync(full, 'utf8');
    const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const method = m[1].toUpperCase();
      const route = canonical(prefix + m[2]);
      found.set(`${method} ${route}`, { method, path: route, file });
    }
  }
  return found;
}

function readDocumentedRoutes() {
  const found = new Map();
  if (!fs.existsSync(PATHS_DIR)) return found;

  for (const file of fs.readdirSync(PATHS_DIR)) {
    if (!/\.ya?ml$/.test(file)) continue;

    let doc;
    try {
      doc = YAML.parse(fs.readFileSync(path.join(PATHS_DIR, file), 'utf8'));
    } catch (err) {
      console.error(`  ! ${file} is not valid YAML: ${err.message}`);
      process.exitCode = 1;
      continue;
    }
    if (!doc || typeof doc !== 'object') continue;

    for (const [rawPath, ops] of Object.entries(doc)) {
      if (!rawPath.startsWith('/') || !ops || typeof ops !== 'object') continue;
      for (const method of Object.keys(ops)) {
        if (!METHODS.includes(method)) continue; // skip `parameters`, etc.
        const key = `${method.toUpperCase()} ${canonical(rawPath)}`;
        found.set(key, { method: method.toUpperCase(), path: canonical(rawPath), file, rawPath });
      }
    }
  }
  return found;
}

/**
 * For a phantom path, look for the same tail registered under a different
 * mount — that is nearly always the real cause (documented under /agent,
 * implemented under /admin).
 */
function suggestAlternative(phantomPath, registered) {
  const tail = phantomPath.replace(/^\/(auth|agent|admin|partner)/, '');
  if (!tail || tail === phantomPath) return null;

  const hits = [];
  for (const { method, path: p } of registered.values()) {
    if (p.replace(/^\/(auth|agent|admin|partner)/, '') === tail) {
      hits.push(`${method} ${p}`);
    }
  }
  return hits.length ? hits : null;
}

/**
 * Assembles the spec the way the server does and checks its internal
 * consistency: every `$ref` resolves, and every tag used by an operation is
 * declared. An unresolved `$ref` renders as an empty schema in Swagger UI, and
 * an undeclared tag renders as a stray ungrouped section at the bottom of the
 * page — both fail quietly, which is why they are checked here.
 */
function inspectSpec() {
  let spec;
  try {
     
    ({ loadSpec: spec } = require(path.join(ROOT, 'src', 'config', 'swagger')));
    spec = spec();
  } catch (err) {
    return { error: err.message };
  }

  const refs = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') refs.add(v);
      else walk(v);
    }
  })(spec);

  const dangling = [];
  for (const ref of refs) {
    if (!ref.startsWith('#/')) {
      dangling.push(`${ref} (external ref — not inlined)`);
      continue;
    }
    let cur = spec;
    let found = true;
    for (const raw of ref.slice(2).split('/')) {
      const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (cur && typeof cur === 'object' && seg in cur) cur = cur[seg];
      else {
        found = false;
        break;
      }
    }
    if (!found) dangling.push(ref);
  }

  const declared = new Set((spec.tags || []).map((t) => t.name));
  const used = new Set();
  for (const ops of Object.values(spec.paths || {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!METHODS.includes(method) || !op?.tags) continue;
      op.tags.forEach((t) => used.add(t));
    }
  }

  return {
    paths: Object.keys(spec.paths || {}).length,
    refs: refs.size,
    dangling: dangling.sort(),
    undeclaredTags: [...used].filter((t) => !declared.has(t)).sort(),
    unusedTags: [...declared].filter((t) => !used.has(t)).sort(),
  };
}

function main() {
  const asJson = process.argv.includes('--json');

  const registered = readRegisteredRoutes();
  const documented = readDocumentedRoutes();
  const spec = inspectSpec();

  const phantom = [];
  for (const [key, info] of documented) {
    if (!registered.has(key)) {
      phantom.push({ ...info, suggestion: suggestAlternative(info.path, registered) });
    }
  }

  const undocumented = [];
  for (const [key, info] of registered) {
    if (!documented.has(key)) undocumented.push(info);
  }

  const sortFn = (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
  phantom.sort(sortFn);
  undocumented.sort(sortFn);

  if (asJson) {
    console.log(JSON.stringify({
      registered: registered.size,
      documented: documented.size,
      phantom,
      undocumented,
      spec,
    }, null, 2));
  } else {
    const line = (c = '─') => console.log(c.repeat(72));

    line();
    console.log('OpenAPI ↔ route-table reconciliation');
    line();
    console.log(`  registered routes : ${registered.size}`);
    console.log(`  documented ops    : ${documented.size}`);
    const pct = registered.size
      ? Math.round(((registered.size - undocumented.length) / registered.size) * 100)
      : 0;
    console.log(`  coverage          : ${pct}%`);

    console.log('');
    line();
    console.log(`PHANTOM — documented but NOT registered  (${phantom.length})`);
    line();
    if (phantom.length === 0) {
      console.log('  none');
    } else {
      console.log('  A client reading the spec will build against these and get a 404.');
      console.log('');
      for (const p of phantom) {
        console.log(`  ${p.method.padEnd(6)} ${p.path}`);
        console.log(`         declared in docs/swagger/paths/${p.file}`);
        if (p.suggestion) {
          console.log(`         ↳ same tail IS registered as: ${p.suggestion.join(', ')}`);
          console.log('           → the doc almost certainly has the wrong mount prefix');
        }
      }
    }

    console.log('');
    line();
    console.log(`UNDOCUMENTED — registered but NOT documented  (${undocumented.length})`);
    line();
    if (undocumented.length === 0) {
      console.log('  none');
    } else {
      for (const u of undocumented) {
        console.log(`  ${u.method.padEnd(6)} ${u.path.padEnd(52)} (${u.file})`);
      }
    }

    console.log('');
    line();
    console.log('SPEC INTEGRITY');
    line();
    if (spec.error) {
      console.log(`  ! could not assemble the spec: ${spec.error}`);
    } else {
      console.log(`  paths assembled   : ${spec.paths}`);
      console.log(`  $refs resolved    : ${spec.refs - spec.dangling.length}/${spec.refs}`);
      if (spec.dangling.length) {
        console.log('  DANGLING $refs (render as empty schemas in Swagger UI):');
        spec.dangling.forEach((r) => console.log(`    - ${r}`));
      }
      if (spec.undeclaredTags.length) {
        console.log('  TAGS used but not declared in openapi.yaml');
        console.log('  (these render as stray ungrouped sections):');
        spec.undeclaredTags.forEach((t) => console.log(`    - ${t}`));
      }
      if (spec.unusedTags.length) {
        console.log('  tags declared but unused (harmless, but likely stale):');
        spec.unusedTags.forEach((t) => console.log(`    - ${t}`));
      }
      if (!spec.dangling.length && !spec.undeclaredTags.length && !spec.unusedTags.length) {
        console.log('  no dangling refs, no tag problems');
      }
    }

    console.log('');
    line();
    const problems =
      phantom.length + undocumented.length + (spec.dangling?.length || 0) +
      (spec.undeclaredTags?.length || 0);
    if (problems === 0) {
      console.log('In sync.');
    } else {
      console.log(
        `Out of sync: ${phantom.length} phantom, ${undocumented.length} undocumented, ` +
          `${spec.dangling?.length || 0} dangling refs, ` +
          `${spec.undeclaredTags?.length || 0} undeclared tags.`
      );
      if (phantom.length) {
        console.log('Phantom entries are the dangerous ones — fix those first.');
      }
    }
    line();
  }

  const failed =
    phantom.length > 0 ||
    undocumented.length > 0 ||
    (spec.dangling?.length || 0) > 0 ||
    (spec.undeclaredTags?.length || 0) > 0;
  if (failed) process.exitCode = 1;
}

main();
