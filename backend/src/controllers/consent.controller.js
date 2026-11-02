'use strict';

/**
 * Data consent — "CoopScore Data Consent Specification" v1.0.
 *
 * Two mandatory gates:
 *   Flow A  cooperative consent, given once by the leader at registration
 *   Flow B  farmer acknowledgment, given by each farmer at onboarding
 *
 * The decisions with legal weight live in services/consent/rules.js; this file
 * is the plumbing around them — persistence, the immutability chain, the
 * emailed verification code and the admin actions.
 *
 * VERIFICATION IS BY EMAIL, not the SMS code the specification describes.
 * There is no SMS provider on this platform and none was agreed. A signer with
 * no email address lands in the spec's own Pending Verification state, the
 * same one it defines for an offline capture, for an admin to resolve.
 */

const { supabaseAdmin } = require('../config/supabase');
const {
  ok,
  created,
  badRequest,
  notFound,
  conflict,
  unprocessable,
  serverError,
  paginated,
} = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { getSignedUrl } = require('../services/storage');
const otp = require('../services/otp');
const email = require('../services/email');
const rules = require('../services/consent/rules');
const logger = require('../utils/logger');

/** Columns safe to return to a field agent. Evidence paths are admin-only. */
const AGENT_COLUMNS =
  'id, entity_type, entity_id, agreement_version, language, item_responses, ' +
  'third_party_sharing, signer_name, signer_role, otp_status, status, ' +
  'created_at, timestamp_server';

/**
 * Loads the live consent for an entity, if any.
 * `superseded` and `withdrawn` rows are excluded: they are history.
 */
