import { create } from 'zustand';
import {
  listDmThreads as dcListDmThreads,
  createDmThread as dcCreateDmThread,
  acceptMessageRequest as dcAcceptRequest,
  declineMessageRequest as dcDeclineRequest,
  type DmThread,
} from '../ffi/gardensCore';

interface DMState {
  threads: DmThread[];
  requests: DmThread[];

  fetchThreads(): Promise<void>;
  createThread(recipientKey: string): Promise<string>;
  acceptRequest(threadId: string): Promise<void>;
  declineRequest(threadId: string): Promise<void>;
}

export const useDMStore = create<DMState>((set, get) => ({
  threads: [],
  requests: [],

  async fetchThreads() {
    const all = await dcListDmThreads();
    set({
      threads: all.filter(t => !t.isRequest),
      requests: all.filter(t => t.isRequest),
    });
  },

  async createThread(recipientKey: string) {
    const result = await dcCreateDmThread(recipientKey);
    await get().fetchThreads();
    return result.id;
  },

  async acceptRequest(threadId: string) {
    await dcAcceptRequest(threadId);
    await get().fetchThreads();
  },

  async declineRequest(threadId: string) {
    await dcDeclineRequest(threadId);
    await get().fetchThreads();
  },
}));
