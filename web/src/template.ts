/**
 * HTML template rendering for profile pages.
 * Gardens-inspired design - dark, warm, app-like presentation
 */

import QRCode from 'qrcode';
import type { ResolvedRecord } from './pkarr';

interface RenderOptions {
  appUrl: string;
  appStoreUrl?: string;
  playStoreUrl?: string;
  gatewayOrigin: string;
}

/**
 * Gardens logo - uses the actual PNG from app/assets
 */
const gardensLogoImg = `
  <img src="/gardens-logo.png" alt="Gardens" style="width: 100%; height: 100%; object-fit: contain;">
`;

/**
 * Common CSS styles shared across all page types
 */
const commonStyles = `
  :root {
    --bg: #050505;
    --bg-soft: #0b0b0b;
    --surface: #111111;
    --surface-2: #171513;
    --surface-3: #1d1916;
    --border: rgba(232, 211, 146, 0.18);
    --border-strong: rgba(232, 211, 146, 0.34);
    --text: #f6f1e7;
    --muted: #b6ab98;
    --muted-2: #8d826f;
    --accent: #e8d392;
    --accent-strong: #f1dfaa;
    --accent-ink: #21180c;
    --green: #2fb466;
    --shadow: 0 16px 50px rgba(0, 0, 0, 0.38);
    --radius-xl: 24px;
    --radius-lg: 20px;
    --radius-md: 14px;
    --radius-sm: 10px;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html,
  body {
    min-height: 100%;
    background: var(--bg);
  }

  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: var(--text);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: clamp(8px, 1.2vh, 14px);
    position: relative;
    overflow-x: hidden;
    background: #050505;
  }

  .bg-glow {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
      linear-gradient(180deg, rgba(4, 4, 4, 0.60) 0%, rgba(4, 4, 4, 0.80) 100%),
      radial-gradient(circle at 50% 30%, rgba(232, 211, 146, 0.10), transparent 45%),
      url('/gardens-bg.jpg') center center / cover no-repeat;
    filter: saturate(0.92) brightness(0.76);
  }

  .bg-glow::after {
    content: "";
    position: absolute;
    inset: 0;
    background: inherit;
    filter: blur(6px);
    opacity: 0.35;
  }

  .shell {
    width: 100%;
    max-width: 680px;
    position: relative;
    z-index: 1;
  }

  .main-card {
    position: relative;
    background: linear-gradient(180deg, rgba(24, 20, 17, 0.96) 0%, rgba(12, 11, 10, 0.97) 100%);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow);
    width: 100%;
    padding: 18px;
    overflow: hidden;
  }

  .main-card::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(232, 211, 146, 0.04), transparent 28%),
      linear-gradient(0deg, rgba(255, 255, 255, 0.015), transparent 35%);
    pointer-events: none;
  }

  .profile-panel {
    position: relative;
    background: linear-gradient(180deg, rgba(9, 9, 9, 0.92), rgba(13, 12, 11, 0.96));
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 20px;
    padding: 16px 14px 14px;
    margin-bottom: 10px;
    text-align: center;
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--green);
    box-shadow: 0 0 0 3px rgba(47, 180, 102, 0.12);
    display: inline-block;
    vertical-align: middle;
    margin-right: 6px;
  }

  .avatar,
  .avatar-placeholder {
    width: 74px;
    height: 74px;
    border-radius: 999px;
    margin: 0 auto 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .avatar {
    object-fit: cover;
    border: 3px solid rgba(255, 255, 255, 0.05);
    box-shadow:
      0 8px 20px rgba(0, 0, 0, 0.28),
      0 0 0 1px rgba(232, 211, 146, 0.16);
    background: #111;
  }

  .avatar-placeholder {
    background: linear-gradient(145deg, #8b46ff 0%, #6f31de 100%);
    color: white;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.04em;
    border: 3px solid rgba(255, 255, 255, 0.05);
    box-shadow:
      0 8px 20px rgba(0, 0, 0, 0.28),
      0 0 0 1px rgba(232, 211, 146, 0.16);
  }

  .avatar-placeholder::after,
  .avatar::after {
    content: "";
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--green);
    border: 2px solid #111;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.24);
  }

  .title {
    font-size: clamp(22px, 3.2vw, 30px);
    line-height: 1.02;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: var(--text);
    margin-bottom: 6px;
  }

  .handle {
    display: inline-block;
    max-width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    color: var(--muted-2);
    word-break: break-all;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 999px;
    padding: 7px 10px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    background: rgba(232, 211, 146, 0.08);
    color: var(--accent-strong);
    border: 1px solid rgba(232, 211, 146, 0.16);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    padding: 7px 10px;
    border-radius: 999px;
  }

  .badge-icon {
    font-size: 11px;
    line-height: 1;
  }

  .description {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
    margin: 10px auto 0;
    max-width: 440px;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 14px;
    align-items: stretch;
  }

  .qr-card,
  .info-card {
    background: linear-gradient(180deg, rgba(10, 10, 10, 0.94), rgba(17, 15, 13, 0.96));
    border: 1px solid var(--border);
    border-radius: 18px;
    position: relative;
  }

  .qr-card {
    padding: 10px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .qr-label {
    text-align: center;
    font-size: 10px;
    color: var(--muted-2);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 8px;
    font-weight: 700;
  }

  .qr-section {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2px;
  }

  .qr-wrap {
    width: 100%;
    background: #f4ead0;
    border-radius: 14px;
    padding: 10px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
  }

  .qr-section svg {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 10px;
    background: white;
  }

  .info-card {
    padding: 14px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 100%;
  }

  .app-header {
    margin-bottom: 10px;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    color: var(--accent-strong);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .app-name {
    font-size: 18px;
    line-height: 1.05;
    font-weight: 800;
    letter-spacing: -0.035em;
    color: var(--text);
    margin-bottom: 6px;
  }

  .app-description {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.4;
  }

  .learn-more,
  .alternative a,
  .footer a {
    color: var(--accent-strong);
    text-decoration: none;
    font-weight: 700;
  }

  .learn-more:hover,
  .alternative a:hover,
  .footer a:hover {
    text-decoration: underline;
  }

  .platforms {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    margin-bottom: 10px;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .platform-icon {
    font-size: 12px;
  }

  .instructions {
    font-size: 12px;
    color: var(--text);
    line-height: 1.4;
    margin-bottom: 10px;
    letter-spacing: -0.01em;
  }

  .copy-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(232, 211, 146, 0.14);
    border-radius: 14px;
    padding: 10px;
    margin-bottom: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    color: var(--text);
    word-break: break-all;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
  }

  .copy-btn {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    border: 1px solid rgba(232, 211, 146, 0.18);
    background: rgba(232, 211, 146, 0.08);
    color: var(--accent-strong);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease;
    flex-shrink: 0;
  }

  .copy-btn:hover {
    transform: translateY(-1px);
    background: rgba(232, 211, 146, 0.13);
    border-color: rgba(232, 211, 146, 0.28);
  }

  .copy-btn.copied {
    color: #0f1b12;
    background: #98e3b2;
    border-color: #98e3b2;
  }

    .store-buttons {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin-top: 10px;
  }

  .store-badge {
    display: inline-block;
    transition: transform 0.18s ease, opacity 0.18s ease;
  }

  .store-badge:hover {
    transform: translateY(-1px);
    opacity: 0.94;
  }

  .store-badge img {
    height: 42px;     /* forces identical visual size */
    width: auto;      /* preserves correct badge ratio */
    display: block;
  }

  .btn-primary {
    display: block;
    width: 100%;
    padding: 12px 14px;
    background: transparent;
    color: var(--accent-strong);
    font-size: 14px;
    font-weight: 800;
    letter-spacing: -0.02em;
    text-decoration: none;
    text-align: center;
    border-radius: 999px;
    border: 2px solid var(--accent);
    cursor: pointer;
    transition: transform 0.18s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.22);
  }

  .btn-primary:hover {
    transform: translateY(-1px);
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
  }

  .alternative {
    text-align: center;
    margin-top: 8px;
    font-size: 11px;
    color: var(--muted-2);
    line-height: 1.35;
  }

  .footer {
    margin-top: 10px;
    text-align: center;
    font-size: 10px;
    color: var(--muted-2);
    line-height: 1.35;
  }

  .brand-footer {
    margin-top: 8px;
    text-align: center;
    position: relative;
    z-index: 1;
    color: var(--muted-2);
    font-size: 10px;
    font-weight: 600;
  }

  .brand-footer-inner {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    opacity: 0.82;
  }

  .brand-logo {
  width: 60px;
  height: 60px;
}

  @media (max-width: 760px) {
    .shell {
      max-width: 100%;
    }

    .content-grid {
      grid-template-columns: 1fr;
    }

    .main-card {
      padding: 12px;
    }

    .profile-panel,
    .qr-card,
    .info-card {
      border-radius: 18px;
    }
  }

  @media (max-width: 520px) {
    body {
      padding: 10px;
    }

    .title {
      font-size: 26px;
    }

    .avatar,
    .avatar-placeholder {
      width: 68px;
      height: 68px;
    }

    .avatar-placeholder {
      font-size: 26px;
    }

    .store-buttons {
      gap: 8px;
    }

    .store-badge {
      flex: 1 1 120px;
      max-width: none;
    }

    .store-badge img {
      height: 40px;
    }
  }

@media (max-height: 820px) {
  body {
    padding: 8px;
  }

  .shell {
    max-width: 640px;
  }

  .main-card {
    padding: 14px;
  }

  .profile-panel {
    padding: 14px 12px 12px;
    margin-bottom: 8px;
  }

  .avatar,
  .avatar-placeholder {
    width: 68px;
    height: 68px;
    margin-bottom: 8px;
  }

  .avatar-placeholder {
    font-size: 25px;
  }

  .title {
    font-size: 24px;
    margin-bottom: 4px;
  }

  .badge {
    margin-top: 8px;
    padding: 6px 9px;
  }

  .description {
    margin-top: 8px;
    font-size: 12px;
  }

  .content-grid {
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 10px;
  }

  .qr-card {
    padding: 8px;
  }

  .qr-wrap {
    padding: 8px;
  }

  .info-card {
    padding: 12px;
  }

  .app-name {
    font-size: 17px;
  }

  .app-description,
  .instructions {
    font-size: 11px;
  }

  .copy-box {
    font-size: 9px;
    padding: 8px;
    margin-bottom: 8px;
  }

  .copy-btn {
    width: 28px;
    height: 28px;
  }

  .store-badge img {
    height: 40px;
  }

  .btn-primary {
    padding: 10px 12px;
    font-size: 13px;
  }

  .alternative,
  .footer,
  .brand-footer {
    font-size: 9px;
  }
}
`;

