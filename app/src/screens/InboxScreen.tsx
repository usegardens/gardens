import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageSquare } from 'lucide-react-native';
import type { MainStackParamList } from '../navigation/RootNavigator';
import { useSyncStore, deriveInboxTopicHex } from '../stores/useSyncStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useConversationsStore } from '../stores/useConversationsStore';
import { useProfileStore } from '../stores/useProfileStore';

type Props = NativeStackScreenProps<MainStackParamList, 'Inbox'>;

export function InboxScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { requests, fetchConversations } = useConversationsStore();
  const { subscribe, unsubscribe } = useSyncStore();
  const { keypair } = useAuthStore();
  const { profileCache, fetchProfile } = useProfileStore();

  const inboxTopic = keypair?.publicKeyHex ? deriveInboxTopicHex(keypair.publicKeyHex) : null;

  useFocusEffect(
    useCallback(() => {
      fetchConversations().catch(() => {});
      if (!inboxTopic) return;
      subscribe(inboxTopic);
      return () => unsubscribe(inboxTopic);
    }, [fetchConversations, inboxTopic, subscribe, unsubscribe]),
  );

  useEffect(() => {
    requests.forEach((request) => {
      const peerKey = request.initiatorKey === keypair?.publicKeyHex ? request.recipientKey : request.initiatorKey;
      fetchProfile(peerKey).catch(() => {});
    });
  }, [fetchProfile, keypair?.publicKeyHex, requests]);

  return (
    <View style={styles.root}>
      <FlatList
        data={requests}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32, flexGrow: requests.length === 0 ? 1 : 0 }}
        keyExtractor={(item) => item.threadId}
        renderItem={({ item }) => {
          const peerKey = item.initiatorKey === keypair?.publicKeyHex ? item.recipientKey : item.initiatorKey;
          const profile = profileCache[peerKey];
          const title = profile?.username ?? `${peerKey.slice(0, 8)}…${peerKey.slice(-6)}`;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('Conversation', { threadId: item.threadId, recipientKey: peerKey })}
            >
              <View style={styles.rowLeft}>
                <View style={styles.unreadDot} />
                <View style={styles.rowText}>
                  <Text style={[styles.from, styles.bold]}>{title}</Text>
                  <Text style={[styles.subject, styles.bold]} numberOfLines={1}>
                    {item.isRequest ? 'Message request' : 'Conversation'}
                  </Text>
                  <Text style={styles.preview} numberOfLines={1}>Open to review and reply.</Text>
                </View>
              </View>
              <Text style={styles.time}>{new Date(item.lastMessageAt ?? item.createdAt).toLocaleDateString()}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MessageSquare size={48} color="#6f5b47" />
            <Text style={styles.emptyText}>No synced requests yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  rowLeft: { flexDirection: 'row', flex: 1, alignItems: 'flex-start', gap: 8 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d7b28d', marginTop: 6 },
  rowText: { flex: 1 },
  from: { color: '#aaa', fontSize: 12 },
  subject: { color: '#fff', fontSize: 15, marginTop: 2 },
  preview: { color: '#666', fontSize: 13, marginTop: 2 },
  bold: { fontWeight: '700' },
  time: { color: '#555', fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120, gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
});
