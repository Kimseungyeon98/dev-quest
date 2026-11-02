/* SHA-1 (동기식) — 진짜 git과 같은 오브젝트 해시를 만들기 위해 직접 구현 */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});

  const encoder = new TextEncoder();
  function utf8(str) { return encoder.encode(str); }

  function sha1Bytes(bytes) {
    const l = bytes.length;
    const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[l] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(l / 0x20000000));
    dv.setUint32(padded.length - 4, (l << 3) >>> 0);

    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const w = new Uint32Array(80);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 80; i++) {
        const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = (x << 1) | (x >>> 31);
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
  }

  function concat(...arrs) {
    let n = 0;
    arrs.forEach((a) => { n += a.length; });
    const out = new Uint8Array(n);
    let o = 0;
    arrs.forEach((a) => { out.set(a, o); o += a.length; });
    return out;
  }

  /* git 오브젝트 해시: sha1("<type> <len>\0<content>") */
  function hashObjectBytes(type, contentBytes) {
    return sha1Bytes(concat(utf8(`${type} ${contentBytes.length}\0`), contentBytes));
  }
  function hashObject(type, content) {
    return hashObjectBytes(type, typeof content === 'string' ? utf8(content) : content);
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  G.sha1 = { utf8, sha1Bytes, concat, hashObject, hashObjectBytes, hexToBytes };
})();
