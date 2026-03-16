import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  Clipboard,
  Platform,
  ActivityIndicator,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolvePkarr } from '../ffi/gardensCore';
import { useOrgsStore } from '../stores/useOrgsStore';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<MainStackParamList>;

// Z32 alphabet regex (lowercase only, as z32 keys are case-insensitive)
// Support both 52-char and 64-char z32 encoded keys
const Z32_REGEX = /^[a-z2-7]{52}(?:[a-z2-7]{12})?$/i;

export function JoinOrgSheet(props: SheetProps<'join-org-sheet'>) {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { fetchMyOrgs } = useOrgsStore();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 28 : 16);

  function close() {
    SheetManager.hide(props.sheetId);
  }

  function reset() {
    setValue('');
    setBusy(false);
  }

  function isValidZ32(key: string): boolean {
    return Z32_REGEX.test(key.trim());
  }

  async function handleJoin(rawValue: string) {
    if (busy) return;
    const trimmed = rawValue.trim();
    
    if (!trimmed) {
      Alert.alert('Key required', 'Enter a public organization key (z32) to join.');
      return;
    }

    if (!isValidZ32(trimmed)) {
      Alert.alert(
        'Invalid key',
        'Please enter a valid z32 public key (52 or 64 characters, letters a-z and numbers 2-7).'
      );
      return;
    }

    setBusy(true);
    try {
      const record = await resolvePkarr(trimmed.toLowerCase());
      
      if (!record) {
        Alert.alert('Organization not found', 'No public organization found with this key.');
        return;
      }
      
      if (record.recordType !== 'org' || !record.orgId) {
        Alert.alert('Not an organization', 'This key does not belong to a public organization.');
        return;
      }

      // Success - navigate to org chat
      await fetchMyOrgs();
      close();
      navigation.navigate('OrgChat', { 
        orgId: record.orgId, 
        orgName: record.name || 'Organization' 
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to find organization. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasteFromClipboard() {
    try {
      const clipboardValue = await Clipboard.getString();
      if (!clipboardValue?.trim()) {
        Alert.alert('Clipboard empty', 'Copy a public organization key first.');
        return;
      }
      setValue(clipboardValue.trim());
    } catch (err: any) {
      Alert.alert('Paste failed', err?.message || 'Could not read the clipboard.');
    }
  }

  return (
    <ActionSheet
      id={props.sheetId}
      gestureEnabled={!busy}
      useBottomSafeAreaPadding
      containerStyle={{...s.container, paddingBottom: bottomInset + 12}}
      indicatorStyle={s.handle}
      onBeforeShow={reset}
    >
      <View style={[s.card, { paddingBottom: bottomInset + 8 }]}>
        <Text style={s.title}>Join Public Org</Text>
        <Text style={s.body}>
          Enter a public organization key (z32) to join. Public orgs are discoverable by anyone.
        </Text>

        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="abc123def456..."
          placeholderTextColor="#7d6a58"
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
          editable={!busy}
        />

        <Text style={s.hint}>
          Have an invite link? Tap it from your messages to join private orgs.
        </Text>

        <TouchableOpacity 
          style={busy ? [s.primaryBtn, s.primaryBtnDisabled] : s.primaryBtn} 
          onPress={() => handleJoin(value)} 
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#111" />
          ) : (
            <Text style={s.primaryBtnText}>Find & Join</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={s.secondaryBtn} onPress={() => handlePasteFromClipboard()} disabled={busy}>
          <Text style={s.secondaryBtnText}>Paste From Clipboard</Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#100d0a',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  handle: { backgroundColor: '#3a3026' },
  card: {
    backgroundColor: '#17130f',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2b221b',
    padding: 18,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  body: { color: '#c8b49f', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 16 },
  hint: { color: '#7d6a58', fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 4 },
  input: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3a3026',
    backgroundColor: '#0f0c09',
    color: '#efe4d8',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#d7b28d',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: { color: '#111', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    marginTop: 10,
    backgroundColor: '#211a14',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#efe4d8', fontSize: 14, fontWeight: '700' },
});
