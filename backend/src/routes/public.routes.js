'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');

router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'heabron-coopscore-api',
      version: '1.0.0',
      // Bump this string whenever a meaningful backend change ships so the
      // mobile/web devs can confirm which build is actually live on Vercel.
      build: '2026-06-26-fieldnote-update-fix',
      // Quick capability flags devs can assert against in production.
      features: {
        listFilters: ['farmerId', 'season', 'cooperativeId', 'tier', 'agentId'],
        farmerIdFilterOnFinancingAndProductions: true,
      },
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
      version: '1.0.0',
      docs: '/api/docs',
      health: '/api/health',
    },
  });
});

module.exports = router;
