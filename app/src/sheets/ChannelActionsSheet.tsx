import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import ActionSheet, { SheetManager } from 'react-native-actions-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ChannelActionsSheetProps {
  sheetId: string;
  payload?: {
    channelName?: string;
    channelId?: string;
    orgId?: string;
    onOpenSettings?: () => void;
    onDelete?: () => void;
  };
}

export function ChannelActionsSheet(props: ChannelActionsSheetProps) {
  const { channelName, onOpenSettings, onDelete } = props.payload || {};
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 28 : 16);

  return (
    <ActionSheet
      id={props.sheetId}
      useBottomSafeAreaPadding
      containerStyle={styles.sheet}
    >
      <View style={[styles.container, { paddingBottom: bottomInset + 8 }]}>
        {channelName ? (
          <Text style={styles.title}># {channelName}</Text>
        ) : null}
        
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            SheetManager.hide(props.sheetId);
            onOpenSettings?.();
          }}
        >
          <Text style={styles.rowText}>Channel Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            SheetManager.hide(props.sheetId);
            onDelete?.();
          }}
        >
          <Text style={styles.rowTextDanger}>Delete Channel</Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  container: { paddingVertical: 8 },
  title: { color: '#9ca3af', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: 18, paddingBottom: 6 },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowTextDanger: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
});
