'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const { standardLimiter } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const routes = require('./routes');
const swagger = require('./config/swagger');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers. CSP is disabled because we load Swagger UI from a CDN
// (unpkg.com) and there's no consistent way to enumerate every script source
// the frontend may need without breaking things. crossOriginEmbedderPolicy
// is disabled so the Swagger HTML can pull in cross-origin CDN assets.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// ─── CORS ────────────────────────────────────────────────────────────────────
// `ALLOWED_ORIGINS` is a comma-separated list of allowed origins, or `*` to
// allow any. There's a subtlety the original code got wrong: browsers reject
// any response that has BOTH `Access-Control-Allow-Origin: *` AND
// `Access-Control-Allow-Credentials: true`. When the list is `*`, we must
// echo back the request's `Origin` instead of literally sending "*" — that
// way credentialed and non-credentialed cross-origin requests both work.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowAll = allowedOrigins.includes('*');

app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin and server-to-server requests have no `Origin` header.
      // Allow them unconditionally.
      if (!origin) return cb(null, true);
      if (allowAll) return cb(null, origin); // echo back, NOT '*' — credentials require this
      if (allowedOrigins.includes(origin)) return cb(null, origin);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// Body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Request logging
if (!config.isProd) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
}

// Global rate limit (excludes health + swagger)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/docs') || req.path === '/api/health' || req.path === '/api') return next();
  return standardLimiter(req, res, next);
});

// API routes
app.use('/api', routes);

// Swagger docs
try {
  swagger.mount(app, '/api/docs');
  logger.info('Swagger UI mounted at /api/docs');
} catch (err) {
  logger.warn({ err: err.message }, 'Swagger spec not loaded');
}

// 404 + error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// On Vercel, the file is required and Express handles the request. Locally
// we start a listening server.
if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(`Heabron CoopScore API listening on :${config.port} (${config.env})`);
  });
}

module.exports = app;