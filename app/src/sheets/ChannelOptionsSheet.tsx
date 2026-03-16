import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { FileText, Workflow, FolderOpen, Bitcoin } from 'lucide-react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ChannelOptionsSheet({ visible, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={[styles.overlay, StyleSheet.absoluteFill]} onPress={onClose} />
      <View style={styles.panel}>
        <Text style={styles.title}>Channel Options</Text>
        <TouchableOpacity style={styles.item} onPress={onClose} disabled>
          <FileText size={20} color="#444" />
          <View style={styles.itemContent}>
            <Text style={styles.itemTextDisabled}>Rules</Text>
            <Text style={styles.comingSoon}>Coming soon!</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.item} onPress={onClose} disabled>
          <Workflow size={20} color="#444" />
          <View style={styles.itemContent}>
            <Text style={styles.itemTextDisabled}>Workflow</Text>
            <Text style={styles.comingSoon}>Coming soon!</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.item} onPress={onClose} disabled>
          <FolderOpen size={20} color="#444" />
          <View style={styles.itemContent}>
            <Text style={styles.itemTextDisabled}>Files</Text>
            <Text style={styles.comingSoon}>Coming soon!</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.item} onPress={onClose} disabled>
          <Bitcoin size={20} color="#444" />
          <View style={styles.itemContent}>
            <Text style={styles.itemTextDisabled}>Wallet</Text>
            <Text style={styles.comingSoon}>Coming soon!</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 40,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 12,
  },
  itemContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTextDisabled: {
    color: '#444',
    fontSize: 16,
    fontWeight: '500',
  },
  comingSoon: {
    color: '#555',
    fontSize: 12,
    fontStyle: 'italic',
  },
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#222',
    alignItems: 'center',
  },
  cancelText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
