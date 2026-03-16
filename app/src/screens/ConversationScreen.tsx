import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Lock } from 'lucide-react-native';
import {
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Text,
  Image,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { SheetManager } from 'react-native-actions-sheet';
import type { MainStackParamList } from '../navigation/RootNavigator';
import { ChannelMessage } from '../components/ChannelMessage';
import { MessageComposer } from '../components/MessageComposer';
import { extractMentions } from '../components/MessageText';
import { useMessagesStore } from '../stores/useMessagesStore';
import { useProfileStore } from '../stores/useProfileStore';
import { useOrgPreviewStore } from '../stores/useOrgPreviewStore';
import { sendDMPushNotification, sendMemberAddedPushNotification } from '../services/pushNotifications';
import { useSyncStore, broadcastOp, deriveInboxTopicHex } from '../stores/useSyncStore';
import { hasProfilePayloadBeenSent, markProfilePayloadSent } from '../stores/useDmProfileStore';
import { addMemberDirect, listOrgMembers, sendMessage as nativeSendMessage } from '../ffi/gardensCore';
import { BlobImage } from '../components/BlobImage';
import { useJoinRequestsStore } from '../stores/useJoinRequestsStore';
import { useAuthStore } from '../stores/useAuthStore';

// In-flight guard: prevents duplicate profile sends if user taps quickly
const profileSendInFlight = new Set<string>();

type Props = NativeStackScreenProps<MainStackParamList, 'Conversation'>;

export function ConversationScreen({ route, navigation }: Props) {
  const { threadId, recipientKey, orgId, orgName, conversationLabel } = route.params;
  const { messages, fetchMessages, sendMessage, deleteMessage } = useMessagesStore();
  const { myProfile, profileCache, fetchProfile, profilePicUri } = useProfileStore();
  const { previewsByOrgId, hydrateOrgPreview } = useOrgPreviewStore();
  const { subscribe, unsubscribe, opTick } = useSyncStore();
  const { resolveThread: resolveJoinRequestThread } = useJoinRequestsStore();
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | undefined>(undefined);
  const flatListRef = useRef<FlatList>(null);

  const contextKey = threadId;
  const messageList = useMemo(() => messages[contextKey] || [], [contextKey, messages]);
  const recipientProfile = profileCache[recipientKey];
  const isOrgAdminConversation = !!orgId;
  const orgPreview = orgId ? previewsByOrgId[orgId] : null;
  const resolvedOrgName = orgName ?? orgPreview?.orgName;
  const isRequesterSideOrgConversation =
    !!resolvedOrgName && (!orgPreview || recipientKey === orgPreview.orgContactKey);

  const messageByIdRef = useRef<Map<string, typeof messageList[0]>>(new Map());
  useEffect(() => {
    messageByIdRef.current = new Map(messageList.map(m => [m.messageId, m]));
  }, [messageList]);

  useEffect(() => {
    fetchProfile(recipientKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientKey]);

  useEffect(() => {
    if (!orgId) return;
    if (orgPreview) return;
    hydrateOrgPreview(recipientKey, orgId, orgName).catch(() => {});
  }, [hydrateOrgPreview, orgId, orgName, orgPreview, recipientKey]);

  // Ensure author profiles are hydrated for stable avatar/name rendering.
  useEffect(() => {
    const myKey = myProfile?.publicKey ?? useAuthStore.getState().keypair?.publicKeyHex;
    if (myKey && myProfile && !profileCache[myKey]) {
      useProfileStore.setState(s => ({
        profileCache: { ...s.profileCache, [myKey]: myProfile },
      }));
    }
    const keys = [...new Set(messageList.map(m => m.authorKey))];
    keys.forEach(key => {
      if (!profileCache[key]) fetchProfile(key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageList, myProfile]);

  useEffect(() => {
    const title = recipientProfile?.username ?? recipientKey.slice(0, 10) + '…';
    if (resolvedOrgName && isRequesterSideOrgConversation) {
      navigation.setOptions({
        headerStyle: { backgroundColor: '#17130f' },
        headerTintColor: '#f1e2d2',
        headerTitle: () => (
          <View style={styles.headerTitleWrap}>
            {recipientProfile?.avatarBlobId ? (
              <BlobImage blobHash={recipientProfile.avatarBlobId} style={styles.headerAvatar} />
            ) : profilePicUri && recipientKey === myProfile?.publicKey ? (
              <Image source={{ uri: profilePicUri }} style={styles.headerAvatar} />
            ) : (
              <View style={styles.headerAvatarFallback}>
                <Text style={styles.headerAvatarText}>{title.slice(0, 2).toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.headerTitleText} numberOfLines={1}>{`${title} from ${resolvedOrgName}`}</Text>
          </View>
        ),
      });
      return;
    }
    navigation.setOptions({
      title: conversationLabel ?? title,
      headerTitle: undefined,
      headerStyle: { backgroundColor: '#17130f' },
      headerTintColor: '#f1e2d2',
      headerTitleStyle: { color: '#f1e2d2' },
    });
  }, [conversationLabel, isRequesterSideOrgConversation, myProfile?.publicKey, navigation, profilePicUri, recipientKey, recipientProfile, resolvedOrgName]);

  const mentionCandidates = useMemo(() => {
    const names = new Set<string>();
    const recipient = profileCache[recipientKey]?.username;
    if (recipient) names.add(recipient);
    if (myProfile?.username) names.add(myProfile.username);
    return Array.from(names);
  }, [profileCache, recipientKey, myProfile]);

  const loadMessages = React.useCallback(async () => {
    setLoading(true);
    try {
      await fetchMessages(null, threadId);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [fetchMessages, threadId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useFocusEffect(
    React.useCallback(() => {
      loadMessages();
      return () => {};
    }, [loadMessages]),
  );

  useFocusEffect(
    React.useCallback(() => {
      subscribe(threadId);
      return () => unsubscribe(threadId);
    }, [threadId, subscribe, unsubscribe]),
  );

  useEffect(() => {
    if (!loading) fetchMessages(null, threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opTick]);

  async function sendProfileIfNeeded() {
    if (!myProfile?.username) return;
    if (profileSendInFlight.has(threadId)) return;
    const profilePayload = JSON.stringify({
      username: myProfile.username,
      avatarBlobId: myProfile.avatarBlobId ?? null,
    });
    const alreadySent = await hasProfilePayloadBeenSent(threadId, profilePayload);
    if (alreadySent) return;
    profileSendInFlight.add(threadId);
    // Profile messages are metadata-only — not fetched back into local message state.
    try {
      const profileResult = await nativeSendMessage(
        null, threadId, 'profile', profilePayload, null, null, [], null,
      );
      if (profileResult.opBytes?.length) broadcastOp(threadId, profileResult.opBytes);
      await markProfilePayloadSent(threadId, profilePayload);
    } catch {
      // best-effort
    } finally {
      profileSendInFlight.delete(threadId);
    }
  }

  function sendDMPushForOutgoingMessage(previewText: string) {
    const senderName = myProfile?.username ?? 'Someone';
    const preview = previewText.length > 100 ? previewText.slice(0, 97) + '…' : previewText;
    const pushTitle =
      isOrgAdminConversation && !isRequesterSideOrgConversation && resolvedOrgName
        ? `${senderName} from ${resolvedOrgName}`
        : senderName;
    sendDMPushNotification({
      senderName,
      recipientKey,
      threadId,
      preview,
      titleOverride: pushTitle,
    }).catch(() => {});
  }

  async function handleSend(text: string) {
    try {
      await sendProfileIfNeeded();
      await sendMessage({
        dmThreadId: threadId,
        contentType: 'text',
        textContent: text,
        mentions: extractMentions(text),
        replyTo: replyingTo ?? undefined,
      });
      setReplyingTo(undefined);
      sendDMPushForOutgoingMessage(text);
      await loadMessages();
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send message');
    }
  }

  async function handleSendBlob(blobId: string, _mimeType: string, contentType: 'image' | 'video') {
    try {
      const wasReply = !!replyingTo;
      await sendProfileIfNeeded();
      await sendMessage({ dmThreadId: threadId, contentType, blobId, replyTo: replyingTo ?? undefined });
      setReplyingTo(undefined);
      sendDMPushForOutgoingMessage(wasReply ? `Replied with a ${contentType}` : `Sent a ${contentType}`);
      await loadMessages();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send');
    }
  }

  async function handleSendAudio(blobId: string) {
    try {
      const wasReply = !!replyingTo;
      await sendProfileIfNeeded();
      await sendMessage({ dmThreadId: threadId, contentType: 'audio', blobId, replyTo: replyingTo ?? undefined });
      setReplyingTo(undefined);
      sendDMPushForOutgoingMessage(wasReply ? 'Replied with a voice message' : 'Sent a voice message');
      await loadMessages();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send');
    }
  }

  async function handleSendGif(embedUrl: string) {
    try {
      const wasReply = !!replyingTo;
      await sendProfileIfNeeded();
      await sendMessage({ dmThreadId: threadId, contentType: 'gif', embedUrl, replyTo: replyingTo ?? undefined });
      setReplyingTo(undefined);
      sendDMPushForOutgoingMessage(wasReply ? 'Replied with a GIF' : 'Sent a GIF');
      await loadMessages();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send');
    }
  }

  function handleReply(messageId: string) {
    setReplyingTo(messageId);
  }

  async function handleResolveThread() {
    if (!isOrgAdminConversation || isRequesterSideOrgConversation) return;
    try {
      await resolveJoinRequestThread(threadId);
      Alert.alert('Request resolved', 'This request was removed from your admin queue.');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to resolve request');
    }
  }

  async function handleAddMember(accessLevel: 'read' | 'write' | 'manage') {
    if (!orgId) return;
    try {
      const members = await listOrgMembers(orgId);
      const existing = members.find(member => member.publicKey === recipientKey);
      if (existing) {
        Alert.alert('Already a member', `${recipientProfile?.username ?? 'This person'} already has ${existing.accessLevel} access.`);
        return;
      }

      const result = await addMemberDirect(orgId, recipientKey, accessLevel);
      if (result.opBytes?.length) {
        // Broadcast to org topic so existing members see the new member
        broadcastOp(orgId, result.opBytes);
        // Also broadcast to joiner's personal inbox topic so they receive the org
        const joinerInboxTopic = deriveInboxTopicHex(recipientKey);
        broadcastOp(joinerInboxTopic, result.opBytes);
        console.log(`[addMember] Broadcasted to org ${orgId.slice(0, 16)}… and joiner inbox ${joinerInboxTopic.slice(0, 16)}…`);
      }
      if (orgName) {
        sendMemberAddedPushNotification({
          recipientKey,
          orgName,
          orgId,
          accessLevel,
        }).catch(() => {});
      }
      if (!isRequesterSideOrgConversation) {
        try {
          await resolveJoinRequestThread(threadId);
        } catch {
          // best-effort: member add succeeded even if resolve failed
        }
      }
      Alert.alert(
        'Member added',
        `${recipientProfile?.username ?? 'Requester'} now has ${accessLevel} access to ${orgName ?? 'the org'}.${
          !isRequesterSideOrgConversation ? ' Request resolved.' : ''
        }`
      );
      if (!isRequesterSideOrgConversation) {
        navigation.goBack();
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to add member');
    }
  }

  function handleLongPress(message: typeof messageList[0]) {
    const canDelete = message.authorKey === myProfile?.publicKey && !message.isDeleted;
    const canApproveRequester =
      isOrgAdminConversation &&
      !!orgId &&
      !isRequesterSideOrgConversation &&
      !message.isDeleted &&
      message.authorKey === recipientKey &&
      message.authorKey !== myProfile?.publicKey;
    const showResolve = canApproveRequester;
    const extraActions = canApproveRequester
      ? [
          { label: 'Add to Org (Read)', onPress: () => { handleAddMember('read').catch(() => {}); } },
          { label: 'Add to Org (Write)', onPress: () => { handleAddMember('write').catch(() => {}); } },
          { label: 'Add as Admin (Manage)', onPress: () => { handleAddMember('manage').catch(() => {}); } },
        ]
      : [];

    SheetManager.show('message-actions-sheet', {
      payload: {
        canDelete,
        canResolve: showResolve,
        extraActions,
        resolveLabel: 'Resolve Message',
        onReply: () => handleReply(message.messageId),
        onDelete: () => {
          Alert.alert(
            'Delete Message',
            'Are you sure you want to delete this message?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deleteMessage(message.messageId);
                  } catch (err: any) {
                    Alert.alert('Error', err.message || 'Failed to delete message');
                  }
                },
              },
            ]
          );
        },
        onResolve: () => {
          Alert.alert(
            'Resolve Message',
            'Mark this request as handled and stop syncing this thread?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Resolve',
                style: 'destructive',
                onPress: () => {
                  handleResolveThread().catch(() => {});
                },
              },
            ]
          );
        },
      },
    });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.encryptionBanner}>
        <Lock size={12} color="#b89269" />
        <Text style={styles.encryptionText}>End-to-end encrypted</Text>
      </View>

      {messageList.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No messages yet</Text>
          <Text style={styles.emptyHint}>
            Say hi to {recipientProfile?.username ?? recipientKey.slice(0, 10) + '…'}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messageList}
          keyExtractor={item => item.messageId}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => {
            const prev = index > 0 ? messageList[index - 1] : null;
            const isGrouped = prev?.authorKey === item.authorKey;
            
            // Collect consecutive image messages from the same author for grid display
            let imageGroup: typeof messageList = [];
            if (item.contentType === 'image') {
              imageGroup = [item];
              // Look backward
              let lookBack = index - 1;
              while (lookBack >= 0 && 
                     messageList[lookBack].authorKey === item.authorKey && 
                     messageList[lookBack].contentType === 'image') {
                imageGroup.unshift(messageList[lookBack]);
                lookBack--;
              }
              // Look forward
              let lookForward = index + 1;
              while (lookForward < messageList.length && 
                     messageList[lookForward].authorKey === item.authorKey && 
                     messageList[lookForward].contentType === 'image') {
                imageGroup.push(messageList[lookForward]);
                lookForward++;
              }
            }
            
            const isOwn = item.authorKey === myProfile?.publicKey;
            const profile = profileCache[item.authorKey];
            const resolvedProfile = isOwn ? (myProfile ?? profile) : profile;
            const authorUsername = resolvedProfile?.username ?? item.authorKey.slice(0, 8);
            const authorAvatarBlobId = resolvedProfile?.avatarBlobId ?? null;
            const authorAvatarRoomId = isOwn ? null : threadId;
            const authorShield = isOrgAdminConversation && isRequesterSideOrgConversation && !isOwn;
            const authorAvatarUri = isOwn && !authorAvatarBlobId ? profilePicUri : null;

            const replyToMsg = item.replyTo ? messageByIdRef.current.get(item.replyTo) : null;
            const replyProfile = replyToMsg ? profileCache[replyToMsg.authorKey] : null;
            const replyToUsername = replyToMsg
              ? (replyProfile?.username ?? replyToMsg.authorKey.slice(0, 8))
              : null;
            // replyToUsername is always non-null when replyToMsg is set (authorKey fallback guarantees it)
            const replyToPreview = replyToMsg ? {
              username: replyToUsername!,
              isDeleted: replyToMsg.isDeleted,
              text: replyToMsg.textContent
                ?? (replyToMsg.contentType === 'image' ? 'Image'
                  : replyToMsg.contentType === 'audio' ? 'Voice message'
                  : replyToMsg.contentType === 'gif' ? 'GIF'
                  : replyToMsg.contentType === 'video' ? 'Video'
                  : 'Message'),
            } : null;

            return (
              <ChannelMessage
                message={item}
                isOwnMessage={isOwn}
                isGrouped={isGrouped}
                authorUsername={authorUsername}
                authorAvatarBlobId={authorAvatarBlobId}
                authorAvatarRoomId={authorAvatarRoomId}
                authorShield={authorShield}
                authorAvatarUri={authorAvatarUri}
                replyToPreview={replyToPreview}
                imageGroup={imageGroup.length > 1 ? imageGroup : undefined}
                onReply={() => handleReply(item.messageId)}
                onLongPress={() => handleLongPress(item)}
              />
            );
          }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <MessageComposer
        roomId={threadId}
        onSend={handleSend}
        onSendBlob={handleSendBlob}
        onSendAudio={handleSendAudio}
        onSendGif={handleSendGif}
        placeholder="Message..."
        mentionCandidates={mentionCandidates}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#120e0b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  encryptionBanner: {
    backgroundColor: '#2a2119',
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  encryptionText: { color: '#efdcc8', fontSize: 12, fontWeight: '600' },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', maxWidth: 240 },
  headerAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  headerAvatarFallback: { width: 28, height: 28, borderRadius: 14, marginRight: 8, backgroundColor: '#3a3026', alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  headerTitleText: { color: '#f1e2d2', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { color: '#f4e7d7', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { color: '#bca58f', fontSize: 14, textAlign: 'center' },
  list: { paddingVertical: 16 },
});
