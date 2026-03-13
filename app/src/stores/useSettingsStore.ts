import { create } from 'zustand';
import * as Keychain from 'react-native-keychain';

const DND_SERVICE = 'gardens.dndEnabled';
const PUSH_SERVICE = 'gardens.pushEnabled';

interface SettingsState {
  dndEnabled: boolean;
  pushNotificationsEnabled: boolean;
  hydrated: boolean;
  loadSettings(): Promise<void>;
  setDnd(enabled: boolean): Promise<void>;
  setPushEnabled(enabled: boolean): Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  dndEnabled: false,
  pushNotificationsEnabled: true, // default true for existing users
  hydrated: false,

  async loadSettings() {
    try {
      const dndResult = await Keychain.getGenericPassword({ service: DND_SERVICE });
      const pushResult = await Keychain.getGenericPassword({ service: PUSH_SERVICE });
      set({
        dndEnabled: dndResult !== false && dndResult.password === 'true',
        // If no stored value, default to true (backwards compat)
        pushNotificationsEnabled: pushResult === false || pushResult.password === 'true',
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  async setDnd(enabled: boolean) {
    try {
      await Keychain.setGenericPassword('key', enabled ? 'true' : 'false', {
        service: DND_SERVICE,
      });
      set({ dndEnabled: enabled });
    } catch {
      // ignore storage errors
    }
  },

  async setPushEnabled(enabled: boolean) {
    try {
      await Keychain.setGenericPassword('key', enabled ? 'true' : 'false', {
        service: PUSH_SERVICE,
      });
      set({ pushNotificationsEnabled: enabled });
    } catch {
      // ignore storage errors
    }
  },
}));
