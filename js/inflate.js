// inflate.js — raw DEFLATE（RFC 1951）解压，自研实现（替代第三方库 fflate 的解压能力）
//
// 仅实现「解压」方向（本项目只解压、不压缩）：
//   Inflate.inflate(data, outSize?) → Uint8Array
//     data     原始 deflate 字节流（不含 zlib/gzip 头）
//     outSize  已知输出大小时预分配，减少扩容拷贝（可选）
//
// 覆盖：stored(0) / 固定 Huffman(1) / 动态 Huffman(2) 三种块类型，
// 标准 LZ77 回溯复制（支持重叠），位读取 LSB 优先，输出按需增长。

const Inflate = {
  // RFC 1951 §3.2.5 码表
  LBASE: [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258],
  LEXT: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    4, 4, 4, 4, 5, 5, 5, 5, 0],
  DBASE: [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
    1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577],
  DEXT: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
    9, 9, 10, 10, 11, 11, 12, 12, 13, 13],
  CORDER: [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15],

  // 复用的查找表与码长缓冲（避免每个块重复分配）
  _litTable: null,
  _distTable: null,
  _clTable: null,
  _litLens: null,
  _distLens: null,
  _clLens: null,
  _fixedLit: null,
  _fixedDist: null,

  _ensureScratch() {
    if (this._litTable) return;
    this._litTable = new Int32Array(1 << 15);   // 最多 15 位
    this._distTable = new Int32Array(1 << 15);
    this._clTable = new Int32Array(1 << 7);     // 码长码最多 7 位
    this._litLens = new Uint8Array(288);
    this._distLens = new Uint8Array(32);
    this._clLens = new Uint8Array(19);
    // 固定 Huffman 码长（RFC 1951 §3.2.6）
    const lit = new Uint8Array(288);
    let i = 0;
    for (; i < 144; i++) lit[i] = 8;
    for (; i < 256; i++) lit[i] = 9;
    for (; i < 280; i++) lit[i] = 7;
    for (; i < 288; i++) lit[i] = 8;
    const dist = new Uint8Array(30).fill(5);
    this._fixedLit = lit;
    this._fixedDist = dist;
  },

  // 由码长构造解码查找表；返回最大码长（0 表示无有效码）
  // 表项 = (码长 << 16) | 符号
  _buildTable(lens, table) {
    let maxBits = 0;
    for (let i = 0; i < lens.length; i++) {
      if (lens[i] > maxBits) maxBits = lens[i];
    }
    if (maxBits === 0) {
      table[0] = 0;
      return 0;
    }
    const counts = new Uint16Array(16);
    for (let i = 0; i < lens.length; i++) counts[lens[i]]++;
    counts[0] = 0;
    const nextCode = new Uint16Array(16);
    let code = 0;
    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + counts[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    const size = 1 << maxBits;
    table.fill(0, 0, size);
    for (let sym = 0; sym < lens.length; sym++) {
      const len = lens[sym];
      if (!len) continue;
      const c = nextCode[len]++;
      // 位序反转：Huffman 码在比特流中 MSB 优先，而位读取器 LSB 优先
      let rev = 0;
      let v = c;
      for (let k = 0; k < len; k++) {
        rev = (rev << 1) | (v & 1);
        v >>>= 1;
      }
      const entry = (len << 16) | sym;
      const step = 1 << len;
      for (let j = rev; j < size; j += step) table[j] = entry;
    }
    return maxBits;
  },

  inflate(data, outSize) {
    this._ensureScratch();
    const litTable = this._litTable;
    const distTable = this._distTable;
    const clTable = this._clTable;
    const litLens = this._litLens;
    const distLens = this._distLens;
    const clLens = this._clLens;

    const LBASE = this.LBASE, LEXT = this.LEXT, DBASE = this.DBASE, DEXT = this.DEXT, CORDER = this.CORDER;
    const len = data.length;

    let out = (typeof outSize === 'number' && outSize > 0)
      ? new Uint8Array(outSize)
      : new Uint8Array(1 << 16);
    let outPos = 0;

    // 位读取（LSB 优先）
    let pos = 0;
    let bitBuf = 0;
    let bitCnt = 0;

    const readBits = (n) => {
      while (bitCnt < n) {
        bitBuf |= (pos < len ? data[pos++] : 0) << bitCnt;
        bitCnt += 8;
      }
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    };

    // 确保输出缓冲至少有 need 空间
    const ensure = (need) => {
      if (outPos + need <= out.length) return;
      let n = out.length;
      while (n < outPos + need) n *= 2;
      const next = new Uint8Array(n);
      next.set(out.subarray(0, outPos));
      out = next;
    };

    // 解码一个 Huffman 符号
    const decode = (table, maxBits) => {
      while (bitCnt < maxBits) {
        bitBuf |= (pos < len ? data[pos++] : 0) << bitCnt;
        bitCnt += 8;
      }
      const entry = table[bitBuf & ((1 << maxBits) - 1)];
      const l = entry >>> 16;
      if (!l) throw new Error('inflate: 无效的 Huffman 码');
      bitBuf >>>= l;
      bitCnt -= l;
      return entry & 0xffff;
    };

    // 跳到字节边界（stored 块前）
    const align = () => {
      const drop = bitCnt & 7;
      bitBuf >>>= drop;
      bitCnt -= drop;
      pos -= bitCnt >> 3;   // 把已预读的整字节退回流
      bitBuf = 0;
      bitCnt = 0;
    };

    let final = 0;
    do {
      final = readBits(1);
      const btype = readBits(2);

      if (btype === 0) {
        // 未压缩块
        align();
        if (pos + 4 > len) throw new Error('inflate: 存储块头部越界');
        const blen = data[pos] | (data[pos + 1] << 8);
        const nlen = data[pos + 2] | (data[pos + 3] << 8);
        pos += 4;
        if ((blen ^ 0xffff) !== nlen) throw new Error('inflate: 存储块长度校验失败');
        if (pos + blen > len) throw new Error('inflate: 存储块数据越界');
        ensure(blen);
        out.set(data.subarray(pos, pos + blen), outPos);
        outPos += blen;
        pos += blen;
      } else if (btype === 1 || btype === 2) {
        let litMax;
        let distMax;
        if (btype === 1) {
          litMax = this._buildTable(this._fixedLit, litTable);
          distMax = this._buildTable(this._fixedDist, distTable);
        } else {
          const hlit = readBits(5) + 257;
          const hdist = readBits(5) + 1;
          const hclen = readBits(4) + 4;
          clLens.fill(0);
          for (let i = 0; i < hclen; i++) clLens[CORDER[i]] = readBits(3);
          const clMax = this._buildTable(clLens, clTable);

          litLens.fill(0);
          distLens.fill(0);
          const total = hlit + hdist;
          const setLen = (idx, val) => {
            if (idx < hlit) litLens[idx] = val;
            else distLens[idx - hlit] = val;
          };
          const getLen = (idx) => (idx < hlit ? litLens[idx] : distLens[idx - hlit]);
          let i = 0;
          while (i < total) {
            const sym = decode(clTable, clMax);
            if (sym < 16) {
              setLen(i++, sym);
            } else if (sym === 16) {
              const rep = 3 + readBits(2);
              const prev = i > 0 ? getLen(i - 1) : 0;
              for (let k = 0; k < rep; k++) setLen(i++, prev);
            } else if (sym === 17) {
              const rep = 3 + readBits(3);
              for (let k = 0; k < rep; k++) setLen(i++, 0);
            } else {
              const rep = 11 + readBits(7);
              for (let k = 0; k < rep; k++) setLen(i++, 0);
            }
          }
          litMax = this._buildTable(litLens.subarray(0, hlit), litTable);
          distMax = this._buildTable(distLens.subarray(0, hdist), distTable);
        }

        // 解码 literal / length 序列
        for (;;) {
          const sym = decode(litTable, litMax);
          if (sym < 256) {
            ensure(1);
            out[outPos++] = sym;
          } else if (sym === 256) {
            break;
          } else {
            const li = sym - 257;
            if (li >= 29) throw new Error('inflate: 非法长度码 ' + sym);
            const length = LBASE[li] + readBits(LEXT[li]);
            const dsym = decode(distTable, distMax);
            if (dsym >= 30) throw new Error('inflate: 非法距离码 ' + dsym);
            const dist = DBASE[dsym] + readBits(DEXT[dsym]);
            if (dist > outPos) throw new Error('inflate: 距离超出输出范围');
            ensure(length);
            let src = outPos - dist;
            for (let k = 0; k < length; k++) out[outPos++] = out[src++];
          }
        }
      } else {
        throw new Error('inflate: 非法块类型 ' + btype);
      }
    } while (!final);

    return out.subarray(0, outPos);
  }
};
