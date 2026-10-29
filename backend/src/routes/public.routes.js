'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const { version } = require('../../package.json');

/**
 * FIXED — the health payload carried two pieces of invented data.
 *
 *  • `build: '2026-06-26-fieldnote-update-fix'` was a string someone had to
 *    remember to bump by hand, and had not been: it named a fix from months
 *    before the code actually deployed, so the one field devs used to confirm
 *    "which build is live on Vercel" was actively lying to them. It now
 *    reports the real commit Vercel built from, and says `local` when there
 *    isn't one, which cannot go stale.
 *
 *  • `features` was a hand-maintained capability list
 *    (`farmerIdFilterOnFinancingAndProductions: true`) that nothing generated
 *    and nothing verified. Two of the filters it advertised were in fact being
 *    stripped before the controllers ever saw them (see validators/domain.js),
 *    so a dev asserting against this block would have concluded the opposite
 *    of the truth. Removed rather than left as a claim no test backs.
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'heabron-coopscore-api',
      version,
      build:
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GIT_COMMIT_SHA ||
        'local',
      env: config.env,
      timestamp: new Date().toISOString(),
    },
  });
});

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      name: 'Heabron CoopScore API',
      // Was a second hardcoded '1.0.0' that could drift from package.json.
      version,
      docs: '/api/docs',
      health: '/api/health',
    },
  });
});

module.exports = router;
