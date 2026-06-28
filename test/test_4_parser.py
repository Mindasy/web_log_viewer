"""test_parser.py — 日志解析格式测试用例"""

import json
import os
import re

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
