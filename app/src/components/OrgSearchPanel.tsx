import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'lucide-react-native';
import type { Room, MemberInfo, Message } from '../ffi/gardensCore';
import {
  listMessages as dcListMessages,
  listOrgMembers,
  removeMemberFromOrg,
  changeMemberPermission,
} from '../ffi/gardensCore';
import { BlobImage } from './BlobImage';
import { useProfileStore } from '../stores/useProfileStore';

// ── Filter parsing ────────────────────────────────────────────────────────────

type FilterType = 'in' | 'from' | 'has' | 'before' | 'after';
interface FilterToken { type: FilterType; value: string }

function parseQuery(raw: string): { filters: FilterToken[]; text: string } {
  const filters: FilterToken[] = [];
  const re = /\b(in|from|has|before|after):(\S+)/g;
  let m; let text = raw;
  while ((m = re.exec(raw)) !== null) {
    filters.push({ type: m[1] as FilterType, value: m[2] });
    text = text.replace(m[0], '');
  }
  return { filters, text: text.trim() };
}

function getFilterPrefix(raw: string): { prefix: FilterType | null; partial: string } {
  const m = raw.match(/(in|from|has|before|after):(\S*)$/);
  return m ? { prefix: m[1] as FilterType, partial: m[2] } : { prefix: null, partial: '' };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchResult { message: Message; roomName: string }

interface Props {
  visible: boolean;
  orgId: string;
  rooms: Room[];
  activeRoomName: string;
  onClose: () => void;
  currentUserKey?: string;
  onOpenAdminChat?: (adminPublicKey: string) => void;
}

// ── Quick filter hints (shown when query is empty) ────────────────────────────

const FILTER_HINTS = [
  'in:', 'from:', 'has:image', 'has:video', 'has:gif', 'before:', 'after:',
];

// ── Component ─────────────────────────────────────────────────────────────────

function isAdminAccess(accessLevel: string): boolean {
  const normalized = accessLevel.toLowerCase();
  return normalized === 'manage' || normalized === 'admin';
}

export function OrgSearchPanel({
  visible,
  orgId,
  rooms,
  activeRoomName,
  onClose,
  currentUserKey,
  onOpenAdminChat,
}: Props) {
  const insets = useSafeAreaInsets();
  const { profileCache, fetchProfile } = useProfileStore();

  const [query, setQuery]               = useState('');
  const [members, setMembers]           = useState<MemberInfo[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [results, setResults]           = useState<SearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { filters } = parseQuery(query);
  const { prefix: suggPrefix, partial: suggPartial } = getFilterPrefix(query);
  const hasQuery = query.trim().length > 0;

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try { setMembers(await listOrgMembers(orgId)); }
    catch { /* non-critical */ }
    finally { setLoadingMembers(false); }
  }, [orgId]);

  // ── Load members when panel opens ─────────────────────────────────────────

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    loadMembers();
  }, [visible, loadMembers]);

  useEffect(() => {
    if (!visible) return;
    for (const member of members) {
      fetchProfile(member.publicKey).catch(() => {});
    }
  }, [fetchProfile, members, visible]);

  const sortedMembers = useMemo(() => {
    const sorted = [...members];
    sorted.sort((a, b) => {
      const adminA = isAdminAccess(a.accessLevel) ? 1 : 0;
      const adminB = isAdminAccess(b.accessLevel) ? 1 : 0;
      if (adminA !== adminB) return adminB - adminA;
      const nameA = (profileCache[a.publicKey]?.username ?? a.publicKey).toLowerCase();
      const nameB = (profileCache[b.publicKey]?.username ?? b.publicKey).toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return sorted;
  }, [members, profileCache]);

  // ── Debounced search ──────────────────────────────────────────────────────

  const runSearch = useCallback(async () => {
    const { filters: localFilters, text } = parseQuery(query);
    const inVal     = localFilters.find(f => f.type === 'in')?.value?.toLowerCase();
    const fromVal   = localFilters.find(f => f.type === 'from')?.value?.toLowerCase();
    const hasVal    = localFilters.find(f => f.type === 'has')?.value?.toLowerCase();
    const beforeVal = localFilters.find(f => f.type === 'before')?.value;
    const afterVal  = localFilters.find(f => f.type === 'after')?.value;
    const beforeTs  = beforeVal ? new Date(beforeVal).getTime() * 1000 : null;
    const afterTs   = afterVal  ? new Date(afterVal).getTime()  * 1000 : null;

    setLoadingSearch(true);
    try {
      const all: SearchResult[] = [];
      for (const room of rooms) {
        if (inVal && !room.name.toLowerCase().includes(inVal)) continue;
        const msgs = await dcListMessages(room.roomId, null, 200, beforeTs);
        for (const msg of msgs) {
          if (msg.isDeleted) continue;
          if (fromVal && !msg.authorKey.toLowerCase().includes(fromVal)) continue;
          if (afterTs  && msg.timestamp < afterTs) continue;
          if (hasVal === 'image' && msg.contentType !== 'image') continue;
          if (hasVal === 'video' && msg.contentType !== 'video') continue;
          if (hasVal === 'gif'   && msg.contentType !== 'gif') continue;
          if (text && !msg.textContent?.toLowerCase().includes(text.toLowerCase())) continue;
          all.push({ message: msg, roomName: room.name });
        }
      }
      all.sort((a, b) => b.message.timestamp - a.message.timestamp);
      setResults(all);
    } catch { /* silently fail */ }
    finally { setLoadingSearch(false); }
  }, [query, rooms]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!hasQuery) { setResults([]); return; }
    timer.current = setTimeout(runSearch, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [hasQuery, query, runSearch]);

  // ── Autocomplete suggestions (only when typing a filter prefix) ───────────

  function getSuggestions(): string[] {
    if (!hasQuery || suggPrefix === null) return [];
    switch (suggPrefix) {
      case 'in':
        return rooms
          .filter(r => r.name.toLowerCase().startsWith(suggPartial.toLowerCase()))
          .slice(0, 6)
          .map(r => `in:${r.name}`);
      case 'has':
        return ['image', 'video', 'gif']
          .filter(v => v.startsWith(suggPartial.toLowerCase()))
          .map(v => `has:${v}`);
      case 'before':
      case 'after':
        return [`${suggPrefix}:${new Date().toISOString().slice(0, 10)}`];
      case 'from':
        return members
          .filter(m => m.publicKey.startsWith(suggPartial))
          .slice(0, 5)
          .map(m => `from:${m.publicKey.slice(0, 8)}`);
      default:
        return [];
    }
  }

  function applySuggestion(s: string) {
    if (!hasQuery) { setQuery(s); return; }
    if (suggPrefix !== null) {
      setQuery(q => q.replace(/(in|from|has|before|after):(\S*)$/, s + ' '));
    }
  }

  function removeFilter(f: FilterToken) {
    setQuery(q => q.replace(`${f.type}:${f.value}`, '').replace(/\s+/g, ' ').trim());
  }

  // ── Member actions ────────────────────────────────────────────────────────

  function handleMemberPress(m: MemberInfo) {
    const displayName = profileCache[m.publicKey]?.username ?? `${m.publicKey.slice(0, 16)}…`;
    Alert.alert(displayName, `Role: ${m.accessLevel}`, [
      { text: 'Change Role', onPress: () => promptChangeRole(m) },
      { text: 'Remove', style: 'destructive', onPress: () => confirmRemove(m) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleMemberLongPress(m: MemberInfo) {
    if (!isAdminAccess(m.accessLevel)) return;
    if (!onOpenAdminChat) return;
    if (currentUserKey && m.publicKey === currentUserKey) return;
    const displayName = profileCache[m.publicKey]?.username ?? `${m.publicKey.slice(0, 16)}…`;
    Alert.alert('Admin Actions', `Open admin chat with ${displayName}?`, [
      {
        text: 'Open Admin Chat',
        onPress: () => onOpenAdminChat(m.publicKey),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function promptChangeRole(m: MemberInfo) {
    Alert.alert('Change Role', `Current: ${m.accessLevel}`,
      (['Pull', 'Read', 'Write', 'Manage'] as const).map(level => ({
        text: level,
        onPress: async () => {
          try { await changeMemberPermission(orgId, m.publicKey, level); await loadMembers(); }
          catch (e: any) { Alert.alert('Error', e.message); }
        },
      })).concat({ text: 'Cancel', style: 'cancel' }),
    );
  }

  function confirmRemove(m: MemberInfo) {
    Alert.alert('Remove Member', 'This cannot be undone.', [
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try { await removeMemberFromOrg(orgId, m.publicKey); await loadMembers(); }
          catch (e: any) { Alert.alert('Error', e.message); }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const suggestions = getSuggestions();

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={ps.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* ── Search bar ── */}
        <View style={[ps.bar, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={onClose} style={ps.back}>
            <ArrowLeft size={22} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={ps.input}
            value={query}
            onChangeText={setQuery}
            placeholder={activeRoomName ? `in:${activeRoomName} …` : 'Search messages…'}
            placeholderTextColor="#444"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} style={ps.clear}>
              <X size={16} color="#666" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Active filter chips ── */}
        {filters.length > 0 && (
          <ScrollView
            horizontal
            style={ps.chipScroll}
            contentContainerStyle={ps.chipRow}
            showsHorizontalScrollIndicator={false}
          >
            {filters.map((f, i) => (
                <TouchableOpacity key={i} style={ps.chip} onPress={() => removeFilter(f)}>
                  <Text style={ps.chipText}>{f.type}:{f.value}</Text>
                  <X size={10} color="#93c5fd" style={ps.chipCloseIcon} />
                </TouchableOpacity>
              ))}
          </ScrollView>
        )}

        {/* ── Autocomplete dropdown (filter prefix typing) ── */}
        {suggestions.length > 0 && (
          <View style={ps.autoRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.autoInner}>
              {suggestions.map(s => (
                <TouchableOpacity key={s} style={ps.autoChip} onPress={() => applySuggestion(s)}>
                  <Text style={ps.autoText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Quick filter hints (empty state) ── */}
        {!hasQuery && suggestions.length === 0 && (
          <View style={ps.hintsRow}>
            <Text style={ps.hintsLabel}>FILTERS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.hintsInner}>
              {FILTER_HINTS.map(s => (
                <TouchableOpacity key={s} style={ps.hintChip} onPress={() => applySuggestion(s)}>
                  <Text style={ps.hintText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Content ── */}
        {hasQuery ? (
          /* Search results */
          loadingSearch ? (
            <View style={ps.center}><ActivityIndicator color="#fff" /></View>
          ) : results.length === 0 && !loadingSearch ? (
            <View style={ps.center}>
              <Text style={ps.emptyText}>No results</Text>
              <Text style={ps.emptyHint}>Try adjusting your filters</Text>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={r => r.message.messageId}
              contentContainerStyle={ps.resultList}
              renderItem={({ item }) => (
                <View style={ps.resultCard}>
                  <View style={ps.resultMeta}>
                    <Text style={ps.resultChannel}># {item.roomName}</Text>
                    <Text style={ps.resultTime}>
                      {new Date(item.message.timestamp).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={ps.resultAuthor}>{item.message.authorKey.slice(0, 14)}…</Text>
                  <Text style={ps.resultBody} numberOfLines={3}>
                    {item.message.textContent ?? `[${item.message.contentType}]`}
                  </Text>
                </View>
              )}
            />
          )
        ) : (
          /* Members list */
          loadingMembers ? (
            <View style={ps.center}><ActivityIndicator color="#fff" /></View>
          ) : (
            <FlatList
              data={sortedMembers}
              keyExtractor={m => m.publicKey}
              contentContainerStyle={[ps.memberList, { paddingBottom: insets.bottom + 16 }]}
              ListEmptyComponent={
                <View style={ps.center}>
                  <Text style={ps.emptyText}>No members yet</Text>
                </View>
              }
              renderItem={({ item: m }) => (
                <TouchableOpacity
                  style={ps.memberRow}
                  onPress={() => handleMemberPress(m)}
                  onLongPress={() => handleMemberLongPress(m)}
                >
                  {profileCache[m.publicKey]?.avatarBlobId ? (
                    <BlobImage blobHash={profileCache[m.publicKey].avatarBlobId!} style={ps.memberAvatarImg} />
                  ) : (
                    <View style={ps.memberAvatar}>
                      <Text style={ps.memberInitials}>
                        {(profileCache[m.publicKey]?.username ?? m.publicKey).slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={ps.memberInfo}>
                    <Text style={ps.memberName}>
                      {profileCache[m.publicKey]?.username ?? `${m.publicKey.slice(0, 14)}…`}
                    </Text>
                    <Text style={ps.memberJoined}>
                      {isAdminAccess(m.accessLevel) ? 'Admin • ' : ''}Joined {new Date(m.joinedAt).toLocaleDateString()}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ps = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#0a0a0a' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 15, fontWeight: '600' },
  emptyHint: { color: '#333', fontSize: 12, marginTop: 6 },

  // Bar
  bar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  back:  { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  input: {
    flex: 1, color: '#fff', fontSize: 15,
    backgroundColor: '#181818', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  clear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },

  // Active filter chips
  chipScroll: { maxHeight: 40, marginTop: 8 },
  chipRow:    { paddingHorizontal: 12, gap: 6, alignItems: 'center' },
  chip:       { backgroundColor: '#1e3a8a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexDirection: 'row', alignItems: 'center' },
  chipText:   { color: '#93c5fd', fontSize: 12, fontWeight: '600' },
  chipCloseIcon: { marginLeft: 5 },

  // Autocomplete
  autoRow:   { borderBottomWidth: 1, borderBottomColor: '#181818', paddingVertical: 6 },
  autoInner: { paddingHorizontal: 12, gap: 6 },
  autoChip:  { backgroundColor: '#1a1a1a', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#2d2d2d' },
  autoText:  { color: '#aaa', fontSize: 13 },

  // Filter hints
  hintsRow:   { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  hintsLabel: { color: '#333', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  hintsInner: { gap: 6 },
  hintChip:   { backgroundColor: '#141414', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: '#252525' },
  hintText:   { color: '#666', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Results
  resultList: { padding: 12 },
  resultCard: {
    backgroundColor: '#111', borderRadius: 10,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  resultMeta:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  resultChannel: { color: '#3b82f6', fontSize: 12, fontWeight: '700' },
  resultTime:    { color: '#444', fontSize: 11 },
  resultAuthor:  { color: '#666', fontSize: 12, marginBottom: 6 },
  resultBody:    { color: '#ddd', fontSize: 14, lineHeight: 20 },

  // Members
  memberList:   { padding: 12 },

  memberRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  memberAvatar:  {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1e3a8a',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  memberAvatarImg: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  memberInitials: { color: '#fff', fontSize: 15, fontWeight: '700' },
  memberInfo:    { flex: 1 },
  memberName:    { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  memberJoined:  { color: '#555', fontSize: 11 },
});
