/**
 * pkarr resolution utilities for the web gateway.
 * Resolves signed DNS packets via HTTP relay (no DHT/native modules needed).
 *
 * Protocol: GET <relay>/<z32-key>
 * Response: 64-byte ed25519 signature + 8-byte timestamp (big-endian u64) + DNS packet bytes
 */

import z32 from 'z32';
import dns from 'dns-packet';

// Public pkarr relay - must match where mobile app publishes
const PKARR_RELAY = 'https://pkarr.pubky.org';
const PKARR_MIN_PACKET_BYTES = 64 + 8;
const MAX_PKARR_PACKET_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000; // 10 minutes

export interface ResolvedRecord {
  recordType: 'user' | 'org' | 'relay' | 'none';
  name?: string;
  username?: string;
  description?: string;
  bio?: string;
  avatarBlobId?: string;
  coverBlobId?: string;
  relayUrl?: string;
  relayPubkey?: string;
  relayZ32?: string;  // z32 pubkey of the owner's relay
  publicKey: string;
  orgId?: string;     // for org records
  joinSig?: string;   // base64 join signature
}

interface ResolvePkarrOptions {
  relayUrl?: string;
}

type DnsTxtData = Uint8Array | string | Array<Uint8Array | string>;

interface DnsAnswer {
  type?: string;
  name?: string;
  data?: DnsTxtData;
}

interface DnsPacket {
  answers?: DnsAnswer[];
}

/**
 * Parse a gardens TXT record string.
 * Formats:
 *   v=gardens1;t=user;u=<username>;b=<bio>;a=<avatar>
 *   v=gardens1;t=org;n=<name>;d=<desc>;a=<avatar>;c=<cover>
 *   v=gardens1;t=relay;n=<url>;a=<pubkey>
 */
function parseGardensRecord(txt: string, z32Key: string): ResolvedRecord {
  const fields: Record<string, string> = {};

  for (const part of txt.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1) {
      fields[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }

  const recordType = (fields['t'] as ResolvedRecord['recordType']) || 'none';

  return {
    recordType,
    name: fields['n'],
    username: fields['u'],
    description: fields['d'],
    bio: fields['b'],
    avatarBlobId: fields['a'],
    coverBlobId: fields['c'],
    relayUrl: fields['n'], // For relay records, 'n' is the URL
    relayPubkey: fields['a'], // For relay records, 'a' is the pubkey
    relayZ32: fields['rl'],
    publicKey: z32Key,
    orgId: fields['id'],
    joinSig: fields['j'],
  };
}

function uint8Equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function encodeSigData(timestampMicros: bigint, packetBytes: Uint8Array): Uint8Array {
  // BEP44 signable payload:
  //   3:seqi<timestamp>e1:v<len>:<dns bytes>
  const prefix = new TextEncoder().encode(`3:seqi${timestampMicros.toString()}e1:v${packetBytes.length}:`);
  return concatBytes([prefix, packetBytes]);
}

function readTimestampMicros(bytes: Uint8Array): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(0, false);
}

function decodeTxtData(data: DnsTxtData | undefined): string {
  if (data == null) return '';
  const chunks = Array.isArray(data) ? data : [data];
  const bytesChunks = chunks.map((chunk) => {
    if (chunk instanceof Uint8Array) return chunk;
    if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
    return new Uint8Array(0);
  });
  return new TextDecoder().decode(concatBytes(bytesChunks));
}

async function verifySignedPacket(
  z32Key: string,
  signature: Uint8Array,
  timestampMicros: bigint,
  packetBytes: Uint8Array,
): Promise<void> {
  const expectedPubkey = z32.decode(z32Key);
  if (!(expectedPubkey instanceof Uint8Array) || expectedPubkey.length !== 32) {
    throw new Error('invalid z32 public key');
  }

  const nowMicros = BigInt(Date.now()) * 1000n;
  const maxFuture = nowMicros + BigInt(MAX_FUTURE_SKEW_MS) * 1000n;
  const maxAge = BigInt(MAX_PKARR_PACKET_AGE_MS) * 1000n;
  if (timestampMicros > maxFuture) {
    throw new Error('pkarr packet timestamp is too far in the future');
  }
  if (nowMicros > timestampMicros && nowMicros - timestampMicros > maxAge) {
    throw new Error('pkarr packet is too old');
  }

  const signable = encodeSigData(timestampMicros, packetBytes);
  const key = await crypto.subtle.importKey(
    'raw',
    expectedPubkey,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, signable);
  if (!ok) {
    throw new Error('pkarr signature verification failed');
  }
}

/**
 * Fetch signed packet bytes from a pkarr relay and decode the DNS packet.
 * Bytes layout: [64-byte signature][8-byte timestamp BE][DNS packet]
 */
