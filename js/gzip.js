// gzip.js — gzip（RFC 1952）解压，自研实现（替代第三方库 fflate 的 gunzipSync）
//
//   Gzip.gunzipSync(u8) → Uint8Array
//   Gzip.crc32(u8)      → number
//
// 解析 gzip 头（可选 FEXTRA/FNAME/FCOMMENT/FHCRC）后调用 Inflate 解压，
// 并校验 CRC32 与 ISIZE（原始长度）。

const Gzip = {
  _crcTable: null,

  _initCrc() {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    this._crcTable = t;
  },

  crc32(data) {
    if (!this._crcTable) this._initCrc();
    const t = this._crcTable;
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  },

  gunzipSync(u8) {
    if (u8.length < 18) throw new Error('gzip 数据过短');
    if (u8[0] !== 0x1F || u8[1] !== 0x8B) throw new Error('不是 gzip 格式');
    if (u8[2] !== 8) throw new Error('不支持的 gzip 压缩方法: ' + u8[2]);

    const flg = u8[3];
    let p = 10;
    if (flg & 0x04) {                        // FEXTRA
      if (p + 2 > u8.length) throw new Error('gzip 头部越界 (FEXTRA)');
      const xlen = u8[p] | (u8[p + 1] << 8);
      p += 2 + xlen;
    }
    if (flg & 0x08) {                        // FNAME（以 0 结尾）
      while (p < u8.length && u8[p] !== 0) p++;
      p++;
    }
    if (flg & 0x10) {                        // FCOMMENT（以 0 结尾）
      while (p < u8.length && u8[p] !== 0) p++;
      p++;
    }
    if (flg & 0x02) p += 2;                  // FHCRC

    const dataEnd = u8.length - 8;           // 头部之后到 CRC32+ISIZE 之前
    if (dataEnd < p) throw new Error('gzip 头部越界');

    const isize = (u8[u8.length - 4] | (u8[u8.length - 3] << 8)
      | (u8[u8.length - 2] << 16) | (u8[u8.length - 1] << 24)) >>> 0;
    const crc = (u8[u8.length - 8] | (u8[u8.length - 7] << 8)
      | (u8[u8.length - 6] << 16) | (u8[u8.length - 5] << 24)) >>> 0;

    const out = Inflate.inflate(u8.subarray(p, dataEnd), isize);
    if (out.length !== isize) {
      throw new Error(`gzip 解压长度不符（期望 ${isize}，实际 ${out.length}）`);
    }
    if (this.crc32(out) !== crc) throw new Error('gzip CRC 校验失败');
    return out;
  }
};
