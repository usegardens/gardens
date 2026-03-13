import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Shield, UserX, UserCheck, VolumeX, Volume2, UserMinus, UserPlus, Key, AlertCircle } from 'lucide-react-native';
import type { MainStackParamList } from '../navigation/RootNavigator';
import { listAuditLog, type AuditLogEntry } from '../ffi/gardensCore';
import { useProfileStore } from '../stores/useProfileStore';
import { BlobImage } from '../components/BlobImage';

type Props = NativeStackScreenProps<MainStackParamList, 'AuditLog'>;

const ACTION_ICONS: Record<string, React.ReactNode> = {
  ban_member: <UserX size={20} color="#ef4444" />,
  unban_member: <UserCheck size={20} color="#22c55e" />,
  kick_member: <UserMinus size={20} color="#f97316" />,
  mute_member: <VolumeX size={20} color="#f59e0b" />,
  unmute_member: <Volume2 size={20} color="#3b82f6" />,
  add_member: <UserPlus size={20} color="#22c55e" />,
  remove_member: <UserMinus size={20} color="#ef4444" />,
  change_permission: <Key size={20} color="#8b5cf6" />,
};

const ACTION_LABELS: Record<string, string> = {
  ban_member: 'Banned',
  unban_member: 'Unbanned',
  kick_member: 'Kicked',
  mute_member: 'Muted',
  unmute_member: 'Unmuted',
  add_member: 'Added',
  remove_member: 'Removed',
  change_permission: 'Permission Changed',
};

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp / 1000); // Convert from microseconds to milliseconds
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function truncateKey(key: string): string {
  return `${key.slice(0, 8)}...${key.slice(-8)}`;
}

export function AuditLogScreen({ route, navigation }: Props) {
  const { orgId, orgName } = route.params;
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { profileCache, fetchProfile } = useProfileStore();

  const loadAuditLog = useCallback(async () => {
    try {
      const log = await listAuditLog(orgId, 100);
      setEntries(log);
      
      // Fetch profiles for all unique keys
      const uniqueKeys = new Set<string>();
      log.forEach(e => {
        uniqueKeys.add(e.moderatorKey);
        uniqueKeys.add(e.targetKey);
      });
      
      for (const key of uniqueKeys) {
        if (!profileCache[key]) {
          fetchProfile(key).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[AuditLog] Failed to load:', err);
    }
  }, [orgId, profileCache, fetchProfile]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadAuditLog().finally(() => setLoading(false));
    }, [loadAuditLog])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAuditLog();
    setRefreshing(false);
  }, [loadAuditLog]);

  useEffect(() => {
    navigation.setOptions({
      title: orgName ? `${orgName} Audit Log` : 'Audit Log',
      headerStyle: { backgroundColor: '#17130f' },
      headerTintColor: '#f1e2d2',
    });
  }, [navigation, orgName]);

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const moderatorProfile = profileCache[item.moderatorKey];
    const targetProfile = profileCache[item.targetKey];
    const icon = ACTION_ICONS[item.actionType] || <AlertCircle size={20} color="#888" />;
    const label = ACTION_LABELS[item.actionType] || item.actionType;

    return (
      <View style={styles.entry}>
        <View style={styles.iconContainer}>{icon}</View>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.action}>{label}</Text>
            <Text style={styles.timestamp}>{formatTimestamp(item.createdAt)}</Text>
          </View>
          
          <View style={styles.actors}>
            <View style={styles.actor}>
              <Text style={styles.actorLabel}>by</Text>
              {moderatorProfile?.avatarBlobId ? (
                <BlobImage blobHash={moderatorProfile.avatarBlobId} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarText}>
                    {(moderatorProfile?.username || item.moderatorKey).slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.actorName} numberOfLines={1}>
                {moderatorProfile?.username || truncateKey(item.moderatorKey)}
              </Text>
            </View>
            
            <View style={styles.arrow}>→</View>
            
            <View style={styles.actor}>
              {targetProfile?.avatarBlobId ? (
                <BlobImage blobHash={targetProfile.avatarBlobId} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarText}>
                    {(targetProfile?.username || item.targetKey).slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.actorName} numberOfLines={1}>
                {targetProfile?.username || truncateKey(item.targetKey)}
              </Text>
            </View>
          </View>
          
          {item.details && (
            <Text style={styles.details}>{item.details}</Text>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerBanner}>
        <Shield size={20} color="#3b82f6" />
        <Text style={styles.headerText}>
          Moderation actions are logged and synced across all Manage-level members
        </Text>
      </View>
      
      <FlatList
        data={entries}
        keyExtractor={(item) => `${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Shield size={48} color="#333" />
            <Text style={styles.emptyText}>No moderation actions yet</Text>
            <Text style={styles.emptySubtext}>
              Audit log tracks bans, kicks, mutes, and permission changes
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 12,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerText: {
    flex: 1,
    color: '#8899aa',
    fontSize: 12,
    lineHeight: 16,
  },
  list: {
    padding: 12,
  },
  entry: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  action: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  timestamp: {
    color: '#666',
    fontSize: 12,
  },
  actors: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  actorLabel: {
    color: '#555',
    fontSize: 11,
    marginRight: 2,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  avatarPlaceholder: {
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
  },
  actorName: {
    color: '#aaa',
    fontSize: 13,
    flex: 1,
  },
  arrow: {
    color: '#444',
    fontSize: 14,
    fontWeight: 'bold',
  },
  details: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 40,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    color: '#444',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
