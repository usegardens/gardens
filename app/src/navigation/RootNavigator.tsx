/**
 * RootNavigator
 *
 * Layout: Single stack with a floating circular + button that opens a bottom
 * sheet for primary actions. Header avatar opens a profile sheet. Bottom tab
 * bar removed.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Linking,
  AppState,
  type AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetManager } from 'react-native-actions-sheet';
import { Settings, Plus } from 'lucide-react-native';
import { useAuthStore } from '../stores/useAuthStore';
import { useProfileStore } from '../stores/useProfileStore';
import { registerPushToken, setupForegroundHandler, setupTokenRefreshHandler, setupNotificationOpenHandler } from '../services/pushNotifications';
import { useSettingsStore } from '../stores/useSettingsStore';

import { WelcomeScreen } from '../screens/WelcomeScreen';
import { NotificationsPermissionScreen } from '../screens/NotificationsPermissionScreen';
import { SignupScreen } from '../screens/SignupScreen';
import { SeedRecoveryScreen } from '../screens/SeedRecoveryScreen';
import { DiscoverOrgsScreen } from '../screens/DiscoverOrgsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { OrgChatScreen } from '../screens/OrgChatScreen';
import { OrgSettingsScreen } from '../screens/OrgSettingsScreen';
import { UserSettingsScreen } from '../screens/UserSettingsScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { RequestsScreen } from '../screens/RequestsScreen';
import { MemberListScreen } from '../screens/MemberListScreen';
import { AuditLogScreen } from '../screens/AuditLogScreen';
import { OrgInviteScreen } from '../screens/OrgInviteScreen';
import { JoinOrgRequestScreen } from '../screens/JoinOrgRequestScreen';
import { QrScannerScreen } from '../screens/QrScannerScreen';
import { DebugConnectionPanel } from '../components/DebugConnectionPanel';
import { LockScreen } from '../components/LockScreen';
import { DonationPromptModal } from '../components/DonationPromptModal';
import { parseGardensLink } from '../utils/gardensLinks';

const gardensLogo = require('../../assets/gardens-logo.png');
const DONATION_PROMPT_LAST_SHOWN_KEY = 'gardens.donations.lastPromptShownAtMs';
const DONATION_PROMPT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const DONATION_PROMPT_DELAY_MS = 2000;

// ─── Param lists ──────────────────────────────────────────────────────────────

export type AuthStackParamList = {
  Welcome: undefined;
  Signup: undefined;
  SeedRecovery: undefined;
  NotificationsPermission: {
    username: string;
    bio: string;
    profilePicUri: string | null;
  };
};

export type MainStackParamList = {
  Home: undefined;
  Inbox: undefined;
  Requests: undefined;
  DiscoverOrgs: undefined;
  OrgChat: { orgId: string; orgName: string; initialRoomId?: string };
  OrgSettings: { orgId: string; orgName: string };
  OrgInvite: { orgId: string; orgName: string };
  MemberList: { orgId: string; orgName: string };
  AuditLog: { orgId: string; orgName: string };
  JoinOrgRequest: { z32Key?: string; orgId?: string; adminKey?: string; orgName?: string; tokenBase64?: string };
  QrScanner: undefined;
  Conversation: {
    threadId: string;
    recipientKey: string;
    orgId?: string;
    orgName?: string;
    conversationLabel?: string;
  };
  Profile: undefined;
  Settings: undefined;
};

// ─── Navigators ───────────────────────────────────────────────────────────────

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
      <AuthStack.Screen name="Signup"  component={SignupScreen} />
      <AuthStack.Screen name="SeedRecovery" component={SeedRecoveryScreen} />
      <AuthStack.Screen name="NotificationsPermission" component={NotificationsPermissionScreen} />
    </AuthStack.Navigator>
  );
}


// ─── Header avatar ─────────────────────────────────────────────────────────────

type HeaderAvatarProps = {
  profilePicUri: string | null;
  initials: string;
  onPress: () => void;
};

function HeaderAvatar({ profilePicUri, initials, onPress }: HeaderAvatarProps) {
  return (
    <TouchableOpacity style={navStyles.avatarBtn} onPress={onPress}>
      {profilePicUri ? (
        <Image source={{ uri: profilePicUri }} style={navStyles.avatarImg} />
      ) : (
        <View style={navStyles.avatarCircle}>
          <Text style={navStyles.avatarInitials}>{initials}</Text>
        </View>
      )}
      <View style={navStyles.onlineDot} />
    </TouchableOpacity>
  );
}



// ─── Screens: Profile/Settings placeholders ───────────────────────────────────

function ProfileScreen() {
  return (
    <View style={placeholderStyles.root}>
      <Text style={placeholderStyles.title}>My Profile</Text>
      <Text style={placeholderStyles.subtitle}>View and edit your profile.</Text>
    </View>
  );
}


const placeholderStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#888', marginTop: 8 },
});

function MainNavigator() {
  const [currentScreen, setCurrentScreen] = useState('Home');
  const [donationPromptVisible, setDonationPromptVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const { keypair } = useAuthStore();
  const { myProfile, profilePicUri, localUsername, loadProfilePicUri, loadLocalUsername, fetchMyProfile } = useProfileStore();
  useEffect(() => {
    loadProfilePicUri();
    loadLocalUsername();
    fetchMyProfile();
    const publicKey = keypair?.publicKeyHex;
    async function initPush() {
      const { loadSettings } = useSettingsStore.getState();
      await loadSettings();
      if (publicKey && useSettingsStore.getState().pushNotificationsEnabled) {
        registerPushToken(publicKey).catch(() => {});
      }
    }
    initPush();
    const unsubscribeForeground = setupForegroundHandler();
    const unsubscribeTokenRefresh = publicKey ? setupTokenRefreshHandler(publicKey) : () => {};
    return () => {
      unsubscribeForeground();
      unsubscribeTokenRefresh();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep link handler ──────────────────────────────────────────────────────
  const navigationRef = useRef<any>(null);

  function handleNotificationOpen(data: Record<string, string>) {
    if (data.threadId && data.recipientKey) {
      setTimeout(() => {
        navigationRef.current?.navigate('Conversation', {
          threadId: data.threadId,
          recipientKey: data.recipientKey,
        });
      }, 100);
    } else if (data.orgId) {
      import('../stores/useOrgsStore').then(({ useOrgsStore }) => {
        useOrgsStore.getState().fetchMyOrgs().then(() => {
          const org = useOrgsStore.getState().orgs.find(o => o.orgId === data.orgId);
          setTimeout(() => {
            if (org) {
              navigationRef.current?.navigate('OrgChat', { orgId: data.orgId, orgName: org.name });
            } else {
              navigationRef.current?.navigate('Home');
            }
          }, 100);
        }).catch(() => {});
      });
    }
  }

  useEffect(() => {
    const unsubscribeNotificationOpen = setupNotificationOpenHandler(handleNotificationOpen);
    return () => unsubscribeNotificationOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleUrl(url: string) {
      if (!url) return;
      const parsedLink = parseGardensLink(url);
      if (!parsedLink) return;

      if (parsedLink.kind === 'dm') {
        const recipientKey = parsedLink.recipientKey;
        if (recipientKey) {
          import('../stores/useConversationsStore').then(({ useConversationsStore }) => {
            useConversationsStore.getState().createConversation(recipientKey).then(threadId => {
              setTimeout(() => {
                navigationRef.current?.navigate('Conversation', { threadId, recipientKey });
              }, 100);
            }).catch(() => {});
          });
        }
        return;
      }

      if (parsedLink.kind === 'pk') {
        setTimeout(() => {
          navigationRef.current?.navigate('JoinOrgRequest', { z32Key: parsedLink.z32Key });
        }, 100);
        return;
      }

      if (parsedLink.kind === 'join') {
        setTimeout(() => {
          navigationRef.current?.navigate('JoinOrgRequest', {
            orgId: parsedLink.orgId,
            adminKey: parsedLink.adminKey,
            z32Key: parsedLink.z32Key,
            orgName: parsedLink.orgName,
          });
        }, 100);
        return;
      }

      if (parsedLink.kind === 'invite') {
        setTimeout(() => {
          navigationRef.current?.navigate('JoinOrgRequest', {
            tokenBase64: parsedLink.tokenBase64,
            orgName: parsedLink.orgName,
          });
        }, 100);
      }
    }

    // Cold start: app opened via deep link
    Linking.getInitialURL().then(url => { if (url) handleUrl(url); }).catch(() => {});

    // Warm start: app already open
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const lastPromptRaw = await AsyncStorage.getItem(DONATION_PROMPT_LAST_SHOWN_KEY);
          const lastPromptAt = Number(lastPromptRaw ?? '0');
          const withinWindow =
            Number.isFinite(lastPromptAt) &&
            lastPromptAt > 0 &&
            Date.now() - lastPromptAt < DONATION_PROMPT_INTERVAL_MS;
          if (withinWindow || cancelled) return;
          await AsyncStorage.setItem(DONATION_PROMPT_LAST_SHOWN_KEY, String(Date.now()));
          if (!cancelled) setDonationPromptVisible(true);
        } catch {
          if (!cancelled) setDonationPromptVisible(true);
        }
      })();
    }, DONATION_PROMPT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const initials = (myProfile?.username ?? localUsername ?? '?').slice(0, 2).toUpperCase();

  return (
    <>
      <MainStack.Navigator
        ref={navigationRef}
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0a0a' },
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#0a0a0a' },
        }}
        screenListeners={{
          focus: (e) => {
            const target = typeof e.target === 'string' ? e.target : '';
            const name = target.split('-')[0];
            if (name) setCurrentScreen(name);
          },
        }}
      >
        <MainStack.Screen
          name="Home"
          component={HomeScreen}
          options={() => ({
            headerTitleAlign: 'center',
            headerTitleContainerStyle: { left: 0, right: 0 },
            headerTitle: () => (
              <Image source={gardensLogo} style={navStyles.headerLogo} resizeMode="contain" />
            ),
            headerLeft: () => (
              <View style={navStyles.homeSideSlot}>
                <HeaderAvatar
                  profilePicUri={profilePicUri}
                  initials={initials}
                  onPress={() => SheetManager.show('profile-sheet')}
                />
              </View>
            ),
            headerRight: () => (
              <View style={[navStyles.homeSideSlot, navStyles.homeSideSlotRight]}>
                <DebugConnectionPanel />
              </View>
            ),
          })}
        />

        <MainStack.Screen
          name="Inbox"
          component={InboxScreen}
          options={{ title: 'Requests', headerShown: true }}
        />
        <MainStack.Screen
          name="Requests"
          component={RequestsScreen}
          options={{ title: 'Message Requests', headerShown: true }}
        />
        <MainStack.Screen
          name="DiscoverOrgs"
          component={DiscoverOrgsScreen}
          options={{ title: 'Discover Communities', headerShown: true }}
        />
        <MainStack.Screen
          name="OrgChat"
          component={OrgChatScreen}
          options={{ headerShown: true }}
        />
        <MainStack.Screen
          name="Conversation"
          component={ConversationScreen}
          options={{ title: 'Conversation', headerShown: true }}
        />
        <MainStack.Screen
          name="OrgSettings"
          component={OrgSettingsScreen}
          options={{ title: 'Server Settings', headerShown: true }}
        />
        <MainStack.Screen
          name="OrgInvite"
          component={OrgInviteScreen}
          options={{ title: 'Invite Members', headerShown: true }}
        />
        <MainStack.Screen
          name="MemberList"
          component={MemberListScreen}
          options={{ title: 'Members', headerShown: true }}
        />
        <MainStack.Screen
          name="JoinOrgRequest"
          component={JoinOrgRequestScreen}
          options={{ title: 'Join Organization', headerShown: true }}
        />
        <MainStack.Screen
          name="QrScanner"
          component={QrScannerScreen}
          options={{ title: 'Join Org', headerShown: true }}
        />

        <MainStack.Screen
          name="Profile"
          component={ProfileScreen}
          options={({ navigation }) => ({
            title: 'Profile',
            headerRight: () => (
              <TouchableOpacity style={navStyles.gear} onPress={() => navigation.navigate('Settings')}>
                <Settings size={20} color="#fff" />
              </TouchableOpacity>
            ),
          })}
        />
        <MainStack.Screen
          name="Settings"
          component={UserSettingsScreen}
          options={{ title: 'Settings' }}
        />
      </MainStack.Navigator>

      {/* Floating + button — only on Home */}
      {currentScreen === 'Home' && (
        <View pointerEvents="box-none" style={[fabStyles.container, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <TouchableOpacity style={fabStyles.fab} onPress={() => SheetManager.show('fab-sheet')}>
            <Plus size={24} color="#000" />
          </TouchableOpacity>
        </View>
      )}

      {donationPromptVisible ? (
        <DonationPromptModal
          visible={donationPromptVisible}
          onDismiss={() => setDonationPromptVisible(false)}
        />
      ) : null}

    </>
  );
}

