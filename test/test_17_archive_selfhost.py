"""test_17_archive_selfhost.py — 自研解压实现验证（替代 fflate / JSZip）

本用例在无浏览器环境下，用 Node 直接运行自研的
    js/inflate.js（raw DEFLATE, RFC 1951）
    js/gzip.js  （gzip 容器 + CRC32, RFC 1952）
    js/zip.js   （ZIP 容器，含 zip64）
对 Python 标准库（zipfile / gzip / zlib）生成的标准压缩样本解码，
再与原始内容逐字节比对，确保自研实现与成熟实现行为一致。
"""

import gzip
import hashlib
import json
import os
import shutil
import struct
import subprocess
import tempfile
import zipfile
import zlib

from test_runner import ROOT, TestSuite

suite = TestSuite("自研解压（inflate/gzip/zip）")

JS_REL = ['js/inflate.js', 'js/zip.js', 'js/gzip.js']

# 在 Node 中加载三个 JS 文件并执行解压，返回 JSON 结果
NODE_SCRIPT = r"""
const fs = require('fs');
const crypto = require('crypto');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let src = '';
for (const f of spec.js) src += fs.readFileSync(f, 'utf8') + '\n';
const api = eval(src + '\n;({Zip: Zip, Gzip: Gzip, Inflate: Inflate})');
const sha = (u8) => crypto.createHash('sha256').update(Buffer.from(u8)).digest('hex');
const out = {};
for (const c of spec.cases) {
  try {
    const u8 = new Uint8Array(fs.readFileSync(c.path));
    if (c.type === 'zip') {
      const m = api.Zip.unzipSync(u8);
      const entries = {};
      for (const n of Object.keys(m)) entries[n] = { size: m[n].length, sha: sha(m[n]) };
      out[c.id] = { names: Object.keys(m).sort(), entries };
    } else if (c.type === 'gz') {
      const d = api.Gzip.gunzipSync(u8);
      out[c.id] = { size: d.length, sha: sha(d) };
    } else if (c.type === 'deflate') {
      const d = api.Inflate.inflate(u8, c.outSize);
      out[c.id] = { size: d.length, sha: sha(d) };
    }
  } catch (e) {
    out[c.id] = { error: String((e && e.message) || e) };
  }
}
console.log(JSON.stringify(out));
"""

# 样本内容
LOG_SMALL = 'hello\nworld\n' * 5
LOG_LARGE = ''.join(f'2026-01-01 10:{i % 60:02d}:{(i * 7) % 60:02d} INFO seq={i} payload\n' for i in range(500))
LOG_REPEAT = ('repeat-this-pattern-' * 40 + '\n') * 120     # 便于触发动态 Huffman
LOG_UNICODE = '中文内容测试\n第二行\n'


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def _build_zip(path, method, entries):
    with zipfile.ZipFile(path, 'w', method) as zf:
        for name, data in entries:
            zf.writestr(name, data)


def _build_zip64(path, entries):
    """先生成普通 zip，再注入 zip64 EOCD + Locator，并把 EOCD 的计数字段置为 0xFFFF。"""
    _build_zip(path, zipfile.ZIP_DEFLATED, entries)
    data = bytearray(open(path, 'rb').read())
    eocd = data.rfind(b'PK\x05\x06')
    if eocd < 0:
        raise RuntimeError('样本缺少 EOCD')
    total = struct.unpack_from('<H', data, eocd + 10)[0]
    cd_size = struct.unpack_from('<I', data, eocd + 12)[0]
    cd_off = struct.unpack_from('<I', data, eocd + 16)[0]

    z64 = struct.pack('<IQHHIIQQQQ', 0x06064B50, 44, 45, 45, 0, 0,
                      total, total, cd_size, cd_off)
    loc = struct.pack('<IIQI', 0x07064B50, 0, eocd, 1)

    struct.pack_into('<H', data, eocd + 8, 0xFFFF)
    struct.pack_into('<H', data, eocd + 10, 0xFFFF)
    struct.pack_into('<I', data, eocd + 12, 0xFFFFFFFF)
    struct.pack_into('<I', data, eocd + 16, 0xFFFFFFFF)

    open(path, 'wb').write(bytes(data[:eocd]) + z64 + loc + bytes(data[eocd:]))


def _raw_deflate(data, level):
    co = zlib.compressobj(level, zlib.DEFLATED, -15)
    return co.compress(data) + co.flush()


