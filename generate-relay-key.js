const { ed25519 } = require('@noble/curves/ed25519');
const { randomBytes } = require('@noble/hashes/utils');

// Generate random 32-byte seed
const seed = randomBytes(32);
const seedHex = Buffer.from(seed).toString('hex');

// Get Ed25519 public key
const pubkey = ed25519.getPublicKey(seed);
const pubkeyHex = Buffer.from(pubkey).toString('hex');

// z32 encode (base32 with z-encoding, no padding)
const z32chars = 'ybndrfg8ejkmcpqxot1uwisza345h769';
function toZ32(bytes) {
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += z32chars[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += z32chars[(value << (5 - bits)) & 31];
  }
  return result;
}

const z32 = toZ32(pubkey);

console.log('');
console.log('=== Relay Key Generated ===');
console.log('');
console.log('z32 Key (add to KNOWN_RELAY_PKARR_KEYS in useRelayStore.ts):');
console.log(`  '${z32}',`);
console.log('');
console.log('Seed Hex (set as RELAY_SEED_HEX in wrangler secret):');
console.log(`  ${seedHex}`);
console.log('');
console.log('Public Key Hex (for reference):');
console.log(`  ${pubkeyHex}`);
console.log('');
console.log('Hop URL (for reference):');
console.log('  https://your-relay.workers.dev/hop');
console.log('');
