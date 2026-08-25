'use strict';

const config = require('../../config');
const {
  baseTemplate, heading, lede, paragraph, button, pill,
  detailTable, credentials, infoBox, successBox, warningBox, dangerBox, code,
} = require('./_base');

const { brand, publicAppUrl } = config;
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

// ============================================================================
// 1. OTP — signup / password reset
// ============================================================================
function otp({ fullName, otpCode, purpose }) {
  const isSignup = purpose === 'signup';
  const title = isSignup ? 'Confirm your email address' : 'Reset your password';
  const intro = isSignup
    ? `Hi ${fullName || 'there'}, confirm this is your email so we can finish setting up your ${brand.name} field agent account.`
    : `Hi ${fullName || 'there'}, we received a request to reset the password on your ${brand.name} account. Enter the code below to continue.`;
  return {
    subject: isSignup
      ? `${otpCode} is your ${brand.name} confirmation code`
      : `${otpCode} is your ${brand.name} password reset code`,
    html: baseTemplate({
      title,
      eyebrow: isSignup ? 'Email confirmation' : 'Password reset',
      preheader: `Your code is ${otpCode}. It expires in 10 minutes.`,
      bodyHtml: `
        ${heading(title)}
        ${lede(intro)}
        ${code(otpCode)}
        ${warningBox(`This code expires in <strong>10 minutes</strong>. If you didn't request it, you can safely ignore this email — no changes will be made.`)}
      `,
    }),
  };
}

// ============================================================================
// 2. Field agent application submitted
// ============================================================================
function agentApplicationSubmitted({ fullName }) {
  return {
    subject: `We received your ${brand.name} application`,
    html: baseTemplate({
      title: 'Application received',
      eyebrow: 'Field agent application',
      preheader: 'Your field agent application is under review',
      bodyHtml: `
        ${heading(`Thanks, ${fullName} — we've got your application`)}
        ${lede(`Your field agent application has been received and is now in the review queue.`)}
        ${infoBox(`<strong>What happens next?</strong><br />Our team reviews your identity details and selfie. This usually takes <strong>24–48 hours</strong>, and you'll get an email the moment a decision is made.`)}
        ${paragraph(`While you wait, you can sign in any time to check your application status.`)}
      `,
    }),
  };
}

// ============================================================================
// 3. Field agent approved
// ============================================================================
function agentApproved({ fullName }) {
  return {
    subject: `You're approved — welcome to ${brand.name}`,
    html: baseTemplate({
      title: 'Agent application approved',
      eyebrow: 'Approved',
      preheader: 'Your field agent account is now active',
      bodyHtml: `
        ${heading(`Welcome aboard, ${fullName}`)}
        ${lede(`Your application has been approved and your ${brand.name} field agent account is now <strong>active</strong>. You can start onboarding cooperatives and farmers right away.`)}
        ${button('Open the app', publicAppUrl)}
        ${successBox(`<strong>Quick start</strong><br />1. Sign in with the email &amp; password you registered<br />2. Create your first cooperative<br />3. Add farmers, map farms &amp; log deliveries<br />4. Submit financing requests and record repayments`)}
      `,
    }),
  };
}

// ============================================================================
// 4. Field agent rejected
// ============================================================================
function agentRejected({ fullName, reason }) {
  return {
    subject: `${brand.name} application update`,
    html: baseTemplate({
      title: 'Application update',
      eyebrow: 'Application decision',
      preheader: 'A decision has been made on your application',
      bodyHtml: `
        ${heading(`Hi ${fullName}`)}
        ${lede(`After reviewing your application, we're unable to approve your ${brand.name} field agent account at this time.`)}
        ${reason ? dangerBox(`<strong>Reason</strong><br />${reason}`) : ''}
        ${paragraph(`If you believe this is a mistake or can provide more information, reach out to <a href="mailto:${brand.supportEmail}" style="color:${config.brand.primary};">${brand.supportEmail}</a>.`)}
      `,
    }),
  };
}

// ============================================================================
// 5. Agent suspended
// ============================================================================
function agentSuspended({ fullName, reason }) {
  return {
    subject: `${brand.name} account suspended`,
    html: baseTemplate({
      title: 'Account suspended',
      eyebrow: 'Account status',
      preheader: 'Your field agent access has been temporarily suspended',
      bodyHtml: `
        ${heading(`Hi ${fullName}`)}
        ${lede(`Your ${brand.name} field agent account has been <strong>suspended</strong> by an administrator. You won't be able to sign in or submit data until this is resolved.`)}
        ${reason ? dangerBox(`<strong>Reason</strong><br />${reason}`) : ''}
        ${paragraph(`For assistance, contact <a href="mailto:${brand.supportEmail}" style="color:${config.brand.primary};">${brand.supportEmail}</a>.`)}
      `,
    }),
  };
}

// ============================================================================
// 6. Partner account created (auto-password)
// ============================================================================
function partnerCreated({ organizationName, contactName, email, autoPassword, loginUrl }) {
  return {
    subject: `Welcome to ${brand.name} — your organization account is ready`,
    html: baseTemplate({
      title: 'Your partner portal is ready',
      eyebrow: 'Partner portal',
      preheader: `Sign-in details for ${organizationName}`,
      bodyHtml: `
        ${heading(`Welcome, ${contactName || organizationName}`)}
        ${lede(`An administrator at ${brand.name} has set up a partner portal account for <strong>${organizationName}</strong>. Use the credentials below to sign in.`)}
        ${credentials([
          { label: 'Email', value: email },
          { label: 'Temporary password', value: autoPassword, mono: true },
        ])}
        ${button('Sign in to the partner portal', loginUrl)}
        ${warningBox(`<strong>Action required.</strong> For your security you'll be asked to change this password the first time you sign in. Don't share these credentials with anyone outside your organization.`)}
      `,
    }),
  };
}

// ============================================================================
// 7. Partner password reset by admin
// ============================================================================
function partnerPasswordReset({ organizationName, contactName, newPassword, loginUrl }) {
  return {
    subject: `Your ${brand.name} partner password was reset`,
    html: baseTemplate({
      title: 'Password reset',
      eyebrow: 'Partner portal',
      preheader: 'An admin reset your partner portal password',
      bodyHtml: `
        ${heading('Your password was reset')}
        ${lede(`Hi ${contactName || organizationName}, an administrator has reset the password on your ${brand.name} partner portal account.`)}
        ${credentials([{ label: 'New temporary password', value: newPassword, mono: true }])}
        ${button('Sign in', loginUrl)}
        ${warningBox(`You'll be asked to choose a new password as soon as you sign in.`)}
      `,
    }),
  };
}

// ============================================================================
// 8. Financing request submitted (admin notification)
// ============================================================================
function financingSubmittedToAdmin({ adminName, cooperativeName, farmerName, amount, agentName }) {
  return {
    subject: `New financing request: ${cooperativeName}`,
    html: baseTemplate({
      title: 'New financing request',
      eyebrow: 'Financing · Action needed',
      preheader: `${cooperativeName} requested ${naira(amount)}`,
      bodyHtml: `
        ${heading('A new financing request needs review')}
        ${lede(`${adminName ? `Hi ${adminName}, a` : 'A'} field agent has submitted a financing request.`)}
        ${detailTable([
          { label: 'Cooperative', value: cooperativeName },
          farmerName ? { label: 'Farmer', value: farmerName } : null,
          { label: 'Amount', value: naira(amount) },
          { label: 'Submitted by', value: agentName },
        ])}
        ${button('Review request', `${publicAppUrl}/admin/financing`)}
      `,
    }),
  };
}

// ============================================================================
// 9. Financing forwarded to partner (admin matches request to a partner)
// ============================================================================
function financingForwardedToPartner({ partnerName, cooperativeName, amount, cooperativeTier, dashboardUrl }) {
  return {
    subject: `Financing request for your review — ${cooperativeName}`,
    html: baseTemplate({
      title: 'Financing request for your review',
      eyebrow: 'Financing · Decision needed',
      preheader: `${cooperativeName} — ${naira(amount)}`,
      bodyHtml: `
        ${heading('A financing request needs your decision')}
        ${lede(`${brand.name} has matched a financing request to <strong>${partnerName}</strong> for your review.`)}
        ${detailTable([
          { label: 'Cooperative', value: cooperativeName },
          { label: 'Amount requested', value: naira(amount) },
          { label: 'CoopScore tier', value: cooperativeTier ? pill(`Tier ${cooperativeTier}`, cooperativeTier === 'A' ? 'green' : cooperativeTier === 'D' ? 'red' : 'gold') : pill('Pending', 'neutral') },
        ])}
        ${button('Review in partner portal', dashboardUrl)}
      `,
    }),
  };
}

// ============================================================================
// 9b. Partner decision relayed back to admin (NEW)
// ============================================================================
function partnerDecisionToAdmin({ adminName, partnerName, cooperativeName, amount, decision, approvedAmount, comments }) {
  const approved = decision === 'approved';
  return {
    subject: `${partnerName} ${approved ? 'approved' : 'declined'} financing — ${cooperativeName}`,
    html: baseTemplate({
      title: 'Partner decision received',
      eyebrow: 'Financing · Partner decision',
      preheader: `${partnerName} ${approved ? 'approved' : 'declined'} ${naira(amount)} for ${cooperativeName}`,
      bodyHtml: `
        ${heading(`${partnerName} has made a decision`)}
        ${lede(`${adminName ? `Hi ${adminName}, ` : ''}<strong>${partnerName}</strong> has reviewed the financing request for <strong>${cooperativeName}</strong>.`)}
        ${detailTable([
          { label: 'Decision', value: approved ? pill('Approved', 'green') : pill('Declined', 'red') },
          { label: 'Requested', value: naira(amount) },
          approved && approvedAmount != null ? { label: 'Approved amount', value: naira(approvedAmount) } : null,
        ])}
        ${comments ? infoBox(`<strong>Partner comments</strong><br />${comments}`) : ''}
        ${paragraph(approved
          ? `Record the manual disbursement when the funds are sent so the field agent can see it.`
          : `The request status will reflect the decline for the submitting field agent.`)}
        ${button('Open request', `${publicAppUrl}/admin/financing`)}
      `,
    }),
  };
}

// ============================================================================
// 10. Financing approved (notify agent)
// ============================================================================
function financingApproved({ recipientName, cooperativeName, amount, dueDate }) {
  return {
    subject: `Financing approved: ${cooperativeName}`,
    html: baseTemplate({
      title: 'Financing approved',
      eyebrow: 'Financing',
      preheader: `${naira(amount)} approved`,
      bodyHtml: `
        ${heading(`Good news, ${recipientName}`)}
        ${lede(`The financing request for <strong>${cooperativeName}</strong> has been <strong>approved</strong>.`)}
        ${successBox(`<strong>Approved amount:</strong> ${naira(amount)}${dueDate ? `<br /><strong>Repayment due:</strong> ${fmtDate(dueDate)}` : ''}`)}
        ${button('View details', `${publicAppUrl}/financing`)}
      `,
    }),
  };
}

// ============================================================================
// 11. Financing rejected
// ============================================================================
function financingRejected({ recipientName, cooperativeName, amount, reason }) {
  return {
    subject: `Financing request declined: ${cooperativeName}`,
    html: baseTemplate({
      title: 'Financing declined',
      eyebrow: 'Financing',
      preheader: `Your request for ${cooperativeName} was not approved`,
      bodyHtml: `
        ${heading(`Hi ${recipientName}`)}
        ${lede(`The financing request for <strong>${cooperativeName}</strong> (${naira(amount)}) has been <strong>declined</strong>.`)}
        ${reason ? dangerBox(`<strong>Reason</strong><br />${reason}`) : ''}
        ${paragraph(`You can submit a revised request after addressing the reason above.`)}
      `,
    }),
  };
}

// ============================================================================
// 12. Financing disbursed (manual)
// ============================================================================
function financingDisbursed({ recipientName, cooperativeName, amount, dueDate, reference }) {
  return {
    subject: `Funds disbursed: ${cooperativeName}`,
    html: baseTemplate({
      title: 'Financing disbursed',
      eyebrow: 'Financing · Disbursed',
      preheader: `${naira(amount)} has been disbursed`,
      bodyHtml: `
        ${heading('Funds disbursed')}
        ${lede(`Hi ${recipientName}, the approved financing for <strong>${cooperativeName}</strong> has been disbursed.`)}
        ${detailTable([
          { label: 'Disbursed amount', value: naira(amount) },
          reference ? { label: 'Reference', value: reference } : null,
          dueDate ? { label: 'Repayment due', value: fmtDate(dueDate) } : null,
        ])}
      `,
    }),
  };
}

// ============================================================================
// 13. Repayment recorded
// ============================================================================
function repaymentRecorded({ recipientName, farmerName, amount, outstandingBalance }) {
  return {
    subject: `Repayment recorded for ${farmerName}`,
    html: baseTemplate({
      title: 'Repayment recorded',
      eyebrow: 'Repayment',
      preheader: `${naira(amount)} from ${farmerName}`,
      bodyHtml: `
        ${heading('Repayment recorded')}
        ${lede(`Hi ${recipientName}, a repayment from <strong>${farmerName}</strong> has been logged.`)}
        ${detailTable([
          { label: 'Amount paid', value: naira(amount) },
          outstandingBalance != null ? { label: 'Outstanding balance', value: naira(outstandingBalance) } : null,
        ])}
      `,
    }),
  };
}

// ============================================================================
// 14. Settlement requested (admin)
// ============================================================================
function settlementRequested({ adminName, agentName, amount }) {
  return {
    subject: `Settlement request: ${agentName}`,
    html: baseTemplate({
      title: 'Settlement request',
      eyebrow: 'Wallet · Action needed',
      preheader: `${agentName} requested ${naira(amount)}`,
      bodyHtml: `
        ${heading('New settlement request')}
        ${lede(`${adminName ? `Hi ${adminName}, agent` : 'Agent'} <strong>${agentName}</strong> has requested a settlement of <strong>${naira(amount)}</strong>.`)}
        ${button('Review settlement', `${publicAppUrl}/admin/wallet-management`)}
      `,
    }),
  };
}

// ============================================================================
// 15. Settlement approved
// ============================================================================
function settlementApproved({ recipientName, amount }) {
  return {
    subject: 'Settlement approved',
    html: baseTemplate({
      title: 'Settlement approved',
      eyebrow: 'Wallet',
      preheader: `Your settlement of ${naira(amount)} was approved`,
      bodyHtml: `
        ${heading('Settlement approved')}
        ${lede(`Hi ${recipientName}, your settlement request for <strong>${naira(amount)}</strong> has been approved and is being processed to your bank account.`)}
      `,
    }),
  };
}

// ============================================================================
// 16. Credit score alert (admin)
// ============================================================================
function creditScoreAlert({ adminName, cooperativeName, oldScore, newScore, tier }) {
  return {
    subject: `Credit score alert: ${cooperativeName}`,
    html: baseTemplate({
      title: 'Credit score alert',
      eyebrow: 'Credit scoring',
      preheader: `${cooperativeName} moved to Tier ${tier}`,
      bodyHtml: `
        ${heading('Credit score change')}
        ${lede(`${adminName ? `Hi ${adminName}, the` : 'The'} credit score for <strong>${cooperativeName}</strong> has changed.`)}
        ${detailTable([
          { label: 'Previous score', value: oldScore },
          { label: 'New score', value: newScore },
          { label: 'New tier', value: pill(`Tier ${tier}`, tier === 'A' ? 'green' : tier === 'D' ? 'red' : 'gold') },
        ])}
      `,
    }),
  };
}

// ============================================================================
// 17. Manual cash purchase submitted (admin notification) — NEW
// ============================================================================
function cashPurchaseSubmitted({ adminName, agentName, farmerName, amount }) {
  return {
    subject: `Input purchase proof submitted: ${agentName}`,
    html: baseTemplate({
      title: 'Input purchase submitted',
      eyebrow: 'Manual payment · Action needed',
      preheader: `${agentName} submitted a ${naira(amount)} purchase for confirmation`,
      bodyHtml: `
        ${heading('Input purchase awaiting confirmation')}
        ${lede(`${adminName ? `Hi ${adminName}, ` : ''}field agent <strong>${agentName}</strong> has submitted proof of an input purchase for confirmation.`)}
        ${detailTable([
          farmerName ? { label: 'Farmer', value: farmerName } : null,
          { label: 'Amount', value: naira(amount) },
          { label: 'Submitted by', value: agentName },
        ])}
        ${button('Review purchase', `${publicAppUrl}/admin/wallet-management`)}
      `,
    }),
  };
}

// ============================================================================
// 18. Manual cash purchase confirmed / rejected (agent notification) — NEW
// ============================================================================
function cashPurchaseDecision({ recipientName, amount, decision, adminNotes }) {
  const confirmed = decision === 'confirm' || decision === 'confirmed';
  return {
    subject: `Input purchase ${confirmed ? 'confirmed' : 'rejected'}`,
    html: baseTemplate({
      title: `Purchase ${confirmed ? 'confirmed' : 'rejected'}`,
      eyebrow: 'Manual payment',
      preheader: `Your ${naira(amount)} purchase was ${confirmed ? 'confirmed' : 'rejected'}`,
      bodyHtml: `
        ${heading(`Hi ${recipientName || 'there'}`)}
        ${lede(`Your input purchase of <strong>${naira(amount)}</strong> has been <strong>${confirmed ? 'confirmed' : 'rejected'}</strong> by an administrator.`)}
        ${confirmed
          ? successBox(`This purchase has been recorded against the farmer's financing.`)
          : dangerBox(`${adminNotes ? `<strong>Reason</strong><br />${adminNotes}` : 'Please review the purchase details and resubmit with valid proof.'}`)}
      `,
    }),
  };
}

// ============================================================================
// 19. Change request decided (agent notification) — NEW
// ============================================================================
function changeRequestDecision({ recipientName, entityName, decision, reviewNotes }) {
  const approved = decision === 'approved' || decision === 'approve';
  return {
    subject: `Your update to ${entityName} was ${approved ? 'approved' : 'rejected'}`,
    html: baseTemplate({
      title: `Change ${approved ? 'approved' : 'rejected'}`,
      eyebrow: 'Pending changes',
      preheader: `Your requested update to ${entityName} was ${approved ? 'approved' : 'rejected'}`,
      bodyHtml: `
        ${heading(`Hi ${recipientName || 'there'}`)}
        ${lede(`Your requested update to <strong>${entityName}</strong> has been <strong>${approved ? 'approved' : 'rejected'}</strong> by an administrator.`)}
        ${approved
          ? successBox(`The change is now live on the record.`)
          : dangerBox(`${reviewNotes ? `<strong>Reason</strong><br />${reviewNotes}` : 'The change was not applied. Please review and resubmit if needed.'}`)}
      `,
    }),
  };
}

// ============================================================================
// 20. Yield verification decided (agent notification) — NEW
// ============================================================================
function yieldVerificationDecision({ recipientName, farmerName, season, decision, notes }) {
  const verified = decision === 'verified' || decision === 'verify';
  return {
    subject: `Yield ${verified ? 'verified' : 'rejected'} — ${farmerName}`,
    html: baseTemplate({
      title: `Yield ${verified ? 'verified' : 'rejected'}`,
      eyebrow: 'Yield verification',
      preheader: `Yield record for ${farmerName} was ${verified ? 'verified' : 'rejected'}`,
      bodyHtml: `
        ${heading(`Hi ${recipientName || 'there'}`)}
        ${lede(`The harvest yield record for <strong>${farmerName}</strong>${season ? ` (${season})` : ''} has been <strong>${verified ? 'verified' : 'rejected'}</strong>.`)}
        ${verified
          ? successBox(`This verified yield now feeds the farmer's CoopScore yield performance.`)
          : dangerBox(`${notes ? `<strong>Reason</strong><br />${notes}` : 'The yield record needs correction. Please review the evidence and resubmit.'}`)}
      `,
    }),
  };
}

module.exports = {
  otp,
  agentApplicationSubmitted,
  agentApproved,
  agentRejected,
  agentSuspended,
  partnerCreated,
  partnerPasswordReset,
  financingSubmittedToAdmin,
  financingForwardedToPartner,
  partnerDecisionToAdmin,
  financingApproved,
  financingRejected,
  financingDisbursed,
  repaymentRecorded,
  settlementRequested,
  settlementApproved,
  creditScoreAlert,
  cashPurchaseSubmitted,
  cashPurchaseDecision,
  changeRequestDecision,
  yieldVerificationDecision,
};
