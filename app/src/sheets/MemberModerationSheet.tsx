import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import ActionSheet, { SheetManager } from 'react-native-actions-sheet';
import { UserX, UserCheck, VolumeX, Volume2, ShieldAlert, Clock, Ban, MessageSquareOff } from 'lucide-react-native';
import type { MemberInfo } from '../ffi/gardensCore';
import {
  getProfile,
  kickMember,
  banMember,
  unbanMember,
  muteMember,
  unmuteMember,
  type SendResult,
} from '../ffi/gardensCore';
import { BlobImage } from '../components/BlobImage';
import { useSyncStore, broadcastOp, deriveInboxTopicHex } from '../stores/useSyncStore';

interface MemberModerationSheetProps {
  sheetId: string;
  payload?: {
    member: MemberInfo;
    orgId: string;
    isBanned?: boolean;
    isMuted?: boolean;
    mutedUntil?: number;
    onAction?: () => void;
  };
}

const MUTE_DURATIONS = [
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '1 day', seconds: 86400 },
  { label: '1 week', seconds: 604800 },
];

export function MemberModerationSheet(props: MemberModerationSheetProps) {
  const { member, orgId, isBanned, isMuted, mutedUntil, onAction } = props.payload || {};
  const [profile, setProfile] = useState<{ username: string; avatarBlobId: string | null; bio: string | null } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { subscribe, unsubscribe } = useSyncStore();

  const loadProfile = useCallback(async () => {
    if (!member) return;
    try {
      const p = await getProfile(member.publicKey);
      if (p) setProfile(p);
    } catch {}
  }, [member]);

  useEffect(() => {
    if (member) loadProfile();
  }, [member, loadProfile]);

  // Broadcast moderation op to both org topic and target's inbox
  async function broadcastModerationOp(result: SendResult, targetKey: string) {
    if (!result.opBytes?.length || !orgId) return;
    
    // Broadcast to org topic so all members see it
    broadcastOp(orgId, result.opBytes);
    
    // Broadcast to target's inbox so they get notified even if removed
    const targetInboxTopic = deriveInboxTopicHex(targetKey);
    broadcastOp(targetInboxTopic, result.opBytes);
    
    console.log(`[moderation] Broadcasted to org ${orgId.slice(0, 16)}… and inbox ${targetInboxTopic.slice(0, 16)}…`);
  }

  async function handleKick() {
    if (!member) return;
    
    Alert.alert(
      'Kick Member',
      `Remove ${profile?.username || 'this member'} from the organization? They can rejoin with an invite.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Kick',
          style: 'destructive',
          onPress: async () => {
            setActionLoading('kick');
            try {
              const result = await kickMember(orgId!, member.publicKey);
              await broadcastModerationOp(result, member.publicKey);
              onAction?.();
              SheetManager.hide('member-moderation-sheet');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to kick member');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  }

  async function handleBan() {
    if (!member) return;
    
    Alert.alert(
      'Ban Member',
      `Ban ${profile?.username || 'this member'} permanently? They will be removed and cannot rejoin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Ban',
          style: 'destructive',
          onPress: async () => {
            setActionLoading('ban');
            try {
              const result = await banMember(orgId!, member.publicKey);
              await broadcastModerationOp(result, member.publicKey);
              onAction?.();
              SheetManager.hide('member-moderation-sheet');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to ban member');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  }

  async function handleUnban() {
    if (!member) return;
    
    setActionLoading('unban');
    try {
      const result = await unbanMember(orgId!, member.publicKey);
      await broadcastModerationOp(result, member.publicKey);
      onAction?.();
      SheetManager.hide('member-moderation-sheet');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to unban member');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMute(durationSeconds: number) {
    if (!member) return;
    
    setActionLoading('mute');
    try {
      const result = await muteMember(orgId!, member.publicKey, durationSeconds);
      await broadcastModerationOp(result, member.publicKey);
      onAction?.();
      SheetManager.hide('member-moderation-sheet');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to mute member');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnmute() {
    if (!member) return;
    
    setActionLoading('unmute');
    try {
      const result = await unmuteMember(orgId!, member.publicKey);
      await broadcastModerationOp(result, member.publicKey);
      onAction?.();
      SheetManager.hide('member-moderation-sheet');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to unmute member');
    } finally {
      setActionLoading(null);
    }
  }

  function showMuteOptions() {
    Alert.alert(
      'Mute Duration',
      'Select how long to mute this member:',
      [
        ...MUTE_DURATIONS.map(({ label, seconds }) => ({
          text: label,
          onPress: () => handleMute(seconds),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  if (!member) {
    return (
      <ActionSheet id={props.sheetId} containerStyle={styles.sheet}>
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      </ActionSheet>
    );
  }

  const displayName = profile?.username || member.publicKey.slice(0, 16) + '...';
  const initials = (profile?.username || member.publicKey).slice(0, 2).toUpperCase();

  return (
    <ActionSheet id={props.sheetId} containerStyle={styles.sheet}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          {profile?.avatarBlobId ? (
            <BlobImage blobHash={profile.avatarBlobId} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.publicKey}>{member.publicKey.slice(0, 24)}...</Text>
            {member.accessLevel && (
              <View style={[styles.badge, getBadgeStyle(member.accessLevel)]}>
                <Text style={styles.badgeText}>{member.accessLevel}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Status Banner */}
        {(isBanned || isMuted) && (
          <View style={styles.statusBanner}>
            {isBanned && (
              <View style={styles.statusItem}>
                <Ban size={16} color="#ef4444" />
                <Text style={styles.statusTextBanned}>Banned</Text>
              </View>
            )}
            {isMuted && (
              <View style={styles.statusItem}>
                <VolumeX size={16} color="#f59e0b" />
                <Text style={styles.statusTextMuted}>
                  Muted {mutedUntil ? `until ${new Date(mutedUntil / 1000).toLocaleString()}` : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Moderation Actions */}
        {!isBanned && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Moderation</Text>
            
            {/* Kick */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleKick}
              disabled={!!actionLoading}
            >
              <View style={[styles.iconContainer, { backgroundColor: '#f9731620' }]}>
                <UserX size={20} color="#f97316" />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Kick Member</Text>
                <Text style={styles.actionDesc}>Remove from org (can rejoin with invite)</Text>
              </View>
              {actionLoading === 'kick' && <ActivityIndicator size="small" color="#888" />}
            </TouchableOpacity>

            {/* Ban */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleBan}
              disabled={!!actionLoading}
            >
              <View style={[styles.iconContainer, { backgroundColor: '#ef444420' }]}>
                <ShieldAlert size={20} color="#ef4444" />
              </View>
              <View style={styles.actionContent}>
                <Text style={[styles.actionTitle, { color: '#ef4444' }]}>Ban Member</Text>
                <Text style={styles.actionDesc}>Permanent removal, cannot rejoin</Text>
              </View>
              {actionLoading === 'ban' && <ActivityIndicator size="small" color="#888" />}
            </TouchableOpacity>

            {/* Mute / Unmute */}
            {isMuted ? (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleUnmute}
                disabled={!!actionLoading}
              >
                <View style={[styles.iconContainer, { backgroundColor: '#3b82f620' }]}>
                  <Volume2 size={20} color="#3b82f6" />
                </View>
                <View style={styles.actionContent}>
                  <Text style={styles.actionTitle}>Unmute Member</Text>
                  <Text style={styles.actionDesc}>Allow them to send messages again</Text>
                </View>
                {actionLoading === 'unmute' && <ActivityIndicator size="small" color="#888" />}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={showMuteOptions}
                disabled={!!actionLoading}
              >
                <View style={[styles.iconContainer, { backgroundColor: '#f59e0b20' }]}>
                  <VolumeX size={20} color="#f59e0b" />
                </View>
                <View style={styles.actionContent}>
                  <Text style={styles.actionTitle}>Mute Member</Text>
                  <Text style={styles.actionDesc}>Temporarily restrict messaging</Text>
                </View>
                {actionLoading === 'mute' && <ActivityIndicator size="small" color="#888" />}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Unban Section */}
        {isBanned && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ban Management</Text>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleUnban}
              disabled={!!actionLoading}
            >
              <View style={[styles.iconContainer, { backgroundColor: '#22c55e20' }]}>
                <UserCheck size={20} color="#22c55e" />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Unban Member</Text>
                <Text style={styles.actionDesc}>Allow them to rejoin the organization</Text>
              </View>
              {actionLoading === 'unban' && <ActivityIndicator size="small" color="#888" />}
            </TouchableOpacity>
          </View>
        )}

        {/* Cancel */}
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => SheetManager.hide('member-moderation-sheet')}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </ActionSheet>
  );
}

function getBadgeStyle(level: string) {
  switch (level.toLowerCase()) {
    case 'manage': return { backgroundColor: '#dc2626' };
    case 'write': return { backgroundColor: '#7c3aed' };
    case 'read': return { backgroundColor: '#1e40af' };
    default: return { backgroundColor: '#374151' };
  }
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  container: {
    padding: 20,
  },
  center: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 16,
  },
  name: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  publicKey: {
    color: '#666',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statusBanner: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  statusTextBanned: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  statusTextMuted: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#222',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  actionDesc: {
    color: '#888',
    fontSize: 12,
  },
  cancelButton: {
    backgroundColor: '#222',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
