// zip.js — ZIP 容器解析，自研实现（替代第三方库 fflate.unzipSync / JSZip）
//
//   Zip.unzipSync(u8) → { [name]: Uint8Array }
//
// 仅解压：解析 EOCD → 中央目录 → 本地头，取每个条目的压缩数据后按压缩方法解出。
// 支持：method 0（stored，零拷贝 subarray 视图）、method 8（deflate → Inflate）；
//       目录项、归档注释、data descriptor（用中央目录中的尺寸）；
//       基本 zip64（EOCD64 与本条目 0x0001 扩展字段）；
//       加密条目（flag bit0）跳过。

const Zip = {
  _u16(u8, o) { return u8[o] | (u8[o + 1] << 8); },

  _u32(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  },

  _u64(u8, o) {
    // 64 位小端（安全范围 2^53 内）
    return u8[o] + u8[o + 1] * 0x100 + u8[o + 2] * 0x10000 + u8[o + 3] * 0x1000000
      + u8[o + 4] * 0x100000000 + u8[o + 5] * 0x10000000000
      + u8[o + 6] * 0x1000000000000 + u8[o + 7] * 0x100000000000000;
  },

  _findEOCD(u8) {
    const min = Math.max(0, u8.length - 65557);   // EOCD 最长 = 22 + 65535 注释
    for (let i = u8.length - 22; i >= min; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4B && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
    }
    throw new Error('未找到 ZIP 结束记录（EOCD），文件可能已损坏');
  },

  // 读取 zip64 记录（若存在）→ { count, cdOff }
  _readZip64(u8, eocd) {
    const locOff = eocd - 20;
    if (locOff < 0 || this._u32(u8, locOff) !== 0x07064B50) return null;
    const z64Off = this._u64(u8, locOff + 8);
    if (z64Off + 56 > u8.length || this._u32(u8, z64Off) !== 0x06064B50) return null;
    return { count: this._u64(u8, z64Off + 32), cdOff: this._u64(u8, z64Off + 48) };
  },

  // 本条目 zip64 扩展字段（0x0001），按需覆盖 0xFFFFFFFF 的字段
  _readZip64Extra(u8, off, extraLen, sizes) {
    let p = off;
    const end = off + extraLen;
    while (p + 4 <= end) {
      const id = this._u16(u8, p);
      const sz = this._u16(u8, p + 2);
      if (id === 0x0001) {
        let q = p + 4;
        if (sizes.usize === 0xFFFFFFFF) { sizes.usize = this._u64(u8, q); q += 8; }
        if (sizes.csize === 0xFFFFFFFF) { sizes.csize = this._u64(u8, q); q += 8; }
        if (sizes.localOff === 0xFFFFFFFF) { sizes.localOff = this._u64(u8, q); q += 8; }
        break;
      }
      p += 4 + sz;
    }
    return sizes;
  },

  _decodeName(bytes) {
    // 与既有行为一致：统一按 UTF-8 解码（含 bit11 标志或非 UTF-8 名称的兼容处理）
    return new TextDecoder('utf-8').decode(bytes);
  },

  unzipSync(u8) {
    const eocd = this._findEOCD(u8);
    let count = this._u16(u8, eocd + 10);
    let cdOff = this._u32(u8, eocd + 16);
    const cdSize = this._u32(u8, eocd + 12);

    if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
      const z = this._readZip64(u8, eocd);
      if (z) {
        count = z.count;
        cdOff = z.cdOff;
      }
    }

    const out = {};
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > u8.length || this._u32(u8, p) !== 0x02014B50) {
        throw new Error('ZIP 中央目录损坏');
      }
      const flags = this._u16(u8, p + 8);
      const method = this._u16(u8, p + 10);
      const sizes = {
        csize: this._u32(u8, p + 20),
        usize: this._u32(u8, p + 24),
        localOff: this._u32(u8, p + 42)
      };
      const nameLen = this._u16(u8, p + 28);
      const extraLen = this._u16(u8, p + 30);
      const commentLen = this._u16(u8, p + 32);
      const name = this._decodeName(u8.subarray(p + 46, p + 46 + nameLen));

      if (sizes.csize === 0xFFFFFFFF || sizes.usize === 0xFFFFFFFF || sizes.localOff === 0xFFFFFFFF) {
        this._readZip64Extra(u8, p + 46 + nameLen, extraLen, sizes);
      }
      p += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) continue;      // 目录项
      if (flags & 0x01) continue;            // 加密条目：跳过（不支持）

      const localOff = sizes.localOff;
      if (localOff + 30 > u8.length || this._u32(u8, localOff) !== 0x04034B50) {
        throw new Error('ZIP 本地头损坏: ' + name);
      }
      const lNameLen = this._u16(u8, localOff + 26);
      const lExtraLen = this._u16(u8, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + sizes.csize);

      let data;
      if (method === 0) {
        data = comp;                          // 未压缩：零拷贝视图
      } else if (method === 8) {
        data = Inflate.inflate(comp, sizes.usize);
      } else {
        continue;                             // 其它压缩方法：跳过
      }
      out[name] = data;
    }
    return out;
  }
};
