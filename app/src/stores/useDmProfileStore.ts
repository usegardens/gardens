import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'gardens.dm_profile:';
const PROFILE_SENT_PREFIX = 'gardens.profile_sent:';

export interface DmProfile {
  publicKey: string;
  username: string;
  avatarBlobId: string | null;
  cachedAt: number;
}

export async function getDmProfile(publicKey: string): Promise<DmProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + publicKey);
    if (!raw) return null;
    return JSON.parse(raw) as DmProfile;
  } catch {
    return null;
  }
}

export async function setDmProfile(profile: Omit<DmProfile, 'cachedAt'>): Promise<void> {
  try {
    const entry: DmProfile = { ...profile, cachedAt: Date.now() };
    await AsyncStorage.setItem(KEY_PREFIX + profile.publicKey, JSON.stringify(entry));
  } catch {
    // non-critical — silently fail
  }
}

export async function hasProfileBeenSent(threadId: string): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(PROFILE_SENT_PREFIX + threadId);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function markProfileSent(threadId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_SENT_PREFIX + threadId, 'true');
  } catch {}
}

export async function hasProfilePayloadBeenSent(threadId: string, payload: string): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(PROFILE_SENT_PREFIX + threadId);
    return val === payload;
  } catch {
    return false;
  }
}

export async function markProfilePayloadSent(threadId: string, payload: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_SENT_PREFIX + threadId, payload);
  } catch {}
}
