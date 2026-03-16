import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { useDebugStore, type DebugEvent } from '../stores/useDebugStore';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function getEventIcon(type: DebugEvent['type']): string {
  switch (type) {
    case 'sync_send': return '📤';
    case 'sync_receive': return '📥';
    case 'relay_upload': return '☁️📤';
    case 'relay_download': return '☁️📥';
    case 'blob_upload': return '📦📤';
    case 'blob_download': return '📦📥';
    default: return '❓';
  }
}

function getEventColor(type: DebugEvent['type']): string {
  switch (type) {
    case 'sync_send': return '#3b82f6';
    case 'sync_receive': return '#22c55e';
    case 'relay_upload': return '#f59e0b';
    case 'relay_download': return '#8b5cf6';
    case 'blob_upload': return '#ec4899';
    case 'blob_download': return '#06b6d4';
    default: return '#6b7280';
  }
}

export function DebugPanel() {
  const [visible, setVisible] = useState(false);
  const { events, clearEvents, enabled } = useDebugStore();

  if (!enabled) {
    return null;
  }

  const recentEvents = events.slice(0, 50);

  return (
    <>
      <TouchableOpacity 
        onPress={() => setVisible(true)}
        style={styles.trigger}
      >
        <Text style={styles.triggerText}>🛠️</Text>
        {events.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {events.length > 99 ? '99+' : events.length}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.panel}>
            <View style={styles.header}>
              <Text style={styles.title}>🔐 Sync/Relay Debug</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.toolbar}>
              <TouchableOpacity 
                style={styles.clearBtn}
                onPress={clearEvents}
              >
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
              <Text style={styles.eventCount}>
                {events.length} events
              </Text>
            </View>

            <ScrollView style={styles.eventList}>
              {recentEvents.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>
                    No events yet. Events will appear when you send/receive sync messages or upload/download blobs.
                  </Text>
                </View>
              ) : (
                recentEvents.map((event) => (
                  <View 
                    key={event.id} 
                    style={[
                      styles.eventItem,
                      { borderLeftColor: getEventColor(event.type) }
                    ]}
                  >
                    <View style={styles.eventHeader}>
                      <Text style={styles.eventIcon}>
                        {getEventIcon(event.type)}
                      </Text>
                      <Text style={styles.eventType}>
                        {event.type.replace('_', ' ').toUpperCase()}
                      </Text>
                      <Text style={styles.eventTime}>
                        {formatTime(event.timestamp)}
                      </Text>
                    </View>
                    <Text style={styles.eventPreview} numberOfLines={1}>
                      {event.preview}
                    </Text>
                    <Text style={styles.eventSize}>
                      {event.size} bytes
                    </Text>
                    {event.details && (
                      <Text style={styles.eventDetails}>
                        {event.details}
                      </Text>
                    )}
                    {event.topic && (
                      <Text style={styles.eventTopic} numberOfLines={1}>
                        Topic: {event.topic.slice(0, 16)}...
                      </Text>
                    )}
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                🔒 Only visible in development builds
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  triggerText: {
    fontSize: 20,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    color: '#888',
    fontSize: 24,
    padding: 4,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  clearBtn: {
    backgroundColor: '#333',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  clearBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  eventCount: {
    color: '#888',
    fontSize: 12,
  },
  eventList: {
    flex: 1,
    padding: 12,
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  eventItem: {
    backgroundColor: '#252525',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  eventType: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  eventTime: {
    color: '#666',
    fontSize: 10,
  },
  eventPreview: {
    color: '#aaa',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  eventSize: {
    color: '#666',
    fontSize: 10,
  },
  eventDetails: {
    color: '#888',
    fontSize: 11,
    marginTop: 4,
  },
  eventTopic: {
    color: '#666',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'center',
  },
  footerText: {
    color: '#666',
    fontSize: 11,
  },
});
