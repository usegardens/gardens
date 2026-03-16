import React, { useEffect, useState } from 'react';
import {
  Image,
  ImageStyle,
  StyleProp,
  View,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { getBlob, requestBlobFromPeer, isNetworkInitialized } from '../ffi/gardensCore';

interface Props {
  blobHash: string;
  style?: StyleProp<ImageStyle>;
  mimeType?: string; // defaults to 'image/jpeg'
  roomId?: string | null;
  peerPublicKey?: string | null;
  publicRelayUrl?: string | null; // fallback: fetch from relay public KV
}

type State = { status: 'loading' } | { status: 'ready'; uri: string } | { status: 'error' };

export function BlobImage({
  blobHash,
  style,
  mimeType = 'image/jpeg',
  roomId = null,
  peerPublicKey = null,
  publicRelayUrl = null,
}: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Check if native module is ready by checking network initialization
      try {
        const networkReady = await isNetworkInitialized();
        if (!networkReady) {
          setState({ status: 'error' });
          return;
        }
      } catch {
        setState({ status: 'error' });
        return;
      }

      try {
        // getBlob returns base64 string directly from native module
        const base64 = await getBlob(blobHash, roomId);
        if (cancelled) return;
        setState({ status: 'ready', uri: `data:${mimeType};base64,${base64}` });
        return;
      } catch {
        // fall through to peer fetch
      }

      if (peerPublicKey) {
        try {
          // requestBlobFromPeer returns base64 string directly
          const base64 = await requestBlobFromPeer(blobHash, peerPublicKey);
          if (!cancelled && base64) {
            setState({ status: 'ready', uri: `data:${mimeType};base64,${base64}` });
            return;
          }
        } catch {
          // fall through to relay
        }
      }

      if (publicRelayUrl) {
        try {
          const resp = await fetch(`${publicRelayUrl}/public-blob/${blobHash}`);
          if (!cancelled && resp.ok) {
            const buf = await resp.arrayBuffer();
            // Convert ArrayBuffer to base64 using React Native compatible method
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            // Simple base64 encoding for React Native
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            let base64 = '';
            for (let i = 0; i < binary.length; i += 3) {
              const b1 = binary.charCodeAt(i);
              const b2 = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
              const b3 = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
              base64 += chars[b1 >> 2];
              base64 += chars[((b1 & 3) << 4) | (b2 >> 4)];
              base64 += i + 1 < binary.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
              base64 += i + 2 < binary.length ? chars[b3 & 63] : '=';
            }
            const respMime = resp.headers.get('Content-Type') ?? mimeType;
            setState({ status: 'ready', uri: `data:${respMime};base64,${base64}` });
            return;
          }
        } catch {
          // fall through
        }
      }

      if (!cancelled) setState({ status: 'error' });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [blobHash, mimeType, roomId, peerPublicKey, publicRelayUrl]);

  if (state.status === 'loading') {
    return (
      <View style={[styles.placeholder, style as object]}>
        <ActivityIndicator color="#888" />
      </View>
    );
  }
  if (state.status === 'error') {
    return <View style={[styles.placeholder, style as object]} />;
  }
  return <Image source={{ uri: state.uri }} style={style} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
});
