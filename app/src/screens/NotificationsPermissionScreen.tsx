import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { AuthorizationStatus, getMessaging, requestPermission as requestMessagingPermission } from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { useAuthStore } from '../stores/useAuthStore';
import { useProfileStore } from '../stores/useProfileStore';
import { useSettingsStore } from '../stores/useSettingsStore';

type Props = NativeStackScreenProps<AuthStackParamList, 'NotificationsPermission'>;

export function NotificationsPermissionScreen({ route }: Props) {
  const messagingInstance = getMessaging();
  const { username, bio, profilePicUri } = route.params;
  const [loading, setLoading] = useState(false);

  const createAccount = useAuthStore(s => s.createAccount);
  const { setProfilePicUri, setLocalUsername, createOrUpdateProfile } = useProfileStore();
  const { setPushEnabled } = useSettingsStore();

  async function finishSignup(shouldRequestPermission: boolean) {
    setLoading(true);
    try {
      if (shouldRequestPermission) {
        const status = await requestMessagingPermission(messagingInstance);
        const granted =
          status === AuthorizationStatus.AUTHORIZED ||
          status === AuthorizationStatus.PROVISIONAL;
        if (Platform.OS === 'android' && granted) {
          await notifee.requestPermission();
        }
        await setPushEnabled(granted);
        if (!granted) {
          throw new Error('Notifications permission was not granted.');
        }
      } else {
        await setPushEnabled(false);
      }

      await createAccount();
      await setLocalUsername(username);
      await createOrUpdateProfile(username, bio || null, []);
      if (profilePicUri) {
        await setProfilePicUri(profilePicUri);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Account creation failed', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Text style={styles.iconText}>N</Text>
        </View>
        <Text style={styles.heading}>Stay in the loop</Text>
        <Text style={styles.body}>
          Get notified when you receive new messages, invites, and mentions — even when the app is closed.
        </Text>
      </View>

      <View style={styles.actions}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => finishSignup(true)}>
              <Text style={styles.primaryBtnText}>Enable Notifications</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipBtn} onPress={() => finishSignup(false)}>
              <Text style={styles.skipBtnText}>Not now</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'space-between' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F2E58F',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconText: { fontSize: 36, color: '#0a0a0a', fontWeight: '700' },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 16 },
  body: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22 },
  actions: { padding: 24, paddingBottom: 40, gap: 12 },
  primaryBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
  skipBtn: { alignItems: 'center', paddingVertical: 14 },
  skipBtnText: { color: '#555', fontSize: 15 },
});
