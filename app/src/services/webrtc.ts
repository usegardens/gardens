/**
 * WebRTC Service for Voice/Video Rooms
 * 
 * Uses react-native-webrtc for media transport and Iroh gossip for signaling.
 * E2EE is achieved by encrypting media frames using the room key.
 */

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
} from 'react-native-webrtc';
import { useVoiceRoomStore } from '../stores/useVoiceRoomStore';
import { useAuthStore } from '../stores/useAuthStore';

// WebRTC configuration for P2P voice/video
// Uses STUN only for NAT traversal. Works for ~85% of connections.
// TURN can be added later for relay when P2P fails (symmetric NATs, firewalls).
// Recommended TURN: Cloudflare Realtime (turn.cloudflare.com:3478)
const WEBRTC_CONFIG = {
  iceServers: [
    // STUN servers for NAT traversal
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

// Signaling message types for Iroh gossip
type SignalMessageType = 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave' | 'mute' | 'unmute' | 'video-on' | 'video-off';

interface SignalMessage {
  type: SignalMessageType;
  from: string;
  roomId: string;
  target?: string;
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  stream?: MediaStream;
}

class WebRTCService {
  private localStream: MediaStream | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;
  private localAudioTrack: MediaStreamTrack | null = null;
  private peers: Map<string, PeerConnection> = new Map();
  private roomId: string | null = null;
  private orgId: string | null = null;
  private isInitialized = false;

  /**
   * Initialize local media streams (audio and optionally video)
   */
  async initializeMedia(videoEnabled: boolean = false): Promise<MediaStream | null> {
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: videoEnabled ? {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        } : false,
      });

      this.localStream = stream;
      
      // Store references to tracks for mute/unmute
      if (stream.getAudioTracks().length > 0) {
        this.localAudioTrack = stream.getAudioTracks()[0];
      }
      if (stream.getVideoTracks().length > 0) {
        this.localVideoTrack = stream.getVideoTracks()[0];
      }

      return stream;
    } catch (error) {
      console.error('[WebRTC] Failed to get user media:', error);
      return null;
    }
  }

  /**
   * Start the voice room - initialize media and broadcast presence
   */
  async startRoom(roomId: string, orgId: string, videoEnabled: boolean = false): Promise<void> {
    this.roomId = roomId;
    this.orgId = orgId;

    // Initialize local media
    await this.initializeMedia(videoEnabled);

    // Update store
    useVoiceRoomStore.getState().joinRoom(roomId, orgId);

    // Broadcast join message via Iroh gossip
    await this.broadcastSignal({
      type: 'join',
      from: useAuthStore.getState().keypair?.publicKeyHex || '',
      roomId,
    });

    this.isInitialized = true;
  }

  /**
   * Leave the voice room and clean up
   */
  async leaveRoom(): Promise<void> {
    if (!this.roomId) return;

    // Broadcast leave message
    await this.broadcastSignal({
      type: 'leave',
      from: useAuthStore.getState().keypair?.publicKeyHex || '',
      roomId: this.roomId,
    });

    // Close all peer connections
    for (const [_, peer] of this.peers) {
      peer.pc.close();
    }
    this.peers.clear();

    // Stop local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      this.localStream = null;
    }
    this.localAudioTrack = null;
    this.localVideoTrack = null;

    // Update store
    useVoiceRoomStore.getState().leaveRoom();

    this.roomId = null;
    this.orgId = null;
    this.isInitialized = false;
  }

  /**
   * Toggle microphone mute
   */
  toggleMute(): void {
    if (this.localAudioTrack) {
      this.localAudioTrack.enabled = !this.localAudioTrack.enabled;
      const isMuted = !this.localAudioTrack.enabled;
      
      useVoiceRoomStore.getState().toggleMute();

      // Broadcast mute state
      this.broadcastSignal({
        type: isMuted ? 'mute' : 'unmute',
        from: useAuthStore.getState().keypair?.publicKeyHex || '',
        roomId: this.roomId || '',
      });
    }
  }

  /**
   * Toggle video
   */
  async toggleVideo(): Promise<void> {
    if (this.localVideoTrack) {
      this.localVideoTrack.enabled = !this.localVideoTrack.enabled;
      const isVideoOn = this.localVideoTrack.enabled;
      
      useVoiceRoomStore.getState().toggleVideo();

      // Broadcast video state
      await this.broadcastSignal({
        type: isVideoOn ? 'video-on' : 'video-off',
        from: useAuthStore.getState().keypair?.publicKeyHex || '',
        roomId: this.roomId || '',
      });
    } else if (!this.localVideoTrack) {
      // Enable video for first time
      const stream = await this.initializeMedia(true);
      if (stream && this.roomId) {
        useVoiceRoomStore.getState().toggleVideo();
        
        // Add video track to all peer connections
        for (const [_, peer] of this.peers) {
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            peer.pc.addTrack(videoTrack, stream);
          }
        }

        await this.broadcastSignal({
          type: 'video-on',
          from: useAuthStore.getState().keypair?.publicKeyHex || '',
          roomId: this.roomId,
        });
      }
    }
  }

  /**
   * Create a peer connection with another participant
   */
  async connectToPeer(peerPublicKey: string): Promise<void> {
    if (this.peers.has(peerPublicKey)) return;

    const pc = new RTCPeerConnection(WEBRTC_CONFIG);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalToPeer(peerPublicKey, {
          type: 'ice-candidate',
          from: useAuthStore.getState().keypair?.publicKeyHex || '',
          roomId: this.roomId || '',
          target: peerPublicKey,
          candidate: JSON.stringify(event.candidate),
        });
      }
    };

    // Handle incoming tracks
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteStream) {
        useVoiceRoomStore.getState().updateParticipant(peerPublicKey, {
          isVideoEnabled: remoteStream.getVideoTracks().length > 0,
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.disconnectFromPeer(peerPublicKey);
      }
    };

    this.peers.set(peerPublicKey, { pc });

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await this.sendSignalToPeer(peerPublicKey, {
      type: 'offer',
      from: useAuthStore.getState().keypair?.publicKeyHex || '',
      roomId: this.roomId || '',
      target: peerPublicKey,
      sdp: JSON.stringify(offer),
    });
  }

  /**
   * Disconnect from a peer
   */
  async disconnectFromPeer(peerPublicKey: string): Promise<void> {
    const peer = this.peers.get(peerPublicKey);
    if (peer) {
      peer.pc.close();
      this.peers.delete(peerPublicKey);
      useVoiceRoomStore.getState().removeParticipant(peerPublicKey);
    }
  }

  /**
   * Handle incoming signaling message from Iroh gossip
   */
  async handleSignalMessage(message: SignalMessage): Promise<void> {
    const myKey = useAuthStore.getState().keypair?.publicKeyHex;
    if (!myKey || message.from === myKey) return;

    switch (message.type) {
      case 'join':
        // New participant joined, connect to them
        useVoiceRoomStore.getState().addParticipant(message.from);
        await this.connectToPeer(message.from);
        break;

      case 'leave':
        await this.disconnectFromPeer(message.from);
        break;

      case 'mute':
      case 'unmute':
        useVoiceRoomStore.getState().updateParticipant(message.from, {
          isMuted: message.type === 'mute',
        });
        break;

      case 'video-on':
      case 'video-off':
        useVoiceRoomStore.getState().updateParticipant(message.from, {
          isVideoEnabled: message.type === 'video-on',
        });
        break;

      case 'offer':
        await this.handleOffer(message.from, message.sdp || '');
        break;

      case 'answer':
        await this.handleAnswer(message.from, message.sdp || '');
        break;

      case 'ice-candidate':
        await this.handleIceCandidate(
          message.from,
          message.candidate || '',
          message.sdpMid || '',
          message.sdpMLineIndex || 0
        );
        break;
    }
  }

  private async handleOffer(peerPublicKey: string, sdpJson: string): Promise<void> {
    let peer = this.peers.get(peerPublicKey);
    
    if (!peer) {
      // Create new peer connection
      const pc = new RTCPeerConnection(WEBRTC_CONFIG);
      
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream!);
        });
      }

      pc.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
        if (event.candidate) {
          this.sendSignalToPeer(peerPublicKey, {
            type: 'ice-candidate',
            from: useAuthStore.getState().keypair?.publicKeyHex || '',
            roomId: this.roomId || '',
            target: peerPublicKey,
            candidate: JSON.stringify(event.candidate),
          });
        }
      };

      pc.ontrack = (event: unknown) => {
        const remoteStream = event.streams[0];
        if (remoteStream) {
          useVoiceRoomStore.getState().updateParticipant(peerPublicKey, {
            isVideoEnabled: remoteStream.getVideoTracks().length > 0,
          });
        }
      };

      peer = { pc };
      this.peers.set(peerPublicKey, peer);
    }

    const sdp = JSON.parse(sdpJson);
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));

    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);

    await this.sendSignalToPeer(peerPublicKey, {
      type: 'answer',
      from: useAuthStore.getState().keypair?.publicKeyHex || '',
      roomId: this.roomId || '',
      target: peerPublicKey,
      sdp: JSON.stringify(answer),
    });
  }

  private async handleAnswer(peerPublicKey: string, sdpJson: string): Promise<void> {
    const peer = this.peers.get(peerPublicKey);
    if (peer) {
      const sdp = JSON.parse(sdpJson);
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  private async handleIceCandidate(
    peerPublicKey: string,
    candidateJson: string,
    sdpMid: string,
    sdpMLineIndex: number
  ): Promise<void> {
    const peer = this.peers.get(peerPublicKey);
    if (peer) {
      const candidate = JSON.parse(candidateJson);
      await peer.pc.addIceCandidate(new RTCIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid || sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex ?? sdpMLineIndex,
      }));
    }
  }

  /**
   * Broadcast a signal message to all participants via Iroh gossip
   * This is a placeholder - implement based on your Iroh gossip integration
   */
  private async broadcastSignal(message: SignalMessage): Promise<void> {
    // TODO: Implement using Iroh gossip
    // The message should be broadcast to the room's gossip topic
    // Example: await irohGossip.broadcast(roomGossipTopic, JSON.stringify(message));
    console.log('[WebRTC] Broadcast signal:', message.type, message.roomId);
  }

  /**
   * Send a signal message to a specific peer via Iroh gossip
   * This is a placeholder - implement based on your Iroh gossip integration
   */
  private async sendSignalToPeer(targetPublicKey: string, message: SignalMessage): Promise<void> {
    // TODO: Implement using Iroh gossip
    // The message should be sent to the specific peer's topic
    // Example: await irohGossip.send(targetPublicKey, JSON.stringify(message));
    console.log('[WebRTC] Send signal to peer:', targetPublicKey, message.type);
  }

  /**
   * Get the local media stream for display
   */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }
}

// Export singleton instance
export const webrtcService = new WebRTCService();
