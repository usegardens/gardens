import { describe, it, expect } from 'vitest';
import { buildMime } from './mime';

describe('buildMime', () => {
  it('includes From address with z32 key and relay domain', () => {
    const raw = buildMime({
      from_z32: 'abc123',
      to: 'alice@example.com',
      subject: 'Hello',
      body_text: 'Hi there',
      body_html: null,
      reply_to_message_id: null,
      timestamp: 0,
    });
    expect(raw).toContain('abc123@gardens-relay.stereos.workers.dev');
    expect(raw).toContain('alice@example.com');
    // mimetext base64-encodes the subject as a MIME encoded-word
    expect(raw).toMatch(/Subject:.*Hello|Subject:.*SGVsbG8/);
  });

  it('sets In-Reply-To when reply_to_message_id is provided', () => {
    const raw = buildMime({
      from_z32: 'abc123',
      to: 'alice@example.com',
      subject: 'Re: Hello',
      body_text: 'Sure!',
      body_html: null,
      reply_to_message_id: '<msg-id-123@mail.example.com>',
      timestamp: 0,
    });
    expect(raw).toContain('In-Reply-To');
    expect(raw).toContain('msg-id-123@mail.example.com');
  });
});
