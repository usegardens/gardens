/**
 * SignupScreen
 *
 * Flow:
 * 1. Generate keypair (calls Rust via UniFFI)
 * 2. Store private key in iOS Keychain / Android Keystore
 * 3. Collect profile fields: username, avatar placeholder, bio
 * 4. Navigate to Main on success
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  SafeAreaView,
  Image,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { useAuthStore } from '../stores/useAuthStore';
import { validateDisplayName } from '../utils/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

export function SignupScreen({ navigation }: Props) {
  useAuthStore(); // keep store subscribed

  const [username, setUsername]         = useState('');
  const [bio, setBio]                   = useState('');
  const [profilePicUri, setLocalPicUri] = useState<string | null>(null);

  async function handlePickPhoto() {
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, selectionLimit: 1 });
    if (result.assets?.[0]?.uri) {
      setLocalPicUri(result.assets[0].uri);
    }
  }

  function handleCreate() {
    const errorMsg = validateDisplayName(username);
    if (errorMsg) {
      Alert.alert('Invalid Username', errorMsg);
      return;
    }
    navigation.navigate('NotificationsPermission', {
      username: username.trim(),
      bio: bio.trim(),
      profilePicUri,
    });
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Create Account</Text>
        <Text style={styles.sub}>Your identity lives on this device, protected by system security.</Text>

        {/* Profile pic picker */}
        <TouchableOpacity style={styles.avatarWrap} onPress={handlePickPhoto}>
          {profilePicUri ? (
            <Image source={{ uri: profilePicUri }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarPlaceholderText}>+</Text>
            </View>
          )}
          <Text style={styles.avatarHint}>
            {profilePicUri ? 'Tap to change' : 'Add photo (optional)'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. alice"
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />

        <Text style={styles.label}>Bio (optional)</Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          placeholder="A few words about you"
          placeholderTextColor="#555"
          multiline
          numberOfLines={3}
          value={bio}
          onChangeText={setBio}
        />

        <TouchableOpacity
          style={styles.btn}
          onPress={handleCreate}
        >
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 24, paddingBottom: 48 },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 8 },
  sub: { fontSize: 14, color: '#888', marginBottom: 24, lineHeight: 20 },

  avatarWrap: { alignItems: 'center', marginBottom: 24 },
  avatarImg: { width: 88, height: 88, borderRadius: 44, marginBottom: 8 },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarPlaceholderText: { color: '#555', fontSize: 28, lineHeight: 32 },
  avatarHint: { color: '#666', fontSize: 13 },

  label: { fontSize: 13, fontWeight: '600', color: '#aaa', marginBottom: 6, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.8 },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  btn: {
    marginTop: 40,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
});
