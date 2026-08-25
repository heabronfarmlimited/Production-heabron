'use strict';

const { Resend } = require('resend');
const config = require('../../config');
const logger = require('../../utils/logger');
const templates = require('../../templates/email/templates');

let resendClient = null;
function getClient() {
  if (resendClient) return resendClient;
  if (!config.resend.apiKey) {
    logger.warn('RESEND_API_KEY not set — emails will be logged but not sent');
    return null;
  }
  resendClient = new Resend(config.resend.apiKey);
  return resendClient;
}

/**
 * Low-level send. Returns { id } or { skipped: true }.
 */
async function send(to, subject, html, opts = {}) {
  if (!to) return { skipped: true, reason: 'no recipient' };

  const client = getClient();
  if (!client) {
    logger.info({ to, subject }, '[EMAIL DRY RUN] (no RESEND_API_KEY)');
    return { skipped: true };
  }

  try {
    const result = await client.emails.send({
      from: config.resend.fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: opts.replyTo || config.resend.replyTo,
      tags: opts.tags,
    });
    logger.info({ to, subject, id: result.data?.id }, 'email sent');
    return result.data;
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'email send failed');
    return { error: err.message };
  }
}

/**
 * Wrap a template function so callers don't have to think about
 * subject/html plumbing. Returns the send result.
 */
function makeSender(templateFn, tagName) {
  return async (to, params, opts = {}) => {
    const { subject, html } = templateFn(params);
    return send(to, subject, html, { ...opts, tags: [{ name: 'template', value: tagName }] });
  };
}

const sendOtp = makeSender(templates.otp, 'otp');
const sendAgentApplicationSubmitted = makeSender(templates.agentApplicationSubmitted, 'agent_application_submitted');
const sendAgentApproved = makeSender(templates.agentApproved, 'agent_approved');
const sendAgentRejected = makeSender(templates.agentRejected, 'agent_rejected');
const sendAgentSuspended = makeSender(templates.agentSuspended, 'agent_suspended');
const sendPartnerCreated = makeSender(templates.partnerCreated, 'partner_created');
const sendPartnerPasswordReset = makeSender(templates.partnerPasswordReset, 'partner_password_reset');
const sendFinancingSubmittedToAdmin = makeSender(templates.financingSubmittedToAdmin, 'financing_submitted');
const sendFinancingForwardedToPartner = makeSender(templates.financingForwardedToPartner, 'financing_forwarded');
const sendFinancingApproved = makeSender(templates.financingApproved, 'financing_approved');
const sendFinancingRejected = makeSender(templates.financingRejected, 'financing_rejected');
const sendFinancingDisbursed = makeSender(templates.financingDisbursed, 'financing_disbursed');
const sendRepaymentRecorded = makeSender(templates.repaymentRecorded, 'repayment_recorded');
const sendSettlementRequested = makeSender(templates.settlementRequested, 'settlement_requested');
const sendSettlementApproved = makeSender(templates.settlementApproved, 'settlement_approved');
const sendCreditScoreAlert = makeSender(templates.creditScoreAlert, 'credit_score_alert');
const sendPartnerDecisionToAdmin = makeSender(templates.partnerDecisionToAdmin, 'partner_decision_to_admin');
const sendCashPurchaseSubmitted = makeSender(templates.cashPurchaseSubmitted, 'cash_purchase_submitted');
const sendCashPurchaseDecision = makeSender(templates.cashPurchaseDecision, 'cash_purchase_decision');
const sendChangeRequestDecision = makeSender(templates.changeRequestDecision, 'change_request_decision');
const sendYieldVerificationDecision = makeSender(templates.yieldVerificationDecision, 'yield_verification_decision');

/**
 * Fire-and-forget wrapper: never throws, never blocks the request.
 */
function safe(fn) {
  return (...args) => {
    Promise.resolve(fn(...args)).catch((err) => logger.warn({ err: err.message }, 'safe email failed'));
  };
}

module.exports = {
  send,
  sendOtp,
  sendAgentApplicationSubmitted,
  sendAgentApproved,
  sendAgentRejected,
  sendAgentSuspended,
  sendPartnerCreated,
  sendPartnerPasswordReset,
  sendFinancingSubmittedToAdmin,
  sendFinancingForwardedToPartner,
  sendFinancingApproved,
  sendFinancingRejected,
  sendFinancingDisbursed,
  sendRepaymentRecorded,
  sendSettlementRequested,
  sendSettlementApproved,
  sendCreditScoreAlert,
  sendPartnerDecisionToAdmin,
  sendCashPurchaseSubmitted,
  sendCashPurchaseDecision,
  sendChangeRequestDecision,
  sendYieldVerificationDecision,
  safe,
};
