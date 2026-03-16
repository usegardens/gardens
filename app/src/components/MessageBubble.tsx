import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import type { Message } from '../stores/useMessagesStore';
import { BlobImage } from './BlobImage';
import { BlobVideo } from './BlobVideo';
import { getBlob } from '../ffi/gardensCore';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { LinkPreviewCard, extractUrls } from './LinkPreview';

// Base64 encode without btoa (React Native compatible)
function base64Encode(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b3 & 63] : '=';
  }
  return result;
}

interface Props {
  message: Message;
  isOwnMessage: boolean;
  avatarBlobId?: string | null;
  onReply?: () => void;
  onReact?: () => void;
  onLongPress?: () => void;
}

const AVATAR_COLORS = ['#c084fc', '#f472b6', '#fb923c', '#34d399', '#60a5fa', '#a78bfa', '#f87171'];
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function AudioMessage({ blobHash, roomId }: { blobHash: string; roomId: string | null }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const playerRef = React.useRef<AudioRecorderPlayer | null>(null);

  async function toggle() {
    if (playing) {
      await playerRef.current?.stopPlayer();
      playerRef.current?.removePlayBackListener();
      setPlaying(false);
    } else {
      try {
        const bytes = await getBlob(blobHash, roomId);
        const base64 = base64Encode(bytes);
        const uri = `data:audio/m4a;base64,${base64}`;
        const player = new AudioRecorderPlayer();
        playerRef.current = player;
        player.addPlayBackListener((e) => {
          setProgress(e.currentPosition);
          setDuration(e.duration);
          if (e.isFinished) {
            setPlaying(false);
            setProgress(0);
            player.stopPlayer();
            player.removePlayBackListener();
          }
        });
        await player.startPlayer(uri);
        setPlaying(true);
      } catch {
        // silently fail
      }
    }
  }

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <TouchableOpacity style={styles.audioBtn} onPress={toggle}>
      <View style={styles.audioPlayer}>
        <View style={styles.playButton}>
          <Text style={styles.audioBtnText}>{playing ? '⏸' : '▶'}</Text>
        </View>
        <View style={styles.waveformContainer}>
          <View style={styles.waveform}>
            {[...Array(20)].map((_, i) => (
              <View
                key={i}
                style={[
                  styles.waveformBar,
                  { height: 8 + ((i * 7) % 16) },
                  i / 20 * 100 <= progressPercent && styles.waveformBarActive,
                ]}
              />
            ))}
          </View>
          <Text style={styles.audioLabel}>
            {playing ? `${Math.floor(progress / 1000)}s` : 'Voice message'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function MessageBubble({ message, isOwnMessage, avatarBlobId, onReply, onLongPress }: Props) {
  if (message.isDeleted) {
    return (
      <View style={[styles.container, isOwnMessage && styles.containerOwn]}>
        <View style={[styles.bubble, styles.bubbleDeleted]}>
          <Text style={styles.deletedText}>Message deleted</Text>
        </View>
      </View>
    );
  }

  const initials = message.authorKey.slice(0, 2).toUpperCase();
  const color = avatarColor(message.authorKey);

  return (
    <TouchableOpacity
      style={[styles.container, isOwnMessage && styles.containerOwn]}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      {!isOwnMessage && (
        <Text style={styles.author}>{message.authorKey.slice(0, 8)}...</Text>
      )}

      <View style={[styles.row, isOwnMessage && styles.rowOwn]}>
        {avatarBlobId ? (
          <BlobImage blobHash={avatarBlobId} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}

        <View style={[styles.bubble, isOwnMessage ? styles.bubbleOwn : styles.bubbleOther]}>
          {message.replyTo && (
            <View style={styles.replyBar}>
              <Text style={styles.replyText}>↩ Reply</Text>
            </View>
          )}

          {message.contentType === 'text' && message.textContent && (
            <>
              <Text style={[styles.text, isOwnMessage && styles.textOwn]}>
                {message.textContent}
              </Text>
              {extractUrls(message.textContent).slice(0, 1).map((url) => (
                <LinkPreviewCard key={url} url={url} />
              ))}
            </>
          )}

          {message.contentType === 'image' && message.blobId && (
            <BlobImage
              blobHash={message.blobId}
              roomId={message.roomId ?? message.dmThreadId ?? null}
              peerPublicKey={message.authorKey}
              style={styles.mediaBlobImage}
            />
          )}

          {message.contentType === 'audio' && message.blobId && (
            <AudioMessage blobHash={message.blobId} roomId={message.roomId ?? message.dmThreadId ?? null} />
          )}

          {message.contentType === 'gif' && message.embedUrl && (
            <Image
              source={{ uri: message.embedUrl }}
              style={styles.mediaBlobImage}
              resizeMode="cover"
            />
          )}

          {message.contentType === 'video' && message.blobId && message.roomId && (
            <BlobVideo blobHash={message.blobId} topicHex={message.roomId} style={styles.mediaBlobImage} />
          )}

          <View style={styles.footer}>
            <Text style={[styles.timestamp, isOwnMessage && styles.timestampOwn]}>
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {message.editedAt && (
              <Text style={[styles.edited, isOwnMessage && styles.editedOwn]}> (edited)</Text>
            )}
          </View>
        </View>

        {onReply && (
          <TouchableOpacity style={styles.replyBtn} onPress={onReply}>
            <Text style={styles.replyBtnText}>↩</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12, paddingHorizontal: 16, alignItems: 'flex-start' },
  containerOwn: { alignItems: 'flex-end' },
  author: { color: '#888', fontSize: 11, marginBottom: 4, marginLeft: 36 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowOwn: { flexDirection: 'row-reverse' },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  bubble: { maxWidth: '75%', borderRadius: 16, padding: 12 },
  bubbleOther: { backgroundColor: '#1a1a1a' },
  bubbleOwn: { backgroundColor: '#3b82f6' },
  bubbleDeleted: { backgroundColor: '#374151', opacity: 0.6 },
  replyBar: { borderLeftWidth: 3, borderLeftColor: '#888', paddingLeft: 8, marginBottom: 6 },
  replyText: { color: '#888', fontSize: 12 },
  text: { color: '#fff', fontSize: 15, lineHeight: 20 },
  textOwn: { color: '#fff' },
  deletedText: { color: '#888', fontSize: 14, fontStyle: 'italic' },
  mediaPlaceholder: { padding: 8, alignItems: 'center' },
  mediaText: { color: '#fff', fontSize: 14 },
  footer: { flexDirection: 'row', marginTop: 4, alignItems: 'center' },
  timestamp: { color: '#888', fontSize: 11 },
  timestampOwn: { color: '#dbeafe' },
  edited: { color: '#888', fontSize: 10, fontStyle: 'italic' },
  editedOwn: { color: '#dbeafe' },
  replyBtn: {
    marginLeft: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBtnText: { color: '#fff', fontSize: 16 },
  mediaBlobImage: { width: '100%', minHeight: 160, borderRadius: 8 },
  audioBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  audioPlayer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center' },
  waveformContainer: { flex: 1, gap: 4 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 },
  waveformBar: { width: 3, backgroundColor: '#555', borderRadius: 1.5 },
  waveformBarActive: { backgroundColor: '#3b82f6' },
  audioBtnText: { color: '#fff', fontSize: 20 },
  audioLabel: { color: '#ddd', fontSize: 13 },
});
