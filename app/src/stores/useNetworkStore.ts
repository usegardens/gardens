import { create } from 'zustand';
import type { ConnectionStatus } from '../ffi/deltaCore';
import { getConnectionStatus } from '../ffi/deltaCore';

interface NetworkState {
  status: ConnectionStatus;
  startPolling(): void;
  stopPolling(): void;
}

let timer: ReturnType<typeof setInterval> | null = null;

export const useNetworkStore = create<NetworkState>((set) => ({
  status: 'Offline',

  startPolling() {
    if (timer) return;
    // Poll core network status periodically
    timer = setInterval(async () => {
      try {
        const status = await getConnectionStatus();
        set({ status });
      } catch {
        set({ status: 'Offline' });
      }
    }, 2000);
  },

  stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    set({ status: 'Offline' });
  },
}));
