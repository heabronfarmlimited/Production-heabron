'use strict';

const config = require('../../config');

/**
 * Heabron email design system.
 * Inline CSS only (Gmail/Outlook strip <style>), table-based layout, 600px
 * shell. Forest-green + harvest-gold palette to match the platform.
 *
 * Exports a base shell plus composable content helpers so every template
 * reads declaratively instead of hand-rolling tables.
 */

const palette = {
  bg: '#EBE7DC',
  card: '#FFFFFF',
  ink: '#1C2A22',
  body: '#415047',
  muted: '#7B847E',
  faint: '#9AA29C',
  line: '#E6E2D6',
  primary: config.brand.primary || '#2C6B47',
  primaryDark: '#205038',
  accent: config.brand.accent || '#E0A82E',
  greenTint: '#ECF5EF',
  greenBorder: '#CFE6D8',
  greenText: '#1F4D33',
  goldTint: '#FBF1D8',
  goldBorder: '#EBD9A0',
  goldText: '#6B520C',
  redTint: '#FCECEC',
  redBorder: '#F2C6C6',
  redText: '#8A2020',
  panel: '#F6F4ED',
};

const FONT = "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono','Courier New',monospace";

function baseTemplate({ title, preheader = '', eyebrow = '', bodyHtml }) {
  const { brand } = config;
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${palette.bg};font-family:${FONT};color:${palette.ink};-webkit-font-smoothing:antialiased;width:100%;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${palette.bg};">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

            <tr><td style="height:4px;background:${palette.accent};border-radius:18px 18px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>

            <tr>
              <td style="background:${palette.card};border:1px solid ${palette.line};border-top:none;border-radius:0 0 18px 18px;overflow:hidden;">

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background:linear-gradient(135deg,${palette.primary} 0%,${palette.primaryDark} 100%);padding:26px 36px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td align="left" style="vertical-align:middle;">
                            <img src="${brand.logoUrl}" alt="${brand.name}" height="34" style="display:block;height:34px;width:auto;border:0;" />
                          </td>
                          <td align="right" style="vertical-align:middle;color:#DCEFE4;font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;">
                            ${brand.name}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:38px 36px 8px 36px;">
                      ${eyebrow ? `<p style="margin:0 0 10px 0;color:${palette.accent};font-size:11.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${eyebrow}</p>` : ''}
                      ${bodyHtml}
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="padding:28px 36px 0 36px;"><hr style="border:none;border-top:1px solid ${palette.line};margin:0;" /></td></tr>
                  <tr>
                    <td style="padding:20px 36px 32px 36px;color:${palette.muted};font-size:12px;line-height:1.7;">
                      <p style="margin:0 0 6px 0;font-weight:600;color:${palette.ink};">${brand.name}</p>
                      <p style="margin:0 0 10px 0;">
                        <a href="${brand.website}" style="color:${palette.primary};text-decoration:none;">${(brand.website || '').replace(/^https?:\/\//, '')}</a>
                        &nbsp;·&nbsp;
                        <a href="mailto:${brand.supportEmail}" style="color:${palette.primary};text-decoration:none;">${brand.supportEmail}</a>
                      </p>
                      <p style="margin:0;color:${palette.faint};font-size:11px;">
                        This is a transactional message about your ${brand.name} account.<br />
                        © ${year} Heabron Farm Limited. All rights reserved.
                      </p>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 12px 0;color:${palette.ink};font-size:23px;line-height:1.25;font-weight:700;">${text}</h1>`;
}
function lede(html) {
  return `<p style="margin:0 0 18px 0;color:${palette.body};font-size:15px;line-height:1.65;">${html}</p>`;
}
function paragraph(html) {
  return `<p style="margin:16px 0 0 0;color:${palette.body};font-size:14.5px;line-height:1.65;">${html}</p>`;
}

function button(label, href, variant = 'primary') {
  const bg = variant === 'accent' ? palette.accent : palette.primary;
  const fg = variant === 'accent' ? '#3A2E07' : '#FFFFFF';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px 0;">
    <tr>
      <td style="border-radius:10px;background:${bg};box-shadow:0 2px 6px rgba(28,42,34,0.18);">
        <a href="${href}" style="display:inline-block;padding:13px 30px;color:${fg};text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;letter-spacing:0.2px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function pill(label, variant = 'green') {
  const map = {
    green: [palette.greenTint, palette.greenText, palette.greenBorder],
    gold: [palette.goldTint, palette.goldText, palette.goldBorder],
    red: [palette.redTint, palette.redText, palette.redBorder],
    neutral: ['#EEEDE6', '#5A615B', palette.line],
  };
  const [bg, fg, bd] = map[variant] || map.green;
  return `<span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${bd};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;letter-spacing:0.3px;">${label}</span>`;
}

function detailTable(rows = []) {
  const clean = rows.filter(Boolean);
  const body = clean
    .map(
      (r, i) => `
      <tr>
        <td style="padding:${i === 0 ? '0' : '12px'} 0 2px 0;width:42%;color:${palette.muted};font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;vertical-align:top;">${r.label}</td>
        <td style="padding:${i === 0 ? '0' : '12px'} 0 2px 0;color:${palette.ink};font-size:15px;font-weight:${r.strong === false ? '500' : '600'};text-align:right;vertical-align:top;">${r.value}</td>
      </tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${palette.panel};border:1px solid ${palette.line};border-radius:12px;margin:18px 0;">
    <tr><td style="padding:18px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
    </td></tr>
  </table>`;
}

function credentials(rows = []) {
  const body = rows
    .map(
      (r) => `
      <p style="margin:0 0 4px 0;color:${palette.muted};font-size:11px;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;">${r.label}</p>
      <p style="margin:0 0 16px 0;color:${palette.ink};font-size:${r.mono ? '19px' : '15px'};font-weight:700;${r.mono ? `font-family:${MONO};letter-spacing:1px;` : ''}">${r.value}</p>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${palette.panel};border:1px solid ${palette.line};border-radius:12px;margin:18px 0;">
    <tr><td style="padding:20px 22px 6px 22px;">${body}</td></tr>
  </table>`;
}

function _box(bg, bd, fg, html) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border:1px solid ${bd};border-radius:12px;margin:18px 0;">
    <tr><td style="padding:16px 18px;color:${fg};font-size:14px;line-height:1.6;">${html}</td></tr>
  </table>`;
}
function infoBox(html) { return _box(palette.greenTint, palette.greenBorder, palette.greenText, html); }
function successBox(html) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${palette.greenTint};border:1px solid ${palette.greenBorder};border-left:4px solid ${palette.primary};border-radius:12px;margin:18px 0;">
    <tr><td style="padding:16px 18px;color:${palette.greenText};font-size:14px;line-height:1.6;">${html}</td></tr>
  </table>`;
}
function warningBox(html) { return _box(palette.goldTint, palette.goldBorder, palette.goldText, html); }
function dangerBox(html) { return _box(palette.redTint, palette.redBorder, palette.redText, html); }

function code(text) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
    <tr><td align="center" style="background:${palette.panel};border:1px dashed ${palette.goldBorder};border-radius:12px;padding:22px;">
      <div style="font-family:${MONO};font-size:30px;letter-spacing:10px;font-weight:700;color:${palette.primary};">${text}</div>
    </td></tr>
  </table>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid ${palette.line};margin:24px 0;" />`;
}

module.exports = {
  palette,
  baseTemplate,
  heading,
  lede,
  paragraph,
  button,
  pill,
  detailTable,
  credentials,
  infoBox,
  successBox,
  warningBox,
  dangerBox,
  code,
  divider,
};