const navStyles = StyleSheet.create({
  avatarBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  avatarImg: { width: 34, height: 34, borderRadius: 17 },
  avatarCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#fff', fontSize: 13, fontWeight: '700' },
  onlineDot: { position: 'absolute', bottom: 4, right: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#0a0a0a' },
  homeSideSlot: { minWidth: 68, justifyContent: 'center' },
  homeSideSlotRight: { alignItems: 'flex-end' },
  headerLogo: { width: 120, height: 56 },
  gear: { paddingHorizontal: 12, paddingVertical: 4 },
});

const fabStyles = StyleSheet.create({
  container: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, justifyContent: 'flex-end', alignItems: 'center', padding: 20 },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F2E58F', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
});

// ─── Root ─────────────────────────────────────────────────────────────────────

export function RootNavigator() {
  const { isUnlocked, hasStoredKey, lock, checkHasStoredKey } = useAuthStore();
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Determine whether an account exists. Unlock is explicit from LockScreen.
    checkHasStoredKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 30-second background auto-lock
  useEffect(() => {
    function handleAppStateChange(nextState: AppStateStatus) {
      if (nextState === 'background' || nextState === 'inactive') {
        if (lockTimer.current) clearTimeout(lockTimer.current);
        lockTimer.current = setTimeout(() => {
          lock();
        }, 30_000);
      } else if (nextState === 'active') {
        if (lockTimer.current) {
          clearTimeout(lockTimer.current);
          lockTimer.current = null;
        }
      }
    }

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
      if (lockTimer.current) clearTimeout(lockTimer.current);
    };
  }, [lock]);

  // Splash while we haven't determined state yet
  if (isUnlocked === null) {
    return (
      <View style={splash.root}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // Has account but locked — show lock screen overlay
  if (!isUnlocked && hasStoredKey) {
    return <LockScreen />;
  }

  // No account — show auth flow
  if (!isUnlocked) {
    return <AuthNavigator />;
  }

  // Unlocked — show main app
  return <MainNavigator />;
}

const splash = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
});
