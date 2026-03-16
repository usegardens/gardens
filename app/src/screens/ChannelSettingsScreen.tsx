import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOrgsStore } from '../stores/useOrgsStore';
import { parseCustomEmoji, normalizeCustomEmojiList } from '../utils/customEmoji';
import { BlobImage } from '../components/BlobImage';

type Props = NativeStackScreenProps<any, 'ChannelSettings'>;

type ChannelEmoji = {
  code: string;
  blobId: string;
  mimeType: string;
  roomId: string | null;
};

export function ChannelSettingsScreen({ route, navigation }: Props) {
  const { orgId, roomId, roomName } = route.params as { orgId: string; orgName: string; roomId: string; roomName: string };
  
  const insets = useSafeAreaInsets();
  const { orgs, updateOrg } = useOrgsStore();
  
  const org = orgs.find(o => o.orgId === orgId);
  const [emojiList, setEmojiList] = useState<ChannelEmoji[]>([]);
  const [newEmojiCode, setNewEmojiCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: `#${roomName} Settings`,
    });
    
    // Load existing channel emoji
    const customEmoji = parseCustomEmoji(org?.customEmojiJson);
    const channelEmoji = customEmoji
      .filter(e => e.roomId === roomId)
      .map(e => ({
        code: e.code,
        blobId: e.blobId,
        mimeType: e.mimeType,
        roomId: e.roomId,
      }));
    setEmojiList(channelEmoji);
  }, [org, roomId, roomName, navigation]);

  function handleAddEmoji() {
    // For now, show info about how to add emoji
    // The actual image upload would require integrating an image picker
    Alert.alert(
      'Add Channel Emoji',
      'To add custom emoji to this channel:\\n\\n1. Go to Org Settings\\n2. Add emoji there\\n3. The emoji will be available in this channel only\\n\\nEmoji added here are encrypted with the channel key.',
      [{ text: 'OK' }]
    );
  }

  async function handleRemoveEmoji(emojiCode: string) {
    Alert.alert(
      'Remove Emoji',
      `Remove :${emojiCode}: from this channel?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setEmojiList(emojiList.filter(e => e.code !== emojiCode));
          },
        },
      ]
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Get all org emoji
      const allEmoji = parseCustomEmoji(org?.customEmojiJson);
      
      // Remove channel emoji for this room from org list
      const otherEmoji = allEmoji.filter(e => e.roomId !== roomId);
      
      // Add updated channel emoji
      const updatedEmoji = [...otherEmoji, ...emojiList];
      
      // Update org - use individual parameters like useOrgsStore expects
      await updateOrg(
        orgId,
        undefined, // name
        undefined, // typeLabel
        undefined, // description
        undefined, // avatarBlobId
        undefined, // coverBlobId
        undefined, // welcomeText
        JSON.stringify(normalizeCustomEmojiList(updatedEmoji)), // customEmojiJson
        undefined, // orgCooldownSecs
        undefined, // isPublic
        undefined, // emailEnabled
      );
      
      Alert.alert('Success', 'Channel emoji saved successfully');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save emoji');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
      <Text style={styles.sectionTitle}>Channel Custom Emoji</Text>
      <Text style={styles.sectionSubtitle}>
        Add custom emoji that can only be used in this channel. These emoji are encrypted with the channel's DCGKA key.
      </Text>

      {/* Existing Emoji */}
      {emojiList.length > 0 && (
        <View style={styles.emojiGrid}>
          {emojiList.map(emoji => (
            <TouchableOpacity
              key={emoji.code}
              style={styles.emojiItem}
              onLongPress={() => handleRemoveEmoji(emoji.code)}
            >
              <BlobImage blobHash={emoji.blobId} style={styles.emojiImage} />
              <Text style={styles.emojiCode}>:{emoji.code}:</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {emojiList.length === 0 && (
        <Text style={styles.emptyText}>No custom emoji for this channel yet.</Text>
      )}

      {/* Add Emoji Section */}
      <View style={styles.addSection}>
        <Text style={styles.addTitle}>Add New Emoji</Text>
        
        <TextInput
          style={styles.input}
          placeholder="Emoji code (e.g., smile)"
          placeholderTextColor="#555"
          value={newEmojiCode}
          onChangeText={setNewEmojiCode}
          autoCapitalize="none"
          autoCorrect={false}
        />
        
        <TouchableOpacity
          style={styles.addButton}
          onPress={handleAddEmoji}
        >
          <Text style={styles.addButtonText}>Select Image</Text>
        </TouchableOpacity>
        
        <Text style={styles.hint}>
          Long-press on an emoji to remove it
        </Text>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  emojiItem: {
    alignItems: 'center',
    width: 72,
  },
  emojiImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  emojiCode: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
  },
  emptyText: {
    color: '#555',
    fontSize: 14,
    marginBottom: 20,
  },
  addSection: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
  },
  addTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#333',
    fontSize: 15,
    marginBottom: 12,
  },
  addButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  hint: {
    color: '#555',
    fontSize: 12,
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#1e3a5f',
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
