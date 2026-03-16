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
import { resolvePkarr, verifyOneTimeInviteCode, claimOneTimeInviteCode } from '../ffi/gardensCore';
import { useOrgsStore } from '../stores/useOrgsStore';
import { broadcastOp } from '../stores/useSyncStore';
import { BlobImage } from '../components/BlobImage';
import { DefaultCoverShader } from '../components/DefaultCoverShader';

type Props = NativeStackScreenProps<MainStackParamList, 'JoinOrg'>;

type OrgPreview = {
  orgId: string;
  orgName: string;
  description: string | null;
  avatarBlobId: string | null;
  coverBlobId: string | null;
};

export function JoinOrgScreen({ route, navigation }: Props) {
  const { z32Key, orgId: routeOrgId, adminKey: routeAdminKey, orgName: routeOrgName, tokenBase64 } = route.params;
  const { fetchMyOrgs } = useOrgsStore();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [orgPreview, setOrgPreview] = useState<OrgPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOrg = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One-time invite code - verify and auto-join
      if (tokenBase64) {
        try {
          const invite = verifyOneTimeInviteCode(tokenBase64);
          setOrgPreview({
            orgId: invite.orgId,
            orgName: routeOrgName || 'Organization',
            description: null,
            avatarBlobId: null,
            coverBlobId: null,
          });
          return;
        } catch {
          // Invalid or expired code
          setError('Invalid or expired invite code.');
          setLoading(false);
          return;
        }
      }

      // Public org via z32 key
      if (z32Key) {
        const record = await resolvePkarr(z32Key);
        if (!record) {
          setError('Organization not found.');
          setLoading(false);
          return;
        }
        if (record.recordType !== 'org' || !record.orgId) {
          setError('This link is not a joinable organization.');
          setLoading(false);
          return;
        }
        setOrgPreview({
          orgId: routeOrgId || record.orgId,
          orgName: routeOrgName || record.name || 'Unknown Organization',
          description: record.description,
          avatarBlobId: record.avatarBlobId,
          coverBlobId: record.coverBlobId,
        });
        return;
      }

      // Org ID and admin key direct link
      if (routeOrgId && routeAdminKey) {
        setOrgPreview({
          orgId: routeOrgId,
          orgName: routeOrgName || 'Organization',
          description: null,
          avatarBlobId: null,
          coverBlobId: null,
        });
        return;
      }

      setError('Organization not found.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load organization.');
    } finally {
      setLoading(false);
    }
  }, [routeAdminKey, routeOrgId, routeOrgName, tokenBase64, z32Key]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  async function handleJoin() {
    if (!orgPreview) return;
    setJoining(true);
    try {
      // For one-time invite codes, claim the code to join
      if (tokenBase64) {
        const result = await claimOneTimeInviteCode(tokenBase64);
        
        // Broadcast membership op to org topic so other members see the new member
        if (result.opBytes?.length) {
          broadcastOp(orgPreview.orgId, result.opBytes);
        }
      }
      
      // Refresh orgs list and navigate to the org
      await fetchMyOrgs();
      
      navigation.replace('OrgChat', {
        orgId: orgPreview.orgId,
        orgName: orgPreview.orgName,
      });
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to join organization');
    } finally {
      setJoining(false);
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
          <TouchableOpacity style={s.secondaryBtn} onPress={() => loadOrg()}>
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
                <Text style={s.subtitle}>{tokenBase64 ? 'You have been invited to join' : 'Join this organization'}</Text>
              </View>
            </View>

            {orgPreview.description ? (
              <Text style={s.description}>{orgPreview.description}</Text>
            ) : null}

            <TouchableOpacity
              style={[s.primaryBtn, joining && s.primaryBtnDisabled]}
              disabled={joining}
              onPress={handleJoin}
            >
              {joining ? (
                <ActivityIndicator color="#111" />
              ) : (
                <Text style={s.primaryBtnText}>{tokenBase64 ? 'Accept Invite' : 'Join Organization'}</Text>
              )}
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
