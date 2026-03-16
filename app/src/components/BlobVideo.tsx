import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleProp,
  ViewStyle,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import Video, { ResizeMode } from 'react-native-video';
import Play from 'lucide-react-native/dist/esm/icons/play.js';
import Download from 'lucide-react-native/dist/esm/icons/download.js';
import CircleAlert from 'lucide-react-native/dist/esm/icons/circle-alert.js';
import { 
  hasBlob, 
  getBlob,
} from '../ffi/gardensCore';
import RNFS from 'react-native-fs';

interface Props {
  blobHash: string;
  topicHex: string;  // Room/thread ID for peer discovery
  style?: StyleProp<ViewStyle>;
}

type VideoState = 
  | { type: 'checking' }  // Checking local storage and DO
  | { type: 'available'; localPath: string }  // Available locally
  | { type: 'downloading'; progress: number }  // P2P download in progress
  | { type: 'unavailable'; reason: string }  // No holders found
  | { type: 'error'; message: string };  // Error occurred

/**
 * BlobVideo - Video player that fetches via P2P using core peer discovery.
 * 
 * Flow:
 * 1. Check if blob exists locally
 * 2. If not, query DO for holders
 * 3. If holders exist, P2P request from one
 * 4. Save to temp file and play
 */
export function BlobVideo({ blobHash, topicHex, style }: Props) {
  const [state, setState] = useState<VideoState>({ type: 'checking' });
  const [isPlaying, _setIsPlaying] = useState(false);

  const checkAndFetchBlob = useCallback(async () => {
    // Try to load the blob directly - if network isn't ready, it'll fail with a proper error
    // Don't block on isNetworkInitialized check as it may return false initially

    setState({ type: 'checking' });

    try {
      // Step 1: Check if we already have the blob locally
      // Note: hasBlob might throw if blob subsystem isn't properly initialized
      let hasLocally = false;
      try {
        hasLocally = await hasBlob(blobHash);
      } catch (blobErr) {
        // If blob functions fail, log but continue (don't treat as fatal error for videos)
        // Images work fine, so if hasBlob fails it might be a temporary issue
        console.log('BlobVideo: hasBlob failed, continuing to fetch:', blobErr);
        hasLocally = false;
      }
      if (hasLocally) {
        // getBlob returns base64 string directly from native module
        try {
          const base64Data = await getBlob(blobHash, topicHex);
          const tempPath = `${RNFS.TemporaryDirectoryPath}/${blobHash}.mp4`;
          await RNFS.writeFile(tempPath, base64Data, 'base64');
          setState({ type: 'available', localPath: tempPath });
          return;
        } catch (getErr) {
          console.log('BlobVideo: getBlob failed, trying P2P fetch:', getErr);
          // Continue to try P2P fetch
        }
      }

      // Step 2: Attempt P2P fetch via core (iroh-blobs)
      setState({ type: 'downloading', progress: 0 });
      // getBlob returns base64 string directly from native module
      try {
        const base64Data = await getBlob(blobHash, topicHex);
        const tempPath = `${RNFS.TemporaryDirectoryPath}/${blobHash}.mp4`;
        await RNFS.writeFile(tempPath, base64Data, 'base64');
        setState({ type: 'available', localPath: tempPath });
      } catch (error) {
        console.error('BlobVideo error:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        
        // Check if native module is not loaded
        if (errMsg.includes('not loaded') || errMsg.includes('not initialized')) {
          setState({ type: 'error', message: 'Video service not available' });
          return;
        }
        
        if (errMsg.includes('Undefined is not a function') || errMsg.includes('undefined is not a function')) {
          setState({ type: 'error', message: 'Native module not properly initialized' });
          return;
        }
        
        const msg = String(error);
        if (msg.includes('NotFound') || msg.includes('not found')) {
          setState({ type: 'unavailable', reason: 'No peers have this video' });
        } else {
          setState({ type: 'error', message: msg });
        }
      }
    } catch (outerError) {
      // Outer try-catch for any unexpected errors
      console.error('BlobVideo unexpected error:', outerError);
      setState({ type: 'error', message: 'Video service failed' });
    }
  }, [blobHash, topicHex]);

  useEffect(() => {
    checkAndFetchBlob();
  }, [checkAndFetchBlob]);

  const renderContent = () => {
    switch (state.type) {
      case 'checking':
        return (
          <View style={styles.centerContent}>
            <Play size={32} color="#666" />
            <Text style={styles.statusText}>Checking availability...</Text>
          </View>
        );

      case 'unavailable':
        return (
          <View style={styles.centerContent}>
            <CircleAlert size={32} color="#666" />
            <Text style={styles.statusText}>{state.reason}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={checkAndFetchBlob}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        );

      case 'downloading':
        return (
          <View style={styles.centerContent}>
            <Download size={32} color="#f97316" />
            <Text style={styles.statusText}>Downloading via P2P...</Text>
          </View>
        );

      case 'error':
        return (
          <View style={styles.centerContent}>
            <CircleAlert size={32} color="#ef4444" />
            <Text style={[styles.statusText, styles.errorText]}>{state.message}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={checkAndFetchBlob}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        );

      case 'available':
        return (
          <Video
            source={{ uri: state.localPath }}
            style={styles.video}
            controls={true}
            resizeMode={ResizeMode.CONTAIN}
            paused={!isPlaying}
            onError={(e) => {
              console.error('Video playback error:', e);
              setState({ type: 'error', message: 'Playback failed' });
            }}
          />
        );
    }
  };

  return (
    <View style={[styles.container, style]}>
      {renderContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    overflow: 'hidden',
    height: 220,
    width: '100%',
  },
  video: {
    width: '100%',
    height: 220,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 220,
    padding: 16,
  },
  statusText: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
  errorText: {
    color: '#ef4444',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
  },
  retryText: {
    color: '#f97316',
    fontSize: 14,
    fontWeight: '600',
  },
});
