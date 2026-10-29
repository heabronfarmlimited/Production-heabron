'use strict';

const winston = require('winston');
const { inspect } = require('util');
const config = require('../config');

/**
 * The codebase calls the logger in two patterns:
 *   1. logger.info('plain message')
 *   2. logger.error({ err, code, hint, details }, 'OTP insert failed')   ← pino style
 *
 * 83 of the 86 call sites use pattern (2), which Winston does not understand:
 * it treats the OBJECT as the message and pushes the real message string into
 * the splat. So `info.message` is the meta object and the human-readable text
 * is hidden in `info[Symbol.for('splat')][0]`.
 *
 * FIXED — this normalisation used to live inside the dev-only formatter, so it
 * ran on a developer machine and NOT in production, where `format.json()`
 * received the un-swapped object. Every production log line therefore looked
 * like:
 *
 *   {"level":"error","message":{"err":"duplicate key"},"timestamp":"…"}
 *
 * with the message — the part that says WHICH operation failed — silently
 * discarded. That is a large part of why the OTP delivery failures could not be
 * diagnosed from the logs. The swap now happens in a shared format stage that
 * runs before the dev/prod split, so both outputs carry the message and the
 * metadata.
 */
const RESERVED = new Set(['level', 'message', 'timestamp', 'stack', 'splat']);

const normalizePinoStyle = winston.format((info) => {
  const splat = info[Symbol.for('splat')];
  const messageIsMeta = typeof info.message === 'object' && info.message !== null;

  if (messageIsMeta && Array.isArray(splat) && typeof splat[0] === 'string') {
    const meta = info.message;
    info.message = splat[0];

    // Merge the meta object's fields up to the top level, pino-style. Reserved
    // Winston fields are namespaced instead of overwritten, so a metadata key
    // called `level` or `message` cannot corrupt the record.
    for (const [key, value] of Object.entries(meta)) {
      if (RESERVED.has(key)) info[`meta_${key}`] = value;
      else info[key] = value;
    }
  } else if (messageIsMeta) {
    // `logger.error({ ... })` with no message string: keep the data, and make
    // the message a readable rendering of it rather than "[object Object]".
    const meta = info.message;
    info.message = inspect(meta, { depth: 5, breakLength: 120 });
    for (const [key, value] of Object.entries(meta)) {
      if (!RESERVED.has(key)) info[key] = value;
    }
  }

  return info;
});

/**
 * Human-readable single-line output for local development. By the time this
 * runs, `normalizePinoStyle` has already put a string in `info.message` and
 * lifted the metadata to the top level.
 */
const devFormat = winston.format.printf((info) => {
  const { level, timestamp, stack, message } = info;

  const meta = {};
  for (const key of Object.keys(info)) {
    if (RESERVED.has(key)) continue;
    if (typeof key === 'symbol') continue;
    meta[key] = info[key];
  }

  const metaKeys = Object.keys(meta);
  const metaStr = metaKeys.length
    ? ` ${inspect(meta, { depth: 5, colors: false, breakLength: 120 })}`
    : '';
  const stackStr = stack ? `\n${stack}` : '';

  return `${timestamp} ${level}: ${message}${metaStr}${stackStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (config.isProd ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    // Must run before the dev/prod split so BOTH outputs are correct.
    normalizePinoStyle(),
    config.isProd ? winston.format.json() : devFormat
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
