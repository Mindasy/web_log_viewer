"""test_heavy_parser.py — 250w 行日志重型解析测试

直接从 parser.js 源码读取正则表达式进行测试，而非硬编码。
如果 parser.js 中的正则被修改，此测试会立即反映变化。

注意：此测试涉及大量 I/O 和正则运算，--fast 模式下自动跳过。
"""

import glob
import os
import re
import tempfile
import time
from test_runner import ROOT, TestSuite

suite = TestSuite("重型解析 (250w行)")

HEAVY_LINES = 2_500_000

# 从 parser.js 源码动态读取正则
PARSER_PATH = os.path.join(ROOT, 'js', 'parser.js')
PARSER_CACHE = {}

def load_parser_regex(name):
    """从 parser.js 读取指定预置的正则表达式"""
    if name in PARSER_CACHE:
        return PARSER_CACHE[name]

    with open(PARSER_PATH, 'r', encoding='utf-8') as f:
        source = f.read()

    # 定位到指定预置的 regex 定义
    pattern = re.compile(
        rf"{name}:\s*{{[\s\S]*?regex:\s*/((?:[^/\\]|\\.)+)/",
        re.MULTILINE
    )
    m = pattern.search(source)
    if not m:
        raise ValueError(f"在 parser.js 中未找到 {name} 预置的正则")
    regex_str = m.group(1)
    compiled = re.compile(regex_str)
    PARSER_CACHE[name] = compiled
    return compiled


LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
SOURCES = [
    'com.example.web.UserController',
    'com.example.service.OrderService',
    'com.example.dao.UserDao',
    'com.example.cache.RedisCacheManager',
    'com.example.mq.MessageConsumer',
    'com.example.config.SecurityConfig',
    'com.example.util.HttpClientUtil',
    'com.example.scheduler.TaskRunner',
]
THREADS = [
    'http-nio-8080-exec-1', 'http-nio-8080-exec-2', 'main',
    'scheduling-1', 'async-task-1', 'mq-consumer-1',
]
MESSAGES = [
    '用户登录成功 userId={}',
    '订单超时 orderId={}',
    '数据库连接失败: Connection refused (attempt {})',
    'Cache hit for key: user_{}',
    '消息已处理 msgId=msg_{}',
    '请求处理完成耗时 {}ms',
]


def generate_line(idx):
    """生成一条 Log4j 格式日志行"""
    h = (idx * 7 + 10) % 24
    m = (idx * 13 + 15) % 60
    s = (idx * 31 + 23) % 60
    ms = (idx * 97 + 42) % 1000
    level = LEVELS[idx % len(LEVELS)]
    thread = THREADS[idx % len(THREADS)]
    source = SOURCES[idx % len(SOURCES)]
    msg = MESSAGES[idx % len(MESSAGES)].format(idx)
    return (f"2025-06-28 {h:02d}:{m:02d}:{s:02d},{ms:03d} "
            f"{level:<5} [{thread}] {source} - {msg}")


@suite.test("从 parser.js 读取源码正则")
def _(t, flags):
    try:
        regex = load_parser_regex('log4j')
        t.ok(f"成功读取 parser.js 中的 log4j 正则")
    except (ValueError, FileNotFoundError) as e:
        t.fail(f"读取正则失败: {e}")
        raise


@suite.test("生成并解析 250w 行")
def _(t, flags):
    try:
        regex = load_parser_regex('log4j')
    except (ValueError, FileNotFoundError):
        return  # 已在上一个用例报告

    print(f"  目标: {HEAVY_LINES:,} 行 Log4j 格式")
    print(f"  正则来源: parser.js (log4j 预置)")

    # 清理上次可能的残留文件（SIGKILL / 断电等导致 finally 未执行）
    leftover_pattern = os.path.join(tempfile.gettempdir(), 'wvl_heavy_*.log')
    for f in glob.glob(leftover_pattern):
        try:
            os.unlink(f)
        except OSError:
            pass

    tmp = tempfile.NamedTemporaryFile(
        mode='w', prefix='wvl_heavy_', suffix='.log',
        delete=False, encoding='utf-8'
    )
    tmp_path = tmp.name

    try:
        # ---- 阶段 1: 生成 ----
        print("  阶段 1/3: 生成日志文件...")
        t0 = time.time()
        written = 0
        for i in range(HEAVY_LINES):
            tmp.write(generate_line(i) + '\n')
            written += 1
        tmp.close()
        gen_time = time.time() - t0
        size_mb = os.path.getsize(tmp_path) / (1024 * 1024)
        t.check(written == HEAVY_LINES,
                f"写入 {written:,} 行 ({size_mb:.1f} MB)")
        print(f"    耗时: {gen_time:.1f}s, 速度: {written/gen_time:.0f} 行/s")

        # ---- 阶段 2: 解析 ----
        print("  阶段 2/3: 正则解析 (使用 parser.js 源码正则)...")
        t1 = time.time()
        parsed = 0
        errors = 0
        level_counts = {}
        sample_first = None
        sample_last = None
        with open(tmp_path, 'r', encoding='utf-8') as f:
            for line_no, line in enumerate(f, 1):
                line = line.rstrip('\n')
                m = regex.match(line)
                if m:
                    parsed += 1
                    lv = m.group(2)
                    level_counts[lv] = level_counts.get(lv, 0) + 1
                    if line_no == 1:
                        sample_first = m.groups()
                    if line_no == HEAVY_LINES:
                        sample_last = m.groups()
                else:
                    errors += 1
                    if errors <= 3:
                        print(f"      ❌ 第 {line_no} 行未匹配: {line[:80]}...")
        parse_time = time.time() - t1
        t.check(parsed == HEAVY_LINES,
                f"匹配 {parsed:,}/{HEAVY_LINES:,} 行 (来自 parser.js 源码正则)")
        t.check(errors == 0, f"0 行解析失败")
        print(f"    耗时: {parse_time:.1f}s, 速度: {parsed/parse_time:.0f} 行/s")

        # ---- 阶段 3: 字段验证 ----
        print("  阶段 3/3: 字段正确性验证...")
        if sample_first:
            first_level = LEVELS[0]
            t.check(sample_first[1] == first_level,
                    f"第1行 level={sample_first[1]} (期望 {first_level})")
            t.check('UserController' in sample_first[3],
                    f"第1行 source={sample_first[3]}")
        if sample_last:
            last_level = LEVELS[(HEAVY_LINES - 1) % len(LEVELS)]
            t.check(sample_last[1] == last_level,
                    f"第{HEAVY_LINES}行 level={sample_last[1]}")
            last_source = SOURCES[(HEAVY_LINES - 1) % len(SOURCES)]
            t.check(sample_last[3] == last_source,
                    f"第{HEAVY_LINES}行 source={sample_last[3]}")

        expected_per_level = HEAVY_LINES // len(LEVELS)
        for lv in LEVELS:
            actual = level_counts.get(lv, 0)
            diff = abs(actual - expected_per_level)
            t.check(diff <= 1,
                    f"级别 {lv}: 期望 ≈{expected_per_level}, 实际 {actual}")

        total_time = time.time() - t0
        print(f"  ✅ 总耗时: {total_time:.1f}s")

    finally:
        os.unlink(tmp_path)
