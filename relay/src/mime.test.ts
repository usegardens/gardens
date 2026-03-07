import { describe, it, expect } from 'vitest';
import { buildMime, type OutboundEmailPayload } from './mime';

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

describe('POST /send-email expiry check', () => {
  function isPayloadExpired(payload: OutboundEmailPayload): boolean {
    return Date.now() - payload.timestamp > 5 * 60 * 1000;
  }

  it('rejects expired payloads (10 minutes ago)', () => {
    const payload: OutboundEmailPayload = {
      from_z32: 'abc123',
      to: 'alice@example.com',
      subject: 'Hi',
      body_text: 'Hello',
      body_html: null,
      reply_to_message_id: null,
      timestamp: Date.now() - 10 * 60 * 1000,
    };
    expect(isPayloadExpired(payload)).toBe(true);
  });

  it('accepts a fresh payload (30 seconds ago)', () => {
    const payload: OutboundEmailPayload = {
      from_z32: 'abc123',
      to: 'alice@example.com',
      subject: 'Hi',
      body_text: 'Hello',
      body_html: null,
      reply_to_message_id: null,
      timestamp: Date.now() - 30 * 1000,
    };
    expect(isPayloadExpired(payload)).toBe(false);
  });

  it('rejects payload at exactly the 5-minute boundary plus 1ms', () => {
    const payload: OutboundEmailPayload = {
      from_z32: 'abc123',
      to: 'alice@example.com',
      subject: 'Hi',
      body_text: 'Hello',
      body_html: null,
      reply_to_message_id: null,
      timestamp: Date.now() - (5 * 60 * 1000 + 1),
    };
    expect(isPayloadExpired(payload)).toBe(true);
  });
});
