/**
 * useSyncStore — manages WebSocket connections to the Gardens Sync Worker (TopicDO).
 *
 * Usage:
 *   const { subscribe, unsubscribe } = useSyncStore();
 *   subscribe(roomId);   // open WS, replay buffered ops, then live push
 *   unsubscribe(roomId); // close WS for that topic
 */

import { create } from 'zustand';
import { ingestOp, getTopicSeq } from '../ffi/gardensCore';
import { ingestEmailOp } from './useInboxStore';
import { blake3 } from '@noble/hashes/blake3';
import { logSyncSend, logSyncReceive } from './useDebugStore';

// Simple TextDecoder alternative for converting bytes to string
function decodeUtf8(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

// Simple base64 encoding/decoding without browser globals
function toBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i] ?? 0;
    const b2 = bytes[i + 1] ?? 0;
    const b3 = bytes[i + 2] ?? 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 0x03) << 4) | (b2 >> 4)];
    result += chars[((b2 & 0x0f) << 2) | (b3 >> 6)];
    result += chars[b3 & 0x3f];
  }
  const padding = bytes.length % 3;
  if (padding > 0) {
    result = result.slice(0, -padding) + (padding === 1 ? '==' : '=');
  }
  return result;
}

function fromBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, '').replace(/=+$/, '');
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    const b1 = chars.indexOf(cleaned[i]);
    const b2 = chars.indexOf(cleaned[i + 1]);
    const b3 = chars.indexOf(cleaned[i + 2]);
    const b4 = chars.indexOf(cleaned[i + 3]);
    bytes.push((b1 << 2) | (b2 >> 4));
    if (b3 !== -1) bytes.push(((b2 & 0x0f) << 4) | (b3 >> 2));
    if (b4 !== -1) bytes.push(((b3 & 0x03) << 6) | b4);
  }
  return new Uint8Array(bytes);
}

export const DEFAULT_SYNC_URL = 'https://gardens-sync.stereos.workers.dev';

