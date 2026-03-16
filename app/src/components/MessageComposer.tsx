import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Mic, SendHorizontal, Smile, X, VolumeX } from 'lucide-react-native';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetManager } from 'react-native-actions-sheet';
import { launchImageLibrary } from 'react-native-image-picker';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import { GifSearchModal } from './GifSearchModal';
import { BlobImage } from './BlobImage';
import { STANDARD_EMOJI_BY_CODE, STANDARD_EMOJI_CODES } from '../data/emoji';
import { initNetwork, isNetworkInitialized, uploadBlob } from '../ffi/gardensCore';

const INPUT_MIN_HEIGHT = 40;
const INPUT_MAX_HEIGHT = 132;
const RECORD_CANCEL_DISTANCE = 88;

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const len = base64.length;
  let padding = 0;
  if (base64[len - 2] === '=') padding = 2;
  else if (base64[len - 1] === '=') padding = 1;

  const bytesLen = (len * 3) / 4 - padding;
  const bytes = new Uint8Array(bytesLen);
  let src = 0;
  let dst = 0;

  while (src < len) {
    const a = lookup[base64.charCodeAt(src++)];
    const b = lookup[base64.charCodeAt(src++)];
    const c = lookup[base64.charCodeAt(src++)];
    const d = lookup[base64.charCodeAt(src++)];

    bytes[dst++] = (a << 2) | (b >> 4);
    if (dst < bytesLen) bytes[dst++] = ((b & 15) << 4) | (c >> 2);
    if (dst < bytesLen) bytes[dst++] = ((c & 3) << 6) | d;
  }

  return bytes;
}

function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

const audioRecorderPlayer = new AudioRecorderPlayer();

interface Props {
  roomId?: string | null;
  onSend: (text: string) => void;
  onSendBlob?: (blobId: string, mimeType: string, contentType: 'image' | 'video') => void;
  onSendAudio?: (blobId: string) => void;
  onSendGif?: (embedUrl: string) => void;
  placeholder?: string;
  replyingTo?: string | null;
  onCancelReply?: () => void;
  customEmojiCodes?: string[];
  customEmojis?: Record<string, { blobId: string; mimeType: string; roomId: string | null }>;
  mentionCandidates?: string[];
  channelCandidates?: string[];
  prefillText?: string | null;
  onPrefillApplied?: () => void;
  isMuted?: boolean;
  mutedUntil?: number;
}

