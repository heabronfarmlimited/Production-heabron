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

/** Resend's documented default is 2 requests/second. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Low-level send. Returns `{ id }` on success, `{ skipped: true }` when no API
 * key is configured, or `{ error }` on failure.
 *
 * FIXED — two bugs here, both of which made a failed send look like a
 * successful one:
 *
 *  1. The Resend v4 SDK does NOT throw on an API error. It resolves with
 *     `{ data: null, error: {...} }`. The old code only caught thrown
 *     exceptions, then logged `'email sent'` with `id: undefined` and returned
 *     `result.data` — i.e. `undefined`. So a rejected send (unverified
 *     sending domain, invalid key, 429 rate limit) was recorded in the logs as
 *     a success and the caller had no way to detect it. `result.error` is now
 *     checked explicitly.
 *
 *  2. Resend rate-limits at ~2 requests/second. Several agents signing up at
 *     once would get a 429, which under bug 1 was silently discarded. 429s and
 *     5xx responses are now retried with backoff.
 *
 * Also: the option is `replyTo` in v4, not `reply_to` — the snake_case key was
 * being ignored, so replies went to the unmonitored `from` address.
 */
async function send(to, subject, html, opts = {}) {
  if (!to) return { skipped: true, reason: 'no recipient' };

  const client = getClient();
  if (!client) {
    logger.info({ to, subject }, '[EMAIL DRY RUN] (no RESEND_API_KEY)');
    return { skipped: true };
  }

  const payload = {
    from: config.resend.fromEmail,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    replyTo: opts.replyTo || config.resend.replyTo,
    tags: opts.tags,
  };

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await client.emails.send(payload);

      if (error) {
        lastError = error.message || String(error);
        const status = error.statusCode || error.status;

        if (RETRYABLE_STATUS.has(status) && attempt < MAX_ATTEMPTS) {
          const backoffMs = 500 * 2 ** (attempt - 1); // 500ms, 1s
          logger.warn(
            { to, subject, status, attempt, backoffMs },
            'email send retryable failure — backing off'
          );
          await sleep(backoffMs);
          continue;
        }

        logger.error(
          { err: lastError, status, to, subject, attempt },
          'email send rejected by provider'
        );
        return { error: lastError, status };
      }

      logger.info({ to, subject, id: data?.id, attempt }, 'email sent');
      return data;
    } catch (err) {
      // Network-level failure (DNS, socket, timeout).
      lastError = err.message;

      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        logger.warn(
          { err: lastError, to, subject, attempt, backoffMs },
          'email send threw — backing off'
        );
        await sleep(backoffMs);
        continue;
      }

      logger.error({ err: lastError, to, subject, attempt }, 'email send failed');
      return { error: lastError };
    }
  }

  return { error: lastError || 'email send failed' };
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
const sendPartnerDecisionToAdmin = makeSender(templates.partnerDecisionToAdmin, 'partner_decision_to_admin');
const sendCashPurchaseSubmitted = makeSender(templates.cashPurchaseSubmitted, 'cash_purchase_submitted');
const sendCashPurchaseDecision = makeSender(templates.cashPurchaseDecision, 'cash_purchase_decision');
const sendChangeRequestDecision = makeSender(templates.changeRequestDecision, 'change_request_decision');
const sendYieldVerificationDecision = makeSender(templates.yieldVerificationDecision, 'yield_verification_decision');

/**
 * Non-throwing wrapper. RETURNS A PROMISE — await it.
 *
 * FIXED (new finding, beyond the already-patched OTP path) — this was a
 * genuine fire-and-forget wrapper: it started the send, attached a `.catch`,
 * and returned `undefined`. Every caller outside `auth.controller` used it,
 * which means on Vercel — where the lambda is frozen the instant the response
 * is written — the in-flight HTTPS request to Resend was killed for:
 *
 *   agent approved / rejected / suspended      (admin.agents.controller)
 *   partner created — the ONLY copy of the      (admin.partners.controller)
 *     auto-generated password
 *   partner password reset — likewise           (admin.partners.controller)
 *   financing submitted / approved / rejected / (financing.controller)
 *     disbursed / forwarded to partner
 *   partner decision to admin                   (financing.controller)
 *   repayment recorded                           (repayments.controller)
 *   settlement requested / approved              (wallet, admin.wallet)
 *   cash purchase decision                       (admin.wallet.controller)
 *   change request decision                      (changeRequests.controller)
 *   yield verification decision                  (productions.controller)
 *
 * Exactly the same defect the OTP email was already fixed for, in fifteen
 * other places. Whether any of these mails escaped depended on whether the
 * instance happened to stay warm.
 *
 * Returning the promise lets callers `await` it and inspect `{ error }` while
 * keeping the original guarantee: it never rejects, so a mail failure can
 * never break the request that triggered it.
 */
function safe(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.warn({ err: err.message }, 'safe email failed');
      return { error: err.message };
    }
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
  sendPartnerDecisionToAdmin,
  sendCashPurchaseSubmitted,
  sendCashPurchaseDecision,
  sendChangeRequestDecision,
  sendYieldVerificationDecision,
  safe,
};
