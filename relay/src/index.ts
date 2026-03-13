/// <reference types="@cloudflare/workers-types" />
/**
 * Gardens Relay — Cloudflare Worker.
 *
 * Endpoints:
 *   POST /hop        — receive an onion packet, peel one layer, route it
 *   GET  /pubkey     — return this relay's Ed25519 pubkey hex (for discovery)
 *   POST /send-email — authenticated outbound email
 *
 * Secrets (set via `wrangler secret put`):
 *   RELAY_SEED_HEX   64 hex char Ed25519 seed
 *   SELF_URL         Base URL of this Worker without trailing slash (e.g. https://relay.gardens.app)
 */

import { ed25519 } from '@noble/curves/ed25519';
import { blake3 } from '@noble/hashes/blake3';
import { peelLayer } from './onion';
import { hexToBytes, bytesToHex, bytesToBase64 } from './crypto';
import { publishRelaySelf } from './pkarr';
import { BLOB_CACHE_CONTROL, MAX_BLOB_BYTES } from './blob-constants';
import PostalMime from 'postal-mime';
import z32 from 'z32';
import { buildMime, type OutboundEmailPayload } from './mime';
import { EmailMessage } from 'cloudflare:email';

export interface Env {
  RELAY_SEED_HEX: string;
  SELF_URL?: string;
  PUBLIC_BLOBS: KVNamespace;
  SYNC_WORKER: Fetcher;
  RATE_LIMIT_KV: KVNamespace;
  PUSH_TOKENS: KVNamespace;
  FCM_PROJECT_ID: string;
  FCM_CLIENT_EMAIL: string;
  FCM_PRIVATE_KEY: string;
  EMAIL: { send(msg: unknown): Promise<void> };
  PROFILE_SLUG_DOMAIN?: string;
}

// ── FCM v1 push helper ────────────────────────────────────────────────────────

async function getFcmAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const payload = encode({
    iss: env.FCM_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });

  const toSign = `${header}.${payload}`;

  const pem = env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n');
  const keyData = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(toSign),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${toSign}.${sigB64}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const { access_token } = await resp.json() as { access_token: string };
  return access_token;
}

async function sendPushNotification(
  env: Env,
  params: { token: string; title: string; body: string; data?: Record<string, string> },
): Promise<void> {
  const accessToken = await getFcmAccessToken(env);
  await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token: params.token,
        notification: { title: params.title, body: params.body },
        data: params.data ?? {},
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    }),
  });
}


const RELAY_DOMAIN = 'gardens-relay.stereos.workers.dev';
const INBOX_SUFFIX = new TextEncoder().encode('gardens:inbox:v1');
const SIGNED_PAYLOAD_MAX_AGE_MS = 5 * 60 * 1000;
const SIGNED_PAYLOAD_MAX_FUTURE_MS = 30 * 1000;
const SLUG_PATTERN = /^@?[a-z0-9\p{Emoji}](?:[a-z0-9\p{Emoji}-]{0,61}[a-z0-9\p{Emoji}])?$/u;

interface SignedEnvelope {
  signed_payload: string;
  signature: string;
}

interface VerifiedEnvelope {
  payload: OutboundEmailPayload;
  publicKeyHex: string;
}

interface ProfileMetaPatch {
  loco?: string;
  interests?: string[];
}

function deriveInboxTopic(z32Key: string): string {
  const pubkey = z32.decode(z32Key);
  const input = new Uint8Array(pubkey.length + INBOX_SUFFIX.length);
  input.set(pubkey);
  input.set(INBOX_SUFFIX, pubkey.length);
  return bytesToHex(blake3(input));
}