const copyScript = `
  function copyToClipboard(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      }, 2000);
    });
  }
`;

/**
 * Deterministic color from a string seed
 */
function seedColor(seed: string): string {
  const palette = [
    '#8B46FF',
    '#4BA3FF',
    '#E7B75C',
    '#2FB466',
    '#E26D5A',
    '#4AC7C0',
    '#D16EFF',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

/**
 * Generate initials from a display name (up to 2 chars)
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('') || name[0]?.toUpperCase() || '?';
}

/**
 * Generate a QR code SVG with an avatar (or initials) embedded in the center.
 */
async function generateQrWithAvatar(
  url: string,
  avatarBlobId: string | undefined,
  displayName: string,
): Promise<string> {
  const svgString: string = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 1,
    color: { dark: '#111111', light: '#FFFFFF' },
  });

  const match = svgString.match(/viewBox="0 0 (\d+) (\d+)"/);
  const size = match ? parseInt(match[1]) : 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = Math.round(size * 0.13);
  const id = `ac${Math.random().toString(36).slice(2, 8)}`;
  const color = seedColor(displayName);
  const inits = initials(displayName);
  const fontSize = Math.round(r * 0.82);

  let centerOverlay: string;
  if (avatarBlobId) {
    centerOverlay = `
  <defs>
    <clipPath id="${id}">
      <circle cx="${cx}" cy="${cy}" r="${r}"/>
    </clipPath>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="#F4EAD0"/>
  <circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="white"/>
  <image href="/blob/${avatarBlobId}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`;
  } else {
    centerOverlay = `
  <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="#F4EAD0"/>
  <circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="white"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>
  <text x="${cx}" y="${cy + fontSize * 0.35}" text-anchor="middle" fill="white" font-size="${fontSize}" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="800">${escapeHtml(inits)}</text>`;
  }

  return svgString.replace('</svg>', `${centerOverlay}\n</svg>`);
}

