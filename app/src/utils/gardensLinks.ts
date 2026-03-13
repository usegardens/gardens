export type ParsedGardensLink =
  | { kind: 'dm'; recipientKey: string }
  | { kind: 'pk'; z32Key: string }
  | { kind: 'join'; orgId?: string; adminKey?: string; z32Key?: string; orgName?: string }
  | { kind: 'invite'; tokenBase64: string; orgName?: string };

const GARDENS_HOSTS = new Set(['usegardens.com', 'www.usegardens.com']);

export function parseGardensLink(url: string): ParsedGardensLink | null {
  if (!url) return null;
  const normalizedUrl = url.trim().replace(/\s+/g, '');

  if (normalizedUrl.startsWith('gardens://dm/')) {
    const recipientKey = normalizedUrl.slice('gardens://dm/'.length);
    return recipientKey ? { kind: 'dm', recipientKey } : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const isGardensScheme = parsed.protocol === 'gardens:';
  const isGardensHost = GARDENS_HOSTS.has(parsed.host);

  if (!isGardensScheme && !isGardensHost) return null;

  const schemeHost = isGardensScheme ? parsed.host : '';
  const schemePathHead = isGardensScheme ? (pathParts[0] ?? '') : '';

  const maybeZ32 =
    isGardensScheme
      ? (
          schemeHost === 'pk'
            ? (pathParts[0] ?? null)
            : (schemePathHead === 'pk' ? (pathParts[1] ?? null) : null)
        )
      : (pathParts.length >= 2 && pathParts[0] === 'pk' ? pathParts[1] : null);
  if (maybeZ32) {
    return { kind: 'pk', z32Key: maybeZ32 };
  }

  const isJoinPath =
    isGardensScheme
      ? (schemeHost === 'join' || schemePathHead === 'join')
      : pathParts[0] === 'join';
  if (isJoinPath) {
    return {
      kind: 'join',
      orgId: parsed.searchParams.get('orgId') ?? parsed.searchParams.get('org') ?? undefined,
      adminKey:
        parsed.searchParams.get('adminKey')
        ?? parsed.searchParams.get('adminPubkey')
        ?? parsed.searchParams.get('admin')
        ?? undefined,
      z32Key: parsed.searchParams.get('z32') ?? parsed.searchParams.get('z32Key') ?? undefined,
      orgName: parsed.searchParams.get('name') ?? undefined,
    };
  }

  const isInvitePath =
    isGardensScheme
      ? (schemeHost === 'invite' || schemePathHead === 'invite')
      : pathParts[0] === 'invite';
  if (isInvitePath) {
    const tokenBase64 = parsed.searchParams.get('token');
    if (!tokenBase64) return null;
    return {
      kind: 'invite',
      tokenBase64,
      orgName: parsed.searchParams.get('name') ?? undefined,
    };
  }

  const tokenMatch = normalizedUrl.match(/(?:^|[?&])token=([^&]+)/i);
  if (tokenMatch?.[1]) {
    let tokenBase64 = tokenMatch[1];
    try {
      tokenBase64 = decodeURIComponent(tokenBase64);
    } catch {
      // Keep the raw token fragment if decoding fails.
    }
    return {
      kind: 'invite',
      tokenBase64,
      orgName: (() => {
        const nameMatch = normalizedUrl.match(/(?:^|[?&])name=([^&]+)/i);
        if (!nameMatch?.[1]) return undefined;
        try {
          return decodeURIComponent(nameMatch[1]);
        } catch {
          return nameMatch[1];
        }
      })(),
    };
  }

  if (/^eyJ[a-zA-Z0-9+/=]+$/.test(normalizedUrl)) {
    return { kind: 'invite', tokenBase64: normalizedUrl };
  }

  return null;
}
