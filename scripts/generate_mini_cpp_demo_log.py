#!/usr/bin/env python3
"""生成 mini_cpp_demo 的 C++ 风格演示日志 — 源文件格式 file.cpp:func:linenum

日志中的函数名与 example/mini_cpp_demo_callstack.txt 的调用树节点一一对应，
用于验证时间线「调用栈」模式的完整链路：
  1. 加载 example/mini_cpp_demo_callstack.txt
  2. 每个函数节点显示日志条数
  3. 点击节点过滤出该函数的日志

日志按 mini_cpp_demo 的真实调用链生成（模拟 HTTP 请求处理流程）：
  main → initServer → dbConnect
      → handleRequest → parseRequestLine → checkVersion → parseHeaders
                       → getOrder → orderFromCache → cacheGet (miss)
                                 → orderFromDb → dbQuery
                                 → cacheSet
      → shutdown → dbClose

用法:
  python3 scripts/generate_mini_cpp_demo_log.py                     # 默认 2000 行
  python3 scripts/generate_mini_cpp_demo_log.py 5000                # 自定义行数
  python3 scripts/generate_mini_cpp_demo_log.py 5000 out.log        # 自定义输出
"""

import os
import random
import sys
from datetime import datetime, timedelta

DEFAULT_LINES = 2000
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'example')

# ── 源文件:函数 ─────────────────────────────────────────────────────────────────
# 与 example/mini_cpp_demo 一一对应（函数名与调用栈文件节点一致）
FUNC_SOURCES = {
    'main': ('main.cpp', 10),
    'initServer': ('main.cpp', 12),
    'shutdown': ('main.cpp', 15),
    'handleRequest': ('main.cpp', 18),
    'parseRequestLine': ('http.cpp', 5),
    'checkVersion': ('http.cpp', 10),
    'parseHeaders': ('http.cpp', 15),
    'getOrder': ('order.cpp', 20),
    'orderFromCache': ('order.cpp', 25),
    'orderFromDb': ('order.cpp', 30),
    'cacheGet': ('cache.cpp', 5),
    'cacheSet': ('cache.cpp', 10),
    'dbConnect': ('db.cpp', 5),
    'dbQuery': ('db.cpp', 10),
    'dbClose': ('db.cpp', 15),
}

# 调用链：父函数 → 子函数调用序列（模拟真实调用栈）
REQUEST_CHAIN = [
    'main',
    'handleRequest',
    'parseRequestLine',
    'checkVersion',
    'parseHeaders',
    'getOrder',
    'orderFromCache',
    'cacheGet',
    'orderFromDb',
    'dbQuery',
    'cacheSet',
]
STARTUP_CHAIN = ['main', 'initServer', 'dbConnect']
SHUTDOWN_CHAIN = ['main', 'shutdown', 'dbClose']

# 各函数的典型消息（C++ 风格）
FUNC_MESSAGES = {
    'main': [
        'server loop iteration #{it}: listening on :8080',
        'received request #{reqId}',
        'loop wakeup: pending events={n}',
    ],
    'initServer': [
        'initializing server components',
        'registering signal handlers (SIGINT, SIGTERM)',
    ],
    'shutdown': [
        'graceful shutdown initiated, draining connections',
    ],
    'dbClose': [
        'closing database pool, releasing {n} connections',
    ],
    'dbConnect': [
        'connecting to mysql://localhost/db ... connected (latency {ms}ms)',
    ],
    'handleRequest': [
        'handling request #{reqId}: {method} {path}',
        'dispatch to handler: route={route}',
    ],
    'parseRequestLine': [
        'parsing request line: "{line}"',
        'method={method}, path={path}, version=HTTP/1.1',
    ],
    'checkVersion': [
        'protocol check: HTTP/1.1 supported',
    ],
    'parseHeaders': [
        'parsed {n} headers, content-length={len}',
    ],
    'getOrder': [
        'fetching order #{orderId}',
        'order lookup start, id={orderId}',
    ],
    'orderFromCache': [
        'trying cache for order #{orderId}',
    ],
    'cacheGet': [
        'cache GET key=order:{orderId} -> {result}',
    ],
    'orderFromDb': [
        'cache miss, querying database for order #{orderId}',
    ],
    'dbQuery': [
        'SQL: SELECT * FROM orders WHERE id={orderId} (rows={rows}, cost={cost}ms)',
    ],
    'cacheSet': [
        'cache SET key=order:{orderId} val="{{rows:{rows}}}"',
    ],
}

LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']
LEVEL_WEIGHTS = [5, 20, 60, 10, 5]