function renderBrandFooter(): string {
  return `
    <div class="brand-footer">
      <div class="brand-footer-inner">
        <span class="brand-logo">${gardensLogoImg}</span>
        <span>Powered by the Gardens network</span>
      </div>
    </div>
  `;
}

/**
 * Render a profile page HTML for a resolved pkarr record.
 */
export async function renderProfilePage(record: ResolvedRecord, options: RenderOptions): Promise<string> {
  const { appUrl, gatewayOrigin } = options;

  const title = record.username || 'User';
  const description = record.bio;
  const displayHandle = `pk:${record.publicKey.slice(0, 16)}...${record.publicKey.slice(-8)}`;

  const avatarUrl = record.avatarBlobId ? `/blob/${record.avatarBlobId}` : null;
  const ogImageUrl = avatarUrl ? `${gatewayOrigin}${avatarUrl}` : null;

  const qrSvg = await generateQrWithAvatar(appUrl, record.avatarBlobId, title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:title" content="${escapeHtml(title)} on Gardens">
  <meta property="og:description" content="${escapeHtml(description || 'Connect with me on Gardens - secure decentralized messaging')}">
  ${ogImageUrl ? `<meta property="og:image" content="${escapeHtml(ogImageUrl)}">` : ''}
  <meta name="twitter:card" content="summary">
  <title>${escapeHtml(title)} - Gardens</title>
  <style>${commonStyles}</style>
</head>
<body>
  <div class="bg-glow"></div>

  <div class="shell">

    <div class="main-card">
      <div class="profile-panel">
        <div class="status-row">
          <span>Public profile</span>
          <span><span class="status-dot"></span>Online on Gardens</span>
        </div>

        ${avatarUrl
          ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(title)}" class="avatar">`
          : `<div class="avatar-placeholder">${escapeHtml(initials(title))}</div>`
        }

        <h1 class="title">${escapeHtml(title)}</h1>
        <div class="handle">${escapeHtml(displayHandle)}</div>
        <div class="badge">
          <span class="badge-icon">✦</span>
          Secure contact
        </div>

        ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
      </div>

      <div class="content-grid">
        <div class="qr-card">
          <div class="qr-label">Scan to open</div>
          <div class="qr-section">
            <div class="qr-wrap">${qrSvg}</div>
          </div>
        </div>

        <div class="info-card">
          <div>
            <div class="app-header">
              <div class="eyebrow">End-to-end encrypted</div>
              <div class="app-name">Open in Gardens</div>
              <div class="app-description">
                Scan the QR code or open the app and paste this public key to start a secure conversation.
                <a href="https://www.usegardens.com" class="learn-more" target="_blank" rel="noopener noreferrer">Learn more</a>
              </div>
            </div>

            <div class="platforms">
              <span class="platform-icon">📱</span>
              <span>Web, iOS & Android</span>
            </div>

            <p class="instructions">
              Share this identifier with anyone who wants to message you on Gardens.
            </p>

            <div class="copy-box">
              <span style="flex: 1;">${escapeHtml(record.publicKey)}</span>
              <button class="copy-btn" onclick="copyToClipboard(this, '${escapeHtml(record.publicKey)}')" title="Copy public key" aria-label="Copy public key">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>

          <div class="store-buttons">

          <a
            href="..."
            class="store-badge"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src="/google-play.svg" alt="Get it on Google Play">
          </a>

          <a
            href="..."
            class="store-badge"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src="/apple-store.svg" alt="Download on the App Store">
          </a>

        </div>

          <div class="footer">
            Public key verification powered by <a href="https://pkarr.org" target="_blank" rel="noopener noreferrer">Pkarr</a>
          </div>
        </div>
      </div>
    </div>

    ${renderBrandFooter()}
  </div>

  <script>${copyScript}</script>
</body>
</html>`;
}

/**
 * Render an organization page with org-specific styling.
 */
export async function renderOrgPage(record: ResolvedRecord, options: RenderOptions): Promise<string> {
  const { appUrl, gatewayOrigin } = options;

  const orgName = record.name || 'Organization';
  const description = record.description;
  const displayHandle = `pk:${record.publicKey.slice(0, 16)}...${record.publicKey.slice(-8)}`;

  const avatarUrl = record.avatarBlobId ? `/blob/${record.avatarBlobId}` : null;
  const ogImageUrl = avatarUrl ? `${gatewayOrigin}${avatarUrl}` : null;
  const contactKey = record.publicKey;

  const qrSvg = await generateQrWithAvatar(appUrl, record.avatarBlobId, orgName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:title" content="${escapeHtml(orgName)} on Gardens">
  <meta property="og:description" content="${escapeHtml(description || 'Message this organization on Gardens to request access')}">
  ${ogImageUrl ? `<meta property="og:image" content="${escapeHtml(ogImageUrl)}">` : ''}
  <meta name="twitter:card" content="summary">
  <title>${escapeHtml(orgName)} - Gardens Organization</title>
  <style>${commonStyles}</style>
</head>
<body>
  <div class="bg-glow"></div>

  <div class="shell">

    <div class="main-card">
      <div class="profile-panel">
        <div class="status-row">
          <span>Organization profile</span>
          <span><span class="status-dot"></span>Reachable on Gardens</span>
        </div>

        ${avatarUrl
          ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(orgName)}" class="avatar">`
          : `<div class="avatar-placeholder">${escapeHtml(initials(orgName))}</div>`
        }

        <h1 class="title">${escapeHtml(orgName)}</h1>
        <div class="handle">${escapeHtml(displayHandle)}</div>
        <div class="badge">
          <span class="badge-icon">◈</span>
          Organization
        </div>

        ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
      </div>

      <div class="content-grid">
        <div class="qr-card">
          <div class="qr-label">Scan to message</div>
          <div class="qr-section">
            <div class="qr-wrap">${qrSvg}</div>
          </div>
        </div>

        <div class="info-card">
          <div>
            <div class="app-header">
              <div class="eyebrow">Verified via Gardens</div>
              <div class="app-name">Message this organization</div>
              <div class="app-description">
                Open Gardens and use this contact key to start a secure conversation or request access.
                <a href="https://www.usegardens.com" class="learn-more" target="_blank" rel="noopener noreferrer">Learn more</a>
              </div>
            </div>

            <div class="platforms">
              <span class="platform-icon">📱</span>
              <span>Web, Desktop, iOS & Android</span>
            </div>

            <p class="instructions">
              Scan the code or paste this public key into Gardens.
            </p>

            <div class="copy-box">
              <span style="flex: 1;">${escapeHtml(contactKey)}</span>
              <button class="copy-btn" onclick="copyToClipboard(this, '${escapeHtml(contactKey)}')" title="Copy organization key" aria-label="Copy organization key">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>

            <div class="store-buttons">

            <a
              href="..."
              class="store-badge"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src="/google-play.svg" alt="Get it on Google Play">
            </a>

            <a
              href="..."
              class="store-badge"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src="/apple-store.svg" alt="Download on the App Store">
            </a>

          </div>

          <div class="footer">
            Organization verification powered by <a href="https://pkarr.org" target="_blank" rel="noopener noreferrer">Pkarr</a>
          </div>
        </div>
      </div>
    </div>

    ${renderBrandFooter()}
  </div>

  <script>${copyScript}</script>
