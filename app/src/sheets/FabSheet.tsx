import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, StyleSheet, Share, Alert, Platform,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { useOrgsStore } from '../stores/useOrgsStore';
import { useConversationsStore } from '../stores/useConversationsStore';
import { useOrgAdminThreadsStore } from '../stores/useOrgAdminThreadsStore';
import { useOrgPreviewStore } from '../stores/useOrgPreviewStore';
import { useProfileStore } from '../stores/useProfileStore';
import { useAuthStore } from '../stores/useAuthStore';
import type { MainStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<MainStackParamList>;
type Mode = 'menu' | 'createOrg' | 'newDm';

export function FabSheet(props: SheetProps<'fab-sheet'>) {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { createOrg, fetchMyOrgs, orgs } = useOrgsStore();
  const { createConversation } = useConversationsStore();
  const { createOrgAdminThread } = useOrgAdminThreadsStore();
  const { hydrateOrgPreview } = useOrgPreviewStore();
  const { myProfile } = useProfileStore();
  const { keypair } = useAuthStore();

  const [mode, setMode] = useState<Mode>('menu');
  const [orgName, setOrgName] = useState('');
  const [dmKey, setDmKey] = useState('');
  const [busy, setBusy] = useState(false);

  const publicKey = myProfile?.publicKey ?? keypair?.publicKeyHex ?? '';
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 28 : 16);

  function close() { SheetManager.hide('fab-sheet'); }

  function reset() {
    setMode('menu');
    setOrgName('');
    setDmKey('');
    setBusy(false);
  }

  async function handleCreateOrg() {
    if (!orgName.trim()) return;
    setBusy(true);
    try {
      const orgId = await createOrg(orgName.trim(), 'Group', null, false);
      await fetchMyOrgs();
      close();
      navigation.navigate('OrgChat', { orgId, orgName: orgName.trim() });
    } finally {
      setBusy(false);
    }
  }

  async function handleNewDM() {
    if (!dmKey.trim()) return;
    setBusy(true);
    try {
      const trimmedKey = dmKey.trim();
      const matchedOrg = orgs.find(org => org.orgPubkey === trimmedKey);
      if (matchedOrg) {
        const threadId = await createOrgAdminThread(matchedOrg.orgId, trimmedKey);
        close();
        navigation.navigate('Conversation', {
          threadId,
          recipientKey: trimmedKey,
          orgId: matchedOrg.orgId,
          orgName: matchedOrg.name,
          conversationLabel: `${matchedOrg.name} admins`,
        });
        return;
      }

      const preview = await hydrateOrgPreview(trimmedKey);
      if (preview) {
        const threadId = await createOrgAdminThread(preview.orgId, trimmedKey);
        close();
        navigation.navigate('Conversation', {
          threadId,
          recipientKey: trimmedKey,
          orgId: preview.orgId,
          orgName: preview.orgName,
          conversationLabel: `${preview.orgName} admins`,
        });
        return;
      }

      const threadId = await createConversation(trimmedKey);
      close();
      navigation.navigate('Conversation', { threadId, recipientKey: trimmedKey });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to start DM');
    } finally {
      setBusy(false);
    }
  }

  async function handleInvite() {
    try { await Share.share({ message: publicKey }); } catch {}
  }

  async function openJoinOrgSheet() {
    await SheetManager.hide('fab-sheet');
    requestAnimationFrame(() => {
      SheetManager.show('join-org-sheet', { context: 'global' }).catch(() => {});
    });
  }

  return (
    <ActionSheet
      id={props.sheetId}
      gestureEnabled={!busy}
      useBottomSafeAreaPadding
      containerStyle={[fs.container, { paddingBottom: bottomInset + 12 }]}
      indicatorStyle={fs.handle}
      onBeforeShow={reset}
    >
  {mode === 'menu' && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        >
          <Text style={fs.title}>New</Text>

          <TouchableOpacity style={fs.row} onPress={() => setMode('newDm')}>
            <View style={fs.iconCircle}><Text style={fs.iconChar}>DM</Text></View>
            <View style={fs.rowCopy}>
              <Text style={fs.rowTitle}>New conversation</Text>
              <Text style={fs.rowSub}>Start a private chat</Text>
            </View>
            <ChevronRight size={16} color="#555" />
          </TouchableOpacity>

          <TouchableOpacity
            style={fs.row}
            onPress={() => {
              openJoinOrgSheet().catch(() => {});
            }}
          >
            <View style={fs.iconCircle}><Text style={fs.iconChar}>QR</Text></View>
            <View style={fs.rowCopy}>
              <Text style={fs.rowTitle}>Join Org</Text>
              <Text style={fs.rowSub}>Open an invite link or org code</Text>
            </View>
            <ChevronRight size={16} color="#555" />
          </TouchableOpacity>

          <TouchableOpacity style={fs.row} onPress={() => setMode('createOrg')}>
            <View style={fs.iconCircle}><Text style={fs.iconChar}>O</Text></View>
            <View style={fs.rowCopy}>
              <Text style={fs.rowTitle}>Create organization</Text>
              <Text style={fs.rowSub}>Start a new community</Text>
            </View>
            <ChevronRight size={16} color="#555" />
          </TouchableOpacity>

          <TouchableOpacity style={fs.row} onPress={handleInvite}>
            <View style={fs.iconCircle}><Text style={fs.iconChar}>+</Text></View>
            <View style={fs.rowCopy}>
              <Text style={fs.rowTitle}>Invite a friend</Text>
              <Text style={fs.rowSub}>Share your public key</Text>
            </View>
            <ChevronRight size={16} color="#555" />
          </TouchableOpacity>

        </ScrollView>
      )}

      {mode === 'createOrg' && (
        <View style={[fs.formMode, { paddingBottom: bottomInset + 20 }]}>
          <Text style={fs.title}>Create organization</Text>
          <TextInput
            value={orgName}
            onChangeText={setOrgName}
            placeholder="Organization name"
            placeholderTextColor="#666"
            style={fs.input}
            editable={!busy}
          />
          <View style={fs.actionsRow}>
            <TouchableOpacity style={fs.secondaryBtn} onPress={() => setMode('menu')} disabled={busy}>
              <Text style={fs.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={fs.primaryBtn} onPress={handleCreateOrg} disabled={busy || !orgName.trim()}>
              {busy ? <ActivityIndicator color="#000" /> : <Text style={fs.primaryText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {mode === 'newDm' && (
        <View style={[fs.formMode, { paddingBottom: bottomInset + 20 }]}>
          <Text style={fs.title}>New conversation</Text>
          <TextInput
            value={dmKey}
            onChangeText={setDmKey}
            placeholder="Recipient public key"
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
            style={fs.input}
            editable={!busy}
          />
          <View style={fs.actionsRow}>
            <TouchableOpacity style={fs.secondaryBtn} onPress={() => setMode('menu')} disabled={busy}>
              <Text style={fs.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={fs.primaryBtn} onPress={handleNewDM} disabled={busy || !dmKey.trim()}>
              {busy ? <ActivityIndicator color="#000" /> : <Text style={fs.primaryText}>Start</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

    </ActionSheet>
  );
}

const fs = StyleSheet.create({
  container:    { backgroundColor: '#111', padding: 16, maxHeight: '92%' },
  handle:       { backgroundColor: '#333' },
  title:        { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  row:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowCopy:      { flex: 1 },
  iconCircle:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  iconChar:     { color: '#fff', fontWeight: '700' },
  rowTitle:     { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowSub:       { color: '#888', fontSize: 12 },
  input:        { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#222', marginTop: 8 },
  formMode:     { minHeight: 180 },
  actionsRow:   { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 },
  primaryBtn:   { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  primaryText:  { color: '#000', fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#222', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  secondaryText:{ color: '#fff' },
});
