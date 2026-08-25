'use strict';

const { supabaseAdmin } = require('../config/supabase');
const logger = require('./logger');

/**
 * Record an action to the activity_logs table.
 * Failure is non-fatal — never let logging break the request.
 */
async function logActivity({ actor, action, entityType, entityId, metadata, req }) {
  try {
    const sb = supabaseAdmin();
    await sb.from('activity_logs').insert({
      actor_id: actor?.userId || null,
      actor_role: actor?.role || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      metadata: metadata || null,
      ip_address: req?.ip || null,
      user_agent: req?.get?.('user-agent') || null,
    });
  } catch (err) {
    logger.warn({ err }, 'activity log failed');
  }
}

module.exports = { logActivity };