</body>
</html>`;
}

/**
 * Render a relay server page with relay-specific information.
 */
export function renderRelayPage(record: ResolvedRecord, options: RenderOptions): string {
  const { appUrl } = options;

  const relayUrl = record.relayUrl || 'Unknown Relay';
  const relayName = record.name || 'Gardens Relay';
  const displayHandle = `pk:${record.publicKey.slice(0, 16)}...${record.publicKey.slice(-8)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:title" content="${escapeHtml(relayName)}">
  <meta property="og:description" content="Gardens relay server for secure message routing">
  <meta name="twitter:card" content="summary">
  <title>${escapeHtml(relayName)} - Gardens Relay</title>
  <style>${commonStyles}</style>
</head>
<body>
  <div class="bg-glow"></div>

  <div class="shell">

    <div class="main-card">
      <div class="profile-panel">
        <div class="status-row">
          <span>Network relay</span>
          <span><span class="status-dot"></span>Available</span>
        </div>

        <div class="avatar-placeholder" style="background: linear-gradient(145deg, #0c4a43 0%, #17665c 100%);">R</div>

        <h1 class="title">${escapeHtml(relayName)}</h1>
        <div class="handle">${escapeHtml(displayHandle)}</div>
        <div class="badge">
          <span class="badge-icon">⬢</span>
          Relay server
        </div>

        <p class="description">
          This relay helps route messages securely through the Gardens network for reliability and offline delivery.
        </p>
      </div>

      <div class="content-grid" style="grid-template-columns: 1fr;">
        <div class="info-card">
          <div>
            <div class="app-header">
              <div class="eyebrow">Network settings</div>
              <div class="app-name">Use this relay in Gardens</div>
              <div class="app-description">
                Open Gardens, go to Settings → Network → Relays, then paste this public key to configure the relay.
              </div>
            </div>

            <div class="platforms">
              <span class="platform-icon">🌐</span>
              <span>Web, Desktop, iOS & Android</span>
            </div>

            <p class="instructions">
              Add this relay to improve privacy and connectivity.
            </p>

            <div class="copy-box">
              <span style="flex: 1;">${escapeHtml(record.publicKey)}</span>
              <button class="copy-btn" onclick="copyToClipboard(this, '${escapeHtml(record.publicKey)}')" title="Copy relay key" aria-label="Copy relay key">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>

            <a href="${escapeHtml(appUrl)}" class="btn-primary">Use this relay</a>

            <div class="alternative">
              Relay URL: <a href="${escapeHtml(relayUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(relayUrl)}</a>
            </div>
          </div>

          <div class="footer">
            Relay identity distributed through <a href="https://pkarr.org" target="_blank" rel="noopener noreferrer">Pkarr</a>
          </div>
        </div>
      </div>
    </div>

    ${renderBrandFooter()}
  </div>

  <script>${copyScript}</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}