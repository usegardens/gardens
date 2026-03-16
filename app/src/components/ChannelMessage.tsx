import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Shield } from 'lucide-react-native';
import type { Message } from '../stores/useMessagesStore';
import { BlobImage } from './BlobImage';
import { DEFAULT_RELAY_URL } from '../stores/useProfileStore';
import { BlobVideo } from './BlobVideo';
import { getBlob } from '../ffi/gardensCore';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { MessageText, extractUrls } from './MessageText';
import { LinkPreviewCard } from './LinkPreview';

const AVATAR_COLORS = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#3498DB', '#E67E22'];

function avatarColor(publicKey: string): string {
  let hash = 0;
  for (let i = 0; i < publicKey.length; i++) {
    hash = publicKey.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Avatar({
  authorKey,
  username,
  avatarBlobId,
  avatarRoomId,
  showShield,
  avatarUri,
  isIced,
}: {
  authorKey: string;
  username: string;
  avatarBlobId: string | null;
  avatarRoomId?: string | null;
  showShield?: boolean;
  avatarUri?: string | null;
  isIced?: boolean;
}) {
  const color = avatarColor(authorKey);
  const initials = username.slice(0, 2).toUpperCase();

  if (showShield) {
    return (
      <View style={styles.avatarWrap}>
        <View style={styles.shieldAvatar}>
          <Shield size={16} color="#3a2817" />
        </View>
      </View>
    );
  }

  if (avatarUri) {
    return (
      <View style={styles.avatarWrap}>
        <Image source={{ uri: avatarUri }} style={[styles.avatar, { borderRadius: 18 }]} />
        {isIced && <Text style={styles.iceBadge}>🧊</Text>}
      </View>
    );
  }

  if (avatarBlobId) {
    return (
      <View style={styles.avatarWrap}>
        <BlobImage
          blobHash={avatarBlobId}
          roomId={avatarRoomId ?? null}
          peerPublicKey={authorKey}
          publicRelayUrl={DEFAULT_RELAY_URL}
          style={[styles.avatar, { borderRadius: 18 }]}
        />
        {isIced && <Text style={styles.iceBadge}>🧊</Text>}
      </View>
    );
  }

  return (
    <View style={[styles.avatar, { backgroundColor: color }]}>
      <Text style={styles.avatarInitials}>{initials}</Text>
      {isIced && <Text style={styles.iceBadge}>🧊</Text>}
    </View>
  );
}

function AudioMessage({ blobHash, roomId }: { blobHash: string; roomId: string | null }) {
  const [playing, setPlaying] = useState(false);
  const playerRef = React.useRef<AudioRecorderPlayer | null>(null);

  async function toggle() {
    if (playing) {
      await playerRef.current?.stopPlayer();
      playerRef.current?.removePlayBackListener();
      setPlaying(false);
    } else {
      try {
        // getBlob returns base64 string directly
        const base64 = await getBlob(blobHash, roomId);
        const uri = `data:audio/m4a;base64,${base64}`;
        const player = new AudioRecorderPlayer();
        playerRef.current = player;
        player.addPlayBackListener((e) => {
          if (e.isFinished) {
            setPlaying(false);
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

  return (
    <TouchableOpacity style={styles.audioBtn} onPress={toggle}>
      <Text style={styles.audioBtnText}>{playing ? '⏸' : '▶'}</Text>
      <Text style={styles.audioLabel}>Voice message</Text>
    </TouchableOpacity>
  );
}

interface Props {
  message: Message;
  isOwnMessage: boolean;
  isGrouped: boolean;
  authorUsername: string;
  authorAvatarBlobId: string | null;
  authorAvatarRoomId?: string | null;
  authorShield?: boolean;
  authorAvatarUri?: string | null;
  authorIced?: boolean;
  replyToPreview?: { username: string; text: string; isDeleted?: boolean } | null;
  reactions?: Array<{ emoji: string; count: number; reactedByMe: boolean }>;
  customEmojis?: Record<string, { blobId: string; mimeType: string; roomId: string | null }>;
  onToggleReaction?: (emoji: string) => void;
  onReply?: () => void;
  onLongPress?: () => void;
  imageGroup?: Message[];
}

export function ChannelMessage({
  message,
  isOwnMessage,
  isGrouped,
  authorUsername,
  authorAvatarBlobId,
  authorAvatarRoomId,
  authorShield,
  authorAvatarUri,
  authorIced,
  replyToPreview,
  reactions = [],
  customEmojis = {},
  onToggleReaction,
  onReply,
  onLongPress,
  imageGroup = [],
}: Props) {
  const color = avatarColor(message.authorKey);
  const timestamp = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (message.isDeleted) {
    return (
      <View style={[styles.row, isGrouped && styles.rowGrouped]}>
        <View style={styles.avatarSlot} />
        <Text style={styles.deletedText}>Message deleted</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, isGrouped && styles.rowGrouped]}
      onLongPress={onLongPress}
      activeOpacity={0.85}
    >
      {/* Avatar or spacer */}
      <View style={styles.avatarSlot}>
        {!isGrouped && (
          <Avatar
            authorKey={message.authorKey}
            username={authorUsername}
            avatarBlobId={authorAvatarBlobId}
            avatarRoomId={authorAvatarRoomId}
            showShield={authorShield}
            avatarUri={authorAvatarUri}
            isIced={authorIced}
          />
        )}
      </View>

      {/* Content column */}
      <View style={styles.content}>
        {/* Username + timestamp row */}
        {!isGrouped && (
          <View style={styles.header}>
            <Text style={[styles.username, { color }, isOwnMessage && styles.usernameOwn]}>
              {authorUsername}
            </Text>
            <Text style={styles.headerTimestamp}>{timestamp}</Text>
          </View>
        )}

        {/* Reply bar */}
        {message.replyTo && replyToPreview && (
          <View style={styles.replyPreview}>
            <View style={styles.replyPreviewInner}>
              <Text style={styles.replyPreviewUser}>@{replyToPreview.username}</Text>
              <Text style={styles.replyPreviewText} numberOfLines={2}>
                {replyToPreview.isDeleted ? 'Message deleted' : replyToPreview.text}
              </Text>
            </View>
          </View>
        )}

        {/* Message body */}
        {message.contentType === 'text' && message.textContent && (() => {
          const urls = extractUrls(message.textContent);
          return (
            <>
              <View style={styles.textRow}>
                <MessageText text={message.textContent} customEmojis={customEmojis} />
                {isGrouped && <Text style={styles.inlineTimestamp}>{timestamp}</Text>}
              </View>
              {urls.slice(0, 1).map(url => (
                <LinkPreviewCard key={url} url={url} />
              ))}
            </>
          );
        })()}

        {/* Single image or image grid */}
        {message.contentType === 'image' && message.blobId && (
          imageGroup.length > 1 ? (
            <View style={styles.imageGrid}>
              {imageGroup.filter(img => img.blobId).map((img, idx) => (
                <BlobImage
                  key={img.messageId}
                  blobHash={img.blobId!}
                  roomId={img.roomId ?? img.dmThreadId ?? null}
                  peerPublicKey={img.authorKey}
                  style={[
                    styles.gridImage,
                    idx === 0 && styles.gridImageFirst,
                    idx === imageGroup.filter(i => i.blobId).length - 1 && styles.gridImageLast,
                  ]}
                />
              ))}
            </View>
          ) : (
            <BlobImage
              blobHash={message.blobId}
              roomId={message.roomId ?? message.dmThreadId ?? null}
              peerPublicKey={message.authorKey}
              style={styles.media}
            />
          )
        )}

        {message.contentType === 'audio' && message.blobId && (
          <AudioMessage blobHash={message.blobId} roomId={message.roomId ?? message.dmThreadId ?? null} />
        )}

        {message.contentType === 'gif' && message.embedUrl && (
          <Image source={{ uri: message.embedUrl }} style={styles.media} resizeMode="cover" />
        )}

        {message.contentType === 'video' && message.blobId && (message.roomId ?? message.dmThreadId) && (
          <BlobVideo blobHash={message.blobId} topicHex={(message.roomId ?? message.dmThreadId)!} style={styles.media} />
        )}

        {message.editedAt && <Text style={styles.edited}>(edited)</Text>}

        {reactions.length > 0 && (
          <View style={styles.reactionsRow}>
            {reactions.map((r) => {
              const custom = customEmojis[r.emoji];
              return (
                <TouchableOpacity
                  key={`${message.messageId}-${r.emoji}`}
                  style={[styles.reactionBadge, r.reactedByMe && styles.reactionBadgeActive]}
                  onPress={() => onToggleReaction?.(r.emoji)}
                  activeOpacity={0.8}
                >
                  {custom ? (
                    <BlobImage
                      blobHash={custom.blobId}
                      mimeType={custom.mimeType}
                      roomId={custom.roomId}
                      style={styles.reactionEmojiImg}
                    />
                  ) : (
                    <Text style={styles.reactionEmojiText}>{r.emoji}</Text>
                  )}
                  <Text style={styles.reactionCount}>{r.count}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Reply button */}
      {onReply && (
        <TouchableOpacity style={styles.replyBtn} onPress={onReply}>
          <Text style={styles.replyBtnText}>↩</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
    alignItems: 'flex-start',
  },
  rowGrouped: {
    paddingTop: 2,
  },

  avatarSlot: {
    width: 40,
    marginRight: 10,
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  shieldAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#d7b28d',
    borderWidth: 1,
    borderColor: '#b89269',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  iceBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    fontSize: 12,
  },

  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 3,
  },
  username: {
    fontSize: 14,
    fontWeight: '600',
  },
  usernameOwn: {
    opacity: 1,
  },
  headerTimestamp: {
    color: '#8d7763',
    fontSize: 11,
  },

  textRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 6,
  },
inlineTimestamp: {
    color: '#8d7763',
    fontSize: 10,
    marginBottom: 2,
  },

  replyPreview: {
    marginBottom: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#3a3026',
  },
  replyPreviewInner: {
    backgroundColor: '#1a140f',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2f261e',
  },
  replyPreviewUser: { color: '#d7b28d', fontSize: 12, fontWeight: '600' },
  replyPreviewText: { color: '#d5c2ae', fontSize: 12, marginTop: 2 },

  media: { width: '100%', minHeight: 160, borderRadius: 6, marginTop: 4 },
  
  // Image grid styles for Discord-like multi-image display
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    marginRight: 40,
  },
  gridImage: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 6,
  },
  gridImageFirst: {
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  gridImageLast: {
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  edited: { color: '#8d7763', fontSize: 11, fontStyle: 'italic', marginTop: 2 },

  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#211a14',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3a3026',
  },
  reactionBadgeActive: { borderColor: '#d7b28d' },
  reactionEmojiText: { fontSize: 14 },
  reactionEmojiImg: { width: 14, height: 14, borderRadius: 3 },
  reactionCount: { color: '#d5c2ae', fontSize: 12 },

  deletedText: { color: '#8d7763', fontSize: 14, fontStyle: 'italic', flex: 1, paddingTop: 2 },

  replyBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#251d16',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    alignSelf: 'center',
  },
  replyBtnText: { color: '#c8b49f', fontSize: 14 },

  audioBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  audioBtnText: { color: '#fff', fontSize: 20 },
  audioLabel: { color: '#d5c2ae', fontSize: 13 },
});
