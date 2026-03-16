import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { LinkPreview as FlyerLinkPreview } from '@flyerhq/react-native-link-preview';

// URL regex pattern for extracting URLs from text
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches || [];
}

// Parse text and return parts with link info
export function parseTextWithLinks(text: string): Array<{ text: string; type: 'text' | 'channel' | 'mention' | 'url'; value?: string }> {
  const parts: Array<{ text: string; type: 'text' | 'channel' | 'mention' | 'url'; value?: string }> = [];
  
  // Match #channel, @mention, and URLs
  const regex = /(#[a-zA-Z0-9_]+)|(@[a-zA-Z0-9_]+)|(https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), type: 'text' });
    }
    
    const fullMatch = match[0];
    if (match[1]) {
      // #channel link
      parts.push({ text: fullMatch, type: 'channel', value: fullMatch.slice(1) });
    } else if (match[2]) {
      // @mention link
      parts.push({ text: fullMatch, type: 'mention', value: fullMatch.slice(1) });
    } else if (match[3]) {
      // URL
      parts.push({ text: fullMatch, type: 'url', value: fullMatch });
    }
    
    lastIndex = match.index + fullMatch.length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), type: 'text' });
  }
  
  return parts;
}

interface LinkPreviewCardProps {
  url: string;
}

export function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  return (
    <View style={styles.container}>
      <FlyerLinkPreview
        text={url}
        containerStyle={styles.previewContainer}
      />
    </View>
  );
}

interface TextWithLinksProps {
  text: string;
  onChannelPress?: (channel: string) => void;
  onMentionPress?: (user: string) => void;
  style?: object;
}

export function TextWithLinks({ text, onChannelPress, onMentionPress, style }: TextWithLinksProps) {
  const parts = parseTextWithLinks(text);
  
  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (part.type === 'channel') {
          return (
            <Text
              key={index}
              style={styles.channelLink}
              onPress={() => onChannelPress?.(part.value!)}
            >
              {part.text}
            </Text>
          );
        } else if (part.type === 'mention') {
          return (
            <Text
              key={index}
              style={styles.mentionLink}
              onPress={() => onMentionPress?.(part.value!)}
            >
              {part.text}
            </Text>
          );
        } else if (part.type === 'url') {
          return (
            <Text
              key={index}
              style={styles.urlLink}
              onPress={() => Linking.openURL(part.value!)}
            >
              {part.text}
            </Text>
          );
        }
        return <Text key={index}>{part.text}</Text>;
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  previewContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  channelLink: {
    color: '#3b82f6',
    fontSize: 15,
    fontWeight: '500',
  },
  mentionLink: {
    color: '#8b5cf6',
    fontSize: 15,
    fontWeight: '500',
  },
  urlLink: {
    color: '#3b82f6',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
});
