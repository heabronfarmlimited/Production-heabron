'use strict';

/**
 * Heabron CoopScore — OpenAPI stub generator
 * ------------------------------------------
 * Run with:  node scripts/gen-swagger-stubs.js            # print to stdout
 *            node scripts/gen-swagger-stubs.js --write     # write the yaml file
 *
 * `check-swagger.js` reports which registered routes are undocumented. This
 * script writes the documentation for them, deriving each operation from the
 * code itself rather than from a human's description of it:
 *
 *   - path parameters  ← the `:param` segments in the route
 *   - query parameters ← the Joi validator used with target 'query'
 *   - request body     ← the Joi validator used with target 'body', converted
 *                        field by field (type, required, enum, pattern,
 *                        min/max, default) via `schema.describe()`
 *   - summary / tag    ← the controller handler name and the route's mount
 *
 * Because the request shapes come from the same Joi objects Express validates
 * with, the generated spec cannot drift from what the API actually accepts.
 * Regenerate after adding routes and paste in anything new.
 *
 * Output goes to docs/swagger/paths/generated-coverage.yaml, which is loaded
 * automatically (src/config/swagger.js inlines every *.yaml under paths/).
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'src', 'routes');
const PATHS_DIR = path.join(ROOT, 'docs', 'swagger', 'paths');
const OUT_FILE = path.join(PATHS_DIR, 'generated-coverage.yaml');

const MOUNTS = {
  'public.routes.js': '',
  'auth.routes.js': '/auth',
  'agent.routes.js': '/agent',
  'admin.routes.js': '/admin',
  'partner.routes.js': '/partner',
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Each route file imports its own validator module as `v`
 * (auth.routes.js uses validators/auth, the rest use validators/domain), so a
 * name is resolved against the module that file actually imported rather than
 * guessed — two modules could define the same name.
 */
const VALIDATOR_MODULES = {};
function validatorsFor(routeFile) {
  if (VALIDATOR_MODULES[routeFile] !== undefined) return VALIDATOR_MODULES[routeFile];

  const src = fs.readFileSync(path.join(ROUTES_DIR, routeFile), 'utf8');
  const m = src.match(/const v = require\('\.\.\/validators\/(\w+)'\)/);
  let mod = {};
  if (m) {
    try {
      mod = require(path.join(ROOT, 'src', 'validators', m[1]));
    } catch {
      mod = {};
    }
  }
  VALIDATOR_MODULES[routeFile] = mod;
  return mod;
}

// ─────────────────────────────────────────────────────────── Joi → OpenAPI

