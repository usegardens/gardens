import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import ActionSheet, { SheetManager } from 'react-native-actions-sheet';
import { BlobImage } from '../components/BlobImage';

interface MessageActionsSheetProps {
  sheetId: string;
  payload?: {
    canDelete: boolean;
    canResolve?: boolean;
    extraActions?: Array<{ label: string; destructive?: boolean; onPress?: () => void }>;
    quickReactions?: string[];
    customEmojis?: Record<string, { blobId: string; mimeType: string; roomId: string | null }>;
    resolveLabel?: string;
    onReact?: (emoji: string) => void;
    onReply?: () => void;
    onDelete?: () => void;
    onResolve?: () => void;
  };
}

export function MessageActionsSheet(props: MessageActionsSheetProps) {
  const {
    canDelete,
    canResolve,
    extraActions = [],
    quickReactions = [],
    customEmojis = {},
    resolveLabel = 'Resolve Message',
    onReact,
    onReply,
    onDelete,
    onResolve,
  } = props.payload || {};

  return (
    <ActionSheet id={props.sheetId} useBottomSafeAreaPadding containerStyle={styles.sheet}>
      <View style={styles.container}>
        {quickReactions.length > 0 && (
          <View style={styles.reactionRow}>
            {quickReactions.slice(0, 7).map((emoji) => {
              const custom = customEmojis[emoji];
              return (
                <TouchableOpacity
                  key={emoji}
                  style={styles.reactionBtn}
                  onPress={() => {
                    SheetManager.hide(props.sheetId);
                    onReact?.(emoji);
                  }}
                >
                  {custom ? (
                    <BlobImage
                      blobHash={custom.blobId}
                      mimeType={custom.mimeType}
                      roomId={custom.roomId}
                      style={styles.reactionEmojiImg}
                    />
                  ) : (
                    <Text style={styles.reactionText}>{emoji}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={styles.reactionBtn}
              onPress={() => {
                SheetManager.hide(props.sheetId);
                SheetManager.show('emoji-picker-sheet', {
                  payload: {
                    customEmojis,
                    onSelect: onReact,
                  },
                });
              }}
            >
              <Text style={styles.reactionText}>＋</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            SheetManager.hide(props.sheetId);
            onReply?.();
          }}
        >
          <Text style={styles.rowText}>Reply</Text>
        </TouchableOpacity>

        {extraActions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.row}
            onPress={() => {
              SheetManager.hide(props.sheetId);
              action.onPress?.();
            }}
          >
            <Text style={action.destructive ? styles.rowTextDanger : styles.rowText}>{action.label}</Text>
          </TouchableOpacity>
        ))}

        {canDelete && (
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              SheetManager.hide(props.sheetId);
              onDelete?.();
            }}
          >
            <Text style={styles.rowTextDanger}>Delete</Text>
          </TouchableOpacity>
        )}

        {canResolve && (
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              SheetManager.hide(props.sheetId);
              onResolve?.();
            }}
          >
            <Text style={styles.rowTextDanger}>{resolveLabel}</Text>
          </TouchableOpacity>
        )}
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
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
  },
  reactionBtn: {
    backgroundColor: '#1b1b1b',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reactionText: { color: '#e5e7eb', fontSize: 16 },
  reactionEmojiImg: { width: 18, height: 18, borderRadius: 4 },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowText: { color: '#e5e7eb', fontSize: 15 },
  rowTextDanger: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
});