function encodeAscii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** Derive the personal inbox topic for a given public key hex. */
export function deriveInboxTopicHex(pubkeyHex: string): string {
  const bytes = new Uint8Array(
    pubkeyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );
  const suffix = encodeAscii('gardens:inbox:v1');
  const input = new Uint8Array(bytes.length + suffix.length);
  input.set(bytes);
  input.set(suffix, bytes.length);
  const hash = blake3(input);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Derive the shared org-admin inbox topic for a given org id. */
export function deriveOrgAdminTopicHex(orgId: string): string {
  const orgBytes = encodeAscii(orgId);
  const suffix = encodeAscii('gardens:org-admin:v1');
  const input = new Uint8Array(orgBytes.length + suffix.length);
  input.set(orgBytes);
  input.set(suffix, orgBytes.length);
  const hash = blake3(input);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Post a p2panda op to the sync worker for a given topic. Fire-and-forget. */
export function broadcastOp(topicHex: string, opBytes: Uint8Array, syncUrl = DEFAULT_SYNC_URL): void {
  const opBase64 = toBase64(opBytes);
  
  // Log sync send event (development only)
  logSyncSend(topicHex, opBytes);
  
  fetch(`${syncUrl}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic_hex: topicHex, op_base64: opBase64 }),
  }).catch(() => {/* best-effort */});
}

interface TopicSocket {
  ws: WebSocket;
  topicHex: string;
}

interface SyncState {
  sockets: Map<string, TopicSocket>;
  lastSeqByTopic: Record<string, number>;
  // Incremented each time an op is ingested — screens watch this to re-fetch
  opTick: number;
  subscribe(topicHex: string, syncUrl?: string): void;
  hydrateTopic(topicHex: string, options?: { timeoutMs?: number; settleMs?: number; syncUrl?: string }): Promise<number>;
  unsubscribe(topicHex: string): void;
  unsubscribeAll(): void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  sockets: new Map(),
  lastSeqByTopic: {},
  opTick: 0,

  subscribe(topicHex: string, syncUrl = DEFAULT_SYNC_URL) {
    const existing = get().sockets.get(topicHex);
    if (existing) return; // already subscribed

    void (async () => {
      let since = 0;
      try {
        since = await getTopicSeq(topicHex);
      } catch {
        // default to 0 if core not ready
      }

      const wsUrl = syncUrl.replace(/^https?:\/\//, (m) =>
        m === 'https://' ? 'wss://' : 'ws://'
      );
      const ws = new WebSocket(`${wsUrl}/topic/${topicHex}?since=${since}`);
      console.log(`[sync] subscribed topic=${topicHex.slice(0, 16)}… since=${since}`);

      ws.onmessage = async (event: any) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            seq?: number;
            data?: string;
          };
          if (msg.type === 'op' && msg.seq != null && msg.data) {
            console.log(`[sync] op received on topic ${topicHex.slice(0, 16)}… seq=${msg.seq} bytes=${msg.data.length}`);
            
            // Log sync receive event (development only)
            logSyncReceive(topicHex, msg.seq, msg.data.length);
            
            const bytes = fromBase64(msg.data);
            try {
              await ingestOp(topicHex, msg.seq, bytes);
              console.log(`[sync] ingestOp OK topic=${topicHex.slice(0, 16)}… seq=${msg.seq}`);
            } catch (ingestErr: any) {
              // Ignore duplicate operation errors - they're expected when re-syncing
              const errMsg = ingestErr?.message || String(ingestErr);
              if (errMsg.includes('UNIQUE constraint') || errMsg.includes('operations_v1.hash')) {
                console.log(`[sync] ingestOp SKIPPED (duplicate) topic=${topicHex.slice(0, 16)}… seq=${msg.seq}`);
              } else {
                console.warn(`[sync] ingestOp FAILED topic=${topicHex.slice(0, 16)}… seq=${msg.seq}`, ingestErr);
              }
            }
            try {
              const decoded = fromBase64(msg.data);
              const decodedStr = decodeUtf8(decoded);
              const parsed = JSON.parse(decodedStr);
              if (parsed?.op_type === 'receive_email') {
                ingestEmailOp(decodedStr);
              }
            } catch {
              // not an email op
            }
            set((s) => ({
              opTick: s.opTick + 1,
              lastSeqByTopic: { ...s.lastSeqByTopic, [topicHex]: msg.seq! },
            }));
          }
        } catch (outerErr) {
          console.warn('[sync] onmessage parse error', outerErr);
        }
      };

      ws.onclose = () => {
        set((s) => {
          const next = new Map(s.sockets);
          next.delete(topicHex);
          return { sockets: next };
        });
      };

      ws.onerror = () => {
        ws.close();
      };

      set((s) => {
        const next = new Map(s.sockets);
        next.set(topicHex, { ws, topicHex });
        return { sockets: next };
      });
    })();
  },

  async hydrateTopic(topicHex: string, options) {
    const timeoutMs = options?.timeoutMs ?? 4000;
    const settleMs = options?.settleMs ?? 600;
    const syncUrl = options?.syncUrl ?? DEFAULT_SYNC_URL;

    let baselineSeq = get().lastSeqByTopic[topicHex];
    if (baselineSeq == null) {
      try {
        baselineSeq = await getTopicSeq(topicHex);
      } catch {
        baselineSeq = 0;
      }
    }

    get().subscribe(topicHex, syncUrl);

    const startedAt = Date.now();
    let latestSeq = baselineSeq;
    let lastAdvanceAt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 100));
      const nextSeq = get().lastSeqByTopic[topicHex] ?? latestSeq;

      if (nextSeq > latestSeq) {
        latestSeq = nextSeq;
        lastAdvanceAt = Date.now();
        continue;
      }

      if (lastAdvanceAt > 0 && Date.now() - lastAdvanceAt >= settleMs) {
        break;
      }
    }

    return get().lastSeqByTopic[topicHex] ?? latestSeq;
  },

  unsubscribe(topicHex: string) {
    const entry = get().sockets.get(topicHex);
    if (entry) {
      entry.ws.close();
      set((s) => {
        const next = new Map(s.sockets);
        next.delete(topicHex);
        return { sockets: next };
      });
    }
  },

  unsubscribeAll() {
    for (const { ws } of get().sockets.values()) {
      ws.close();
    }
    set({ sockets: new Map() });
  },
}));