export function MessageComposer({
  roomId = null,
  onSend,
  onSendBlob,
  onSendAudio,
  onSendGif,
  placeholder = 'Message...',
  replyingTo,
  onCancelReply,
  customEmojiCodes = [],
  customEmojis = {},
  mentionCandidates = [],
  channelCandidates = [],
  prefillText,
  onPrefillApplied,
  isMuted = false,
  mutedUntil,
}: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [trayOpen, setTrayOpen] = useState(false);
  const [gifVisible, setGifVisible] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingWillCancel, setRecordingWillCancel] = useState(false);
  const inputHeight = useRef(new Animated.Value(INPUT_MIN_HEIGHT)).current;
  const recordPathRef = useRef<string | null>(null);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const [shellWidth, setShellWidth] = useState(0);

  useEffect(() => {
    if (!recording) {
      setRecordingElapsedMs(0);
      return;
    }
    const id = setInterval(() => {
      if (recordStartedAtRef.current) {
        setRecordingElapsedMs(Date.now() - recordStartedAtRef.current);
      }
    }, 250);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (!prefillText) return;
    setText(prev => {
      if (!prev) return prefillText;
      return prev.endsWith(' ') ? `${prev}${prefillText}` : `${prev} ${prefillText}`;
    });
    onPrefillApplied?.();
  }, [prefillText, onPrefillApplied]);

  function resetInputHeight() {
    Animated.timing(inputHeight, {
      toValue: INPUT_MIN_HEIGHT,
      duration: 80,
      useNativeDriver: false,
    }).start();
  }

  function handleContentSizeChange(e: { nativeEvent: { contentSize: { height: number } } }) {
    const nextHeight = Math.min(Math.max(e.nativeEvent.contentSize.height, INPUT_MIN_HEIGHT), INPUT_MAX_HEIGHT);
    Animated.timing(inputHeight, {
      toValue: nextHeight,
      duration: 80,
      useNativeDriver: false,
    }).start();
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    resetInputHeight();
  }

  const ensureNetwork = useCallback(async () => {
    const ok = await isNetworkInitialized();
    if (!ok) await initNetwork(null);
  }, []);

  async function pickMedia() {
    try {
      await ensureNetwork();
      const result = await launchImageLibrary({
        mediaType: 'mixed',
        includeBase64: true,
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.8,
        selectionLimit: 10, // Allow multiple image/video selection
      });
      const assets = result.assets;
      if (!assets || assets.length === 0) return;

      // If multiple files selected, send as multi-image message
      if (assets.length > 1) {
        for (const asset of assets) {
          const isVideo = asset.type?.startsWith('video') ?? false;
          if (isVideo) continue; // Skip videos in multi-select
          
          const mimeType = asset.type ?? 'image/jpeg';
          let bytes: Uint8Array;
          if (asset.base64) {
            bytes = base64ToBytes(asset.base64);
          } else if (asset.uri) {
            const base64Data = await RNFS.readFile(asset.uri, 'base64');
            bytes = base64ToBytes(base64Data);
          } else {
            continue;
          }

          const blobId = await uploadBlob(bytes, mimeType, roomId);
          // For multi-image, we send each as separate image message
          onSendBlob?.(blobId, mimeType, 'image');
        }
        return;
      }

      // Single file - original behavior
      const asset = assets[0];
      const isVideo = asset.type?.startsWith('video') ?? false;
      const mimeType = asset.type ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      const contentType: 'image' | 'video' = isVideo ? 'video' : 'image';

      let bytes: Uint8Array;
      if (asset.base64) {
        bytes = base64ToBytes(asset.base64);
      } else if (asset.uri) {
        const base64Data = await RNFS.readFile(asset.uri, 'base64');
        bytes = base64ToBytes(base64Data);
      } else {
        throw new Error('No image data available');
      }

      const blobId = await uploadBlob(bytes, mimeType, roomId);
      onSendBlob?.(blobId, mimeType, contentType);
    } catch (err: any) {
      Alert.alert('Media failed', err?.message || 'Could not send media.');
    }
  }

  const beginRecording = useCallback(async () => {
    if (recordingRef.current) return;
    const filePath = `${RNFS.TemporaryDirectoryPath}/gardens-${Date.now()}.m4a`;
    recordPathRef.current = filePath;
    recordStartedAtRef.current = Date.now();
    recordingRef.current = true;
    setRecording(true);
    setRecordingWillCancel(false);
    setTrayOpen(false);
    try {
      await audioRecorderPlayer.startRecorder(filePath);
    } catch (err: any) {
      recordPathRef.current = null;
      recordStartedAtRef.current = null;
      recordingRef.current = false;
      setRecording(false);
      setRecordingWillCancel(false);
      Alert.alert('Voice note failed', err?.message || 'Could not access the microphone.');
    }
  }, []);

  function handleShellLayout(event: LayoutChangeEvent) {
    setShellWidth(event.nativeEvent.layout.width);
  }

  const finishRecording = useCallback(async (cancelled: boolean) => {
    if (!recordingRef.current) return;
    const startedAt = recordStartedAtRef.current;
    const path = recordPathRef.current;

    recordingRef.current = false;
    recordPathRef.current = null;
    recordStartedAtRef.current = null;
    setRecording(false);
    setRecordingWillCancel(false);

    try {
      const uri = await audioRecorderPlayer.stopRecorder();
      if (cancelled || !uri || !path || !startedAt) return;
      if (Date.now() - startedAt < 350) return;
      await ensureNetwork();
      const normalizedPath = path.startsWith('file://') ? path.slice(7) : path;
      const base64Data = await RNFS.readFile(normalizedPath, 'base64');
      const bytes = base64ToBytes(base64Data);
      const blobId = await uploadBlob(bytes, 'audio/m4a', roomId);
      onSendAudio?.(blobId);
    } catch (err: any) {
      Alert.alert('Voice note failed', err?.message || 'Could not send voice note.');
    } finally {
      if (path) {
        const normalizedPath = path.startsWith('file://') ? path.slice(7) : path;
        RNFS.unlink(normalizedPath).catch(() => {});
      }
    }
  }, [ensureNetwork, onSendAudio, roomId]);

  const micPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: event =>
          text.trim().length === 0 && shellWidth > 0 && event.nativeEvent.locationX >= shellWidth - 88,
        onMoveShouldSetPanResponder: event =>
          text.trim().length === 0 && shellWidth > 0 && event.nativeEvent.locationX >= shellWidth - 88,
        onPanResponderGrant: () => {
          beginRecording().catch(() => {});
        },
        onPanResponderMove: (_, gestureState) => {
          if (!recordingRef.current) return;
          const lift = Math.min(0, gestureState.dy);
          setRecordingWillCancel(lift <= -RECORD_CANCEL_DISTANCE);
        },
        onPanResponderRelease: async (_, gestureState) => {
          if (!recordingRef.current) return;
          const shouldCancel = gestureState.dy <= -RECORD_CANCEL_DISTANCE;
          if (shouldCancel) {
            await finishRecording(true);
            return;
          }
          await finishRecording(false);
        },
        onPanResponderTerminate: () => {
          finishRecording(true).catch(() => {});
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [beginRecording, finishRecording, shellWidth, text],
  );

  const showPtt = text.trim().length === 0;
  const emojiQueryMatch = text.match(/(^|\s)(:[a-zA-Z0-9_+-]{0,})$/);
  const emojiQuery = emojiQueryMatch?.[2] ?? '';
  const emojiSuggestions = emojiQuery
    ? (() => {
        const customMatches = customEmojiCodes.filter(code => code.startsWith(emojiQuery));
        const standardMatches = STANDARD_EMOJI_CODES.filter(code => code.startsWith(emojiQuery));
        const seen = new Set<string>();
        return [...customMatches, ...standardMatches]
          .filter(code => {
            if (seen.has(code)) return false;
            seen.add(code);
            return true;
          })
          .slice(0, 6);
      })()
    : [];

  const mentionQueryMatch = text.match(/(^|\s)@([a-zA-Z0-9_+-]*)$/);
  const mentionQuery = mentionQueryMatch?.[2] ?? '';
  const mentionSuggestions = mentionQueryMatch
    ? mentionCandidates.filter(name => name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6)
    : [];

  const channelQueryMatch = text.match(/(^|\s)#([a-zA-Z0-9_+-]*)$/);
  const channelQuery = channelQueryMatch?.[2] ?? '';
  const channelSuggestions = channelQueryMatch
    ? channelCandidates.filter(name => name.toLowerCase().startsWith(channelQuery.toLowerCase())).slice(0, 6)
    : [];

  function applyEmoji(code: string) {
    setText(prev => prev.replace(/(^|\s)(:[a-zA-Z0-9_+-]{0,})$/, `$1${code} `));
  }

  function applyMention(username: string) {
    setText(prev => prev.replace(/(^|\s)@([a-zA-Z0-9_+-]*)$/, `$1@${username} `));
  }

  function applyChannel(name: string) {
    setText(prev => prev.replace(/(^|\s)#([a-zA-Z0-9_+-]*)$/, `$1#${name} `));
  }

  function insertEmoji(value: string) {
    if (emojiQueryMatch && value.startsWith(':') && value.endsWith(':')) {
      applyEmoji(value);
      return;
    }
    setText(prev => (prev ? `${prev}${value} ` : `${value} `));
  }

  function openEmojiPicker() {
    SheetManager.show('emoji-picker-sheet', {
      payload: {
        customEmojis,
        onSelect: insertEmoji,
      },
    });
  }

  const composerBottomPadding = 10 + Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);
  const recordingHint = recordingWillCancel
    ? 'Release to cancel'
    : 'Swipe up to cancel • Release to send';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'position'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 12}
    >
      {replyingTo && (
        <View style={styles.replyBar}>
          <Text style={styles.replyText}>Replying to message...</Text>
          {onCancelReply && (
            <TouchableOpacity onPress={onCancelReply}>
              <X size={16} color="#c8b49f" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {trayOpen && !recording && (
        <View style={styles.utilityTray}>
          <TouchableOpacity style={styles.utilityTile} onPress={() => { setTrayOpen(false); pickMedia().catch(() => {}); }}>
              <View style={[styles.utilityIcon, styles.utilityCamera]}>
                <Camera size={18} color="#fff" />
              </View>
              <Text style={styles.utilityLabel}>Photo & Video</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.utilityTile} onPress={() => { setTrayOpen(false); setGifVisible(true); }}>
            <View style={[styles.utilityIcon, styles.utilityGif]}>
              <Text style={styles.utilityGifText}>GIF</Text>
            </View>
            <Text style={styles.utilityLabel}>GIF</Text>
          </TouchableOpacity>
        </View>
      )}

      {emojiSuggestions.length > 0 && (
        <View style={styles.suggestionRow}>
          {emojiSuggestions.map(code => (
            <TouchableOpacity key={code} style={styles.suggestionChip} onPress={() => applyEmoji(code)}>
              {customEmojis[code] ? (
                <>
                  <BlobImage
                    blobHash={customEmojis[code].blobId}
                    mimeType={customEmojis[code].mimeType}
                    roomId={customEmojis[code].roomId}
                    style={styles.customEmojiPreview}
                  />
                  <Text style={styles.suggestionText}>{code}</Text>
                </>
              ) : (
                <Text style={styles.suggestionText}>
                  {STANDARD_EMOJI_BY_CODE[code] ? `${STANDARD_EMOJI_BY_CODE[code]} ${code}` : code}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {mentionSuggestions.length > 0 && (
        <View style={styles.suggestionRow}>
          {mentionSuggestions.map(name => (
            <TouchableOpacity key={name} style={styles.suggestionChip} onPress={() => applyMention(name)}>
              <Text style={styles.suggestionText}>@{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {channelSuggestions.length > 0 && (
        <View style={styles.suggestionRow}>
          {channelSuggestions.map(name => (
            <TouchableOpacity key={name} style={styles.suggestionChip} onPress={() => applyChannel(name)}>
              <Text style={styles.suggestionText}>#{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View
        style={[styles.shell, { paddingBottom: composerBottomPadding }]}
        onLayout={handleShellLayout}
        {...(showPtt || recording ? micPanResponder.panHandlers : {})}
      >
        {recording ? (
          <View style={styles.recordingBar}>
            <View style={styles.recordingStatus}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>{formatElapsed(recordingElapsedMs)}</Text>
            </View>
            <View style={styles.recordingBody}>
              <Text style={styles.recordingHint}>{recordingHint}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.composerRow}>
            <TouchableOpacity style={[styles.circleBtn, trayOpen && styles.circleBtnActive]} onPress={() => setTrayOpen(v => !v)}>
              <Text style={styles.plusText}>{trayOpen ? '×' : '+'}</Text>
            </TouchableOpacity>

            <View style={styles.inputShell}>
              <TouchableOpacity style={styles.inputIconBtn} onPress={openEmojiPicker}>
                <Smile size={18} color="#dbc3a8" />
              </TouchableOpacity>
              <Animated.View style={[styles.inputWrap, { minHeight: inputHeight }]}>
                <TextInput
                  style={styles.input}
                  placeholder={placeholder}
                  placeholderTextColor="#8d7763"
                  value={text}
                  onChangeText={setText}
                  onContentSizeChange={handleContentSizeChange}
                  multiline
                  maxLength={4000}
                  returnKeyType="default"
                  scrollEnabled
                />
              </Animated.View>
            </View>

            {showPtt ? (
              <View>
                <View style={[styles.micBtn, recording && styles.micBtnActive]}>
                  <Mic size={18} color="#2e2014" />
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
                <SendHorizontal size={18} color="#2e2014" />
              </TouchableOpacity>
            )}
          </View>
        )}
        
        {/* Muted overlay - blocks input when user is muted */}
        {isMuted && (
          <View style={styles.mutedOverlay}>
            <VolumeX size={18} color="#f59e0b" />
            <Text style={styles.mutedText}>
              {mutedUntil 
                ? `Muted until ${new Date(mutedUntil / 1000).toLocaleTimeString()}`
                : 'You are muted'}
            </Text>
          </View>
        )}
      </View>

      <GifSearchModal
        visible={gifVisible}
        onSelect={(url) => {
          onSendGif?.(url);
          setGifVisible(false);
        }}
        onClose={() => setGifVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#17130f',
    borderTopWidth: 1,
    borderTopColor: '#2f261e',
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1d1711',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: '#33281f',
  },
  replyText: { color: '#c8b49f', fontSize: 13, fontWeight: '500' },
  utilityTray: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1a140f',
    borderTopWidth: 1,
    borderTopColor: '#2f261e',
  },
  utilityTile: { alignItems: 'center', gap: 8 },
  utilityIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityCamera: { backgroundColor: '#b89269' },
  utilityGif: { backgroundColor: '#8f6f51' },
  utilityGifText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  utilityLabel: { color: '#c8b49f', fontSize: 12, fontWeight: '600' },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: '#17130f',
    borderTopWidth: 1,
    borderTopColor: '#2f261e',
  },
  suggestionChip: {
    backgroundColor: '#2a2119',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestionText: { color: '#f2e8dc', fontSize: 12, fontWeight: '600' },
  customEmojiPreview: { width: 16, height: 16, borderRadius: 4 },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2a2119',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  circleBtnActive: { backgroundColor: '#3a2d21' },
  plusText: { color: '#f1dfca', fontSize: 24, lineHeight: 24, fontWeight: '300' },
  inputShell: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#251d16',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  inputIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  inputWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  input: {
    color: '#f5ede4',
    fontSize: 16,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    maxHeight: INPUT_MAX_HEIGHT,
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#d7b28d',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  micBtnActive: { backgroundColor: '#bf5b4a' },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#d7b28d',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  mutedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 19, 15, 0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 22,
    margin: 4,
  },
  mutedText: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '600',
  },
  recordingBar: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: '#251d16',
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 66,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#bf5b4a',
  },
  recordingTime: {
    color: '#f5ede4',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  recordingBody: { flex: 1 },
  recordingHint: { color: '#c8b49f', fontSize: 13, fontWeight: '500' },
});
