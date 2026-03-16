import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  StatusBar,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react-native';
import { useVoiceRoomStore, VoiceParticipant } from '../stores/useVoiceRoomStore';
import { useProfileStore } from '../stores/useProfileStore';
import { BlobImage } from '../components/BlobImage';

type Props = NativeStackScreenProps<any, 'VoiceRoom'>;

export function VoiceRoomScreen({ route, navigation }: Props) {
  const { roomId, roomName, orgId, orgName } = route.params as { 
    roomId: string; 
    roomName: string;
    orgId: string;
    orgName: string;
  };

  const { 
    participants, 
    isMuted, 
    isVideoEnabled,
    joinRoom, 
    leaveRoom, 
    toggleMute, 
    toggleVideo,
  } = useVoiceRoomStore();
  
  const { profileCache, fetchProfile } = useProfileStore();

  useEffect(() => {
    // Join the room on mount
    joinRoom(roomId, orgId);
    
    return () => {
      // Leave room on unmount if still in call
      const state = useVoiceRoomStore.getState();
      if (state.isInCall && state.currentRoomId === roomId) {
        leaveRoom();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, orgId]);

  // Fetch profiles for participants
  useEffect(() => {
    participants.forEach(p => {
      if (!profileCache[p.publicKey]) {
        fetchProfile(p.publicKey);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  const handleLeave = () => {
    Alert.alert(
      'Leave Voice Channel',
      'Are you sure you want to leave this voice channel?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Leave', 
          style: 'destructive',
          onPress: () => {
            leaveRoom();
            navigation.goBack();
          }
        },
      ]
    );
  };

  const renderParticipant = ({ item }: { item: VoiceParticipant }) => {
    const profile = profileCache[item.publicKey];
    const username = profile?.username ?? item.username;
    const avatarBlobId = profile?.avatarBlobId ?? item.avatarBlobId;
    
    return (
      <View style={styles.participantCard}>
        <View style={styles.avatarContainer}>
          {avatarBlobId ? (
            <BlobImage 
              blobHash={avatarBlobId} 
              style={styles.avatar} 
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitial}>
                {(username || item.publicKey).slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          {item.isMuted && (
            <View style={styles.mutedIndicator}>
              <MicOff size={10} color="#fff" />
            </View>
          )}
          {item.isSpeaking && (
            <View style={styles.speakingIndicator} />
          )}
        </View>
        <Text style={styles.participantName} numberOfLines={1}>
          {username}
        </Text>
        {item.isVideoEnabled && (
          <View style={styles.videoIndicator}>
            <Video size={12} color="#fff" />
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.roomName}>🎤 {roomName}</Text>
          <Text style={styles.orgName}>{orgName}</Text>
        </View>
        <View style={styles.participantCount}>
          <Text style={styles.participantCountText}>
            {participants.length} in call
          </Text>
        </View>
      </View>

      {/* Participants Grid */}
      <FlatList
        data={participants}
        keyExtractor={item => item.publicKey}
        renderItem={renderParticipant}
        numColumns={2}
        contentContainerStyle={styles.participantsList}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Connecting...</Text>
          </View>
        }
      />

      {/* Controls Bar */}
      <View style={styles.controlsBar}>
        {/* Self controls */}
        <View style={styles.selfControls}>
          <TouchableOpacity
            style={[styles.controlButton, isMuted && styles.controlButtonActive]}
            onPress={toggleMute}
          >
            {isMuted ? (
              <MicOff size={24} color="#fff" />
            ) : (
              <Mic size={24} color="#fff" />
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.controlButton, isVideoEnabled && styles.controlButtonActive]}
            onPress={toggleVideo}
          >
            {isVideoEnabled ? (
              <Video size={24} color="#fff" />
            ) : (
              <VideoOff size={24} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        {/* Leave button */}
        <TouchableOpacity
          style={styles.leaveButton}
          onPress={handleLeave}
        >
          <PhoneOff size={24} color="#fff" />
          <Text style={styles.leaveText}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backText: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: '500',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  roomName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  orgName: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  participantCount: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  participantCountText: {
    color: '#888',
    fontSize: 12,
  },
  participantsList: {
    padding: 16,
  },
  participantCard: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    margin: 4,
    backgroundColor: '#111',
    borderRadius: 12,
    maxWidth: '48%',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#666',
    fontSize: 24,
    fontWeight: '600',
  },
  mutedIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#111',
  },
  speakingIndicator: {
    position: 'absolute',
    bottom: -4,
    left: '50%',
    marginLeft: -4,
    width: 8,
    height: 8,
    backgroundColor: '#22c55e',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#111',
  },
  participantName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  videoIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  selfControls: {
    flexDirection: 'row',
    gap: 12,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonActive: {
    backgroundColor: '#3b82f6',
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ef4444',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  leaveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
