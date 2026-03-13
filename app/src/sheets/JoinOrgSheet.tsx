import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  TextInput,
  Clipboard,
  Platform,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '../navigation/RootNavigator';
import { parseGardensLink } from '../utils/gardensLinks';

type Nav = NativeStackNavigationProp<MainStackParamList>;

export function JoinOrgSheet(props: SheetProps<'join-org-sheet'>) {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
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

  async function handleCode(rawValue: string) {
    if (busy) return;
    const trimmed = rawValue.trim();
    if (!trimmed) {
      Alert.alert('Paste required', 'Paste an invite link, org link, or raw invite token.');
      return;
    }

    setBusy(true);
    try {
      const parsedLink = parseGardensLink(trimmed);
      if (parsedLink?.kind === 'dm') {
        await Linking.openURL(trimmed);
        close();
        return;
      }

      if (parsedLink?.kind === 'pk') {
        close();
        navigation.navigate('JoinOrgRequest', { z32Key: parsedLink.z32Key });
        return;
      }

      if (parsedLink?.kind === 'join' || parsedLink?.kind === 'invite') {
        close();
        navigation.navigate(
          'JoinOrgRequest',
          parsedLink.kind === 'join'
            ? {
                orgId: parsedLink.orgId,
                adminKey: parsedLink.adminKey,
                z32Key: parsedLink.z32Key,
                orgName: parsedLink.orgName,
              }
            : {
                tokenBase64: parsedLink.tokenBase64,
                orgName: parsedLink.orgName,
              },
        );
        return;
      }

      if (/^[a-z2-7]{20,}$/i.test(trimmed)) {
        close();
        navigation.navigate('JoinOrgRequest', { z32Key: trimmed });
        return;
      }

      Alert.alert('Unsupported invite', 'Paste a Gardens invite link, org link, or raw invite token.');
    } catch (err: any) {
      Alert.alert('Import failed', err?.message || 'Could not open this invite.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasteFromClipboard() {
    try {
      const clipboardValue = await Clipboard.getString();
      if (!clipboardValue?.trim()) {
        Alert.alert('Clipboard empty', 'Copy an invite link or token first.');
        return;
      }
      setValue(clipboardValue);
      await handleCode(clipboardValue);
    } catch (err: any) {
      Alert.alert('Paste failed', err?.message || 'Could not read the clipboard.');
    }
  }

  return (
    <ActionSheet
      id={props.sheetId}
      gestureEnabled={!busy}
      useBottomSafeAreaPadding
      containerStyle={[s.container, { paddingBottom: bottomInset + 12 }]}
      indicatorStyle={s.handle}
      onBeforeShow={reset}
    >
      <View style={[s.card, { paddingBottom: bottomInset + 8 }]}>
        <Text style={s.title}>Join Org</Text>
        <Text style={s.body}>
          Paste a Gardens invite link, public org link, org code, or raw invite token.
        </Text>

        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="gardens://invite?token=..."
          placeholderTextColor="#7d6a58"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
          editable={!busy}
        />

        <TouchableOpacity style={s.primaryBtn} onPress={() => handleCode(value)} disabled={busy}>
          <Text style={s.primaryBtnText}>{busy ? 'Opening…' : 'Open Invite'}</Text>
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
  input: {
    minHeight: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3a3026',
    backgroundColor: '#0f0c09',
    color: '#efe4d8',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#d7b28d',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
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
