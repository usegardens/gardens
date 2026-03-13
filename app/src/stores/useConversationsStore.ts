import { create } from 'zustand';
import {
  listDmThreads as dcListDmThreads,
  createDmThread as dcCreateDmThread,
  deleteConversation as dcDeleteConversation,
  sendMessage,
  type DmThread,
} from '../ffi/gardensCore';
import { broadcastOp, deriveInboxTopicHex } from './useSyncStore';
import { DEFAULT_RELAY_URL, useProfileStore } from './useProfileStore';
import { markProfilePayloadSent } from './useDmProfileStore';

interface ConversationsState {
  conversations: DmThread[];
  requests: DmThread[];
  deletedThreadIds: Set<string>;

  fetchConversations(): Promise<void>;
  createConversation(recipientKey: string): Promise<string>;
  deleteConversation(threadId: string): Promise<void>;
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  conversations: [],
  requests: [],
  deletedThreadIds: new Set(),

  async fetchConversations() {
    const all = await dcListDmThreads();
    const { deletedThreadIds } = get();
    const visible = all.filter(t => !deletedThreadIds.has(t.threadId));
    console.log(`[conversations] fetchConversations → ${all.length} total (${visible.filter(t => !t.isRequest).length} conversations, ${visible.filter(t => t.isRequest).length} requests)`);
    set({
      conversations: visible.filter(t => !t.isRequest),
      requests: visible.filter(t => t.isRequest),
    });
  },

  async createConversation(recipientKey: string) {
    const result = await dcCreateDmThread(recipientKey);
    await get().fetchConversations();
    // Send our profile to the new thread so the recipient can identify us
    const myProfile = useProfileStore.getState().myProfile;
    if (result.opBytes?.length) {
      const inboxTopic = deriveInboxTopicHex(recipientKey);
      console.log(`[conversations] broadcasting DM_THREAD op to inbox topic=${inboxTopic.slice(0, 16)}… threadId=${result.id}`);
      broadcastOp(inboxTopic, result.opBytes);
    } else {
      console.warn('[conversations] createConversation returned no opBytes — op will not reach recipient');
    }
    if (myProfile?.username) {
      const profilePayload = JSON.stringify({
        username: myProfile.username,
        avatarBlobId: myProfile.avatarBlobId ?? null,
      });
      try {
        const profileResult = await sendMessage(
          null, result.id, 'profile', profilePayload, null, null, [], null,
        );
        if (profileResult.opBytes?.length) {
          broadcastOp(result.id, profileResult.opBytes);
        }
        await markProfilePayloadSent(result.id, profilePayload);
      } catch {
        // profile message is best-effort
      }
    }
    // Push notification so recipient sees the request even when backgrounded
    fetch(`${DEFAULT_RELAY_URL}/push/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientKeys: [recipientKey],
        title: 'New message request',
        body: 'Someone wants to start a conversation with you.',
        data: { type: 'dm_request', threadId: result.id, recipientKey },
      }),
    }).catch(() => {});
    return result.id;
  },

  async deleteConversation(threadId: string) {
    // Optimistically remove and track so re-fetches triggered by opTick don't resurrect it
    set(s => ({
      requests: s.requests.filter(r => r.threadId !== threadId),
      conversations: s.conversations.filter(c => c.threadId !== threadId),
      deletedThreadIds: new Set([...s.deletedThreadIds, threadId]),
    }));
    const result = await dcDeleteConversation(threadId);
    if (result.opBytes?.length) {
      broadcastOp(threadId, result.opBytes);
    }
    await get().fetchConversations();
  },
}));
