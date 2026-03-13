import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MessageSquare, Shield } from 'lucide-react-native';
import { useOrgAdminThreadsStore } from '../stores/useOrgAdminThreadsStore';
import { useProfileStore } from '../stores/useProfileStore';
import { useSyncStore, deriveOrgAdminTopicHex } from '../stores/useSyncStore';

type Props = {
  orgId: string;
  orgName: string;
  adminContactKey: string | null;
  isAdmin: boolean;
  onOpenConversation: (threadId: string, recipientKey: string, orgId: string) => void;
};

function truncateKey(key: string): string {
  if (key.length <= 16) return key;
  return `${key.slice(0, 8)}…${key.slice(-6)}`;
}

export function OrgAdminInboxPanel({ orgId, orgName, adminContactKey, isAdmin, onOpenConversation }: Props) {
  const { threadsByOrg, fetchOrgAdminThreads } = useOrgAdminThreadsStore();
  const { profileCache, fetchProfile } = useProfileStore();
  const { subscribe, unsubscribe, opTick } = useSyncStore();

  useEffect(() => {
    fetchOrgAdminThreads(orgId).catch(() => {});
  }, [fetchOrgAdminThreads, orgId]);

  useEffect(() => {
    if (!adminContactKey) return;
    const inboxTopic = deriveOrgAdminTopicHex(orgId);
    subscribe(inboxTopic);
    return () => unsubscribe(inboxTopic);
  }, [adminContactKey, orgId, subscribe, unsubscribe]);

  useEffect(() => {
    fetchOrgAdminThreads(orgId).catch(() => {});
  }, [fetchOrgAdminThreads, opTick, orgId]);

  const syncedThreads = (threadsByOrg[orgId] ?? []).sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));

  useEffect(() => {
    syncedThreads.forEach((thread) => {
      const peerKey = thread.participantKey;
      fetchProfile(peerKey).catch(() => {});
    });
  }, [fetchProfile, syncedThreads]);

  return (
    <View style={s.root}>
      <View style={s.hero}>
        <View style={s.heroIcon}>
          <Shield size={18} color="#111" />
        </View>
        <Text style={s.heroTitle}>Admin Inbox</Text>
        <Text style={s.heroBody}>
          Requests and direct admin conversations for {orgName} sync here. This is the live queue, not Invite Members copied over again.
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Synced Messages</Text>
        <Text style={s.cardBody}>
          Conversations sent to the org admin contact appear here so admins can review and reply from one place.
        </Text>
        {adminContactKey ? (
          syncedThreads.length > 0 ? (
            <View style={s.threadList}>
              {syncedThreads.map((thread) => {
                const peerKey = thread.participantKey;
                const profile = profileCache[peerKey];
                const title = profile?.username ?? truncateKey(peerKey);
                return (
                  <TouchableOpacity
                    key={thread.threadId}
                    style={s.threadRow}
                    onPress={() => onOpenConversation(thread.threadId, peerKey, orgId)}
                  >
                    <View style={s.threadBadge}>
                      <MessageSquare size={16} color="#3a2817" />
                    </View>
                    <View style={s.threadCopy}>
                      <Text style={s.threadTitle}>{title}</Text>
                      <Text style={s.threadSubtitle}>
                        {thread.isRequest ? 'Join request waiting for reply' : 'Active org-admin conversation'}
                      </Text>
                    </View>
                    <Text style={s.threadChevron}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={s.emptyState}>
              <ActivityIndicator size="small" color="#9d8368" />
              <Text style={s.emptyStateText}>No admin messages synced yet.</Text>
            </View>
          )
        ) : (
          <Text style={s.emptyText}>No admin contact key is available for syncing yet.</Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>What This Screen Is</Text>
        <View style={s.workflowRow}>
          <MessageSquare size={16} color="#d7b28d" />
          <Text style={s.workflowText}>Each row above is a requester thread, not the org contact key repeated.</Text>
        </View>
        <View style={s.workflowRow}>
          <MessageSquare size={16} color="#d7b28d" />
          <Text style={s.workflowText}>Open a thread to reply, review the request, and add the person to the org from the conversation.</Text>
        </View>
        <View style={s.workflowRow}>
          <MessageSquare size={16} color="#d7b28d" />
          <Text style={s.workflowText}>
            {isAdmin
              ? 'Shareable join links and QR codes live in org settings, not in this inbox view.'
              : 'Only managers/admins can process requests from this inbox.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#100d0a', padding: 16 },
  hero: { backgroundColor: '#17130f', borderRadius: 16, borderWidth: 1, borderColor: '#2c241c', padding: 16, marginBottom: 14 },
  heroIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#d7b28d', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  heroTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  heroBody: { color: '#c8b49f', fontSize: 13, lineHeight: 18, marginTop: 6 },
  card: { backgroundColor: '#17130f', borderRadius: 14, borderWidth: 1, borderColor: '#2c241c', padding: 14, marginBottom: 12 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  cardBody: { color: '#c8b49f', fontSize: 13, lineHeight: 18 },
  workflowRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 10 },
  workflowText: { color: '#efe4d8', fontSize: 13, flex: 1, lineHeight: 18 },
  emptyText: { color: '#8d7763', fontSize: 13, marginTop: 10 },
  threadList: { marginTop: 12, gap: 10 },
  threadRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#211a14', borderRadius: 12, borderWidth: 1, borderColor: '#3a3026', padding: 12 },
  threadBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#d7b28d', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  threadCopy: { flex: 1 },
  threadTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  threadSubtitle: { color: '#bca58f', fontSize: 12, marginTop: 3 },
  threadChevron: { color: '#8d7763', fontSize: 20, marginLeft: 8 },
  emptyState: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyStateText: { color: '#8d7763', fontSize: 13 },
});
