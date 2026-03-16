/**
 * Auth store — owns keypair lifecycle and unlock state.
 *
 * Storage contract
 * ----------------
 * - Private key seed: stored in iOS Keychain / Android Keystore under the
 *   service key `gardens.privateKey`, protected by device secure storage.
 * - Public key + mnemonic: stored under `gardens.publicKey` / `gardens.mnemonic`
 *   without additional auth guard (they are not secrets).
 */

import { create } from 'zustand';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateKeypair, importFromMnemonic, initCore, initNetwork, type KeyPair } from '../ffi/gardensCore';

const KEYCHAIN_SERVICE = 'gardens.privateKey';
const PUBKEY_SERVICE   = 'gardens.publicKey';
const MNEMONIC_SERVICE = 'gardens.mnemonic';
const HAS_ACCOUNT_KEY  = 'gardens.hasAccount';
const INIT_TIMEOUT_MS = 12000;

interface AuthState {
  keypair: KeyPair | null;
  isUnlocked: boolean | null;
  hasStoredKey: boolean;

  /** Generate a new keypair, persist to Keychain, mark unlocked. */
  createAccount(): Promise<KeyPair>;

  /** Re-derive from 24 words, persist, mark unlocked. */
  importAccount(words: string[]): Promise<KeyPair>;

  /** Restore keypair from Keychain and mark unlocked. */
  unlockSession(): Promise<boolean>;

  /** Lock the session (keypair stays in Keychain; clears in-memory copy). */
  lock(): void;

  /**
   * Reads AsyncStorage to determine if an account exists without
   * triggering any secure-auth prompt. Call once on app start.
   */
  checkHasStoredKey(): Promise<void>;

  /** Clear local auth state after deleting account data. */
  clearAccountState(): Promise<void>;
}

async function persistKeypair(kp: KeyPair): Promise<void> {
  await Keychain.setGenericPassword('key', kp.privateKeyHex, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  });
  await Keychain.setGenericPassword('key', kp.publicKeyHex, {
    service: PUBKEY_SERVICE,
  });
  await Keychain.setGenericPassword('key', kp.mnemonic, {
    service: MNEMONIC_SERVICE,
  });
}

let unlockInFlight = false;

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  keypair: null,
  isUnlocked: null,
  hasStoredKey: false,

  async checkHasStoredKey() {
    const val = await AsyncStorage.getItem(HAS_ACCOUNT_KEY);
    const hasStoredKey = val === 'true';
    set(state => ({
      hasStoredKey,
      isUnlocked: state.isUnlocked === null ? false : state.isUnlocked,
    }));
  },

  async createAccount() {
    const kp = await generateKeypair();
    await persistKeypair(kp);
    await AsyncStorage.setItem(HAS_ACCOUNT_KEY, 'true');
    try {
      await initCore(kp.privateKeyHex);
      await initNetwork(null);
    } catch (err) {
      console.error('[auth] Failed to initialize core/network:', err);
      throw err;
    }
    set({ keypair: kp, isUnlocked: true, hasStoredKey: true });
    return kp;
  },

  async importAccount(words: string[]) {
    const kp = await importFromMnemonic(words);
    await persistKeypair(kp);
    await AsyncStorage.setItem(HAS_ACCOUNT_KEY, 'true');
    try {
      await initCore(kp.privateKeyHex);
      await initNetwork(null);
    } catch (err) {
      console.error('[auth] Failed to initialize core/network:', err);
      throw err;
    }
    set({ keypair: kp, isUnlocked: true, hasStoredKey: true });
    return kp;
  },

  async unlockSession() {
    if (unlockInFlight) return false;
    unlockInFlight = true;
    try {
      const result = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
      if (!result) {
        // AsyncStorage can drift from Keychain; recover cleanly instead of retry-looping forever.
        await AsyncStorage.removeItem(HAS_ACCOUNT_KEY);
        set({ keypair: null, isUnlocked: false, hasStoredKey: false });
        return false;
      }

      const pubResult = await Keychain.getGenericPassword({ service: PUBKEY_SERVICE });
      const mnResult  = await Keychain.getGenericPassword({ service: MNEMONIC_SERVICE });

      const kp: KeyPair = {
        privateKeyHex: result.password,
        publicKeyHex:  pubResult ? pubResult.password : '',
        mnemonic:      mnResult  ? mnResult.password  : '',
      };
      await withTimeout(initCore(kp.privateKeyHex), INIT_TIMEOUT_MS, 'Unlock initialization timed out.');
      await withTimeout(initNetwork(null), INIT_TIMEOUT_MS, 'Network initialization timed out.');
      set({ keypair: kp, isUnlocked: true });
      return true;
    } catch (err) {
      console.warn('[auth] unlockSession failed:', err);
      set({ isUnlocked: false });
      return false;
    } finally {
      unlockInFlight = false;
    }
  },

  lock() {
    set({ keypair: null, isUnlocked: false });
  },

  async clearAccountState() {
    await AsyncStorage.removeItem(HAS_ACCOUNT_KEY);
    set({ keypair: null, isUnlocked: false, hasStoredKey: false });
  },
}));
