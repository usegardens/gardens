import { create } from 'zustand';
import { sendMessage as nativeSendMessage, listMessages, deleteMessage as nativeDeleteMessage, listReactions, addReaction, removeReaction, type Reaction } from '../ffi/gardensCore';
import { broadcastOp } from './useSyncStore';
import { setDmProfile } from './useDmProfileStore';
import { useProfileStore } from './useProfileStore';

// Base64 decode function compatible with React Native (atob not available)
function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Remove padding
  const cleanBase64 = base64.replace(/=+$/, '');
  const length = (cleanBase64.length * 6) >> 3;
  const bytes = new Uint8Array(length);
  let i: number, p = 0;
  for (i = 0; i + 4 <= cleanBase64.length; i += 4) {
    const enc1 = chars.indexOf(cleanBase64[i]);
    const enc2 = chars.indexOf(cleanBase64[i + 1]);
    const enc3 = chars.indexOf(cleanBase64[i + 2]);
    const enc4 = chars.indexOf(cleanBase64[i + 3]);
    bytes[p++] = (enc1 << 2) | (enc2 >> 4);
    bytes[p++] = ((enc2 & 15) << 4) | (enc3 >> 2);
    bytes[p++] = ((enc3 & 3) << 6) | enc4;
  }
  const remaining = cleanBase64.length - i;
  if (remaining >= 2) {
    const enc1 = chars.indexOf(cleanBase64[i]);
    const enc2 = chars.indexOf(cleanBase64[i + 1]);
    bytes[p++] = (enc1 << 2) | (enc2 >> 4);
    if (remaining > 2) {
      const enc3 = chars.indexOf(cleanBase64[i + 2]);
      bytes[p++] = ((enc2 & 15) << 4) | (enc3 >> 2);
    }
  }
  return bytes;
}

export interface Message {
  messageId: string;
  roomId: string | null;
  dmThreadId: string | null;
  authorKey: string;
  contentType: 'text' | 'audio' | 'image' | 'gif' | 'video' | 'embed' | 'profile';
  textContent: string | null;
  blobId: string | null;
  embedUrl: string | null;
  mentions: string[];
  replyTo: string | null;
  timestamp: number;
  editedAt: number | null;
  isDeleted: boolean;
}

type ContextKey = string; // roomId or dmThreadId

interface MessagesState {
  messages: Record<ContextKey, Message[]>;
  reactions: Record<string, Reaction[]>;

  fetchMessages(
    roomId: string | null,
    dmThreadId: string | null,
    limit?: number,
    beforeTimestamp?: number,
  ): Promise<void>;

  sendMessage(params: {
    roomId?: string;
    dmThreadId?: string;
    contentType: Message['contentType'];
    textContent?: string;
    blobId?: string;
    embedUrl?: string;
    mentions?: string[];
    replyTo?: string;
  }): Promise<string>;

  deleteMessage(messageId: string, orgId?: string): Promise<void>;

  toggleReaction(messageId: string, emoji: string, myPublicKey: string, roomId?: string | null): Promise<void>;
}

const contextKey = (roomId: string | null, dmThreadId: string | null): ContextKey =>
  roomId ?? dmThreadId ?? 'none';

