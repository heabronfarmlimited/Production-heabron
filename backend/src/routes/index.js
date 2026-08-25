'use strict';

const express = require('express');
const publicRoutes = require('./public.routes');
const authRoutes = require('./auth.routes');
const agentRoutes = require('./agent.routes');
const adminRoutes = require('./admin.routes');
const partnerRoutes = require('./partner.routes');

const router = express.Router();

router.use('/', publicRoutes);
router.use('/auth', authRoutes);
router.use('/agent', agentRoutes);
router.use('/admin', adminRoutes);
router.use('/partner', partnerRoutes);

module.exports = router;
