'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const SWAGGER_DIR = path.resolve(__dirname, '../../docs/swagger');

/**
 * Build a single OpenAPI document by reading the root `openapi.yaml`
 * (which uses $ref to load every path and schema from sibling files).
 */
function loadSpec() {
  const rootPath = path.join(SWAGGER_DIR, 'openapi.yaml');
  if (!fs.existsSync(rootPath)) {
    throw new Error(`OpenAPI root not found: ${rootPath}`);
  }
  const rootText = fs.readFileSync(rootPath, 'utf8');
  const root = YAML.parse(rootText);

  // Inline-include all schemas
  const schemaDir = path.join(SWAGGER_DIR, 'schemas');
  if (fs.existsSync(schemaDir)) {
    root.components = root.components || {};
    root.components.schemas = root.components.schemas || {};
    for (const file of fs.readdirSync(schemaDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const obj = YAML.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
      Object.assign(root.components.schemas, obj || {});
    }
  }

  // Inline-include all paths
  const pathDir = path.join(SWAGGER_DIR, 'paths');
  if (fs.existsSync(pathDir)) {
    root.paths = root.paths || {};
    for (const file of fs.readdirSync(pathDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const obj = YAML.parse(fs.readFileSync(path.join(pathDir, file), 'utf8'));
      Object.assign(root.paths, obj || {});
    }
  }

  return root;
}

/**
 * Derive the canonical base URL the API is being served from for the
 * current request. On Vercel `x-forwarded-proto` and `host` are set
 * correctly. Locally we'll see `http` + `localhost:4000`. This way the
 * "Try it out" button in Swagger always targets the same host you opened
 * the docs from, so production hits production and local hits local,
 * with no hard-coded URLs to keep in sync.
 */
function deriveBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4000').toString().split(',')[0].trim();
  return `${proto}://${host}/api`;
}

/**
 * Return a per-request copy of the spec with `servers` set to the live
 * request origin first, then any servers declared in the YAML as fallbacks.
 */
function specForRequest(baseSpec, req) {
  const dynamicUrl = deriveBaseUrl(req);
  const yamlServers = Array.isArray(baseSpec.servers) ? baseSpec.servers : [];

  // Put the live URL first, deduped against any YAML-declared servers.
  const dedupedYaml = yamlServers.filter((s) => s && s.url !== dynamicUrl);
  return {
    ...baseSpec,
    servers: [
      { url: dynamicUrl, description: 'Current environment' },
      ...dedupedYaml,
    ],
  };
}

/**
 * Build the Swagger UI HTML page. All UI assets come from a CDN
 * (unpkg.com / swagger-ui-dist), so there are NO static files for Express
 * to serve. This works identically on a long-running local server and on
 * Vercel serverless functions, where bundling node_modules/swagger-ui-dist
 * isn't reliable.
 */
function buildSwaggerHtml({ basePath, title }) {
  const specUrl = `${basePath}.json`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.17.14/favicon-32x32.png" sizes="32x32" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>
    html, body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none !important; }
    .swagger-ui .info .title { color: #2C6B47; }
    .swagger-ui .btn.authorize { background: #2C6B47; color: #fff; border-color: #2C6B47; }
    .swagger-ui .btn.authorize svg { fill: #fff; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: "#swagger-ui",
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        deepLinking: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: "none",
        defaultModelsExpandDepth: 1,
        filter: true
      });
    };
  </script>
</body>
</html>`;
}

function mount(app, basePath = '/api/docs') {
  const baseSpec = loadSpec();
  const html = buildSwaggerHtml({ basePath, title: 'Heabron CoopScore API' });

  // Serve the UI shell at both `/api/docs` and `/api/docs/`.
  const sendHtml = (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.send(html);
  };
  app.get(basePath, sendHtml);
  app.get(`${basePath}/`, sendHtml);

  // JSON + YAML specs — `servers` is rewritten per-request so "Try it out"
  // always targets the host the docs page was opened from.
  app.get(`${basePath}.json`, (req, res) => res.json(specForRequest(baseSpec, req)));
  app.get(`${basePath}/openapi.json`, (req, res) => res.json(specForRequest(baseSpec, req))); // alias
  app.get(`${basePath}.yaml`, (req, res) => {
    res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
    res.send(YAML.stringify(specForRequest(baseSpec, req)));
  });
}

module.exports = { loadSpec, mount };