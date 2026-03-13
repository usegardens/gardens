import { create } from 'zustand';
import {
  deleteConversation as dcDeleteConversation,
  listMyOrgAdminThreads,
  type OrgAdminThread,
} from '../ffi/gardensCore';
import { broadcastOp } from './useSyncStore';

interface JoinRequestsState {
  threads: OrgAdminThread[];
  resolvedThreadIds: Set<string>;
  fetchThreads(): Promise<void>;
  resolveThread(threadId: string): Promise<void>;
}

export const useJoinRequestsStore = create<JoinRequestsState>((set, get) => ({
  threads: [],
  resolvedThreadIds: new Set<string>(),

  async fetchThreads() {
    const threads = await listMyOrgAdminThreads();
    const { resolvedThreadIds } = get();
    set({ threads: threads.filter(t => !resolvedThreadIds.has(t.threadId)) });
  },

  async resolveThread(threadId: string) {
    const existingThread = get().threads.find(t => t.threadId === threadId) ?? null;
    set((state) => ({
      threads: state.threads.filter(t => t.threadId !== threadId),
      resolvedThreadIds: new Set([...state.resolvedThreadIds, threadId]),
    }));

    try {
      const result = await dcDeleteConversation(threadId);
      if (result.opBytes?.length) {
        broadcastOp(threadId, result.opBytes);
      }
    } catch (err) {
      set((state) => {
        const nextResolved = new Set(state.resolvedThreadIds);
        nextResolved.delete(threadId);
        return {
          threads: existingThread ? [existingThread, ...state.threads] : state.threads,
          resolvedThreadIds: nextResolved,
        };
      });
      throw err;
    }
  },
}));
