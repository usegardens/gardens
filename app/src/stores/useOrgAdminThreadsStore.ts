import { create } from 'zustand';
import {
  createOrgAdminThread as dcCreateOrgAdminThread,
  listOrgAdminThreads as dcListOrgAdminThreads,
  type OrgAdminThread,
  sendMessage,
} from '../ffi/gardensCore';
import { broadcastOp, deriveOrgAdminTopicHex } from './useSyncStore';
import { useProfileStore } from './useProfileStore';

interface OrgAdminThreadsState {
  threadsByOrg: Record<string, OrgAdminThread[]>;
  fetchOrgAdminThreads(orgId: string): Promise<void>;
  createOrgAdminThread(orgId: string, orgContactKey: string): Promise<string>;
}

export const useOrgAdminThreadsStore = create<OrgAdminThreadsState>((set, get) => ({
  threadsByOrg: {},

  async fetchOrgAdminThreads(orgId) {
    const threads = await dcListOrgAdminThreads(orgId);
    set((s) => ({ threadsByOrg: { ...s.threadsByOrg, [orgId]: threads } }));
  },

  async createOrgAdminThread(orgId, orgContactKey) {
    const result = await dcCreateOrgAdminThread(orgId, orgContactKey);
    await get().fetchOrgAdminThreads(orgId);

    if (result.opBytes?.length) {
      const inboxTopic = deriveOrgAdminTopicHex(orgId);
      broadcastOp(inboxTopic, result.opBytes);
    }

    const myProfile = useProfileStore.getState().myProfile;
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
      } catch {
        // best-effort
      }
    }

    return result.id;
  },
}));