function parseSignedEnvelope(input: unknown): SignedEnvelope | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  if (typeof body.signed_payload !== 'string' || typeof body.signature !== 'string') {
    return null;
  }
  return { signed_payload: body.signed_payload, signature: body.signature };
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function verifySignedEnvelope(envelope: SignedEnvelope): VerifiedEnvelope | null {
  try {
    const payload = JSON.parse(envelope.signed_payload) as OutboundEmailPayload;
    if (!payload || typeof payload !== 'object') return null;
    if (
      typeof payload.from_z32 !== 'string' ||
      typeof payload.to !== 'string' ||
      typeof payload.subject !== 'string' ||
      typeof payload.body_text !== 'string' ||
      typeof payload.timestamp !== 'number'
    ) {
      return null;
    }

    const pubkeyBytes = z32.decode(payload.from_z32);
    if (!(pubkeyBytes instanceof Uint8Array) || pubkeyBytes.length !== 32) {
      return null;
    }

    const sigBytes = Uint8Array.from(atob(envelope.signature), c => c.charCodeAt(0));
    const msgBytes = new TextEncoder().encode(envelope.signed_payload);
    const valid = ed25519.verify(sigBytes, msgBytes, pubkeyBytes);
    if (!valid) return null;

    return {
      payload,
      publicKeyHex: bytesToHex(pubkeyBytes).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isFreshTimestamp(timestampMs: number): boolean {
  const skew = Date.now() - timestampMs;
  return skew <= SIGNED_PAYLOAD_MAX_AGE_MS && skew >= -SIGNED_PAYLOAD_MAX_FUTURE_MS;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractLocalPart(email: string): string | null {
  const at = email.indexOf('@');
  if (at <= 0) return null;
  return email.slice(0, at).toLowerCase();
}

export function normalizeSlug(input: string): string {
  if (!input) return '';
  // 1) Ensure proper decomposition to catch spoofed visually similar emojis/characters
  let normalized = input.normalize('NFKD').toLowerCase().trim();
  
  // 2) Preserve an optional leading '@' and allow alphanumeric/dash/emojis
  const hasAt = normalized.startsWith('@');
  normalized = normalized.replace(/[^\w\-\p{Emoji}]/gu, '');
  
  // 3) Strip out underscores
  normalized = normalized.replace(/_/g, '');
  
  // 4) Prevent repeated dashes
  normalized = normalized.replace(/-+/g, '-');
  
  // 5) Remove leading/trailing dashes safely without clipping single-char emojis
  normalized = normalized.replace(/^-+|-+$/g, '');

  if (hasAt && !normalized.startsWith('@')) {
    normalized = '@' + normalized;
  }

  return (normalized || '').slice(0, 63);
}

function sanitizeProfileMeta(input: unknown): ProfileMetaPatch | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const out: ProfileMetaPatch = {};

  if (typeof raw.loco === 'string') {
    const loco = raw.loco.trim();
    if (loco) out.loco = loco.slice(0, 120);
  }

  if (Array.isArray(raw.interests)) {
    const interests = raw.interests
      .filter((v): v is string => typeof v === 'string')
      .map(v => v.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map(v => v.slice(0, 40));
    out.interests = interests;
  }

  if (Object.keys(out).length === 0) return null;
  return out;
}

interface EmailOp {
  op_type: string;
  from: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  message_id: string;
  received_at: number;
}

function encodeOp(op: EmailOp): string {
  return btoa(JSON.stringify(op));
}

async function resolvePkarrEmail(z32Key: string): Promise<{ email: boolean; type: string } | null> {
  try {
    const url = `https://pkarr.pubky.org/${z32Key}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    // DNS packet starts after 72-byte header (64-byte sig + 8-byte timestamp)
    const dnsBytes = bytes.slice(72);
    const txtStr = new TextDecoder().decode(dnsBytes);
    const hasEmail = txtStr.includes('email=1');
    const isOrg = txtStr.includes('t=org');
    return { email: hasEmail, type: isOrg ? 'org' : 'user' };
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── GET /pubkey — return Ed25519 pubkey for discovery ──────────────────────
    if (request.method === 'GET' && url.pathname === '/pubkey') {
      const seed = hexToBytes(env.RELAY_SEED_HEX);
      const pubkey = ed25519.getPublicKey(seed);
      return new Response(bytesToHex(pubkey), {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // ── POST /hop — peel one onion layer ──────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/hop') {
      const body = await request.arrayBuffer();
      const packet = new Uint8Array(body);

      let payload;
      try {
        payload = peelLayer(packet, env.RELAY_SEED_HEX);
      } catch (err) {
        return new Response('bad packet', { status: 400 });
      }

      if (payload.type === 'forward') {
        const parsedHopUrl = new URL(payload.nextHopUrl);
        if (parsedHopUrl.protocol !== 'https:') {
          return new Response('invalid next hop', { status: 400 });
        }
        const resp = await fetch(payload.nextHopUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: payload.innerPacket,
        });
        return new Response(null, { status: resp.ok ? 200 : 502 });
      }

      if (payload.type === 'deliver') {
        // Forward op to sync worker TopicDO for persistence and fan-out
        const topicHex = bytesToHex(payload.topicId);
        const opBase64 = bytesToBase64(payload.op);
        try {
          await env.SYNC_WORKER.fetch('https://sync/deliver', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic_hex: topicHex, op_base64: opBase64 }),
          });
        } catch {
          // Non-fatal: best-effort delivery to sync worker
        }
        return new Response(null, { status: 200 });
      }

      return new Response('unknown payload type', { status: 400 });
    }

    // ── PUT /public-blob/:blobId — store a content-addressed public blob ────────
    if (request.method === 'PUT' && url.pathname.startsWith('/public-blob/')) {
      const blobId = url.pathname.slice('/public-blob/'.length);

      // Validate blobId format (64 hex chars = SHA-256)
      if (!/^[0-9a-f]{64}$/i.test(blobId)) {
        return new Response('invalid blob id', { status: 400 });
      }

      const contentLength = parseInt(request.headers.get('Content-Length') ?? '0', 10);
      if (contentLength > MAX_BLOB_BYTES) {
        return new Response('blob too large (max 2MB)', { status: 413 });
      }

      const bytes = new Uint8Array(await request.arrayBuffer());

      if (bytes.length > MAX_BLOB_BYTES) {
        return new Response('blob too large (max 2MB)', { status: 413 });
      }

      // Content-address verification: sha256(body) must equal blobId
      const computedHash = bytesToHex(blake3(bytes));
      if (computedHash !== blobId.toLowerCase()) {
        return new Response('hash mismatch', { status: 400 });
      }

      const mimeType = request.headers.get('Content-Type') ?? 'application/octet-stream';

      await env.PUBLIC_BLOBS.put(blobId.toLowerCase(), bytes, {
        metadata: { mimeType },
        expirationTtl: 60 * 60 * 24 * 90, // 90 days
      });

      return new Response(null, { status: 204 });
    }

    // ── GET /public-blob/:blobId — serve a stored public blob ──────────────────
    if (request.method === 'GET' && url.pathname.startsWith('/public-blob/')) {
      const blobId = url.pathname.slice('/public-blob/'.length).toLowerCase();

      if (!/^[0-9a-f]{64}$/.test(blobId)) {
        return new Response('invalid blob id', { status: 400 });
      }

      const { value, metadata } = await env.PUBLIC_BLOBS.getWithMetadata<{ mimeType: string }>(
        blobId,
        'arrayBuffer',
      );

      if (!value) {
        return new Response('not found', { status: 404 });
      }

      return new Response(value, {
        headers: {
          'Content-Type': metadata?.mimeType ?? 'application/octet-stream',
          'Cache-Control': BLOB_CACHE_CONTROL,
        },
      });
    }

    // ── POST /send-email — authenticated outbound email ────────────────────────
    if (request.method === 'POST' && url.pathname === '/send-email') {
      const json = await readJson(request);
      const envelope = parseSignedEnvelope(json);
      if (!envelope) return new Response('invalid payload', { status: 400 });

      const verified = verifySignedEnvelope(envelope);
      if (!verified) return new Response('signature verification failed', { status: 403 });
      const { payload } = verified;

      if (!isFreshTimestamp(payload.timestamp)) {
        return new Response('payload expired', { status: 400 });
      }

      // Rate limit: 50 emails/hour per from_z32
      const rateKey = `email_rate:${payload.from_z32}`;
      const currentCount = Number(await env.RATE_LIMIT_KV.get(rateKey) ?? 0);
      if (currentCount >= 50) {
        return new Response('rate limit exceeded', { status: 429 });
      }
      await env.RATE_LIMIT_KV.put(rateKey, String(currentCount + 1), { expirationTtl: 3600 });

      // Build MIME and send
      const rawMime = buildMime(payload);
      const from = `${payload.from_z32}@${RELAY_DOMAIN}`;
      const msg = new EmailMessage(from, payload.to, rawMime);
      try {
        await env.EMAIL.send(msg);
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        return new Response(`email send failed: ${detail}`, { status: 500 });
      }

      return new Response(null, { status: 200 });
    }

    // ── POST /profile-meta/set — signed discoverable profile metadata write ───
    if (request.method === 'POST' && url.pathname === '/profile-meta/set') {
      const json = await readJson(request);
      const envelope = parseSignedEnvelope(json);
      if (!envelope) return new Response('invalid payload', { status: 400 });

      const verified = verifySignedEnvelope(envelope);
      if (!verified) return new Response('signature verification failed', { status: 403 });
      const { payload, publicKeyHex } = verified;

      if (!isFreshTimestamp(payload.timestamp)) {
        return new Response('payload expired', { status: 400 });
      }
      if (extractLocalPart(payload.to) !== 'profile-meta' || payload.subject !== 'profile-meta:set') {
        return new Response('invalid control envelope', { status: 400 });
      }

      const cmd = parseJsonObject(payload.body_text);
      if (!cmd || cmd.op !== 'profile_meta_set') {
        return new Response('invalid command', { status: 400 });
      }

      const requestedKey = typeof cmd.publicKey === 'string' ? cmd.publicKey.toLowerCase() : publicKeyHex;
      if (!/^[0-9a-f]{64}$/.test(requestedKey)) {
        return new Response('invalid public key', { status: 400 });
      }
      if (requestedKey !== publicKeyHex) {
        return new Response('public key mismatch', { status: 403 });
      }

      const patch = sanitizeProfileMeta(cmd.meta);
      if (!patch) {
        return new Response('invalid metadata', { status: 400 });
      }

      const existing = await env.PUSH_TOKENS.get(`meta:${requestedKey}`);
      const current = existing ? parseJsonObject(existing) ?? {} : {};
      const updated = { ...current, ...patch, updatedAt: Date.now() };
      await env.PUSH_TOKENS.put(`meta:${requestedKey}`, JSON.stringify(updated), {
        expirationTtl: 60 * 60 * 24 * 365,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── POST /slug/claim — signed slug claim for {slug}.<domain> links ────────
    if (request.method === 'POST' && url.pathname === '/slug/claim') {
      const json = await readJson(request);
      const envelope = parseSignedEnvelope(json);
      if (!envelope) return new Response('invalid payload', { status: 400 });

      const verified = verifySignedEnvelope(envelope);
      if (!verified) return new Response('signature verification failed', { status: 403 });
      const { payload, publicKeyHex } = verified;

      if (!isFreshTimestamp(payload.timestamp)) {
        return new Response('payload expired', { status: 400 });
      }
      if (extractLocalPart(payload.to) !== 'slug' || payload.subject !== 'slug:claim') {
        return new Response('invalid control envelope', { status: 400 });
      }

      const cmd = parseJsonObject(payload.body_text);
      if (!cmd || cmd.op !== 'slug_claim') {
        return new Response('invalid command', { status: 400 });
      }

      const requestedKey = typeof cmd.publicKey === 'string' ? cmd.publicKey.toLowerCase() : publicKeyHex;
      if (!/^[0-9a-f]{64}$/.test(requestedKey)) {
        return new Response('invalid public key', { status: 400 });
      }
      if (requestedKey !== publicKeyHex) {
        return new Response('public key mismatch', { status: 403 });
      }

      const slugSource =
        (typeof cmd.slug === 'string' && cmd.slug.trim()) ||
        (typeof cmd.displayName === 'string' && cmd.displayName.trim()) ||
        '';
      const slug = normalizeSlug(slugSource);
      if (!SLUG_PATTERN.test(slug)) {
        return new Response('invalid slug', { status: 400 });
      }

      const slugKey = `slug:${slug}`;
      const profileSlugKey = `profile_slug:${requestedKey}`;
      const existingSlugClaim = await env.PUSH_TOKENS.get(slugKey);
      if (existingSlugClaim) {
        const parsed = parseJsonObject(existingSlugClaim);
        const owner = typeof parsed?.publicKey === 'string' ? parsed.publicKey.toLowerCase() : null;
        if (owner && owner !== requestedKey) {
          return new Response('slug already claimed', { status: 409 });
        }
      }

      const previousSlug = await env.PUSH_TOKENS.get(profileSlugKey);
      if (previousSlug && previousSlug !== slug) {
        const prevSlugKey = `slug:${previousSlug}`;
        const prevRaw = await env.PUSH_TOKENS.get(prevSlugKey);
        const prevParsed = prevRaw ? parseJsonObject(prevRaw) : null;
        const prevOwner = typeof prevParsed?.publicKey === 'string' ? prevParsed.publicKey.toLowerCase() : null;
        if (prevOwner === requestedKey) {
          await env.PUSH_TOKENS.delete(prevSlugKey);
        }
      }

      const now = Date.now();
      const existingParsed = existingSlugClaim ? parseJsonObject(existingSlugClaim) : null;
      const claimedAt = typeof existingParsed?.claimedAt === 'number' ? existingParsed.claimedAt : now;
      await env.PUSH_TOKENS.put(slugKey, JSON.stringify({
        slug,
        publicKey: requestedKey,
        z32Key: payload.from_z32,
        claimedAt,
        updatedAt: now,
      }));
      await env.PUSH_TOKENS.put(profileSlugKey, slug);

      const rootDomain = (env.PROFILE_SLUG_DOMAIN ?? 'usegardens.com').toLowerCase();
      const linkUrl = `https://gateway.${rootDomain}/u/${slug}`;

      return new Response(
        JSON.stringify({
          success: true,
          slug: slug,
          url: linkUrl,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── GET /slug/:slug — resolve claimed slug to key metadata ─────────────────
    if (request.method === 'GET' && url.pathname.startsWith('/slug/')) {
      const requested = url.pathname.slice('/slug/'.length);
      const slug = normalizeSlug(requested);
      if (!SLUG_PATTERN.test(slug)) return new Response('invalid slug', { status: 400 });
      const raw = await env.PUSH_TOKENS.get(`slug:${slug}`);
      if (!raw) return new Response('not found', { status: 404 });
      return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
    }

    // ── GET /profile-meta/:publicKey — fetch discoverable profile metadata ─────
    if (request.method === 'GET' && url.pathname.startsWith('/profile-meta/')) {
      const publicKey = url.pathname.slice('/profile-meta/'.length).toLowerCase();
      if (!publicKey) return new Response('missing key', { status: 400 });
      if (!/^[0-9a-f]{64}$/.test(publicKey)) return new Response('invalid key', { status: 400 });
      const data = await env.PUSH_TOKENS.get(`meta:${publicKey}`);
      if (!data) return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      return new Response(data, { headers: { 'Content-Type': 'application/json' } });
    }

    // ── POST /push/register — store FCM token for a public key ─────────────────
    if (request.method === 'POST' && url.pathname === '/push/register') {
      const { publicKey, token } = await request.json() as { publicKey: string; token: string };
      if (!publicKey || !token) return new Response('missing fields', { status: 400 });
      await env.PUSH_TOKENS.put(`push:${publicKey}`, token, { expirationTtl: 60 * 60 * 24 * 90 });
      return new Response(null, { status: 204 });
    }

    // ── POST /push/notify — send push to one or more recipients ────────────────
    if (request.method === 'POST' && url.pathname === '/push/notify') {
      const { recipientKeys, title, body, data } = await request.json() as {
        recipientKeys: string[];
        title: string;
        body: string;
        data?: Record<string, string>;
      };
      if (!recipientKeys?.length || !title || !body) {
        return new Response('missing fields', { status: 400 });
      }
      await Promise.all(
        recipientKeys.map(async (key) => {
          const token = await env.PUSH_TOKENS.get(`push:${key}`);
          if (token) await sendPushNotification(env, { token, title, body, data });
        }),
      );
      return new Response(null, { status: 204 });
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const selfUrl = env.SELF_URL ?? 'https://gardens-relay.workers.dev';
    await publishRelaySelf(env.RELAY_SEED_HEX, selfUrl);
  },

  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const localPart = message.to.split('@')[0];

    const record = await resolvePkarrEmail(localPart);
    if (!record?.email) {
      message.setReject('Recipient does not accept email');
      return;
    }

    const parsed = await PostalMime.parse(await new Response(message.raw).arrayBuffer());

    const op: EmailOp = {
      op_type: 'receive_email',
      from: message.from,
      subject: parsed.subject ?? '',
      body_text: parsed.text ?? '',
      body_html: parsed.html ?? null,
      message_id: parsed.messageId ?? crypto.randomUUID(),
      received_at: Date.now(),
    };

    const topic = deriveInboxTopic(localPart);

    try {
      await env.SYNC_WORKER.fetch('https://sync/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_hex: topic, op_base64: encodeOp(op) }),
      });
    } catch {
      // Non-fatal
    }
  },
} satisfies ExportedHandler<Env>;
