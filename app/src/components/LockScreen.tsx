import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../stores/useAuthStore';

export function LockScreen() {
  const { unlockSession, isUnlocked } = useAuthStore();
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPrompting = isUnlocked === null;

  useEffect(() => {
    let cancelled = false;

    async function promptUnlock() {
      if (cancelled) return;
      await unlockSession();
      if (cancelled) return;

      if (!useAuthStore.getState().isUnlocked) {
        retryTimer.current = setTimeout(() => {
          promptUnlock().catch(() => {});
        }, 1200);
      }
    }

    promptUnlock().catch(() => {});

    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [unlockSession]);

  return (
    <View style={s.root}>
      <Text style={s.title}>Gardens</Text>
      <Text style={s.subtitle}>Restoring secure session…</Text>
      <ActivityIndicator color="#fff" style={s.spinner} />
      {!isPrompting && (
        <Text style={s.hint}>Loading your local account keys…</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#555', fontSize: 15, marginBottom: 24 },
  spinner: { marginBottom: 16 },
  hint: { color: '#777', fontSize: 13 },
});
