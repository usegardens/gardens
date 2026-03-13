import emojiRegex from 'emoji-regex';

/**
 * Validates a user's display name or organization name.
 * 
 * Rules:
 * 1. Must not be empty.
 * 2. Must not exceed 16 characters (correctly measuring emojis, e.g., Array.from).
 * 3. Must contain only alphanumeric characters, spaces, and emojis.
 * 4. Must not contain more than one contiguous space segment (no multiple space gaps).
 */
export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Name is required.';
  }

  // 1. Check length using Array.from to count emojis/surrogate pairs as 1 character
  const chars = Array.from(trimmed);
  if (chars.length > 16) {
    return 'Name must be 16 characters or less.';
  }

  // 2. Check for at most one space gap
  // By splitting on ' ', if there is 1 space, length is 2. If > 2, there are multiple spaces.
  const parts = trimmed.split(' ');
  if (parts.length > 2) {
    return 'Name can only contain a single space.';
  }

  // 3. Ensure parts are solely alphanumeric + emojis.
  // We use the robust emoji-regex to remove valid emojis, then check remaining text.
  const regexEmoji = emojiRegex();
  const withoutEmojis = trimmed.replace(regexEmoji, '');

  // After removing emojis, the only characters left should be alphanumeric and spaces
  const alphanumericRegex = /^[a-zA-Z0-9 ]*$/;
  if (!alphanumericRegex.test(withoutEmojis)) {
    return 'Name can only contain letters, numbers, and emojis.';
  }

  return null; // Valid
}
