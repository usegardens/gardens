import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Clipboard,
  Share,
  LayoutAnimation,
  Platform,
  UIManager,
  useWindowDimensions,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  pkarrUrl: string;
  publicKeyHex: string;
  label: string;
  publicLinkOverride?: string;
  onShare?: () => void;
}

const GARDENS_BASE_URL = 'https://gateway.usegardens.com';

export function PublicIdentityCard({ pkarrUrl, publicKeyHex, label, publicLinkOverride, onShare }: Props) {
  const { width } = useWindowDimensions();
  const [showFullKey, setShowFullKey] = useState(false);
  const [dnsExpanded, setDnsExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const truncatedKey = `${publicKeyHex.slice(0, 16)}...${publicKeyHex.slice(-8)}`;
  const z32Key = pkarrUrl.startsWith('pk:') ? pkarrUrl.slice(3) : pkarrUrl;
  const webLink = publicLinkOverride ?? `${GARDENS_BASE_URL}/pk/${z32Key}`;
  const qrSize = Math.min(Math.max(width - 132, 168), 224);

  const handleCopy = (text: string, type: string) => {
    Clipboard.setString(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleShare = async () => {
    if (onShare) {
      onShare();
      return;
    }
    try {
      await Share.share({
        message: `${label}: ${webLink}`,
        url: webLink,
      });
    } catch {
      // Share cancelled
    }
  };

  const toggleDns = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDnsExpanded(!dnsExpanded);
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={s.title}>{label}</Text>
          <Text style={s.subtitle}>📱 Web, Desktop, iOS & Android</Text>
        </View>
      </View>

      <View style={s.qrContainer}>
        <QRCode
          value={webLink}
          size={qrSize}
          backgroundColor="#ffffff"
          color="#101418"
        />
      </View>

      <Text style={s.qrLabel}>
        Scan the QR code or open Gardens and message this contact key.
      </Text>

      <View style={s.lowerPanel}>
        <View style={s.row}>
          <View style={s.rowContent}>
            <Text style={s.rowLabel}>Your Public Link</Text>
            <Text style={s.rowValue} numberOfLines={1} ellipsizeMode="middle">
              {webLink}
            </Text>
          </View>
          <View style={s.rowActions}>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => handleCopy(webLink, 'url')}
            >
              <Text style={s.iconBtnText}>
                {copied === 'url' ? '✓' : '📋'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={s.row}
          onPress={() => setShowFullKey(!showFullKey)}
          activeOpacity={0.7}
        >
          <View style={s.rowContent}>
            <Text style={s.rowLabel}>Public Key</Text>
            <Text style={s.rowValue} numberOfLines={showFullKey ? undefined : 1}>
              {showFullKey ? publicKeyHex : truncatedKey}
            </Text>
          </View>
          <View style={s.rowActions}>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => handleCopy(publicKeyHex, 'key')}
            >
              <Text style={s.iconBtnText}>
                {copied === 'key' ? '✓' : '📋'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={s.shareBtn} onPress={handleShare}>
          <Text style={s.shareBtnText}>Share Public Link</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.dnsHeader} onPress={toggleDns} activeOpacity={0.7}>
          <Text style={s.dnsHeaderText}>DNS Configuration (optional)</Text>
          <Text style={s.dnsHeaderIcon}>{dnsExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {dnsExpanded && (
          <View style={s.dnsContent}>
            <Text style={s.dnsText}>
              To use a custom domain, add this TXT record to your DNS:
            </Text>

            <View style={s.dnsRecord}>
              <View style={s.dnsRow}>
                <Text style={s.dnsLabel}>Host:</Text>
                <Text style={s.dnsValue}>_gardens</Text>
              </View>
              <View style={s.dnsRow}>
                <Text style={s.dnsLabel}>Value:</Text>
                <Text style={s.dnsValue} numberOfLines={2} ellipsizeMode="middle">
                  {pkarrUrl}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={s.copyDnsBtn}
              onPress={() => handleCopy(`Host: _gardens\nValue: ${pkarrUrl}`, 'dns')}
            >
              <Text style={s.copyDnsText}>
                {copied === 'dns' ? 'Copied!' : 'Copy Record'}
              </Text>
            </TouchableOpacity>

            <Text style={s.dnsHelp}>
              Gardens-enabled apps can then resolve you at yourdomain.com
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#141414',
    borderRadius: 24,
    padding: 16,
    marginVertical: 8,
    marginHorizontal: -6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  header: {
    marginBottom: 10,
  },
  headerText: {
    gap: 4,
  },
  title: {
    color: '#f5f7fa',
    fontSize: 19,
    fontWeight: '700',
  },
  subtitle: {
    color: '#a3a3a3',
    fontSize: 12,
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: '#101010',
    borderRadius: 18,
  },
  qrLabel: {
    color: '#b0b0b0',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  lowerPanel: {
    backgroundColor: '#0d0d0d',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    color: '#9f9f9f',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowValue: {
    color: '#f5f7fa',
    fontSize: 12,
    marginTop: 3,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rowActions: {
    flexDirection: 'row',
    marginLeft: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: {
    fontSize: 16,
  },
  shareBtn: {
    backgroundColor: '#F2E58F',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  shareBtnText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '700',
  },
  dnsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  dnsHeaderText: {
    color: '#b0b0b0',
    fontSize: 13,
    fontWeight: '600',
  },
  dnsHeaderIcon: {
    color: '#9f9f9f',
    fontSize: 12,
  },
  dnsContent: {
    paddingTop: 4,
  },
  dnsText: {
    color: '#b0b0b0',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  dnsRecord: {
    backgroundColor: '#131313',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  dnsRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dnsLabel: {
    color: '#a0a0a0',
    fontSize: 12,
    width: 50,
  },
  dnsValue: {
    color: '#f5f7fa',
    fontSize: 12,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  copyDnsBtn: {
    backgroundColor: '#262626',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  copyDnsText: {
    color: '#f5f7fa',
    fontSize: 12,
    fontWeight: '600',
  },
  dnsHelp: {
    color: '#9d9d9d',
    fontSize: 11,
    fontStyle: 'italic',
  },
});
