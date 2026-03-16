/**
 * useDebugStore — Debug logging for sync and relay traffic (development only).
 * 
 * This store records encrypted values passing through sync and relay.
 * It is only active when __DEV__ is true (development builds).
 */

import { create } from 'zustand';

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export type DebugEventType = 'sync_send' | 'sync_receive' | 'relay_upload' | 'relay_download' | 'blob_upload' | 'blob_download';

export interface DebugEvent {
  id: string;
  timestamp: number;
  type: DebugEventType;
  topic?: string;
  size: number;
  preview: string; // truncated hex/base64 preview
  details?: string;
}

interface DebugState {
  events: DebugEvent[];
  maxEvents: number;
  enabled: boolean;
  addEvent(event: Omit<DebugEvent, 'id' | 'timestamp'>): void;
  clearEvents(): void;
}

// Only enable in development builds
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export const useDebugStore = create<DebugState>((set, get) => ({
  events: [],
  maxEvents: 100,
  enabled: isDev,

  addEvent: (event) => {
    if (!get().enabled) return;
    
    const id = Math.random().toString(36).substring(2, 9);
    const newEvent: DebugEvent = {
      ...event,
      id,
      timestamp: Date.now(),
    };
    
    set((state) => ({
      events: [newEvent, ...state.events].slice(0, state.maxEvents),
    }));
  },

  clearEvents: () => {
    set({ events: [] });
  },
}));

/**
 * Log a sync send event (only in development).
 */
export function logSyncSend(topicHex: string, opBytes: Uint8Array) {
  useDebugStore.getState().addEvent({
    type: 'sync_send',
    topic: topicHex,
    size: opBytes.length,
    preview: uint8ArrayToHex(opBytes).slice(0, 32) + '...',
    details: `Sent ${opBytes.length} bytes to sync`,
  });
}

/**
 * Log a sync receive event (only in development).
 */
export function logSyncReceive(topicHex: string, seq: number, dataLength: number) {
  useDebugStore.getState().addEvent({
    type: 'sync_receive',
    topic: topicHex,
    size: dataLength,
    preview: `seq=${seq}`,
    details: `Received ${dataLength} bytes from sync`,
  });
}

/**
 * Log a relay upload event (only in development).
 */
export function logRelayUpload(url: string, size: number) {
  useDebugStore.getState().addEvent({
    type: 'relay_upload',
    size,
    preview: url.split('/').pop()?.slice(0, 20) || 'unknown',
    details: `Uploaded ${size} bytes to relay`,
  });
}

/**
 * Log a relay download event (only in development).
 */
export function logRelayDownload(url: string, size: number) {
  useDebugStore.getState().addEvent({
    type: 'relay_download',
    size,
    preview: url.split('/').pop()?.slice(0, 20) || 'unknown',
    details: `Downloaded ${size} bytes from relay`,
  });
}

/**
 * Log a blob upload event (only in development).
 */
export function logBlobUpload(blobId: string, roomId: string | null, size: number) {
  useDebugStore.getState().addEvent({
    type: 'blob_upload',
    topic: roomId || 'org-wide',
    size,
    preview: blobId.slice(0, 16) + '...',
    details: roomId 
      ? `Encrypted blob for room ${roomId.slice(0, 8)}...`
      : 'Unencrypted org blob',
  });
}

/**
 * Log a blob download event (only in development).
 */
export function logBlobDownload(blobId: string, roomId: string | null, size: number) {
  useDebugStore.getState().addEvent({
    type: 'blob_download',
    topic: roomId || 'org-wide',
    size,
    preview: blobId.slice(0, 16) + '...',
    details: roomId
      ? `Decrypted blob from room ${roomId.slice(0, 8)}...`
      : 'Decrypted org blob',
  });
}
