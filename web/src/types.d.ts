declare module 'z32' {
  export function encode(bytes: Uint8Array): string;
  export function decode(value: string): Uint8Array;
}

declare module 'dns-packet' {
  export interface TxtAnswer {
    type: string;
    name?: string;
    data: unknown;
  }

  export interface Packet {
    type?: string;
    answers?: TxtAnswer[];
  }

  const dns: {
    encode(packet: unknown): Uint8Array;
    decode(data: Uint8Array): Packet;
  };

  export default dns;
}
