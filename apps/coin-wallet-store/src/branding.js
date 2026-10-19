import { getAdminToken } from '@youpi/common';

// The store's pages are written for the stock "YOUPI Store" demo. When the
// merchant has set their own identity in Admin > Store Settings, the pages are
// rewritten as they are served: store name, gateway name, brand colour, logo,
// and support contacts. With the stock settings the pages are sent unchanged.

const STOCK_APP_NAME = 'YOUPI PG';
const STOCK_STORE_NAMES = new Set(['', 'YOUPI Demo Store', 'YOUPI Store']);
const STOCK_COLOR = '#2563eb';
const CACHE_MS = 15_000;
const FETCH_TIMEOUT_MS = 1_500;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

// For text placed inside a JavaScript string or comment in an inline script.
const escapeJs = (value) => String(value ?? '').replace(/[\\'"`<>&\u2028\u2029]/g,
  (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const clean = (value, max = 80) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const httpsUrl = (value) => {
  const v = clean(value, 500);
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
};

const hexColor = (value) => {
  const v = clean(value, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : '';
};

/**
 * Reads the merchant's public identity from the payment API. Server to
 * server on this machine; the admin token never reaches the browser.
 * @param {string} apiUrl
 * @param {string} merchantId
 */
export async function fetchBranding(apiUrl, merchantId) {
  const res = await fetch(`${apiUrl}/api/v1/admin/merchant-settings?merchantId=${encodeURIComponent(merchantId)}`, {
    headers: { Authorization: `Bearer ${getAdminToken()}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`merchant-settings HTTP ${res.status}`);
  const data = await res.json();
  const b = data.branding || {};
  const storeName = clean(data.businessName);
  return {
    appName: clean(b.appName) || STOCK_APP_NAME,
    storeName: STOCK_STORE_NAMES.has(storeName) ? 'YOUPI Store' : storeName,
    color: hexColor(b.primaryColor) || STOCK_COLOR,
    logoUrl: httpsUrl(b.logoUrl),
    supportEmails: (data.supportEmails || b.supportEmails || []).map((e) => clean(e, 120)).filter((e) => /^[^\s@<>"']+@[^\s@<>"']+$/.test(e)).slice(0, 3),
    supportMobiles: (data.supportMobiles || b.supportMobiles || []).map((m) => clean(m, 20).replace(/[^+\d\s-]/g, '')).filter((m) => /\d{6,}/.test(m.replace(/\D/g, ''))).slice(0, 3),
    privacyUrl: httpsUrl(data.privacyPolicyUrl || b.privacyPolicyUrl),
    termsUrl: httpsUrl(b.termsUrl)
  };
}

/**
 * Keeps the last good branding for a short while, so a page view does not
 * wait on the payment API, and a change in Admin shows up within seconds.
 */
export class BrandingCache {
  constructor(apiUrl, merchantId) {
    this.apiUrl = apiUrl;
    this.merchantId = merchantId;
    this.value = null;
    this.at = 0;
    this.pending = null;
  }

  async get() {
    if (Date.now() - this.at < CACHE_MS) return this.value;
    if (!this.pending) {
      this.pending = fetchBranding(this.apiUrl, this.merchantId)
        .then((value) => { this.value = value; })
        .catch(() => { /* keep the last good value; the page falls back to stock text */ })
        .finally(() => { this.at = Date.now(); this.pending = null; });
    }
    await this.pending;
    return this.value;
  }
}

const isStock = (b) => !b || (
  b.appName === STOCK_APP_NAME && b.storeName === 'YOUPI Store' && b.color === STOCK_COLOR &&
  !b.logoUrl && !b.supportEmails.length && !b.supportMobiles.length && !b.privacyUrl && !b.termsUrl
);

// --- colour ---------------------------------------------------------------

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
const darken = (hex, f) => toHex(toRgb(hex).map((n) => n * (1 - f)));
const lighten = (hex, f) => toHex(toRgb(hex).map((n) => n + (255 - n) * f));

/** The stock blue scale, mapped onto the merchant's colour. */
function recolor(html, color) {
  if (color === STOCK_COLOR) return html;
  const map = {
    '#2563eb': color,
    '#1d4ed8': darken(color, 0.15),
    '#1e40af': darken(color, 0.3),
    '#1e3a8a': darken(color, 0.45),
    '#3b82f6': lighten(color, 0.15),
    '#60a5fa': lighten(color, 0.35),
    '#93c5fd': lighten(color, 0.55),
    '#bfdbfe': lighten(color, 0.72),
    '#dbeafe': lighten(color, 0.85),
    '#eff6ff': lighten(color, 0.93)
  };
  const [r, g, b] = toRgb(color);
  return html
    .replace(/#(2563eb|1d4ed8|1e40af|1e3a8a|3b82f6|60a5fa|93c5fd|bfdbfe|dbeafe|eff6ff)\b/gi, (m) => map[m.toLowerCase()])
    .replace(/rgba\(\s*37\s*,\s*99\s*,\s*235\s*,/g, `rgba(${r}, ${g}, ${b},`);
}

// --- text -----------------------------------------------------------------

function renameText(text, b, esc) {
  const app = esc(b.appName);
  const store = esc(b.storeName);
  return text
    .replaceAll('YOUPI Store', store)
    .replaceAll('YOUPI Gateway', app)
    .replaceAll('YOUPI PG', app)
    // A bare "YOUPI" used as a name ("send to YOUPI?"), but not identifiers
    // such as YOUPI_WEBHOOK_SECRET or the order prefix YOUPI-ORD.
    .replace(/\bYOUPI\b(?=[\s?.,!:;)])/g, app);
}

/** Rewrites names outside and inside inline scripts with the right escaping. */
function rename(html, b) {
  return html
    .split(/(<script\b[^>]*>[\s\S]*?<\/script>)/i)
    .map((part, i) => {
      if (i % 2 === 0) return renameText(part, b, escapeHtml);
      const open = part.indexOf('>') + 1;
      const close = part.lastIndexOf('</script>');
      return part.slice(0, open) + renameText(part.slice(open, close), b, escapeJs) + part.slice(close);
    })
    .join('');
}

// --- logo, icon, footer ---------------------------------------------------

const initialOf = (name) => (name.match(/[A-Za-z0-9]/) || ['Y'])[0].toUpperCase();

/** A small square icon: the initial on the brand colour. */
export function iconSvg(b) {
  const color = b?.color || STOCK_COLOR;
  const letter = initialOf(b ? b.storeName : 'YOUPI Store');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="44" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#ffffff">${letter}</text></svg>`;
}

function logoBadge(b) {
  if (b.logoUrl) {
    return `<div class="brand-logo-badge" style="background:#ffffff; padding:3px; overflow:hidden;"><img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.storeName)}" style="width:100%; height:100%; object-fit:contain; display:block;" /></div>`;
  }
  return `<div class="brand-logo-badge" style="font-family:'Outfit',sans-serif; font-weight:800;">${escapeHtml(initialOf(b.storeName))}</div>`;
}

function supportLinks(b) {
  const items = [
    ...b.supportEmails.map((e) => `<a href="mailto:${escapeHtml(e)}" style="color:#cbd5e1;">${escapeHtml(e)}</a>`),
    ...b.supportMobiles.map((m) => `<a href="tel:${escapeHtml(m.replace(/[^+\d]/g, ''))}" style="color:#cbd5e1;">${escapeHtml(m)}</a>`),
    b.privacyUrl && `<a href="${escapeHtml(b.privacyUrl)}" target="_blank" rel="noopener" style="color:#cbd5e1;">Privacy Policy</a>`,
    b.termsUrl && `<a href="${escapeHtml(b.termsUrl)}" target="_blank" rel="noopener" style="color:#cbd5e1;">Terms of Service</a>`
  ].filter(Boolean);
  if (!items.length) return '';
  return `<div style="font-size:0.8rem; color:#94a3b8; display:flex; flex-wrap:wrap; gap:0.4rem 1rem; align-items:center;"><span>Support:</span>${items.join('')}</div>`;
}

/**
 * Applies the merchant's identity to one of the store's HTML pages.
 * @param {string} html
 * @param {Awaited<ReturnType<typeof fetchBranding>> | null} b
 */
export function applyBranding(html, b) {
  const favicon = b?.logoUrl
    ? `<link rel="icon" href="${escapeHtml(b.logoUrl)}" />`
    : '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';
  let out = html.replace('</head>', `  ${favicon}\n</head>`);
  if (isStock(b)) return out.replace('<!--BRAND_SUPPORT_LINKS-->', '');

  const year = new Date().getFullYear();
  out = out
    .replace('<span>✨ <strong>YOUPI Gateway</strong> Demo Powered by YOUPI PG</span>',
      `<span>✨ <strong>${escapeHtml(b.storeName)}</strong> · Payments by ${escapeHtml(b.appName)}</span>`)
    .replace('© 2026 YOUPI PG · Sovereign Small Scale Payment Gateway Suite',
      `© ${year} ${escapeHtml(b.storeName)} · Payments by ${escapeHtml(b.appName)}`)
    .replaceAll('<div class="brand-logo-badge">⚡</div>', logoBadge(b))
    .replace('<!--BRAND_SUPPORT_LINKS-->', supportLinks(b));
  if (b.logoUrl) {
    out = out.replaceAll('<span>⚡ YOUPI Store</span>',
      `<span><img src="${escapeHtml(b.logoUrl)}" alt="" style="height:1.4em; width:auto; vertical-align:middle; margin-right:0.35em;" />YOUPI Store</span>`);
  }
  return recolor(rename(out, b), b.color);
}