async function fetchFromRelay(z32Key: string, relayUrl: string): Promise<DnsPacket | null> {
  const url = `${relayUrl}/${z32Key}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Relay error: ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.length < PKARR_MIN_PACKET_BYTES) {
    throw new Error(`Invalid relay response: too short (${bytes.length} bytes)`);
  }

  const signature = bytes.subarray(0, 64);
  const timestampBytes = bytes.subarray(64, 72);
  const packetBytes = bytes.subarray(72);
  const timestampMicros = readTimestampMicros(timestampBytes);

  await verifySignedPacket(z32Key, signature, timestampMicros, packetBytes);
  return dns.decode(Buffer.from(packetBytes)) as DnsPacket;
}

/**
 * Resolve a pkarr record via HTTP relay.
 * @param z32Key - z32-encoded public key (without 'pk:' prefix)
 */
export async function resolvePkarr(z32Key: string, options?: ResolvePkarrOptions): Promise<ResolvedRecord | null> {
  const relayUrl = (options?.relayUrl ?? PKARR_RELAY).replace(/\/+$/, '');
  console.log(`[pkarr] Resolving key: ${z32Key}`);
  try {
    const packet = await fetchFromRelay(z32Key, relayUrl);
    if (!packet) {
      console.log(`[pkarr] No packet found for key: ${z32Key}`);
      return null;
    }
    console.log(`[pkarr] Packet resolved, answers: ${packet.answers?.length || 0}`);
    
    // Debug: log all answers
    for (const answer of packet.answers || []) {
      console.log(`[pkarr] Answer: type=${answer.type}, name=${answer.name}`);
    }

    // Look for _gardens TXT records
    for (const answer of packet.answers || []) {
      if (answer.type === 'TXT' && (answer.name === '_gardens' || answer.name?.startsWith('_gardens.'))) {
        const txtValue = decodeTxtData(answer.data);
        if (txtValue.startsWith('v=gardens1')) {
          const record = parseGardensRecord(txtValue, z32Key);
          if (record.recordType === 'relay' && record.relayPubkey) {
            const selfPubkey = z32.decode(z32Key);
            const relayPubkey = hexToBytes(record.relayPubkey);
            if (!uint8Equals(selfPubkey, relayPubkey)) {
              console.warn('[pkarr] relay TXT pubkey mismatch for key', z32Key);
              continue;
            }
          }
          return record;
        }
      }
    }

    // Also check for relay records at _gardens-relay
    for (const answer of packet.answers || []) {
      if (answer.type === 'TXT' && (answer.name === '_gardens-relay' || answer.name?.startsWith('_gardens-relay.'))) {
        const txtValue = decodeTxtData(answer.data);
        if (txtValue.startsWith('v=gardens1')) {
          const record = parseGardensRecord(txtValue, z32Key);
          if (record.recordType === 'relay' && record.relayPubkey) {
            const selfPubkey = z32.decode(z32Key);
            const relayPubkey = hexToBytes(record.relayPubkey);
            if (!uint8Equals(selfPubkey, relayPubkey)) {
              console.warn('[pkarr] relay TXT pubkey mismatch for key', z32Key);
              continue;
            }
          }
          return record;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to resolve pkarr:', error);
    return null;
  }
}

/**
 * Resolve a pkarr key from a custom domain's DNS TXT record.
 * Looks for _gardens.<domain> TXT record containing pk:<z32-key>
 * @param domain - Custom domain (e.g., "example.com")
 * @returns The z32-encoded public key if found, null otherwise
 */
export async function resolveDomainToPkarr(domain: string): Promise<string | null> {
  try {
    // Use Cloudflare's DNS over HTTPS API
    const dnsName = `_gardens.${domain}`;
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dnsName)}&type=TXT`,
      {
        headers: {
          'Accept': 'application/dns-json',
        },
      }
    );

    if (!response.ok) {
      console.error('DNS query failed:', response.status);
      return null;
    }

    const data = await response.json() as { Answer?: Array<{ type: number; data?: string }> };

    if (!data.Answer || !Array.isArray(data.Answer)) {
      return null;
    }

    // Look for TXT record containing pk:<z32-key>
    for (const answer of data.Answer) {
      if (answer.type === 16) { // TXT record type
        // TXT data is wrapped in quotes in DNS JSON response
        const txtValue = answer.data?.replace(/^"|"$/g, '');
        if (txtValue && txtValue.startsWith('pk:')) {
          const z32Key = txtValue.slice(3); // Remove 'pk:' prefix
          return z32Key;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to resolve domain:', error);
    return null;
  }
}

// Re-export z32 for use in other modules if needed
export { z32 };

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
