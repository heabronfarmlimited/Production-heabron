'use strict';

const winston = require('winston');
const { inspect } = require('util');
const config = require('../config');

/**
 * Custom dev formatter.
 *
 * The codebase calls the logger in two patterns:
 *   1. logger.info('plain message')
 *   2. logger.error({ err, code, hint, details }, 'OTP insert failed')   ← pino style
 *
 * Winston's default `simple` formatter renders the meta object as
 * "[object Object]" because it String()s the first argument. In pattern (2)
 * Winston treats the OBJECT as the message (so message="[object Object]")
 * and puts the string 'OTP insert failed' into the splat. We swap them back
 * here and pretty-print the meta object inline so we actually see what
 * went wrong.
 */
const devFormat = winston.format.printf((info) => {
  const splatSym = Symbol.for('splat');
  const { level, timestamp, stack } = info;
  let { message } = info;

  // Collect "meta" — anything that isn't a standard winston field
  const meta = {};
  for (const k of Object.keys(info)) {
    if (k === 'level' || k === 'message' || k === 'timestamp' || k === 'stack') continue;
    meta[k] = info[k];
  }

  // Splat args from logger.error(obj, 'msg', ...rest)
  const splat = info[splatSym];

  // pino-style: first arg was an object, second arg was the actual message
  if (typeof message === 'object' && message !== null && splat && splat.length > 0 && typeof splat[0] === 'string') {
    const realMsg = splat[0];
    const metaObj = message;
    message = realMsg;
    Object.assign(meta, metaObj);
  }

  // If message itself is still an object, inspect it
  if (typeof message === 'object' && message !== null) {
    message = inspect(message, { depth: 5, colors: false, breakLength: 120 });
  }

  // Pretty-print meta
  let metaStr = '';
  const metaKeys = Object.keys(meta);
  if (metaKeys.length > 0) {
    metaStr = ' ' + inspect(meta, { depth: 5, colors: false, breakLength: 120 });
  }

  const stackStr = stack ? `\n${stack}` : '';
  return `${timestamp} ${level}: ${message}${metaStr}${stackStr}`;
});

const logger = winston.createLogger({
  level: config.isProd ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.isProd ? winston.format.json() : devFormat
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;