async function liveConsentFor(sb, entityType, entityId) {
  if (!entityId) return null;
  const { data, error } = await sb
    .from('consent_records')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .in('status', ['active', 'pending_verification'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Whether a cooperative permits third-party sharing.
 *
 * A farmer cannot grant sharing their cooperative refused, so this is read
 * server-side rather than trusted from the client (spec 4.3).
 */
async function cooperativeAllowsSharing(sb, cooperativeId) {
  if (!cooperativeId) return true;
  const consent = await liveConsentFor(sb, 'cooperative', cooperativeId);
  return rules.allowsThirdPartySharing(consent);
}

/**
 * POST /agent/consent — record a consent capture.
 *
 * Idempotent per entity: capturing again supersedes the previous record rather
 * than editing it, which is what keeps the history append-only (spec 7).
 */
async function recordConsent(req, res) {
  const sb = supabaseAdmin();
  const body = req.body;
  const { entityType, entityId, cooperativeId } = body;

  if (!rules.SUPPORTED_LANGUAGES.includes(body.language)) {
    return badRequest(
      res,
      `Consent is only available in: ${rules.SUPPORTED_LANGUAGES.join(', ')}. ` +
        'Other translations are still being reviewed.'
    );
  }

  if (entityType === 'farmer' && !cooperativeId && !entityId) {
    return badRequest(res, 'cooperativeId is required for farmer consent');
  }

  // Flow B requires Flow A to be complete first (spec 4, Rule).
  if (entityType === 'farmer' && cooperativeId) {
    const coopConsent = await liveConsentFor(sb, 'cooperative', cooperativeId);
    if (!rules.satisfiesGate(coopConsent)) {
      return conflict(
        res,
        'This cooperative has no consent on record. Complete the cooperative consent before adding farmers.',
        { cooperativeId }
      );
    }
  }

  const allowsSharing = await cooperativeAllowsSharing(sb, cooperativeId);
  const validation = rules.validateResponses(entityType, body.itemResponses, {
    cooperativeAllowsSharing: allowsSharing,
  });

  if (!validation.ok) {
    // A refusal of a required item is not a validation failure to retry — it
    // is a decision. Log it without personal details and say so plainly.
    const refusedRequired = validation.errors.some((e) => /must be agreed/.test(e.message));
    if (refusedRequired) {
      const entry = rules.declineLogEntry({
        entityType,
        responses: body.itemResponses,
        agentId: req.user.userId,
        cooperativeId: cooperativeId || null,
      });
      logger.info(entry, 'consent declined — registration not completed');
      await logActivity({
        actor: req.user,
        action: 'consent_declined',
        entityType: `${entityType}_consent`,
        entityId: entityId || null,
        metadata: { refusedItems: entry.refused_items },
        req,
      });
    }
    return unprocessable(res, 'Consent cannot be recorded', validation.errors);
  }

  if (body.voiceFile && !rules.voiceIsAcceptable({ durationSeconds: body.voiceDurationSeconds })) {
    return badRequest(
      res,
      `The recorded statement must be at least ${rules.MIN_VOICE_SECONDS} seconds long.`
    );
  }

  const previous = await liveConsentFor(sb, entityType, entityId);
  const { status, otpStatus } = rules.initialStatus({
    otpVerified: false,
    signerEmail: body.signerEmail,
  });

  const row = {
    entity_type: entityType,
    entity_id: entityId || null,
    agreement_version: body.agreementVersion,
    language: body.language,
    item_responses: body.itemResponses,
    third_party_sharing: validation.thirdPartySharing,
    signer_name: body.signerName,
    signer_role: body.signerRole || null,
    signer_phone: body.signerPhone || null,
    signer_email: body.signerEmail ? otp.normalizeEmail(body.signerEmail) : null,
    second_officer_name: body.secondOfficerName || null,
    second_officer_phone: body.secondOfficerPhone || null,
    second_officer_email: body.secondOfficerEmail || null,
    signature_file: body.signatureFile || null,
    voice_file: body.voiceFile || null,
    unable_to_sign: Boolean(body.unableToSign),
    otp_status: otpStatus,
    agent_id: req.user.userId,
    timestamp_device: body.timestampDevice || null,
    gps_latitude: body.gpsLatitude ?? null,
    gps_longitude: body.gpsLongitude ?? null,
    status,
    supersedes_id: previous ? previous.id : null,
  };

  // Supersede first. A partial unique index allows only one `active` row per
  // entity, so inserting before superseding would be rejected by the database.
  if (previous) {
    const { error: supErr } = await sb
      .from('consent_records')
      .update({ status: 'superseded' })
      .eq('id', previous.id);
    if (supErr) throw supErr;
  }

  const { data: inserted, error: insErr } = await sb
    .from('consent_records')
    .insert(row)
    .select(AGENT_COLUMNS)
    .single();

  if (insErr) {
    // Put the previous record back, so a failed capture does not leave the
    // entity with no consent at all.
    if (previous) {
      await sb.from('consent_records').update({ status: previous.status }).eq('id', previous.id);
    }
    logger.error(
      { err: insErr.message, code: insErr.code, entityType, entityId },
      'consent insert failed'
    );
    throw insErr;
  }

  if (entityId) await applyConsentToEntity(sb, entityType, entityId, inserted);

  // Send the verification code. Awaited: a code that never left must not be
  // reported as sent (the serverless host freezes the function on response).
  let emailSent = false;
  if (row.signer_email) {
    try {
      const code = await otp.createOtp(row.signer_email, otp.OTP_PURPOSES.CONSENT);
      const delivery = await email.safe(email.sendOtp)(row.signer_email, {
        fullName: row.signer_name,
        otpCode: code,
        purpose: 'consent',
      });
      emailSent = !delivery?.error;
      if (delivery?.error) {
        logger.warn({ err: delivery.error, consentId: inserted.id }, 'consent OTP email rejected');
      }
    } catch (e) {
      logger.error({ err: e.message, consentId: inserted.id }, 'consent OTP could not be issued');
    }
  }

  await logActivity({
    actor: req.user,
    action: 'consent_recorded',
    entityType: `${entityType}_consent`,
    entityId: inserted.id,
    metadata: { thirdPartySharing: validation.thirdPartySharing, supersededId: row.supersedes_id },
    req,
  });

  return created(res, {
    ...inserted,
    verificationEmailSent: emailSent,
    // So the app can show "we sent a code to ..." or the pending-verification
    // state without guessing which happened.
    requiresVerification: otpStatus === 'pending',
  });
}

/** Mirrors the consent decision onto the entity for cheap, joinless reads. */
async function applyConsentToEntity(sb, entityType, entityId, consent) {
  const table = entityType === 'cooperative' ? 'cooperatives' : 'farmers';
  const { data, error } = await sb
    .from(table)
    .update({
      consent_record_id: consent.id,
      consent_status: consent.status,
      third_party_sharing: consent.third_party_sharing,
    })
    .eq('id', entityId)
    .select('id');
  if (error) {
    logger.error({ err: error.message, table, entityId }, 'consent flags update failed');
    return false;
  }
  if (!data || data.length === 0) {
    // An UPDATE matching no rows reports no error, so this has to be checked
    // explicitly or the entity silently keeps its old sharing flag.
    logger.error({ table, entityId }, 'consent flags update matched no rows');
    return false;
  }
  return true;
}

/** POST /agent/consent/:consentId/verify — confirm the emailed code. */
async function verifyConsentOtp(req, res) {
  const sb = supabaseAdmin();

  const { data: consent, error } = await sb
    .from('consent_records')
    .select('*')
    .eq('id', req.params.consentId)
    .maybeSingle();
  if (error) throw error;
  if (!consent) return notFound(res, 'Consent record not found');

  if (consent.status === 'withdrawn' || consent.status === 'superseded') {
    return conflict(res, `This consent record is ${consent.status}`);
  }
  if (consent.otp_status === 'verified') return ok(res, { alreadyVerified: true });
  if (!consent.signer_email) {
    return badRequest(res, 'This consent has no email address to verify against.');
  }

  const result = await otp.consumeOtp(consent.signer_email, req.body.code, otp.OTP_PURPOSES.CONSENT);
  if (!result.ok) {
    logger.warn({ consentId: consent.id, reason: result.reason }, 'consent OTP verification failed');
    // One message for every failure reason, so a wrong code cannot be told
    // apart from a missing one by probing.
    return badRequest(res, 'That code is not valid or has expired. Request a new one.');
  }

  const { data: updated, error: updErr } = await sb
    .from('consent_records')
    .update({ otp_status: 'verified', status: 'active', otp_verified_at: new Date().toISOString() })
    .eq('id', consent.id)
    .select(AGENT_COLUMNS);
  if (updErr) throw updErr;
  if (!updated || updated.length === 0) {
    return serverError(res, 'Could not mark this consent verified. Please try again.');
  }

  if (consent.entity_id) {
    await applyConsentToEntity(sb, consent.entity_type, consent.entity_id, updated[0]);
  }

  await logActivity({
    actor: req.user,
    action: 'consent_verified',
    entityType: `${consent.entity_type}_consent`,
    entityId: consent.id,
    req,
  });

  return ok(res, updated[0]);
}

/** POST /agent/consent/:consentId/resend — issue a fresh code. */
async function resendConsentOtp(req, res) {
  const sb = supabaseAdmin();
  const { data: consent, error } = await sb
    .from('consent_records')
    .select('id, signer_email, signer_name, status, otp_status')
    .eq('id', req.params.consentId)
    .maybeSingle();
  if (error) throw error;
  if (!consent) return notFound(res, 'Consent record not found');
  if (consent.otp_status === 'verified') return ok(res, { alreadyVerified: true });
  if (!consent.signer_email) {
    return badRequest(res, 'This consent has no email address to send a code to.');
  }

  const code = await otp.createOtp(consent.signer_email, otp.OTP_PURPOSES.CONSENT);
  const delivery = await email.safe(email.sendOtp)(consent.signer_email, {
    fullName: consent.signer_name,
    otpCode: code,
    purpose: 'consent',
  });
  if (delivery?.error) {
    return serverError(res, 'We could not send the code. Please try again shortly.');
  }
  return ok(res, { sent: true });
}

/** GET /agent/consent/:entityType/:entityId — the live consent for an entity. */
async function getConsentForEntity(req, res) {
  const sb = supabaseAdmin();
  const { entityType, entityId } = req.params;
  if (!['cooperative', 'farmer'].includes(entityType)) {
    return badRequest(res, 'entityType must be "cooperative" or "farmer"');
  }

  const consent = await liveConsentFor(sb, entityType, entityId);
  return ok(res, {
    consent: consent
      ? Object.fromEntries(
          Object.entries(consent).filter(([k]) => AGENT_COLUMNS.includes(k))
        )
      : null,
    satisfiesGate: rules.satisfiesGate(consent),
    allowsThirdPartySharing: rules.allowsThirdPartySharing(consent),
    needsRecollection: rules.needsRecollection(consent),
  });
}

/** GET /admin/consent — review queue, pending verification first. */
async function listConsent(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { status, entityType } = req.query;

  let q = sb.from('consent_records').select('*', { count: 'exact' });
  if (status) q = q.eq('status', status);
  if (entityType) q = q.eq('entity_type', entityType);

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

/**
 * GET /admin/consent/:consentId — full record including the evidence.
 *
 * Only admins reach this route, and only here are the signature and voice
 * recording exposed, as short-lived signed URLs (spec 9: partners see consent
 * status only, never the recordings or signatures).
 */
async function getConsent(req, res) {
  const sb = supabaseAdmin();
  const { data: consent, error } = await sb
    .from('consent_records')
    .select('*')
    .eq('id', req.params.consentId)
    .maybeSingle();
  if (error) throw error;
  if (!consent) return notFound(res, 'Consent record not found');

  const evidence = {};
  for (const [key, path] of [
    ['signatureUrl', consent.signature_file],
    ['voiceUrl', consent.voice_file],
  ]) {
    if (!path) continue;
    try {
      // Minutes, not the year-long default: this is biometric-adjacent
      // personal data and the URL should not outlive the admin looking at it.
      evidence[key] = await getSignedUrl('consent-evidence', path, 300);
    } catch (e) {
      logger.warn({ err: e.message, consentId: consent.id, path }, 'consent evidence URL failed');
      evidence[key] = null;
    }
  }

  return ok(res, { ...consent, evidence });
}

/**
 * POST /admin/consent/:consentId/withdraw — withdraw consent (spec 8).
 *
 * Stops new collection and third-party sharing from this date. Existing loan
 * and repayment records are deliberately retained for settlement and audit.
 */
async function withdrawConsent(req, res) {
  const sb = supabaseAdmin();
  const { reason } = req.body;

  const { data: consent, error } = await sb
    .from('consent_records')
    .select('*')
    .eq('id', req.params.consentId)
    .maybeSingle();
  if (error) throw error;
  if (!consent) return notFound(res, 'Consent record not found');
  if (consent.status === 'withdrawn') {
    return conflict(res, 'This consent has already been withdrawn');
  }

  const { data: updated, error: updErr } = await sb
    .from('consent_records')
    .update({
      status: 'withdrawn',
      withdrawal_date: new Date().toISOString(),
      withdrawal_reason: reason,
      withdrawn_by_user_id: req.user.userId,
      third_party_sharing: false,
    })
    .eq('id', consent.id)
    .eq('status', consent.status)
    .select('*');
  if (updErr) throw updErr;
  if (!updated || updated.length === 0) {
    return conflict(res, 'This consent was changed by someone else a moment ago');
  }

  if (consent.entity_id) {
    await applyConsentToEntity(sb, consent.entity_type, consent.entity_id, updated[0]);
  }

  // When a cooperative withdraws, its members' records are flagged for review
  // (spec 8) — not auto-withdrawn, because each farmer gave their own consent.
  let flaggedMembers = 0;
  if (consent.entity_type === 'cooperative' && consent.entity_id) {
    const { data: members, error: memErr } = await sb
      .from('farmers')
      .update({ third_party_sharing: false })
      .eq('cooperative_id', consent.entity_id)
      .select('id');
    if (memErr) {
      logger.error({ err: memErr.message, cooperativeId: consent.entity_id }, 'member sharing flag update failed');
    } else {
      flaggedMembers = (members || []).length;
    }
  }

  await logActivity({
    actor: req.user,
    action: 'consent_withdrawn',
    entityType: `${consent.entity_type}_consent`,
    entityId: consent.id,
    metadata: { reason, flaggedMembers },
    req,
  });

  return ok(res, { ...updated[0], flaggedMembers });
}

module.exports = {
  recordConsent,
  verifyConsentOtp,
  resendConsentOtp,
  getConsentForEntity,
  listConsent,
  getConsent,
  withdrawConsent,
  // Exported for the onboarding gates in the cooperative and farmer controllers.
  liveConsentFor,
  cooperativeAllowsSharing,
};
