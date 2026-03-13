import { create } from 'zustand';
import { resolvePkarr } from '../ffi/gardensCore';
import { useOrgsStore } from './useOrgsStore';

export type OrgPreview = {
  orgId: string;
  orgName: string;
  description: string | null;
  avatarBlobId: string | null;
  coverBlobId: string | null;
  orgContactKey: string;
};

interface OrgPreviewState {
  previewsByOrgId: Record<string, OrgPreview>;
  hydrateOrgPreview(orgContactKey: string, expectedOrgId?: string, fallbackName?: string): Promise<OrgPreview | null>;
}

function looksLikeHexKey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export const useOrgPreviewStore = create<OrgPreviewState>((set) => ({
  previewsByOrgId: {},

  async hydrateOrgPreview(orgContactKey, expectedOrgId, fallbackName) {
    const localOrg = useOrgsStore.getState().orgs.find(org =>
      org.orgPubkey === orgContactKey || (!!expectedOrgId && org.orgId === expectedOrgId),
    );

    if (localOrg) {
      const preview: OrgPreview = {
        orgId: localOrg.orgId,
        orgName: localOrg.name || fallbackName || 'Unknown Organization',
        description: localOrg.description,
        avatarBlobId: localOrg.avatarBlobId,
        coverBlobId: localOrg.coverBlobId,
        orgContactKey: localOrg.orgPubkey ?? orgContactKey,
      };
      set(s => ({ previewsByOrgId: { ...s.previewsByOrgId, [preview.orgId]: preview } }));
      return preview;
    }

    if (looksLikeHexKey(orgContactKey)) {
      return null;
    }

    try {
      const resolved = await resolvePkarr(orgContactKey);
      if (!resolved || resolved.recordType !== 'org' || !resolved.orgId) {
        return null;
      }
      const preview: OrgPreview = {
        orgId: resolved.orgId,
        orgName: resolved.name || fallbackName || 'Unknown Organization',
        description: resolved.description ?? null,
        avatarBlobId: resolved.avatarBlobId ?? null,
        coverBlobId: resolved.coverBlobId ?? null,
        orgContactKey,
      };
      set(s => ({ previewsByOrgId: { ...s.previewsByOrgId, [preview.orgId]: preview } }));
      return preview;
    } catch {
      return null;
    }
  },
}));
