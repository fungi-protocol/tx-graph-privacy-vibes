// URL-fragment codec: the entire shareable state travels as
// #s=<base64url(deflate-raw(JSON))>. Everything needed to reproduce what
// the user is looking at: the seed, the camera, the tutorial position, and
// (for the right-click "copy reference" reviewing aid) a click position
// plus the element under the cursor. Params and manual interventions join
// in later milestones.

export interface FragmentState {
  seed: string;
  /** tutorial step index; -1 or absent = tour hidden */
  t?: number;
  /** camera [x, y, scale] */
  cam?: [number, number, number];
  /** view: 0 = block explorer (default), 1 = bipartite */
  v?: number;
  /** scene: 0 = intro story (default), 1 = the economy */
  sc?: number;
  /** economy day (scene 1 only) */
  n?: number;
  /** copy-reference: world position clicked + element selector under cursor */
  ref?: { wx: number; wy: number; sel?: string };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToB64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!, b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += B64[b2 & 63]!;
  }
  return out;
}

function b64urlToBytes(text: string): Uint8Array {
  const idx = new Map([...B64].map((c, i) => [c, i]));
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of text) {
    const v = idx.get(ch);
    if (v === undefined) throw new Error(`bad base64url char ${ch}`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const src = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(src).arrayBuffer());
}

export async function encodeFragment(state: FragmentState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(state));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  return `s=${bytesToB64url(packed)}`;
}

export async function decodeFragment(fragment: string): Promise<FragmentState | null> {
  const m = /(?:^|[#&])s=([A-Za-z0-9_-]+)/.exec(fragment);
  if (!m) return null;
  const packed = b64urlToBytes(m[1]!);
  const json = await pipe(packed, new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(json)) as FragmentState;
}