export const useMessagesStore = create<MessagesState>((set) => ({
  messages: {},
  reactions: {},

  async fetchMessages(roomId, dmThreadId, limit = 50, beforeTimestamp) {
    const msgs = await listMessages(
      roomId ?? null,
      dmThreadId ?? null,
      limit,
      beforeTimestamp ?? null,
    );
    const key = contextKey(roomId, dmThreadId);

    // Split out profile-exchange messages — store them in KV, never render them.
    const profileMsgs = msgs.filter(m => m.contentType === 'profile');
    const visibleMsgs = msgs.filter(m => m.contentType !== 'profile');

    for (const pm of profileMsgs) {
      try {
        const data = JSON.parse(pm.textContent ?? '{}') as {
          username?: string;
          avatarBlobId?: string | null;
        };
        if (data.username) {
          await setDmProfile({
            publicKey: pm.authorKey,
            username: data.username,
            avatarBlobId: data.avatarBlobId ?? null,
          });
          // Hydrate in-memory profile cache immediately
          useProfileStore.setState(s => {
            const existing = s.profileCache[pm.authorKey];
            if (!existing) {
              return {
                profileCache: {
                  ...s.profileCache,
                  [pm.authorKey]: {
                    publicKey: pm.authorKey,
                    username: data.username!,
                    avatarBlobId: data.avatarBlobId ?? null,
                    bio: null,
                    availableFor: [],
                    isPublic: false,
                    createdAt: pm.timestamp,
                    updatedAt: pm.timestamp,
                  },
                },
              };
            }
            // Existing entry: patch in avatarBlobId if the DM profile provides one we're missing
            if (data.avatarBlobId && !existing.avatarBlobId) {
              return {
                profileCache: {
                  ...s.profileCache,
                  [pm.authorKey]: { ...existing, avatarBlobId: data.avatarBlobId },
                },
              };
            }
            return s;
          });
        }
      } catch {
        // malformed profile message — ignore
      }
    }

    // Oldest-first for display.
    set(s => ({ messages: { ...s.messages, [key]: [...visibleMsgs].reverse() as Message[] } }));

    const messageIds = visibleMsgs.map(m => m.messageId);
    if (messageIds.length > 0) {
      const reactions = await listReactions(messageIds);
      const grouped: Record<string, Reaction[]> = {};
      for (const r of reactions) {
        grouped[r.messageId] = grouped[r.messageId] || [];
        grouped[r.messageId].push(r);
      }
      set(s => ({ reactions: { ...s.reactions, ...grouped } }));
    }
  },

  async sendMessage({ roomId, dmThreadId, contentType, textContent, blobId, embedUrl, mentions = [], replyTo }) {
    const result = await nativeSendMessage(
      roomId ?? null,
      dmThreadId ?? null,
      contentType,
      textContent ?? null,
      blobId ?? null,
      embedUrl ?? null,
      mentions,
      replyTo ?? null,
    );

    // Broadcast op to sync worker so peers receive it live
    if (result.opBytes?.length) {
      const topic = roomId ?? dmThreadId;
      if (topic) broadcastOp(topic, result.opBytes);
    }

    return result.id;
  },

  async deleteMessage(messageId, orgId) {
    const result = await nativeDeleteMessage(messageId, orgId);

    const topic = (() => {
      for (const msgs of Object.values(useMessagesStore.getState().messages)) {
        const found = msgs.find(m => m.messageId === messageId);
        if (found?.roomId) return found.roomId;
        if (found?.dmThreadId) return found.dmThreadId;
      }
      return orgId ?? null;
    })();

    if (topic && result.opBytes?.length) {
      broadcastOp(topic, result.opBytes);
    }

    // Optimistically update local state
    set(s => {
      const updatedMessages: Record<string, Message[]> = {};
      for (const key of Object.keys(s.messages)) {
        updatedMessages[key] = s.messages[key].map(msg =>
          msg.messageId === messageId ? { ...msg, isDeleted: true } : msg
        );
      }
      return { messages: updatedMessages };
    });
  },

  async toggleReaction(messageId, emoji, myPublicKey, roomId) {
    const current = useMessagesStore.getState().reactions[messageId] || [];
    const hasReacted = current.some(r => r.emoji === emoji && r.reactorKey === myPublicKey);
    let result: { id: string; opBytesBase64: string };
    if (hasReacted) {
      result = await removeReaction(messageId, emoji);
    } else {
      result = await addReaction(messageId, emoji);
    }
    // Broadcast reaction op to sync worker so other members see it live
    const topic = roomId ?? (() => {
      for (const msgs of Object.values(useMessagesStore.getState().messages)) {
        const found = msgs.find(m => m.messageId === messageId);
        if (found?.roomId) return found.roomId;
      }
      return null;
    })();
    if (topic && result.opBytesBase64) {
      const bytes = base64ToBytes(result.opBytesBase64);
      broadcastOp(topic, bytes);
    }
    const updated = await listReactions([messageId]);
    set(s => ({ reactions: { ...s.reactions, [messageId]: updated } }));
  },
}));