/** Converts one `Joi.describe()` node into an OpenAPI schema object. */
function joiToSchema(node) {
  if (!node || typeof node !== 'object') return { type: 'string' };

  const rules = Object.fromEntries((node.rules || []).map((r) => [r.name, r.args || {}]));
  const out = {};

  // An explicit `valid(...)` list becomes an enum. Joi puts a leading
  // `{ override: true }` marker in `allow` for `.valid()`, so filter to
  // primitives.
  const allow = (node.allow || []).filter((v) => typeof v !== 'object' || v === null);
  const enumVals = allow.filter((v) => v !== null);

  switch (node.type) {
    case 'string':
      out.type = 'string';
      if (rules.guid) out.format = 'uuid';
      else if (rules.email) out.format = 'email';
      else if (rules.uri) out.format = 'uri';
      else if (rules.isoDate) out.format = 'date';
      if (rules.pattern?.regex) out.pattern = String(rules.pattern.regex).replace(/^\/|\/$/g, '');
      if (rules.min?.limit !== undefined) out.minLength = rules.min.limit;
      if (rules.max?.limit !== undefined) out.maxLength = rules.max.limit;
      if (enumVals.length) out.enum = enumVals;
      break;

    case 'number':
      out.type = rules.integer ? 'integer' : 'number';
      if (rules.positive) out.exclusiveMinimum = 0;
      if (rules.min?.limit !== undefined) out.minimum = rules.min.limit;
      if (rules.max?.limit !== undefined) out.maximum = rules.max.limit;
      if (enumVals.length) out.enum = enumVals;
      break;

    case 'boolean':
      out.type = 'boolean';
      break;

    case 'date':
      out.type = 'string';
      out.format = 'date-time';
      break;

    case 'array':
      out.type = 'array';
      out.items = node.items?.length ? joiToSchema(node.items[0]) : { type: 'string' };
      if (rules.min?.limit !== undefined) out.minItems = rules.min.limit;
      if (rules.max?.limit !== undefined) out.maxItems = rules.max.limit;
      break;

    case 'object':
      out.type = 'object';
      if (node.keys) {
        out.properties = {};
        for (const [k, sub] of Object.entries(node.keys)) out.properties[k] = joiToSchema(sub);
        const req = Object.entries(node.keys)
          .filter(([, s]) => s.flags?.presence === 'required')
          .map(([k]) => k);
        if (req.length) out.required = req;
      }
      break;

    case 'alternatives': {
      const opts = (node.matches || []).map((m) => joiToSchema(m.schema)).filter(Boolean);
      if (opts.length) return { oneOf: opts };
      out.type = 'string';
      break;
    }

    default:
      out.type = 'string';
  }

  const def = node.flags?.default;
  if (def !== undefined && typeof def !== 'function' && typeof def !== 'object') {
    out.default = def;
  }
  if (node.flags?.description) out.description = node.flags.description;
  return out;
}

function bodySchemaFor(validatorName, routeFile) {
  const schema = validatorsFor(routeFile)[validatorName];
  if (!schema || typeof schema.describe !== 'function') return null;
  const described = schema.describe();
  if (described.type !== 'object' || !described.keys) return null;
  return joiToSchema(described);
}

function queryParamsFor(validatorName, routeFile) {
  const schema = validatorsFor(routeFile)[validatorName];
  if (!schema || typeof schema.describe !== 'function') return [];
  const described = schema.describe();
  if (described.type !== 'object' || !described.keys) return [];

  return Object.entries(described.keys).map(([name, node]) => {
    // page / pageSize already exist as shared components; reference those so
    // the generated file stays consistent with the hand-written ones.
    if (name === 'page') return { $ref: '#/components/parameters/PageParam' };
    if (name === 'pageSize') return { $ref: '#/components/parameters/PageSizeParam' };
    return {
      name,
      in: 'query',
      required: node.flags?.presence === 'required',
      schema: joiToSchema(node),
    };
  });
}

// ──────────────────────────────────────────────────────────── route parsing

/**
 * Splits a route file into one block per `router.<method>(...)` call, so a
 * definition spread over several lines is read whole. A single-line regex would
 * see only up to the first newline and miss the validator and handler of, for
 * example:
 *
 *   router.post(
 *     '/uploads/:kind',
 *     upload.single('file'),
 *     asyncHandler(uploads.create),
 *   );
 */
