import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Linking, PermissionsAndroid, Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Copy, Download, ExternalLink, MessageSquare } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '../navigation/RootNavigator';
import { useOrgsStore } from '../stores/useOrgsStore';
import { useOrgAdminThreadsStore } from '../stores/useOrgAdminThreadsStore';
import QRCode from 'react-native-qrcode-svg';
import RNFS from 'react-native-fs';

type Props = NativeStackScreenProps<MainStackParamList, 'OrgInvite'>;

const APP_STORE_URL = 'https://apps.apple.com/';
const PLAY_STORE_URL = 'https://play.google.com/store';
const GARDENS_SCHEME = 'gardens://';

export function OrgInviteScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { orgId, orgName } = route.params;
  const { orgs } = useOrgsStore();
  const { createOrgAdminThread } = useOrgAdminThreadsStore();
  const qrCodeRef = useRef<any>(null);
  const [savingQr, setSavingQr] = useState(false);

  const org = orgs.find(item => item.orgId === orgId);
  const orgContactKey = useMemo(() => org?.orgPubkey ?? null, [org]);

  // Public join link - anyone can join with the org's public key
  const publicJoinLink = useMemo(() => {
    if (!orgContactKey) return null;
    return `${GARDENS_SCHEME}join?orgId=${encodeURIComponent(orgId)}&adminKey=${encodeURIComponent(orgContactKey)}&name=${encodeURIComponent(orgName)}`;
  }, [orgContactKey, orgId, orgName]);

  function handleCopyOrgKey() {
    if (!orgContactKey) return;
    Alert.alert('Copied', 'Organization public key copied to clipboard.');
  }

  function handleCopyInviteLink() {
    if (!publicJoinLink) return;
    Alert.alert('Copied', 'Join link copied to clipboard.');
  }

  async function handleMessageOrgInbox() {
    if (!orgContactKey) return;
    try {
      const threadId = await createOrgAdminThread(orgId, orgContactKey);
      navigation.navigate('Conversation', {
        threadId,
        recipientKey: orgContactKey,
        orgId,
        orgName,
        conversationLabel: `${orgName} admins`,
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to start org admin conversation');
    }
  }

  async function openLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Link unavailable', url);
    }
  }

  async function ensureDownloadPermission(): Promise<boolean> {
    if (Platform.OS !== 'android' || Platform.Version > 29) return true;
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE, {
      title: 'Storage access',
      message: 'Gardens needs storage access to save the QR code image.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function handleDownloadQr() {
    if (!publicJoinLink || !qrCodeRef.current || savingQr) return;
    setSavingQr(true);
    try {
      const hasPermission = await ensureDownloadPermission();
      if (!hasPermission) {
        Alert.alert('Permission needed', 'Storage access is required to save the QR code.');
        return;
      }

      const pngBase64 = await new Promise<string>((resolve, reject) => {
        qrCodeRef.current?.toDataURL((data: string) => {
          if (data) {
            resolve(data);
          } else {
            reject(new Error('QR image data was empty.'));
          }
        });
      });

      const safeName = orgName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'invite';
      const fileName = `gardens-${safeName}-qr.png`;
      const baseDir = Platform.OS === 'android' ? RNFS.DownloadDirectoryPath : RNFS.DocumentDirectoryPath;
      const filePath = `${baseDir}/${fileName}`;
      await RNFS.writeFile(filePath, pngBase64, 'base64');
      Alert.alert('QR saved', `Saved to ${filePath}`);
    } catch (err: any) {
      Alert.alert('Save failed', err?.message || 'Could not save the QR code.');
    } finally {
      setSavingQr(false);
    }
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 36 }]}>
      <Text style={s.title}>Share Organization</Text>
      <Text style={s.subtitle}>Anyone can join using the link below</Text>

      {/* Public Organization Section - shows org key for sharing */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <MessageSquare size={20} color="#2fb466" />
          <Text style={s.cardTitle}>Organization Key</Text>
        </View>
        <Text style={s.cardDescription}>
          Share this key or QR code. Anyone can use it to join your organization.
        </Text>
        {publicJoinLink ? (
          <View style={s.qrWrap}>
            <QRCode
              getRef={ref => { qrCodeRef.current = ref; }}
              value={publicJoinLink}
              size={200}
              backgroundColor="#ffffff"
              color="#101418"
            />
          </View>
        ) : null}
        <View style={s.keyBox}>
          <Text style={s.keyText}>{orgContactKey ?? 'Loading...'}</Text>
        </View>
        <View style={s.actionRow}>
          <TouchableOpacity style={s.actionBtn} onPress={handleCopyOrgKey} disabled={!orgContactKey}>
            <Copy size={18} color="#fff" />
            <Text style={s.actionText}>Copy Key</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={handleCopyInviteLink} disabled={!publicJoinLink}>
            <Copy size={18} color="#fff" />
            <Text style={s.actionText}>Copy Link</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={handleDownloadQr} disabled={!publicJoinLink || savingQr}>
            <Download size={18} color="#fff" />
            <Text style={s.actionText}>{savingQr ? 'Saving…' : 'QR'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Message Admins */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <MessageSquare size={20} color="#e8d392" />
          <Text style={s.cardTitle}>Message Admins</Text>
        </View>
        <Text style={s.cardDescription}>
          Start a conversation with the org admins to ask questions or discuss.
        </Text>
        <TouchableOpacity
          style={[s.primaryBtn, !orgContactKey && s.btnDisabled]}
          onPress={handleMessageOrgInbox}
          disabled={!orgContactKey}
        >
          <MessageSquare size={18} color="#000" />
          <Text style={s.primaryBtnText}>Message Admins</Text>
        </TouchableOpacity>
      </View>

      {/* Install Links */}
      <View style={s.card}>
        <Text style={s.sectionTitle}>Get the App</Text>
        <Text style={s.cardDescription}>
          Share these store links alongside your org key so new members can install Gardens.
        </Text>
        <View style={s.storeButtons}>
          <TouchableOpacity style={s.storeBtn} onPress={() => openLink(APP_STORE_URL)}>
            <ExternalLink size={18} color="#fff" />
            <Text style={s.storeBtnText}>App Store</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.storeBtn} onPress={() => openLink(PLAY_STORE_URL)}>
            <ExternalLink size={18} color="#fff" />
            <Text style={s.storeBtnText}>Play Store</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 36 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#777', fontSize: 14, marginBottom: 20 },
  card: {
    backgroundColor: '#161616',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#252525',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cardDescription: { color: '#999', fontSize: 13, lineHeight: 18, marginBottom: 16 },
  sectionTitle: { color: '#9ca3af', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 },
  qrWrap: { marginVertical: 12, alignItems: 'center', paddingVertical: 16, backgroundColor: '#ffffff', borderRadius: 12 },
  keyBox: { backgroundColor: '#0b0b0b', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#202020' },
  keyText: { color: '#e5e7eb', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#252525' },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#e8d392',
  },
  primaryBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  storeButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  storeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 10, backgroundColor: '#252525' },
  storeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
