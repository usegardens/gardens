import { Platform } from 'react-native';
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { DEFAULT_RELAY_URL } from '../stores/useProfileStore';

// ── Channel setup ─────────────────────────────────────────────────────────────
const NOTIFICATION_CHANNEL_ID = 'messages_loon_v1';
const ANDROID_NOTIFICATION_SOUND = 'loon';
const IOS_NOTIFICATION_SOUND = 'loon.mp3';
const messagingInstance = getMessaging();

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: NOTIFICATION_CHANNEL_ID,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    sound: ANDROID_NOTIFICATION_SOUND,
    vibration: true,
    lights: true,
  });
}

// ── Permission + token registration ──────────────────────────────────────────

export async function registerPushToken(publicKey: string): Promise<void> {
  const authStatus = await requestPermission(messagingInstance);
  const enabled =
    authStatus === AuthorizationStatus.AUTHORIZED ||
    authStatus === AuthorizationStatus.PROVISIONAL;

  if (!enabled) return;

  await ensureAndroidChannel();

  const token = await getToken(messagingInstance);

  await fetch(`${DEFAULT_RELAY_URL}/push/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, token }),
  }).catch(() => {});
}

// ── Display a local notification (used for foreground + background handler) ──

export async function displayNotification(title: string, body: string, data?: Record<string, string>) {
  await ensureAndroidChannel();
  await notifee.displayNotification({
    title,
    body,
    data,
    android: { channelId: NOTIFICATION_CHANNEL_ID, pressAction: { id: 'default' }, sound: ANDROID_NOTIFICATION_SOUND },
    ios: { sound: IOS_NOTIFICATION_SOUND },
  });
}

// ── Relay push helpers (called after send) ────────────────────────────────────

export async function sendDMPushNotification(params: {
  senderName: string;
  recipientKey: string;
  threadId: string;
  preview: string;
  titleOverride?: string;
}): Promise<void> {
  await fetch(`${DEFAULT_RELAY_URL}/push/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'dm',
      recipientKeys: [params.recipientKey],
      title: params.titleOverride ?? params.senderName,
      body: params.preview,
      data: { threadId: params.threadId, recipientKey: params.recipientKey },
    }),
  }).catch(() => {});
}

export async function sendMentionPushNotification(params: {
  senderName: string;
  mentionedKeys: string[];
  orgName: string;
  roomId: string;
  preview: string;
}): Promise<void> {
  if (params.mentionedKeys.length === 0) return;
  await fetch(`${DEFAULT_RELAY_URL}/push/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'mention',
      recipientKeys: params.mentionedKeys,
      title: `${params.senderName} mentioned you in ${params.orgName}`,
      body: params.preview,
      data: { roomId: params.roomId },
    }),
  }).catch(() => {});
}

export async function sendMemberAddedPushNotification(params: {
  recipientKey: string;
  orgName: string;
  orgId: string;
  accessLevel: string;
}): Promise<void> {
  const normalizedAccess = params.accessLevel.toLowerCase();
  await fetch(`${DEFAULT_RELAY_URL}/push/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'member_added',
      recipientKeys: [params.recipientKey],
      title: `Added to ${params.orgName} (${normalizedAccess})`,
      body: `You now have ${normalizedAccess} access. Tap to open.`,
      data: { type: 'member_added', orgId: params.orgId, accessLevel: params.accessLevel },
    }),
  }).catch(() => {});
}