@suite.test("Node 运行自研解压：ZIP / gzip / DEFLATE 与标准库一致")
def _(t, flags):
    if not shutil.which('node'):
        t.ok("未检测到 node，跳过运行时用例")
        return

    with tempfile.TemporaryDirectory() as d:
        # ---- 构造样本 ----
        zip_entries = [
            ('a.log', LOG_SMALL),
            ('sub/b.log', LOG_LARGE),
            ('数据/测试.log', LOG_UNICODE),
        ]
        p_zip_stored = os.path.join(d, 'stored.zip')
        p_zip_deflate = os.path.join(d, 'deflate.zip')
        p_zip_empty = os.path.join(d, 'empty.zip')
        p_zip64 = os.path.join(d, 'z64.zip')

        _build_zip(p_zip_stored, zipfile.ZIP_STORED, zip_entries)
        _build_zip(p_zip_deflate, zipfile.ZIP_DEFLATED, zip_entries)
        _build_zip(p_zip_empty, zipfile.ZIP_DEFLATED, [])          # 空 zip
        _build_zip64(p_zip64, [('only.log', LOG_SMALL)])

        # 目录项：单独验证被跳过
        p_zip_dir = os.path.join(d, 'withdir.zip')
        with zipfile.ZipFile(p_zip_dir, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('dir/', '')
            zf.writestr('dir/x.log', LOG_SMALL)

        # gzip 正常 / CRC 损坏 / 截断
        p_gz = os.path.join(d, 'single.gz')
        open(p_gz, 'wb').write(gzip.compress(LOG_LARGE.encode('utf-8')))

        p_gz_crc = os.path.join(d, 'badcrc.gz')
        bad = bytearray(gzip.compress(LOG_SMALL.encode('utf-8')))
        bad[-8] ^= 0xFF                                            # 破坏 CRC32
        open(p_gz_crc, 'wb').write(bytes(bad))

        p_gz_trunc = os.path.join(d, 'trunc.gz')
        open(p_gz_trunc, 'wb').write(gzip.compress(LOG_SMALL.encode('utf-8'))[:-4])

        # raw DEFLATE：stored(level 0) 与 动态 Huffman(level 9)
        raw_stored = _raw_deflate(LOG_SMALL.encode('utf-8'), 0)
        raw_dyn = _raw_deflate(LOG_REPEAT.encode('utf-8'), 9)
        p_dfl_stored = os.path.join(d, 'stored.deflate')
        p_dfl_dyn = os.path.join(d, 'dyn.deflate')
        open(p_dfl_stored, 'wb').write(raw_stored)
        open(p_dfl_dyn, 'wb').write(raw_dyn)

        cases = [
            {'id': 'zip_stored', 'type': 'zip', 'path': p_zip_stored},
            {'id': 'zip_deflate', 'type': 'zip', 'path': p_zip_deflate},
            {'id': 'zip_empty', 'type': 'zip', 'path': p_zip_empty},
            {'id': 'zip_dir', 'type': 'zip', 'path': p_zip_dir},
            {'id': 'zip64', 'type': 'zip', 'path': p_zip64},
            {'id': 'gz_ok', 'type': 'gz', 'path': p_gz},
            {'id': 'gz_badcrc', 'type': 'gz', 'path': p_gz_crc},
            {'id': 'gz_trunc', 'type': 'gz', 'path': p_gz_trunc},
            {'id': 'deflate_stored', 'type': 'deflate', 'path': p_dfl_stored,
             'outSize': len(LOG_SMALL.encode('utf-8'))},
            {'id': 'deflate_dyn', 'type': 'deflate', 'path': p_dfl_dyn,
             'outSize': len(LOG_REPEAT.encode('utf-8'))},
        ]

        spec = {
            'js': [os.path.join(ROOT, rel) for rel in JS_REL],
            'cases': cases,
        }
        p_spec = os.path.join(d, 'spec.json')
        p_script = os.path.join(d, 'run.js')
        open(p_spec, 'w', encoding='utf-8').write(json.dumps(spec))
        open(p_script, 'w', encoding='utf-8').write(NODE_SCRIPT)

        proc = subprocess.run(['node', p_script, p_spec],
                              capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            t.fail(f"Node.js 执行失败: {proc.stderr.strip()[:400]}")
            return
        try:
            res = json.loads(proc.stdout.strip())
        except ValueError:
            t.fail(f"输出非 JSON: {proc.stdout.strip()[:200]}")
            return

        # ---- ZIP 校验 ----
        expected_names = sorted(['a.log', 'sub/b.log', '数据/测试.log'])
        expected_sha = {
            'a.log': _sha(LOG_SMALL.encode('utf-8')),
            'sub/b.log': _sha(LOG_LARGE.encode('utf-8')),
            '数据/测试.log': _sha(LOG_UNICODE.encode('utf-8')),
        }
        for cid in ('zip_stored', 'zip_deflate'):
            r = res.get(cid, {})
            t.check(r.get('names') == expected_names,
                    f"{cid}: 条目名一致 ({r.get('names')})")
            ents = r.get('entries', {})
            for name, h in expected_sha.items():
                t.check(ents.get(name, {}).get('sha') == h, f"{cid}: {name} 内容一致")
            t.check(ents.get('a.log', {}).get('size') == len(LOG_SMALL.encode('utf-8')),
                    f"{cid}: a.log 长度正确")

        t.check(res.get('zip_empty', {}).get('names') == [],
                f"空 zip 解析为空 ({res.get('zip_empty')})")
        t.check(res.get('zip_dir', {}).get('names') == ['dir/x.log'],
                f"zip 目录项被跳过 ({res.get('zip_dir', {}).get('names')})")
        z64 = res.get('zip64', {})
        t.check(z64.get('names') == ['only.log'], f"zip64: 条目正确 ({z64.get('names')})")
        t.check(z64.get('entries', {}).get('only.log', {}).get('sha') == _sha(LOG_SMALL.encode('utf-8')),
                "zip64: 内容一致")

        # ---- gzip 校验 ----
        gz = res.get('gz_ok', {})
        t.check(gz.get('size') == len(LOG_LARGE.encode('utf-8')), f"gzip 长度正确 ({gz.get('size')})")
        t.check(gz.get('sha') == _sha(LOG_LARGE.encode('utf-8')), "gzip 内容一致")
        for cid, label in (('gz_badcrc', 'CRC 损坏'), ('gz_trunc', '数据截断')):
            r = res.get(cid, {})
            t.check(bool(r.get('error')), f"gzip {label} 正确抛出错误 ({r.get('error')})")

        # ---- raw DEFLATE 校验 ----
        for cid, text in (('deflate_stored', LOG_SMALL), ('deflate_dyn', LOG_REPEAT)):
            r = res.get(cid, {})
            raw = text.encode('utf-8')
            t.check(r.get('size') == len(raw), f"{cid}: 长度正确 ({r.get('size')})")
            t.check(r.get('sha') == _sha(raw), f"{cid}: 内容一致")


@suite.test("index.html 不再引用第三方 lib/，且按序加载自研解压脚本")
def _(t, flags):
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    t.check('lib/' not in html, "index.html 不引用 lib/ 第三方库")
    t.check('fflate' not in html and 'jszip' not in html.lower(), "index.html 不含 fflate/jszip 引用")

    for rel in JS_REL:
        t.check(f'src="{rel}"' in html, f"index.html 引入 {rel}")

    # 依赖顺序：inflate 需在 zip/gzip 之前
    i_inflate = html.find('src="js/inflate.js"')
    i_zip = html.find('src="js/zip.js"')
    i_gzip = html.find('src="js/gzip.js"')
    i_archive = html.find('src="js/archive.js"')
    t.check(0 <= i_inflate < i_zip, "inflate.js 在 zip.js 之前")
    t.check(0 <= i_inflate < i_gzip, "inflate.js 在 gzip.js 之前")
    t.check(i_zip < i_archive and i_gzip < i_archive, "zip/gzip 在 archive.js 之前")


@suite.test("自研解压源码不含第三方调用")
def _(t, flags):
    # 精确断言：archive.js 不再调用 fflate/JSZip
    arc = open(os.path.join(ROOT, 'js', 'archive.js'), encoding='utf-8').read()
    for bad in ('fflate.', 'JSZip', 'jszip'):
        t.check(bad not in arc, f"archive.js 不含第三方调用 {bad}")
    t.check('Zip.unzipSync' in arc, "archive.js 使用自研 Zip.unzipSync")
    t.check('Gzip.gunzipSync' in arc, "archive.js 使用自研 Gzip.gunzipSync")