THREADS = ['main', 'worker-1', 'worker-2', 'worker-3']
THREAD_TID = {'main': 4001, 'worker-1': 4101, 'worker-2': 4102, 'worker-3': 4103}
THREAD_TAG = {'main': 'MAIN', 'worker-1': 'WORKER', 'worker-2': 'WORKER', 'worker-3': 'WORKER'}

PID = 1001
BASE_TIME = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)


def pick_level():
    return random.choices(LEVELS, weights=LEVEL_WEIGHTS, k=1)[0]


def message_for(func, level):
    tmpls = FUNC_MESSAGES.get(func, ['{func} executed'])
    tmpl = random.choice(tmpls)
    kwargs = {
        'it': random.randint(1, 999),
        'reqId': random.randint(10000, 99999),
        'method': random.choice(['GET', 'POST']),
        'path': random.choice(['/api/orders/123', '/api/orders/456', '/api/health']),
        'route': random.choice(['OrderHandler', 'HealthHandler']),
        'line': random.choice(['GET /api/orders/123 HTTP/1.1', 'POST /api/orders HTTP/1.1']),
        'n': random.randint(2, 8),
        'len': random.randint(4, 1024),
        'orderId': random.randint(100, 999),
        'result': random.choice(['HIT', 'MISS', 'HIT']),
        'rows': random.randint(1, 10),
        'cost': random.randint(1, 200),
        'ms': random.randint(5, 80),
        'func': func,
    }
    try:
        return tmpl.format(**kwargs)
    except (KeyError, ValueError):
        return tmpl


def emit(chain, tid, tag, current_time, lines):
    """按调用链顺序输出日志，返回更新后的时间"""
    for func in chain:
        level = pick_level()
        src_file, line_num = FUNC_SOURCES[func]
        msg = message_for(func, level)
        ts = current_time.strftime('%Y-%m-%d %H:%M:%S,') + f'{current_time.microsecond // 1000:03d} +0800'
        source = f'{src_file}:{func}:{line_num}'
        lines.append(f'[{ts}][{level}][{PID}][{tid}][{tag}][{source}] {msg}')
        # 同函数内可能输出 1-3 条
        for _ in range(random.choices([0, 1, 2], weights=[40, 50, 10])[0]):
            level2 = pick_level()
            msg2 = message_for(func, level2)
            ts2 = current_time.strftime('%Y-%m-%d %H:%M:%S,') + f'{current_time.microsecond // 1000:03d} +0800'
            lines.append(f'[{ts2}][{level2}][{PID}][{tid}][{tag}][{source}] {msg2}')
            current_time += timedelta(milliseconds=random.randint(1, 30))
        current_time += timedelta(milliseconds=random.randint(5, 60))
    return current_time


def main():
    num_lines = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LINES
    out_name = sys.argv[2] if len(sys.argv) > 2 else 'mini_cpp_demo.log'
    if not out_name.endswith('.log'):
        out_name += '.log'
    out_path = os.path.join(OUTPUT_DIR, out_name)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    current_time = BASE_TIME
    lines = []
    booted = False
    req_counter = 0

    print(f'生成 {num_lines:,} 条 mini_cpp_demo C++ 风格日志 -> {out_path}')

    while len(lines) < num_lines:
        # 首次需启动
        if not booted:
            current_time = emit(STARTUP_CHAIN, THREAD_TID['main'], THREAD_TAG['main'], current_time, lines)
            booted = True
            current_time += timedelta(milliseconds=100)
            continue
        # 随机关闭/重启（制造 initServer/dbConnect 多次出现）
        if random.random() < 0.08:
            current_time = emit(SHUTDOWN_CHAIN, THREAD_TID['main'], THREAD_TAG['main'], current_time, lines)
            booted = False
            current_time += timedelta(milliseconds=200)
            continue
        # 主线程处理请求
        thread = random.choices(THREADS, weights=[45, 25, 20, 10])[0]
        if thread == 'main':
            current_time = emit(REQUEST_CHAIN, THREAD_TID['main'], THREAD_TAG['main'], current_time, lines)
        else:
            # worker 异步执行部分链（模拟异步任务）
            chain = ['handleRequest', 'parseRequestLine', 'checkVersion', 'parseHeaders',
                     'getOrder', 'orderFromCache', 'cacheGet', 'orderFromDb', 'dbQuery', 'cacheSet']
            current_time = emit(chain, THREAD_TID[thread], THREAD_TAG[thread], current_time, lines)
        req_counter += 1
        current_time += timedelta(milliseconds=random.randint(20, 500))

        if len(lines) >= num_lines:
            break

    lines = lines[:num_lines]
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    elapsed = (current_time - BASE_TIME).total_seconds()
    print(f'完成! 行数: {len(lines):,}, 请求数: {req_counter:,}, 时间跨度: {elapsed:.0f}s')
    print(f'文件大小: {os.path.getsize(out_path) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
