import { create } from 'zustand';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMyProfile,
  getProfile,
  getBlob,
  getPkarrUrl,
  resolvePkarr,
  createOrUpdateProfile as dcCreateOrUpdateProfile,
  type Profile,
} from '../ffi/gardensCore';
import { getDmProfile } from './useDmProfileStore';
import { useAuthStore } from './useAuthStore';
import { broadcastOp } from './useSyncStore';

export type { Profile };

export const DEFAULT_RELAY_URL = 'https://relay.usegardens.com';
export const PROFILE_SLUG_DOMAIN = 'usegardens.com';

export async function uploadBlobToRelay(
  blobBytes: Uint8Array,
  blobId: string,
  mimeType: string,
  relayBaseUrl: string,
): Promise<void> {
  const resp = await fetch(`${relayBaseUrl}/public-blob/${blobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blobBytes,
  });
  if (!resp.ok && resp.status !== 409) {
    throw new Error(`Failed to upload blob to relay: ${resp.status}`);
  }
}

export async function getRelayZ32(relayBaseUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(`${relayBaseUrl}/pubkey`);
    if (!resp.ok) return null;
    const pubkeyHex = (await resp.text()).trim();
    const pkarrUrl = getPkarrUrl(pubkeyHex); // returns "pk:<z32>"
    return pkarrUrl.replace('pk:', '');
  } catch {
    return null;
  }
}

const PROFILE_PIC_SERVICE  = 'gardens.profilePicUri';
const LOCAL_USERNAME_SERVICE = 'gardens.localUsername';
const SLUG_STORAGE_KEY = '@gardens/profile_slug';
const SLUG_URL_STORAGE_KEY = '@gardens/profile_slug_url';

interface ProfileState {
  myProfile: Profile | null;
  profileCache: Record<string, Profile>;
  profilePicUri: string | null;
  /** Locally persisted username — set at signup, used as fallback if myProfile is null. */
  localUsername: string | null;
  /** Claimed profile slug for {slug}.usegardens.com links */
  profileSlug: string | null;
  /** Full URL for the profile slug */
  profileSlugUrl: string | null;

  fetchMyProfile(): Promise<void>;
  fetchProfile(publicKey: string): Promise<Profile | null>;
  createOrUpdateProfile(username: string, bio: string | null, availableFor: string[], isPublic?: boolean, avatarBlobId?: string | null, emailEnabled?: boolean): Promise<void>;
  setProfilePicUri(uri: string | null): Promise<void>;
  loadProfilePicUri(): Promise<void>;
  setLocalUsername(name: string): Promise<void>;
  loadLocalUsername(): Promise<void>;
  setProfileSlug(slug: string | null, url: string | null): Promise<void>;
  loadProfileSlug(): Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  myProfile: null,
  profileCache: {},
  profilePicUri: null,
  localUsername: null,
  profileSlug: null,
  profileSlugUrl: null,

  async fetchMyProfile() {
    const profile = await getMyProfile();
    if (profile) {
      set(s => ({ myProfile: profile, profileCache: { ...s.profileCache, [profile.publicKey]: profile } }));
      return;
    }

    const myKey = useAuthStore.getState().keypair?.publicKeyHex;
    if (!myKey) return;

    const dmProfile = await getDmProfile(myKey);
    if (dmProfile?.username?.trim()) {
      const restoredFromDm: Profile = {
        publicKey: myKey,
        username: dmProfile.username.trim(),
        avatarBlobId: dmProfile.avatarBlobId ?? null,
        bio: null,
        availableFor: [],
        isPublic: false,
        createdAt: dmProfile.cachedAt,
        updatedAt: dmProfile.cachedAt,
      };
      set(s => ({ myProfile: restoredFromDm, profileCache: { ...s.profileCache, [myKey]: restoredFromDm } }));
      return;
    }

    // Last resort: restore from public pkarr profile if available.
    try {
      const pkarrUrl = getPkarrUrl(myKey);
      const z32 = pkarrUrl.startsWith('pk:') ? pkarrUrl.slice(3) : pkarrUrl;
      const resolved = await resolvePkarr(z32);
      if (!resolved?.username?.trim()) return;
      const restoredFromPkarr: Profile = {
        publicKey: myKey,
        username: resolved.username.trim(),
        avatarBlobId: resolved.avatarBlobId ?? null,
        bio: resolved.bio ?? null,
        availableFor: [],
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      set(s => ({ myProfile: restoredFromPkarr, profileCache: { ...s.profileCache, [myKey]: restoredFromPkarr } }));
    } catch {
      // no-op
    }
  },

  async fetchProfile(publicKey: string) {
    // 1. In-memory cache
    const cached = get().profileCache[publicKey];
    if (cached) return cached;

    // 2. AsyncStorage KV (profiles exchanged via DM channel)
    const dm = await getDmProfile(publicKey);
    if (dm) {
      const profile: Profile = {
        publicKey: dm.publicKey,
        username: dm.username,
        avatarBlobId: dm.avatarBlobId,
        bio: null,
        availableFor: [],
        isPublic: false,
        createdAt: dm.cachedAt,
        updatedAt: dm.cachedAt,
      };
      set(s => ({ profileCache: { ...s.profileCache, [publicKey]: profile } }));
      return profile;
    }

    // 3. Native local store (org members, previously synced profiles)
    const profile = await getProfile(publicKey);
    if (profile) {
      set(s => ({ profileCache: { ...s.profileCache, [publicKey]: profile } }));
      return profile;
    }

    // 4. pkarr network resolution (public profiles only)
    try {
      // getPkarrUrl can throw synchronously if the native module is unavailable —
      // the surrounding try/catch covers both this and the async resolvePkarr call.
      const pkarrUrl = getPkarrUrl(publicKey); // returns "pk:<z32>"
      const z32 = pkarrUrl.startsWith('pk:') ? pkarrUrl.slice(3) : pkarrUrl;
      const resolved = await resolvePkarr(z32);
      if (resolved?.username) {
        const p: Profile = {
          publicKey,
          username: resolved.username,
          avatarBlobId: resolved.avatarBlobId ?? null,
          bio: resolved.bio ?? null,
          availableFor: [],
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set(s => ({ profileCache: { ...s.profileCache, [publicKey]: p } }));
        return p;
      }
    } catch {
      // pkarr unavailable or no public profile — not an error
    }

    return null;
  },

  async createOrUpdateProfile(username, bio, availableFor, isPublic = false, avatarBlobId = null, emailEnabled = false) {
    if (isPublic) {
      const blobToUpload = avatarBlobId ?? get().myProfile?.avatarBlobId ?? null;
      if (blobToUpload) {
        try {
          const bytes = await getBlob(blobToUpload, null);
          await uploadBlobToRelay(bytes, blobToUpload, 'application/octet-stream', DEFAULT_RELAY_URL);
        } catch (e) {
          console.warn('[relay] Failed to upload avatar to relay:', e);
        }
      }
    }
    const result = await dcCreateOrUpdateProfile(username, bio, availableFor, isPublic, avatarBlobId, emailEnabled);
    // Broadcast the profile operation to sync with other peers
    if (result.opBytes?.length) {
      // Profile ops are broadcast to the user's own topic for sync
      const myKey = useAuthStore.getState().keypair?.publicKeyHex;
      if (myKey) {
        broadcastOp(myKey, result.opBytes);
      }
    }
    await get().fetchMyProfile();
  },

  async setProfilePicUri(uri: string | null) {
    if (uri) {
      await Keychain.setGenericPassword('key', uri, { service: PROFILE_PIC_SERVICE });
    } else {
      await Keychain.resetGenericPassword({ service: PROFILE_PIC_SERVICE });
    }
    set({ profilePicUri: uri });
  },

  async loadProfilePicUri() {
    try {
      const result = await Keychain.getGenericPassword({ service: PROFILE_PIC_SERVICE });
      if (result) set({ profilePicUri: result.password });
    } catch {}
  },

  async setLocalUsername(name: string) {
    await Keychain.setGenericPassword('key', name, { service: LOCAL_USERNAME_SERVICE });
    set({ localUsername: name });
  },

  async loadLocalUsername() {
    try {
      const result = await Keychain.getGenericPassword({ service: LOCAL_USERNAME_SERVICE });
      if (result) set({ localUsername: result.password });
    } catch {}
  },

  async setProfileSlug(slug: string | null, url: string | null) {
    try {
      if (slug && url) {
        await AsyncStorage.setItem(SLUG_STORAGE_KEY, slug);
        await AsyncStorage.setItem(SLUG_URL_STORAGE_KEY, url);
      } else {
        await AsyncStorage.removeItem(SLUG_STORAGE_KEY);
        await AsyncStorage.removeItem(SLUG_URL_STORAGE_KEY);
      }
      set({ profileSlug: slug, profileSlugUrl: url });
    } catch (err) {
      console.warn('[profile] Failed to store slug:', err);
    }
  },

  async loadProfileSlug() {
    try {
      const [slug, url] = await Promise.all([
        AsyncStorage.getItem(SLUG_STORAGE_KEY),
        AsyncStorage.getItem(SLUG_URL_STORAGE_KEY),
      ]);
      set({ profileSlug: slug, profileSlugUrl: url });
    } catch {}
  },
}));
