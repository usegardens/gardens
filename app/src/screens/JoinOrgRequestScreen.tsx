import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/RootNavigator';
import { resolvePkarr, verifyInviteToken } from '../ffi/gardensCore';
import { useOrgAdminThreadsStore } from '../stores/useOrgAdminThreadsStore';
import { BlobImage } from '../components/BlobImage';
import { DefaultCoverShader } from '../components/DefaultCoverShader';

type Props = NativeStackScreenProps<MainStackParamList, 'JoinOrgRequest'>;

type OrgPreview = {
  orgId: string;
  orgName: string;
  description: string | null;
  avatarBlobId: string | null;
  coverBlobId: string | null;
  orgContactKey: string;
};

export function JoinOrgRequestScreen({ route, navigation }: Props) {
  const { z32Key, orgId: routeOrgId, adminKey: routeAdminKey, orgName: routeOrgName, tokenBase64 } = route.params;
  const { createOrgAdminThread } = useOrgAdminThreadsStore();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [orgPreview, setOrgPreview] = useState<OrgPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOrg = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tokenBase64) {
        const invite = verifyInviteToken(tokenBase64, Date.now());
        setOrgPreview({
          orgId: invite.orgId,
          orgName: routeOrgName || 'Private Organization',
          description: null,
          avatarBlobId: null,
          coverBlobId: null,
          orgContactKey: invite.inviterKey,
        });
        return;
      }

      if (!z32Key) {
        if (!routeOrgId || !routeAdminKey) {
          setError('Organization not found.');
          return;
        }
        setOrgPreview({
          orgId: routeOrgId,
          orgName: routeOrgName || 'Unknown Organization',
          description: null,
          avatarBlobId: null,
          coverBlobId: null,
          orgContactKey: routeAdminKey,
        });
        return;
      }

      const record = await resolvePkarr(z32Key);
      if (!record) {
        if (!routeOrgId || !routeAdminKey) {
          setError('Organization not found.');
          return;
        }
        setOrgPreview({
          orgId: routeOrgId,
          orgName: routeOrgName || 'Unknown Organization',
          description: null,
          avatarBlobId: null,
          coverBlobId: null,
          orgContactKey: routeAdminKey,
        });
        return;
      }
      if (record.recordType !== 'org' || !record.orgId) {
        setError('This link is not a joinable organization.');
        return;
      }
      setOrgPreview({
        orgId: routeOrgId || record.orgId,
        orgName: routeOrgName || record.name || 'Unknown Organization',
        description: record.description,
        avatarBlobId: record.avatarBlobId,
        coverBlobId: record.coverBlobId,
        orgContactKey: routeAdminKey || record.publicKey,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to load organization.');
    } finally {
      setLoading(false);
    }
  }, [routeAdminKey, routeOrgId, routeOrgName, tokenBase64, z32Key]);

  useEffect(() => {
    loadOrg().catch(() => {});
  }, [loadOrg]);

  async function handleRequestToJoin() {
    if (!orgPreview) return;
    setBusy(true);
    try {
      const threadId = await createOrgAdminThread(orgPreview.orgId, orgPreview.orgContactKey);
      navigation.replace('Conversation', {
        threadId,
        recipientKey: orgPreview.orgContactKey,
        orgId: orgPreview.orgId,
        orgName: orgPreview.orgName,
        conversationLabel: `${orgPreview.orgName} admins`,
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to send join request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#d7b28d" />
          <Text style={s.loadingText}>Loading organization…</Text>
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorTitle}>Link unavailable</Text>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => loadOrg().catch(() => {})}>
            <Text style={s.secondaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : orgPreview ? (
        <View style={s.content}>
          <View style={s.coverWrap}>
            {orgPreview.coverBlobId ? (
              <BlobImage blobHash={orgPreview.coverBlobId} style={s.coverImage} />
            ) : (
              <DefaultCoverShader width={360} height={180} />
            )}
          </View>

          <View style={s.card}>
            <View style={s.avatarRow}>
              {orgPreview.avatarBlobId ? (
                <BlobImage blobHash={orgPreview.avatarBlobId} style={s.avatar} />
              ) : (
                <View style={s.avatarFallback}>
                  <Text style={s.avatarText}>{orgPreview.orgName.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
              <View style={s.titleWrap}>
                <Text style={s.title}>{orgPreview.orgName}</Text>
                <Text style={s.subtitle}>Request access from the org admins</Text>
              </View>
            </View>

            {orgPreview.description ? (
              <Text style={s.description}>{orgPreview.description}</Text>
            ) : null}

            <Text style={s.body}>
              This starts an admin request conversation for this organization. You are not granted membership until an admin approves you.
            </Text>

            <TouchableOpacity
              style={[s.primaryBtn, busy && s.primaryBtnDisabled]}
              disabled={busy}
              onPress={handleRequestToJoin}
            >
              {busy ? <ActivityIndicator color="#111" /> : <Text style={s.primaryBtnText}>Request to Join</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#100d0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  loadingText: { color: '#bca58f', marginTop: 12, fontSize: 14 },
  errorTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  errorText: { color: '#bca58f', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  content: { flex: 1 },
  coverWrap: { height: 180, overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  card: {
    flex: 1,
    marginTop: -24,
    backgroundColor: '#17130f',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 20, marginRight: 14 },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 20,
    marginRight: 14,
    backgroundColor: '#d7b28d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#111', fontSize: 24, fontWeight: '800' },
  titleWrap: { flex: 1 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#bca58f', fontSize: 14, marginTop: 4 },
  description: { color: '#efe4d8', fontSize: 15, lineHeight: 22, marginTop: 20 },
  body: { color: '#9d8368', fontSize: 13, lineHeight: 20, marginTop: 16 },
  primaryBtn: {
    marginTop: 28,
    backgroundColor: '#d7b28d',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#111', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    marginTop: 4,
    backgroundColor: '#211a14',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryBtnText: { color: '#efe4d8', fontWeight: '700' },
});
