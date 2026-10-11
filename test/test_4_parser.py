"""test_parser.py — 日志解析格式测试用例"""

import json
import os
import re
import shutil
import subprocess

from test_runner import ROOT, SAMPLES_DIR, TestSuite

suite = TestSuite("日志解析格式验证")

# 来自 parser.js 的预设正则
BRACKET_RE = re.compile(
    r'^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{2,4})\]'
    r'\[(\w+)\]\[(\d+)\]\[(\d+)\]\[([^\]]+)\]\[([^\]]+)\]\s*(.*)$'
)

LOG4J_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3})\s+'
    r'(\w+)\s+\[([^\]]+)\]\s+(\S+)\s*[-:]\s*(.*)$'
)

LOG4J2_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3})\s+'
    r'(\w+)\s+\[([^\]]*)\]\s*\[([^\]]*)\]\s+(\S+)\s*[-:]\s*(.*)$'
)


def is_json(line):
    return line.strip().startswith('{') and line.strip().endswith('}')


def count_matches(lines, fmt):
    """统计给定格式的样本中能匹配的行数"""
    actual = 0
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        if line.startswith('\t') or line.startswith('  '):
            continue

        if fmt == 'bracketLog':
            if BRACKET_RE.match(line):
                actual += 1
        elif fmt == 'log4j2':
            if LOG4J2_RE.match(line):
                actual += 1
        elif fmt in ('log4j', 'multiline'):
            if LOG4J_RE.match(line):
                actual += 1
        elif fmt == 'json':
            if is_json(line):
                try:
                    json.loads(line)
                    actual += 1
                except json.JSONDecodeError:
                    pass
        elif fmt == 'syslog':
            if re.match(r'^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}', line):
                actual += 1
    return actual


TESTS = [
    ('bracket.log', 'bracketLog', 5),
    ('log4j.log', 'log4j', 7),
    ('log4j2.log', 'log4j2', 3),
    ('json.log', 'json', 3),
    ('syslog.log', 'syslog', 3),
    ('multiline.log', 'multiline', 2),
]


@suite.test("样本文件解析")
def _(t, flags):
    t.check(os.path.isdir(SAMPLES_DIR), "test/samples/ 目录存在")
    if not os.path.isdir(SAMPLES_DIR):
        return

    for fname, fmt, expected in TESTS:
        fpath = os.path.join(SAMPLES_DIR, fname)
        if not os.path.exists(fpath):
            t.fail(f"样本文件 {fname} 不存在")
            continue

        lines = open(fpath, encoding='utf-8').read().splitlines()
        print(f"     解析 {fname} ({fmt}) - {len(lines)} 行原始数据...")
        actual = count_matches(lines, fmt)
        t.check(actual == expected, f"{fname}: 解析 {actual}/{expected} 行")


@suite.test("Bracket 字段提取")
def _(t, flags):
    fpath = os.path.join(SAMPLES_DIR, 'bracket.log')
    bracket_lines = open(fpath, encoding='utf-8').read().splitlines()
    if bracket_lines:
        m = BRACKET_RE.match(bracket_lines[0])
        if m:
            t.check(m.group(2) == 'ERROR', "bracket 第1行 level=ERROR")
            t.check(m.group(6) == 'com.example.dao.UserDao', "bracket 第1行 source")
            t.check(len(m.groups()) == 7, f"bracket 捕获7个字段 (实际{len(m.groups())})")


@suite.test("导入健壮性：跳过空/失败文件 + 逐文件流式解析")
def _(t, flags):
    ps = open(os.path.join(ROOT, 'js', 'parser.js'), encoding='utf-8').read()
    app = open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()
    # 空文件 / 空压缩包 / 解压失败 → 统一跳过（不中断整批导入）
    t.check('skippedFiles' in ps, "mergeFiles 记录被跳过的文件")
    t.check('全部 ${n} 个文件为空或解析失败' in ps, "全部失败时抛出明确提示")
    t.check('innerEntries.length === 0' in ps, "空压缩包（无内容）被跳过")
    t.check('added === 0' in ps, "空文本文件被跳过")
    # 跳过结果交由上层在加载完成后统一提示（避免被成功提示覆盖）
    t.check('_lastSkipped' in ps and 'consumeSkipped' in ps, "跳过清单可被上层消费")
    t.check('consumeSkipped' in app and '跳过 ' in app, "onDataLoaded 展示跳过提示")
    # 多文件加速：逐文件流式解析，去除 allLines/fileLineMap 并行大数组
    t.check('const allLines' not in ps and 'const fileLineMap' not in ps,
            "压缩包解析不再累积 allLines/fileLineMap 大数组")
    t.check('_splitLines' in ps, "使用快速按行切分 _splitLines")
    t.check('text.split(/\\r?\\n/)' not in ps, "已移除较慢的正则 split")


@suite.test("导入健壮性：_splitLines / consumeSkipped 运行时行为")
def _(t, flags):
    if not shutil.which('node'):
        t.ok("未检测到 node，跳过运行时用例")
        return
    js_path = os.path.join(ROOT, 'js', 'parser.js')
    script = r"""
const fs = require('fs');
const LP = eval(fs.readFileSync(%s, 'utf8') + '\n;LogParser');
const out = {
  lf: LP._splitLines('a\nb\nc'),
  crlf: LP._splitLines('a\r\nb\r\nc'),
  mixed: LP._splitLines('a\nb\r\n\r\nc'),
  trailing: LP._splitLines('a\n'),
};
LP._lastSkipped = ['x.log', 'empty.zip'];
out.take1 = LP.consumeSkipped();
out.take2 = LP.consumeSkipped();
console.log(JSON.stringify(out));
""" % json.dumps(js_path)
    proc = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr.strip()[:300]}")
        return
    try:
        res = json.loads(proc.stdout.strip())
    except ValueError:
        t.fail(f"输出非 JSON: {proc.stdout.strip()[:200]}")
        return
    t.check(res['lf'] == ['a', 'b', 'c'], f"_splitLines 处理 \\n ({res['lf']})")
    t.check(res['crlf'] == ['a', 'b', 'c'], f"_splitLines 处理 \\r\\n ({res['crlf']})")
    t.check(res['mixed'] == ['a', 'b', '', 'c'], f"_splitLines 处理混合换行 ({res['mixed']})")
    t.check(res['trailing'] == ['a', ''], f"_splitLines 保留行尾空段 ({res['trailing']})")
    t.check(res['take1'] == ['x.log', 'empty.zip'], f"consumeSkipped 返回跳过清单 ({res['take1']})")
    t.check(res['take2'] == [], f"consumeSkipped 取出后清空 ({res['take2']})")
