import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Linking, Clipboard, PermissionsAndroid, Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SheetManager } from 'react-native-actions-sheet';
import { Copy, Download, ExternalLink, MessageSquare } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '../navigation/RootNavigator';
import { generateInviteToken } from '../ffi/gardensCore';
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
  const qrCodeRef = useRef<QRCode | null>(null);
  const [savingQr, setSavingQr] = useState(false);
  const org = orgs.find(item => item.orgId === orgId);
  const orgContactKey = useMemo(() => org?.orgPubkey ?? null, [org]);
  const privateInviteLink = useMemo(() => {
    if (!org || org.isPublic) return null;
    try {
      const expiryMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const token = generateInviteToken(orgId, 'read', expiryMs);
      return `${GARDENS_SCHEME}invite?token=${encodeURIComponent(token)}&name=${encodeURIComponent(orgName)}`;
    } catch {
      return null;
    }
  }, [org, orgId, orgName]);
  const publicJoinLink = useMemo(() => {
    if (!org?.isPublic || !orgContactKey) return null;
    return `${GARDENS_SCHEME}join?orgId=${encodeURIComponent(orgId)}&adminKey=${encodeURIComponent(orgContactKey)}&name=${encodeURIComponent(orgName)}`;
  }, [org?.isPublic, orgContactKey, orgId, orgName]);
  const qrValue = org?.isPublic ? publicJoinLink : privateInviteLink;
  const replayLink = qrValue;

  function handleCopyOrgKey() {
    if (!orgContactKey) return;
    Clipboard.setString(orgContactKey);
    Alert.alert('Copied', 'Org public key copied to clipboard.');
  }

  function handleCopyInviteLink() {
    if (!replayLink) return;
    Clipboard.setString(replayLink);
    Alert.alert('Copied', 'Invite link copied to clipboard.');
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
    if (!qrValue || !qrCodeRef.current || savingQr) return;
    setSavingQr(true);
    try {
      const hasPermission = await ensureDownloadPermission();
      if (!hasPermission) {
        Alert.alert('Permission needed', 'Storage access is required to save the QR code.');
        return;
      }

      const pngBase64 = await new Promise<string>((resolve, reject) => {
        qrCodeRef.current?.toDataURL(data => {
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
      <Text style={s.title}>Invite Members</Text>
      <Text style={s.subtitle}>Use the org public key for {orgName}</Text>

      <View style={s.card}>
        <Text style={s.sectionTitle}>{org?.isPublic ? 'Org Public Key' : 'Private Invite Link'}</Text>
        <Text style={s.bodyText}>
          {org?.isPublic
            ? 'Share the org public key, not a personal admin key. Messaging this key should create an org-admin thread that syncs into the admin inbox.'
            : 'Share this signed invite link for private access requests. Opening it lands the recipient in an admin request flow instead of auto-joining.'}
        </Text>
        {qrValue ? (
          <View style={s.qrWrap}>
            <QRCode
              getRef={ref => {
                qrCodeRef.current = ref;
              }}
              value={qrValue}
              size={220}
              backgroundColor="#ffffff"
              color="#101418"
            />
          </View>
        ) : null}
        <View style={s.keyBox}>
          <Text style={s.keyText}>
            {org?.isPublic
              ? (orgContactKey ?? 'Org public key not available yet.')
              : (privateInviteLink ?? 'Private invite link not available yet.')}
          </Text>
        </View>
        <View style={s.actionRow}>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={org?.isPublic ? handleCopyOrgKey : handleCopyInviteLink}
            disabled={org?.isPublic ? !orgContactKey : !privateInviteLink}
          >
            <Copy size={18} color="#fff" />
            <Text style={s.actionText}>{org?.isPublic ? 'Copy Key' : 'Copy Invite'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={handleMessageOrgInbox} disabled={!orgContactKey}>
            <MessageSquare size={18} color="#fff" />
            <Text style={s.actionText}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => SheetManager.show('join-org-sheet')}>
            <ExternalLink size={18} color="#fff" />
            <Text style={s.actionText}>Join Org</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.sectionTitle}>Invite Link</Text>
        <Text style={s.bodyText}>
          This is the exact raw link encoded into the QR code. You can copy it directly or save the QR as an image.
        </Text>
        <View style={s.keyBox}>
          <Text style={s.keyText}>{replayLink ?? 'Invite link not available yet.'}</Text>
        </View>
        <View style={s.actionRow}>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={handleCopyInviteLink}
            disabled={!replayLink}
          >
            <Copy size={18} color="#fff" />
            <Text style={s.actionText}>Copy Link</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={handleDownloadQr} disabled={!replayLink || savingQr}>
            <Download size={18} color="#fff" />
            <Text style={s.actionText}>{savingQr ? 'Saving…' : 'Download QR'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.sectionTitle}>Install Links</Text>
        <Text style={s.bodyText}>
          Share store links alongside the {org?.isPublic ? 'org public key' : 'private invite link'} so new members can install the app before starting the admin request flow.
        </Text>
        <TouchableOpacity style={s.storeBtn} onPress={() => openLink(APP_STORE_URL)}>
          <ExternalLink size={18} color="#fff" />
          <Text style={s.actionText}>App Store</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.storeBtn} onPress={() => openLink(PLAY_STORE_URL)}>
          <ExternalLink size={18} color="#fff" />
          <Text style={s.actionText}>Play Store</Text>
        </TouchableOpacity>
      </View>

      <View style={s.card}>
        <Text style={s.sectionTitle}>What Not To Share</Text>
        <Text style={s.bodyText}>
          Do not use a personal admin key as the org contact surface. Use the org public key for public orgs or a signed invite link for private orgs.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 36 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#777', fontSize: 13, marginTop: 4, marginBottom: 16 },
  card: {
    backgroundColor: '#101010',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  sectionTitle: { color: '#9ca3af', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  bodyText: { color: '#9ca3af', fontSize: 13, lineHeight: 18, marginTop: 10 },
  keyBox: { backgroundColor: '#0b0b0b', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#202020' },
  keyText: { color: '#e5e7eb', fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#1a1a1a' },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  storeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#1a1a1a', marginTop: 10 },
  qrWrap: { marginTop: 14, marginBottom: 4, alignItems: 'center', paddingVertical: 16, backgroundColor: '#ffffff', borderRadius: 14 },
});
