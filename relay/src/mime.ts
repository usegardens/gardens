// @ts-expect-error — mimetext has no bundled types
import { createMimeMessage } from 'mimetext';

export interface OutboundEmailPayload {
  from_z32: string;
  to: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  reply_to_message_id: string | null;
  timestamp: number;
}

const RELAY_DOMAIN = 'relay.usegardens.com';

export function buildMime(payload: OutboundEmailPayload): string {
  const msg = createMimeMessage();
  msg.setSender(`${payload.from_z32}@${RELAY_DOMAIN}`);
  msg.setRecipient(payload.to);
  msg.setSubject(payload.subject);
  msg.addMessage({ contentType: 'text/plain', data: payload.body_text });

  if (payload.body_html) {
    msg.addMessage({ contentType: 'text/html', data: payload.body_html });
  }
  if (payload.reply_to_message_id) {
    msg.setHeader('In-Reply-To', payload.reply_to_message_id);
    msg.setHeader('References', payload.reply_to_message_id);
  }

  return msg.asRaw();
}