export async function sendReplyPushNotification(params: {
  senderName: string;
  recipientKey: string;
  preview: string;
  orgId?: string;
  roomId?: string;
  orgName?: string;
}): Promise<void> {
  const title = params.orgName
    ? `${params.senderName} replied to you in ${params.orgName}`
    : `${params.senderName} replied to you`;

  await fetch(`${DEFAULT_RELAY_URL}/push/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'reply',
      recipientKeys: [params.recipientKey],
      title,
      body: params.preview,
      data: {
        type: 'reply',
        ...(params.orgId ? { orgId: params.orgId } : {}),
        ...(params.roomId ? { roomId: params.roomId } : {}),
      },
    }),
  }).catch(() => {});
}

// ── Token refresh handler (re-register when FCM token rotates) ───────────────

export function setupTokenRefreshHandler(publicKey: string): () => void {
  return onTokenRefresh(messagingInstance, async (newToken) => {
    await fetch(`${DEFAULT_RELAY_URL}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey, token: newToken }),
    }).catch(() => {});
  });
}

// ── Notification open handler (call once after auth, returns unsubscribe) ─────

export function setupNotificationOpenHandler(
  onOpen: (data: Record<string, string>) => void,
): () => void {
  async function refreshMyOrgsIfMembershipEvent(data?: Record<string, string>) {
    if (!data) return;
    if (data.type !== 'member_added' && !data.orgId) return;
    try {
      // Subscribe to the org topic first to receive the member-add operation
      if (data.orgId) {
        const { useSyncStore } = await import('../stores/useSyncStore');
        await useSyncStore.getState().hydrateTopic(data.orgId, { timeoutMs: 3000, settleMs: 400 });
      }
      const { useOrgsStore } = await import('../stores/useOrgsStore');
      await useOrgsStore.getState().fetchMyOrgs();
    } catch {
      // best-effort refresh
    }
  }

  // App in background: user taps notification
  const unsubscribe = onNotificationOpenedApp(messagingInstance, (remoteMessage) => {
    const data = remoteMessage.data as Record<string, string> | undefined;
    if (data) {
      refreshMyOrgsIfMembershipEvent(data).catch(() => {});
      onOpen(data);
    }
  });

  // App killed: opened by tapping notification
  getInitialNotification(messagingInstance).then((remoteMessage) => {
    const data = remoteMessage?.data as Record<string, string> | undefined;
    if (data) {
      refreshMyOrgsIfMembershipEvent(data).catch(() => {});
      onOpen(data);
    }
  });

  return unsubscribe;
}

// ── Background message handler (call once at app root) ───────────────────────

export function setupBackgroundHandler() {
  setBackgroundMessageHandler(messagingInstance, async (remoteMessage) => {
    const { title, body } = remoteMessage.notification ?? {};
    const data = remoteMessage.data as Record<string, string> | undefined;
    
    // Pre-sync org data in background for member_added notifications
    if (data && data.type === 'member_added' && data.orgId) {
      try {
        const { useSyncStore } = await import('../stores/useSyncStore');
        await useSyncStore.getState().hydrateTopic(data.orgId, { timeoutMs: 5000, settleMs: 600 });
        const { useOrgsStore } = await import('../stores/useOrgsStore');
        await useOrgsStore.getState().fetchMyOrgs();
      } catch {
        // best-effort background sync
      }
    }
    
    if (title && body) {
      await displayNotification(title, body, data);
    }
  });
}

// ── Foreground message handler (call once after auth) ────────────────────────

export function setupForegroundHandler(): () => void {
  return onMessage(messagingInstance, async (remoteMessage) => {
    const { title, body } = remoteMessage.notification ?? {};
    const data = remoteMessage.data as Record<string, string> | undefined;

    if (data && (data.type === 'member_added' || !!data.orgId)) {
      try {
        // Subscribe to the org topic first to receive the member-add operation
        if (data.orgId) {
          const { useSyncStore } = await import('../stores/useSyncStore');
          await useSyncStore.getState().hydrateTopic(data.orgId, { timeoutMs: 3000, settleMs: 400 });
        }
        const { useOrgsStore } = await import('../stores/useOrgsStore');
        await useOrgsStore.getState().fetchMyOrgs();
      } catch {
        // best-effort refresh
      }
    }

    if (title && body) {
      await displayNotification(title, body, data);
    }
  });
}
