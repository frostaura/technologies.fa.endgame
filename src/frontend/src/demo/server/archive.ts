/**
 * A real, small app export for the demo (`AppVersionService.ExportAsync`): a gzipped tar of
 * `<slug>/manifest.json`, `<slug>/code.bundle` (a git bundle `git clone` reads) and
 * `<slug>/platform.json`. Everything is built in the page, synchronously and without a library:
 * ustar, stored deflate blocks inside gzip and zlib, CRC-32, Adler-32 and SHA-1. Nothing is
 * compressed; the archive is a few kilobytes.
 */

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- checksums -------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of data) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function sha1(data: Uint8Array): Uint8Array {
  const ml = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(ml / 2 ** 32));
  view.setUint32(padded.length - 4, ml >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 80; j++) {
      const x = (w[j - 3] ?? 0) ^ (w[j - 8] ?? 0) ^ (w[j - 14] ?? 0) ^ (w[j - 16] ?? 0);
      w[j] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      const [f, k] = j < 20 ? [(b & c) | (~b & d), 0x5a827999] : j < 40 ? [b ^ c ^ d, 0x6ed9eba1] : j < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[j] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// --- deflate (stored blocks), zlib and gzip --------------------------------------------------

function stored(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 0;
  do {
    const len = Math.min(65535, data.length - at);
    const last = at + len >= data.length;
    parts.push(new Uint8Array([last ? 1 : 0, len & 0xff, len >> 8, ~len & 0xff, (~len >> 8) & 0xff]), data.subarray(at, at + len));
    at += len;
  } while (at < data.length);
  return concat(parts);
}

function zlib(data: Uint8Array): Uint8Array {
  const a = adler32(data);
  return concat([new Uint8Array([0x78, 0x01]), stored(data), new Uint8Array([a >>> 24, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff])]);
}

export function gzip(data: Uint8Array, mtime: number): Uint8Array {
  const head = new Uint8Array(10);
  head.set([0x1f, 0x8b, 8, 0]);
  new DataView(head.buffer).setUint32(4, mtime >>> 0, true);
  head[9] = 3;
  const tail = new Uint8Array(8);
  const tv = new DataView(tail.buffer);
  tv.setUint32(0, crc32(data), true);
  tv.setUint32(4, data.length >>> 0, true);
  return concat([head, stored(data), tail]);
}

// --- tar (ustar) -----------------------------------------------------------------------------

function tarEntry(name: string, body: Uint8Array, mtime: number): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(bytes(s), at);
  const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";
  put(name, 0);
  put(octal(0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(body.length, 12), 124);
  put(octal(mtime, 12), 136);
  put("        ", 148);
  put("0", 156);
  put("ustar\u000000", 257);
  put("endgame", 265);
  put("endgame", 297);
  const sum = h.reduce((n, b) => n + b, 0);
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const pad = new Uint8Array((512 - (body.length % 512)) % 512);
  return concat([h, body, pad]);
}

export function tar(files: { name: string; body: Uint8Array }[], mtime: number): Uint8Array {
  return concat([...files.map((f) => tarEntry(f.name, f.body, mtime)), new Uint8Array(1024)]);
}

// --- a git bundle ----------------------------------------------------------------------------

interface GitObject {
  type: "commit" | "tree" | "blob";
  body: Uint8Array;
  id: Uint8Array;
}

function object(type: GitObject["type"], body: Uint8Array): GitObject {
  return { type, body, id: sha1(concat([bytes(`${type} ${body.length}\0`), body])) };
}

function packHeader(type: GitObject["type"], size: number): Uint8Array {
  const code = { commit: 1, tree: 2, blob: 3 }[type];
  const out: number[] = [];
  let byte = (code << 4) | (size & 0x0f);
  size >>>= 4;
  while (size > 0) {
    out.push(byte | 0x80);
    byte = size & 0x7f;
    size >>>= 7;
  }
  out.push(byte);
  return new Uint8Array(out);
}

export interface BundleCommit {
  message: string;
  author: string;
  email: string;
  /** Seconds since the epoch. */
  at: number;
  files: Record<string, string>;
}

/** A git bundle (v2) of these commits, oldest first, on `main`: `git clone code.bundle` checks out the newest. */
export function gitBundle(commits: BundleCommit[]): Uint8Array {
  const objects: GitObject[] = [];
  let parent: GitObject | null = null;
  for (const c of commits) {
    const entries = Object.keys(c.files).sort().map((name) => {
      const blob = object("blob", bytes(c.files[name] ?? ""));
      objects.push(blob);
      return concat([bytes(`100644 ${name}\0`), blob.id]);
    });
    const tree = object("tree", concat(entries));
    objects.push(tree);
    const who = `${c.author} <${c.email}> ${c.at} +0000`;
    const commit = object("commit", bytes(`tree ${hex(tree.id)}\n${parent ? `parent ${hex(parent.id)}\n` : ""}author ${who}\ncommitter ${who}\n\n${c.message}\n`));
    objects.push(commit);
    parent = commit;
  }
  const count = new Uint8Array(12);
  count.set(bytes("PACK"));
  new DataView(count.buffer).setUint32(4, 2);
  new DataView(count.buffer).setUint32(8, objects.length);
  const pack = concat([count, ...objects.flatMap((o) => [packHeader(o.type, o.body.length), zlib(o.body)])]);
  const head = parent ? hex(parent.id) : "";
  return concat([bytes(`# v2 git bundle\n${head} refs/heads/main\n${head} HEAD\n\n`), pack, sha1(pack)]);
}
