/**
 * TopicDO — Cloudflare Durable Object for per-topic op buffering and blob pointer tracking.
 *
 * One instance per topic, named by the 32-byte topic ID hex.
 *
 * Storage layout:
 *   "head"                   → number  (highest seq written, starts at 0)
 *   "op:<seq>"               → string  (base64-encoded raw p2panda op bytes)
 *   "blob-ptr:<hash>"        → object  { holders: string[], size: number, mimeType: string }
 *
 * Buffer capped at BUFFER_SIZE ops. On overflow, the oldest entry is evicted.
 * Blob pointers track which peers have which blobs (not the blob data itself).
 */

export const BUFFER_SIZE = 1000;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export interface BlobPointer {
  holders: string[];      // List of peer public keys who have this blob
  size: number;           // Blob size in bytes
  mimeType: string;       // MIME type
  timestamp: number;      // When first registered
}

export class TopicDO {
  private storage: DurableObjectStorage;
  private connections: Map<WebSocket, { lastSeq: number }> = new Map();

  constructor(state: DurableObjectState, _env: unknown) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // WebSocket upgrade
    if (upgrade?.toLowerCase() === 'websocket') {
      const since = parseInt(url.searchParams.get('since') ?? '0', 10);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      await this.handleWebSocket(server, since);
      return new Response(null, { status: 101, webSocket: client });
    }

    // POST — deliver op bytes directly
    if (request.method === 'POST' && pathParts.length === 0) {
      const bytes = new Uint8Array(await request.arrayBuffer());
      await this.receiveOp(bytes);
      return new Response(null, { status: 200 });
    }

    // Blob pointer endpoints: /blob-pointers/<hash>
    const pointersIndex = pathParts.indexOf('blob-pointers');
    if (pointersIndex !== -1 && pathParts[pointersIndex + 1]) {
      const blobHash = pathParts[pointersIndex + 1];
      
      // GET /blob-pointers/<hash> - get list of holders
      if (request.method === 'GET') {
        return this.getBlobPointer(blobHash);
      }
      
      // POST /blob-pointers/<hash> - register as holder
      if (request.method === 'POST') {
        const body = await request.json() as { peerPublicKey: string; size: number; mimeType: string };
        return this.registerBlobHolder(blobHash, body.peerPublicKey, body.size, body.mimeType);
      }
      
      // DELETE /blob-pointers/<hash> - unregister as holder
      if (request.method === 'DELETE') {
        const body = await request.json() as { peerPublicKey: string };
        return this.unregisterBlobHolder(blobHash, body.peerPublicKey);
      }
    }

    return new Response('not found', { status: 404 });
  }

  async receiveOp(bytes: Uint8Array): Promise<void> {
    const head = ((await this.storage.get<number>('head')) ?? 0) + 1;
    const seq = head;

    const data = uint8ArrayToBase64(bytes);
    await this.storage.put(`op:${seq}`, data);
    await this.storage.put('head', seq);

    // Evict oldest op when buffer exceeds capacity
    if (seq > BUFFER_SIZE) {
      await this.storage.delete(`op:${seq - BUFFER_SIZE}`);
    }

    // Fan out to all live WebSocket clients
    const msg = JSON.stringify({ type: 'op', seq, data });
    for (const [ws] of this.connections) {
      if ((ws as unknown as { readyState: number }).readyState === 1) {
        ws.send(msg);
      }
    }
  }

  async handleWebSocket(ws: WebSocket, since: number): Promise<void> {
    const head = (await this.storage.get<number>('head')) ?? 0;

    // Replay buffered ops from since+1 to head
    for (let seq = since + 1; seq <= head; seq++) {
      const data = await this.storage.get<string>(`op:${seq}`);
      if (data) {
        ws.send(JSON.stringify({ type: 'op', seq, data }));
      }
    }

    // Signal catch-up complete
    ws.send(JSON.stringify({ type: 'ready', head }));

    // Register for live push
    this.connections.set(ws, { lastSeq: head });

    ws.addEventListener('message', async (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; data?: string };
        if (msg.type === 'op' && msg.data) {
          await this.receiveOp(base64ToUint8Array(msg.data));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener('close', () => {
      this.connections.delete(ws);
    });
  }

  // ── Blob Pointer Registry ────────────────────────────────────────────────

  /**
   * Get the blob pointer (list of holders) for a given hash.
   * Returns 404 if no one has registered this blob.
   */
  async getBlobPointer(blobHash: string): Promise<Response> {
    // Validate hash format (hex, 64 chars for SHA-256)
    if (!/^[0-9a-f]{64}$/i.test(blobHash)) {
      return new Response('invalid blob hash', { status: 400 });
    }

    const ptr = await this.storage.get<BlobPointer>(`blob-ptr:${blobHash}`);
    if (!ptr) {
      return new Response('blob not found', { status: 404 });
    }

    return new Response(JSON.stringify(ptr), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /**
   * Register a peer as a holder of a blob.
   * Called when a peer uploads/stores a blob locally.
   */
  async registerBlobHolder(
    blobHash: string,
    peerPublicKey: string,
    size: number,
    mimeType: string,
  ): Promise<Response> {
    // Validate hash format
    if (!/^[0-9a-f]{64}$/i.test(blobHash)) {
      return new Response('invalid blob hash', { status: 400 });
    }

    // Validate peer public key (hex, 64 chars for ed25519)
    if (!/^[0-9a-f]{64}$/i.test(peerPublicKey)) {
      return new Response('invalid peer public key', { status: 400 });
    }

    const key = `blob-ptr:${blobHash}`;
    let ptr = await this.storage.get<BlobPointer>(key);

    if (!ptr) {
      // First time this blob is registered
      ptr = {
        holders: [peerPublicKey],
        size,
        mimeType,
        timestamp: Date.now(),
      };
    } else {
      // Add peer to holders if not already present
      if (!ptr.holders.includes(peerPublicKey)) {
        ptr.holders.push(peerPublicKey);
      }
      // Update size/mimeType if provided (should be same)
      if (size) ptr.size = size;
      if (mimeType) ptr.mimeType = mimeType;
    }

    await this.storage.put(key, ptr);

    return new Response(JSON.stringify({ success: true, holders: ptr.holders }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /**
   * Unregister a peer as a holder of a blob.
   * Called when a peer deletes a blob or goes offline.
   * If no holders remain, the pointer is deleted.
   */
  async unregisterBlobHolder(blobHash: string, peerPublicKey: string): Promise<Response> {
    // Validate inputs
    if (!/^[0-9a-f]{64}$/i.test(blobHash)) {
      return new Response('invalid blob hash', { status: 400 });
    }

    if (!/^[0-9a-f]{64}$/i.test(peerPublicKey)) {
      return new Response('invalid peer public key', { status: 400 });
    }

    const key = `blob-ptr:${blobHash}`;
    const ptr = await this.storage.get<BlobPointer>(key);

    if (!ptr) {
      return new Response('blob not found', { status: 404 });
    }

    // Remove peer from holders
    ptr.holders = ptr.holders.filter(p => p !== peerPublicKey);

    if (ptr.holders.length === 0) {
      // No one has this blob anymore, delete the pointer
      await this.storage.delete(key);
      return new Response(JSON.stringify({ success: true, holders: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } else {
      // Update with remaining holders
      await this.storage.put(key, ptr);
      return new Response(JSON.stringify({ success: true, holders: ptr.holders }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }
}
