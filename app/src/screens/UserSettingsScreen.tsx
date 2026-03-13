import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  Clipboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOCATION_STORAGE_KEY, claimProfileSlug } from '../sheets/LocationPickerSheet';
import { PROFILE_SLUG_DOMAIN } from '../stores/useProfileStore';
import { SheetManager } from 'react-native-actions-sheet';
import { PublicIdentityCard } from '../components/PublicIdentityCard';
import { useProfileStore, type Profile } from '../stores/useProfileStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createOrUpdateProfile, getMyProfile, getPkarrUrl } from '../ffi/gardensCore';

function SettingsRow({
  label,
  description,
  value,
  onPress,
}: {
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={s.row}
      disabled={!onPress}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
        {description && <Text style={s.rowDesc}>{description}</Text>}
      </View>
      <View style={s.rowRight}>
        {value && <Text style={s.rowValue}>{value}</Text>}
        {onPress && <Text style={s.chevron}>›</Text>}
      </View>
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.sectionBody}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.row}>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
        {description && <Text style={s.rowDesc}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#333', true: '#3b82f6' }}
        thumbColor="#fff"
      />
    </View>
  );
}

export function UserSettingsScreen() {
  const { fetchMyProfile, localUsername, profileSlug, profileSlugUrl, loadProfileSlug } = useProfileStore();
  const { dndEnabled, setDnd, loadSettings } = useSettingsStore();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [pkarrUrl, setPkarrUrl] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getMyProfile();
      if (p) {
        setProfile(p);
        setIsPublic(p.isPublic);
        setEmailEnabled(p.emailEnabled ?? false);
        try {
          setPkarrUrl(getPkarrUrl(p.publicKey));
        } catch {
          // pkarrUrl is display-only; don't block load if it fails
        }
      }
      await fetchMyProfile();
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchMyProfile]);

  useEffect(() => {
    loadProfile();
    loadProfileSlug();
    AsyncStorage.getItem(LOCATION_STORAGE_KEY).then(v => setLocation(v)).catch(() => {});
  }, [loadProfile, loadProfileSlug]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleTogglePublic(value: boolean) {
    const username = profile?.username ?? localUsername;
    if (!username) {
      Alert.alert('Error', 'Please complete your profile setup first.');
      return;
    }

    setSaving(true);
    try {
      await createOrUpdateProfile(
        username,
        profile?.bio ?? null,
        profile?.availableFor ?? [],
        value,
        profile?.avatarBlobId ?? null,
        emailEnabled
      );
      setIsPublic(value);
      await loadProfile();
      
      if (value) {
        const refreshed = await getMyProfile();
        if (refreshed?.publicKey && refreshed?.username) {
          const result = await claimProfileSlug(refreshed.publicKey, refreshed.username);
          if (result) {
            Alert.alert(
              'Public Profile Enabled',
              `Your profile is now live at:\n${result.url}`
            );
          } else {
            Alert.alert(
              'Public Profile Enabled',
              'Your profile is now published to the DHT and can be discovered by others.'
            );
          }
        } else {
          Alert.alert(
            'Public Profile Enabled',
            'Your profile is now published to the DHT and can be discovered by others.'
          );
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update profile');
      // Revert toggle on error
      setIsPublic(!value);
    } finally {
      setSaving(false);
    }
  }

  const openEditProfile = () => {
    try {
      console.log('[UserSettings] Opening edit-profile-sheet...');
      console.log('[UserSettings] SheetManager:', SheetManager);
      console.log('[UserSettings] SheetManager.show:', (SheetManager as any).show);
      (SheetManager as any).show('edit-profile-sheet');
    } catch (err: any) {
      console.error('[UserSettings] Error opening edit-profile-sheet:', err);
      Alert.alert('Error', `Failed to open: ${err.message}`);
    }
  };

  const openBackupSeed = () => {
    try {
      (SheetManager as any).show('backup-seed-sheet');
    } catch (err: any) {
      console.error('[UserSettings] Error opening backup-seed-sheet:', err);
      Alert.alert('Error', `Failed to open: ${err.message}`);
    }
  };

  const openExportData = () => {
    try {
      (SheetManager as any).show('export-data-sheet');
    } catch (err: any) {
      console.error('[UserSettings] Error opening export-data-sheet:', err);
      Alert.alert('Error', `Failed to open: ${err.message}`);
    }
  };

  const openDeleteAccount = () => {
    try {
      (SheetManager as any).show('delete-account-sheet');
    } catch (err: any) {
      console.error('[UserSettings] Error opening delete-account-sheet:', err);
      Alert.alert('Error', `Failed to open: ${err.message}`);
    }
  };

  // Get current values for display
  const displayName = profile?.username || localUsername || 'Not set';
  const bio = profile?.bio || 'Not set';
  const myPublicKeyZ32 = pkarrUrl?.startsWith('pk:') ? pkarrUrl.slice(3) : null;

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Section title="Profile">
        <SettingsRow 
          label="Display Name" 
          value={displayName}
          onPress={openEditProfile}
        />
        <SettingsRow 
          label="Bio" 
          description={bio === 'Not set' ? 'Tell people about yourself' : bio}
          value={bio !== 'Not set' ? undefined : undefined}
          onPress={openEditProfile}
        />
        <SettingsRow 
          label="Profile Picture" 
          value="Change"
          onPress={openEditProfile}
        />
        <SettingsRow 
          label="Cover Photo" 
          value="Change"
          onPress={openEditProfile}
        />
      </Section>

      <Section title="Privacy">
        <ToggleRow
          label="Do Not Disturb"
          description="Silence all incoming notifications"
          value={dndEnabled}
          onChange={(v) => setDnd(v)}
        />
        <SettingsRow
          label="Interests"
          description={profile?.availableFor?.length ? profile.availableFor.slice(0, 3).join(', ') + (profile.availableFor.length > 3 ? '…' : '') : 'Not set'}
          onPress={() => SheetManager.show('interests-sheet')}
        />
        <SettingsRow
          label="Location"
          description={location ?? 'Not set'}
          onPress={() => {
            SheetManager.show('location-picker-sheet');
            // Refresh after sheet closes
            setTimeout(() => {
              AsyncStorage.getItem(LOCATION_STORAGE_KEY).then(v => setLocation(v)).catch(() => {});
            }, 1000);
          }}
        />
      </Section>

      <Section title="Public Profile">
        <ToggleRow
          label="Make Profile Public"
          description="Publish to DHT for discovery"
          value={isPublic}
          onChange={handleTogglePublic}
          disabled={saving}
        />
        {saving && (
          <View style={s.savingRow}>
            <ActivityIndicator size="small" color="#888" />
            <Text style={s.savingText}>Updating...</Text>
          </View>
        )}
        
        {isPublic && profile && pkarrUrl && (
          <View style={s.cardContainer}>
            <PublicIdentityCard
              pkarrUrl={pkarrUrl}
              publicKeyHex={profile.publicKey}
              label="Your Public Profile"
              publicLinkOverride={profileSlugUrl || undefined}
            />
          </View>
        )}
        
        {isPublic && profileSlugUrl && (
          <View style={s.slugContainer}>
            <Text style={s.slugLabel}>Your Public Link</Text>
            <View style={s.slugRow}>
              <Text style={s.slugText} numberOfLines={1}>
                {profileSlugUrl.replace('https://', '')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Clipboard.setString(profileSlugUrl);
                }}
              >
                <Text style={s.slugCopyBtn}>Copy</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.slugHint}>
              Share this link so people can find your profile
            </Text>
          </View>
        )}
      </Section>

      <Section title="Email">
        <View style={s.sectionInner}>
          <Text style={s.sectionDesc}>
            Receive and send email at your public key address.
          </Text>

          {isPublic ? (
            <>
              <View style={s.addressRow}>
                <Text style={s.addressText} numberOfLines={1}>
                  {myPublicKeyZ32 ? `${myPublicKeyZ32}@gardens-relay.stereos.workers.dev` : '—'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    if (myPublicKeyZ32) {
                      Clipboard.setString(`${myPublicKeyZ32}@gardens-relay.stereos.workers.dev`);
                    }
                  }}
                >
                  <Text style={s.copyBtn}>Copy</Text>
                </TouchableOpacity>
              </View>

              <View style={s.toggleRow}>
                <Text style={s.toggleLabel}>Send & receive email</Text>
                <Switch
                  value={emailEnabled}
                  onValueChange={async (value) => {
                    setEmailEnabled(value);
                    try {
                      await createOrUpdateProfile(
                        profile?.username ?? localUsername ?? '',
                        profile?.bio ?? null,
                        profile?.availableFor ?? [],
                        profile?.isPublic ?? false,
                        profile?.avatarBlobId ?? null,
                        value
                      );
                    } catch {
                      setEmailEnabled(!value);
                    }
                  }}
                  trackColor={{ true: '#F2E58F', false: '#333' }}
                  thumbColor="#fff"
                />
              </View>
            </>
          ) : (
            <Text style={s.hint}>Enable a public profile to use email.</Text>
          )}
        </View>
      </Section>

      <Section title="Security">
        <SettingsRow 
          label="Backup Seed Phrase" 
          description="View your recovery phrase"
          onPress={openBackupSeed}
        />
      </Section>

      <Section title="Account">
        <SettingsRow 
          label="Export Data" 
          description="Download your data"
          onPress={openExportData}
        />
        <TouchableOpacity style={s.dangerRow} onPress={openDeleteAccount}>
          <Text style={s.dangerLabel}>Delete Account</Text>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>
      </Section>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingVertical: 24, paddingHorizontal: 16 },
  center: { alignItems: 'center', justifyContent: 'center' },

  section: { marginBottom: 32 },
  sectionTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionBody: {
    backgroundColor: '#111',
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionInner: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionDesc: { color: '#666', fontSize: 12, marginBottom: 10 },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  addressText: { color: '#aaa', fontSize: 13, flex: 1 },
  copyBtn: { color: '#F2E58F', fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { color: '#fff', fontSize: 14 },
  hint: { color: '#555', fontSize: 12 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowContent: { flex: 1 },
  rowLabel: { color: '#fff', fontSize: 15 },
  rowDesc: { color: '#555', fontSize: 12, marginTop: 2 },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowValue: {
    color: '#888',
    fontSize: 14,
  },
  chevron: { color: '#444', fontSize: 20, marginLeft: 8 },

  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  savingText: {
    color: '#888',
    fontSize: 12,
    marginLeft: 8,
  },

  cardContainer: {
    padding: 12,
    backgroundColor: '#0a0a0a',
  },

  slugContainer: {
    marginTop: 12,
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginHorizontal: 12,
  },
  slugLabel: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  slugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#0a0a0a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  slugText: {
    color: '#F2E58F',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  slugCopyBtn: {
    color: '#3b82f6',
    fontWeight: '700',
    fontSize: 13,
  },
  slugHint: {
    color: '#666',
    fontSize: 12,
  },

  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dangerLabel: { color: '#ef4444', fontSize: 15, flex: 1 },
});
