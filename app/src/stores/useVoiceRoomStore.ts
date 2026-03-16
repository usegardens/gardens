import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { useProfileStore } from './useProfileStore';

export interface VoiceParticipant {
  publicKey: string;
  username: string;
  avatarBlobId: string | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isSpeaking: boolean;
  joinedAt: number;
}

interface VoiceRoomState {
  // Current room info
  currentRoomId: string | null;
  currentOrgId: string | null;
  isInCall: boolean;
  
  // Local user state
  isMuted: boolean;
  isVideoEnabled: boolean;
  
  // Participants
  participants: VoiceParticipant[];
  
  // Actions
  joinRoom: (roomId: string, orgId: string) => void;
  leaveRoom: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  addParticipant: (publicKey: string) => void;
  removeParticipant: (publicKey: string) => void;
  updateParticipant: (publicKey: string, updates: Partial<VoiceParticipant>) => void;
}

export const useVoiceRoomStore = create<VoiceRoomState>((set, get) => ({
  currentRoomId: null,
  currentOrgId: null,
  isInCall: false,
  isMuted: false,
  isVideoEnabled: false,
  participants: [],

  joinRoom: (roomId: string, orgId: string) => {
    const myKey = useAuthStore.getState().keypair?.publicKeyHex;
    const myProfile = useProfileStore.getState().myProfile;
    
    if (!myKey) return;
    
    const selfParticipant: VoiceParticipant = {
      publicKey: myKey,
      username: myProfile?.username ?? myKey.slice(0, 8),
      avatarBlobId: myProfile?.avatarBlobId ?? null,
      isMuted: false,
      isVideoEnabled: false,
      isSpeaking: false,
      joinedAt: Date.now(),
    };
    
    set({ 
      currentRoomId: roomId,
      currentOrgId: orgId,
      isInCall: true,
      isMuted: false,
      isVideoEnabled: false,
      participants: [selfParticipant],
    });
    
    // TODO: Initialize WebRTC connection and start broadcasting presence
    // TODO: Subscribe to room gossip topic for participant updates
  },

  leaveRoom: () => {
    set({
      currentRoomId: null,
      currentOrgId: null,
      isInCall: false,
      isMuted: false,
      isVideoEnabled: false,
      participants: [],
    });
    
    // TODO: Clean up WebRTC connections and stop broadcasting
  },

  toggleMute: () => {
    const { isMuted, currentRoomId } = get();
    if (!currentRoomId) return;
    
    set({ isMuted: !isMuted });
    
    // Update self in participants list
    const myKey = useAuthStore.getState().keypair?.publicKeyHex;
    if (myKey) {
      set(state => ({
        participants: state.participants.map(p => 
          p.publicKey === myKey ? { ...p, isMuted: !isMuted } : p
        ),
      }));
    }
    
    // TODO: Update WebRTC audio track enabled state
  },

  toggleVideo: () => {
    const { isVideoEnabled, currentRoomId } = get();
    if (!currentRoomId) return;
    
    set({ isVideoEnabled: !isVideoEnabled });
    
    // Update self in participants list
    const myKey = useAuthStore.getState().keypair?.publicKeyHex;
    if (myKey) {
      set(state => ({
        participants: state.participants.map(p => 
          p.publicKey === myKey ? { ...p, isVideoEnabled: !isVideoEnabled } : p
        ),
      }));
    }
    
    // TODO: Update WebRTC video track enabled state
  },

  addParticipant: (publicKey: string) => {
    const myKey = useAuthStore.getState().keypair?.publicKeyHex;
    if (publicKey === myKey) return; // Don't add self
    
    // Check if already exists
    const existing = get().participants.find(p => p.publicKey === publicKey);
    if (existing) return;
    
    // TODO: Fetch profile for this participant
    // For now, add with placeholder data
    const newParticipant: VoiceParticipant = {
      publicKey,
      username: publicKey.slice(0, 8),
      avatarBlobId: null,
      isMuted: true, // Assume muted until we get state
      isVideoEnabled: false,
      isSpeaking: false,
      joinedAt: Date.now(),
    };
    
    set(state => ({
      participants: [...state.participants, newParticipant],
    }));
    
    // TODO: Initiate WebRTC connection with this participant
  },

  removeParticipant: (publicKey: string) => {
    set(state => ({
      participants: state.participants.filter(p => p.publicKey !== publicKey),
    }));
    
    // TODO: Close WebRTC connection with this participant
  },

  updateParticipant: (publicKey: string, updates: Partial<VoiceParticipant>) => {
    set(state => ({
      participants: state.participants.map(p => 
        p.publicKey === publicKey ? { ...p, ...updates } : p
      ),
    }));
  },
}));