function parseRoutes() {
  const routes = [];

  for (const [file, prefix] of Object.entries(MOUNTS)) {
    const full = path.join(ROUTES_DIR, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');

    const starts = [];
    const head = /router\.(get|post|put|patch|delete)\(/g;
    let m;
    while ((m = head.exec(src)) !== null) {
      starts.push({ index: m.index, method: m[1], bodyAt: m.index + m[0].length });
    }

    starts.forEach((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
      const block = src.slice(start.bodyAt, end);

      const pathMatch = block.match(/^\s*'([^']+)'/);
      if (!pathMatch) return;

      const vMatch = block.match(/validate\(v\.(\w+)(?:,\s*'(\w+)')?\)/);
      const hMatch = block.match(/asyncHandler\(([\w.]+)\)/);
      const upMatch = block.match(/\w*[Uu]pload\.(?:single|array)\('([^']+)'/);

      const route = prefix + pathMatch[1];
      routes.push({
        method: start.method,
        express: route,
        openapi: route.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        validator: vMatch ? vMatch[1] : null,
        validatorTarget: vMatch ? vMatch[2] || 'body' : null,
        handler: hMatch ? hMatch[1] : null,
        multipartField: upMatch ? upMatch[1] : null,
        file,
      });
    });
  }
  return routes;
}

function canonical(p) {
  return p.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/';
}

function documentedKeys() {
  const set = new Set();
  if (!fs.existsSync(PATHS_DIR)) return set;
  for (const file of fs.readdirSync(PATHS_DIR)) {
    if (!/\.ya?ml$/.test(file)) continue;
    if (path.join(PATHS_DIR, file) === OUT_FILE) continue; // ignore our own output
    let doc;
    try {
      doc = YAML.parse(fs.readFileSync(path.join(PATHS_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!doc) continue;
    for (const [p, ops] of Object.entries(doc)) {
      if (!p.startsWith('/') || !ops || typeof ops !== 'object') continue;
      for (const method of Object.keys(ops)) {
        if (METHODS.includes(method)) set.add(`${method.toUpperCase()} ${canonical(p)}`);
      }
    }
  }
  return set;
}

// ─────────────────────────────────────────────────────── tags and summaries

/** Maps a route to the tag it belongs under, reusing the declared vocabulary. */
function tagFor(route) {
  const scope = { '/agent': 'Agent', '/admin': 'Admin', '/partner': 'Partner', '/auth': 'Auth' };
  const prefix = Object.keys(scope).find((p) => route.openapi.startsWith(p + '/'));
  if (!prefix) return 'Health';
  if (prefix === '/auth') return 'Auth';

  const rest = route.openapi.slice(prefix.length + 1);
  const seg = rest.split('/')[0];

  const GROUPS = {
    dashboard: 'Dashboard',
    profile: 'Profile',
    cooperatives: 'Cooperatives',
    farmers: 'Farmers',
    productions: 'Production',
    deliveries: 'Deliveries',
    'financing-requests': 'Financing',
    financing: 'Financing',
    repayments: 'Repayments',
    wallet: 'Wallet',
    wallets: 'Wallets',
    notifications: 'Notifications',
    uploads: 'Uploads',
    imports: 'Imports',
    exports: 'Exports',
    'change-requests': 'Change Requests',
    'field-notes': 'Field Notes',
    'market-access': 'Market Access',
    'bank-account': 'Profile',
    'field-agents': 'Field Agents',
    agents: 'Agents',
    partners: 'Partners',
    credit: 'Credit',
    benchmarks: 'Benchmarks',
    activity: 'Activity',
    organization: 'Profile',
    disbursements: 'Wallets',
    transactions: 'Wallets',
    'cash-purchases': 'Wallets',
  };

  // A nested resource is grouped by its parent, so
  // /agent/farmers/{id}/field-notes lands under Farmers, not Field Notes.
  const group = GROUPS[seg] || seg.replace(/(^|-)(\w)/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase());
  return `${scope[prefix]} — ${group}`;
}

/** "listCashPurchases" -> "List cash purchases" */
function summaryFor(route) {
  const override = SUMMARY_OVERRIDES[`${route.method.toUpperCase()} ${route.openapi}`];
  if (override) return override;

  const fn = (route.handler || '').split('.').pop();
  if (!fn || fn === '-') {
    return `${route.method.toUpperCase()} ${route.openapi}`;
  }
  const words = fn
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The upload `kind` is a path segment checked against a whitelist in the
 * controller, not a Joi schema, so it is read from the controller's own export
 * to keep the documented enum in step with what the code accepts. The
 * pre-activation route allows a narrower set.
 */
let UPLOAD_KINDS = [];
const PRE_ACTIVATION_KINDS = ['avatar', 'selfie'];
try {
  const uploads = require(path.join(ROOT, 'src', 'controllers', 'uploads.controller'));
  if (uploads.BUCKETS) UPLOAD_KINDS = Object.keys(uploads.BUCKETS).sort();
} catch {
  /* leave empty; the param is then documented as a plain string */
}

/** Routes whose handler is an inline function, so no name to derive from. */
const SUMMARY_OVERRIDES = {
  'GET /': 'API root — service name, version and docs link',
};

function pathParamsFor(route) {
  const names = [...route.express.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);

  return names.map((name) => {
    if (name === 'kind') {
      const allowed = route.openapi.startsWith('/auth/') ? PRE_ACTIVATION_KINDS : UPLOAD_KINDS;
      const schema = { type: 'string' };
      if (allowed.length) schema.enum = [...allowed].sort();
      return {
        name,
        in: 'path',
        required: true,
        description: 'Storage bucket to upload into.',
        schema,
      };
    }
    return {
      name,
      in: 'path',
      required: true,
      schema: /Id$/.test(name) ? { type: 'string', format: 'uuid' } : { type: 'string' },
    };
  });
}

// ───────────────────────────────────────────────────────────────── assembly

function main() {
  const write = process.argv.includes('--write');
  const routes = parseRoutes();
  const documented = documentedKeys();

  const missing = routes.filter(
    (r) => !documented.has(`${r.method.toUpperCase()} ${canonical(r.openapi)}`)
  );

  const spec = {};
  for (const route of missing) {
    spec[route.openapi] = spec[route.openapi] || {};

    const op = {
      tags: [tagFor(route)],
      summary: summaryFor(route),
    };

    const params = [
      ...pathParamsFor(route),
      ...(route.validatorTarget === 'query' ? queryParamsFor(route.validator, route.file) : []),
    ];
    if (params.length) op.parameters = params;

    if (route.validatorTarget === 'body' && route.validator) {
      const schema = bodySchemaFor(route.validator, route.file);
      if (schema) {
        op.requestBody = {
          required: true,
          content: { 'application/json': { schema } },
        };
      }
    } else if (route.multipartField) {
      // multer routes carry no Joi body schema; the upload is a file part.
      op.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: [route.multipartField],
              properties: {
                [route.multipartField]: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      };
    }

    const listish = route.validatorTarget === 'query' || /^list|^get.*s$/.test(
      (route.handler || '').split('.').pop() || ''
    );
    const okCode = route.method === 'post' && !/confirm|verify|decision|read|login/.test(route.openapi)
      ? '201'
      : '200';

    op.responses = {
      [okCode]: {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              $ref: listish
                ? '#/components/schemas/PaginatedEnvelope'
                : '#/components/schemas/SuccessEnvelope',
            },
          },
        },
      },
    };

    spec[route.openapi][route.method] = op;
  }

  const header = [
    '# =============================================================================',
    '# GENERATED — do not hand-edit.',
    '#',
    '# Produced by `node scripts/gen-swagger-stubs.js --write` for the routes that',
    '# `node scripts/check-swagger.js` reported as registered but undocumented.',
    '#',
    '# Request bodies and query parameters are derived from the same Joi validators',
    '# that Express validates against (src/validators/domain.js), so this file',
    '# cannot describe a shape the API would reject. Summaries come from the',
    '# controller handler names — refine them in place if you move an operation',
    '# into one of the hand-written path files, and delete it from here.',
    '# =============================================================================',
    '',
  ].join('\n');

  const yaml = header + YAML.stringify(spec, { lineWidth: 0 });

  if (write) {
    fs.writeFileSync(OUT_FILE, yaml);
    console.log(`Wrote ${Object.keys(spec).length} paths (${missing.length} operations)`);
    console.log(`  -> ${path.relative(ROOT, OUT_FILE)}`);
  } else {
    console.log(yaml);
    console.error(`\n# ${missing.length} operations across ${Object.keys(spec).length} paths`);
    console.error('# Re-run with --write to save.');
  }
}

main();
