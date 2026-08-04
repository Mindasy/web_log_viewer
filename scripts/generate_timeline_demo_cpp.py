#!/usr/bin/env python3
"""生成 C++ 风格时间线演示日志 — 源文件格式 file.cpp:func:linenum

用法:
  python3 scripts/generate_timeline_demo_cpp.py              # 50000 行, example/timeline_demo_cpp.log
  python3 scripts/generate_timeline_demo_cpp.py 100000       # 自定义行数
  python3 scripts/generate_timeline_demo_cpp.py 100000 out.log  # 自定义输出
"""

import os
import random
import sys
from datetime import datetime, timedelta

DEFAULT_LINES = 50000
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'example')

# ── C++ 源文件 ─────────────────────────────────────────────────────────────────
CPP_SOURCES = [
    ('main.cpp', ['main', 'initSignalHandlers', 'parseArgs', 'printUsage', 'shutdown']),
    ('http_server.cpp', ['handleRequest', 'parseHeaders', 'routeRequest', 'sendResponse', 'keepAlive', 'readBody', 'checkMethod']),
    ('thread_pool.cpp', ['workerThread', 'submitTask', 'waitAll', 'resizePool', 'getQueueSize', 'shutdownPool']),
    ('database.cpp', ['queryDatabase', 'executeTransaction', 'prepareStatement', 'bindParams', 'fetchRow', 'releaseConnection', 'ping']),
    ('cache.cpp', ['cacheGet', 'cacheSet', 'cacheDel', 'cacheExpire', 'cacheEvict', 'cacheStats', 'cacheFlush', 'cacheWarmUp']),
    ('logger.cpp', ['logMessage', 'rotateLog', 'flushBuffer', 'setLevel', 'formatLine', 'openLogFile', 'closeLogStream']),
    ('network.cpp', ['tcpConnect', 'tcpSend', 'tcpRecv', 'tcpClose', 'setSocketOpt', 'resolveHost', 'bindPort', 'epollWait']),
    ('parser.cpp', ['parseInput', 'parseJson', 'parseXml', 'parseCsv', 'validateSchema', 'skipWhitespace', 'readToken']),
    ('handler.cpp', ['dispatchEvent', 'handleSignal', 'handleTimeout', 'handleError', 'registerHandler', 'unregisterHandler']),
    ('worker.cpp', ['processTask', 'initWorker', 'idleLoop', 'reportMetrics', 'handleFatal', 'checkHealth']),
    ('scheduler.cpp', ['scheduleTask', 'runPending', 'cancelTask', 'rescheduleTask', 'findNextSlot', 'migrateTasks', 'rebalance']),
    ('allocator.cpp', ['allocate', 'deallocate', 'realloc', 'initPool', 'defragPool', 'checkLeak', 'dumpStats', 'trimPool']),
    ('compressor.cpp', ['compress', 'decompress', 'initStream', 'flushStream', 'resetDict', 'checkCrc', 'selectCodec']),
    ('encryptor.cpp', ['encryptData', 'decryptData', 'generateKey', 'rotateKey', 'signData', 'verifySig', 'hashPassword', 'hashFile']),
    ('serializer.cpp', ['serialize', 'deserialize', 'writeHeader', 'readHeader', 'checkMagic', 'alignBuffer', 'truncateTail']),
    ('monitor.cpp', ['collectMetrics', 'reportHealth', 'checkThreshold', 'sendAlert', 'snapshotProcess', 'recordLatency', 'trackMemory']),
    ('ratelimiter.cpp', ['acquireToken', 'refillBucket', 'checkQuota', 'resetCounter', 'burstLimit', 'warmUpPhase', 'syncClocks']),
    ('auth.cpp', ['authenticate', 'authorize', 'validateToken', 'refreshToken', 'revokeToken', 'checkPermission', 'loginAudit', 'rbacCheck']),
    ('config.cpp', ['loadConfig', 'reloadConfig', 'watchFile', 'mergeDefaults', 'validateSchema', 'dumpConfig', 'diffConfig']),
    ('profiler.cpp', ['startProfile', 'stopProfile', 'dumpFlame', 'recordSample', 'resolveSymbol', 'aggregateStacks', 'generateReport']),
]

# ── 线程 ───────────────────────────────────────────────────────────────────────
CPP_THREADS = [
    'main',
    'worker-1', 'worker-2', 'worker-3', 'worker-4',
    'io-thread-1', 'io-thread-2', 'io-thread-3',
    'timer-thread', 'gc-thread', 'signal-handler',
    'db-pool-1', 'db-pool-2',
    'cache-flusher',
    'monitor-thread',
    'profiler-thread',
]

# ── PID 分配 ───────────────────────────────────────────────────────────────────
CPP_THREAD_PID_MAP = {
    'main': 1001,
    'worker-1': 1001, 'worker-2': 1001, 'worker-3': 1001, 'worker-4': 1001,
    'io-thread-1': 1001, 'io-thread-2': 1001, 'io-thread-3': 1001,
    'timer-thread': 1001, 'gc-thread': 1001, 'signal-handler': 1001,
    'db-pool-1': 2002, 'db-pool-2': 2002,
    'cache-flusher': 2002,
    'monitor-thread': 3003, 'profiler-thread': 3003,
}

# ── 线程 TID 和 TAG 映射 ──────────────────────────────────────────────────────
CPP_THREAD_TID = {
    'main': 1001,               # 与 PID 相同
    'worker-1': 2001, 'worker-2': 2002, 'worker-3': 2003, 'worker-4': 2004,
    'io-thread-1': 3001, 'io-thread-2': 3002, 'io-thread-3': 3003,
    'timer-thread': 4001, 'gc-thread': 4002, 'signal-handler': 4003,
    'db-pool-1': 5001, 'db-pool-2': 5002,
    'cache-flusher': 5003,
    'monitor-thread': 6001, 'profiler-thread': 6002,
}

CPP_THREAD_TAG = {
    'main': 'MAIN',
    'worker-1': 'WORKER', 'worker-2': 'WORKER', 'worker-3': 'WORKER', 'worker-4': 'WORKER',
    'io-thread-1': 'IO', 'io-thread-2': 'IO', 'io-thread-3': 'IO',
    'timer-thread': 'TIMER', 'gc-thread': 'GC', 'signal-handler': 'SIGNAL',
    'db-pool-1': 'DB', 'db-pool-2': 'DB',
    'cache-flusher': 'CACHE',
    'monitor-thread': 'MONITOR', 'profiler-thread': 'PROFILE',
}
LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
LEVEL_WEIGHTS = [3, 25, 50, 12, 7, 3]

# ── C++ 风格消息 ───────────────────────────────────────────────────────────────
CPP_MESSAGES = {
    'TRACE': [
        'enter: {func} (args={args})',
        'exit: {func} -> {retval}',
        'lock acquired: {lock} (waited {waitMs}ms)',
        'lock released: {lock}',
        'bytecode: {instr} at {addr}',
        'stack frame: {func} sp={sp} bp={bp}',
        'register snapshot: {reg}=0x{val:016x}',
        'pipeline stage: {stage} -> {next}',
    ],
    'DEBUG': [
        'SQL: {sql} (rows={rows}, cost={cost}ms)',
        'request body: {body}',
        'response headers: {headers}',
        'param check: {field}={value} -> {valid}',
        'tx state: txId={txId}, status={status}',
        'DI: {bean} -> {target}',
        'buffer: used={used}/{total} bytes, segments={segments}',
        'pool stats: active={active}, idle={idle}, max={max}',
        'fd={fd} ready for {events}',
        'epoll: waiting={waiting}, events={events}',
    ],
    'INFO': [
        'request handled: {method} {url} -> {status} ({duration}ms)',
        'task completed: {task} ({count} records, {duration}ms)',
        'cache hit: key={key} ({hitRate}%)',
        'config reloaded: {count} items changed',
        'health check: {service} OK ({latency}ms)',
        'file uploaded: {file} ({size}KB)',
        'connection established: {addr} (fd={fd})',
        'message sent: topic={topic}, msgId={msgId}',
        'index rebuilt: {index}, {docCount} docs',
        'token refreshed: userId={user}',
        'pid={pid} started, port={port}',
        'graceful shutdown: {reason}',
    ],
    'WARN': [
        'slow query: {sql} ({cost}ms > {threshold}ms)',
        'memory high: {used}MB/{max}MB ({pct}%)',
        'retry #{attempt}/{maxRetry}: {operation}',
        'pool exhausted: {used}/{total}',
        'rate limit: {api}, QPS={qps}',
        'cert expiring: {domain} ({days} days)',
        'queue backlog: {pool} queue={queueSize}',
        'disk usage: {disk}% ({free}GB free)',
        'deprecated: {key} -> use {newKey}',
        'latency spike: {url} avg={avg}ms p99={p99}ms',
        'fd leak suspected: {fdCount} open',
        'page fault: addr=0x{addr:016x} (minor)',
    ],
    'ERROR': [
        'request failed: {error}',
        'db timeout: {sql} ({timeout}ms)',
        'HTTP call failed: {method} {url} -> {error}',
        'serialize error: type={cls}, cause={cause}',
        'tx rollback: txId={txId}, {error}',
        'send failed: topic={topic} (attempt {attempt}/{maxRetry})',
        'auth failed: user={user}, IP={ip}',
        'redis error: {cmd} {key} -> {error}',
        'file read error: {path} ({error})',
        'RPC timeout: {rpcMethod} ({timeout}ms)',
        'NullPointerException: {func} at line {line}',
        'IllegalArgument: {param}={value}',
        'segfault: addr=0x{addr:016x}, signal={sig}',
        'assertion failed: {expr} at {func}:{line}',
        'stack overflow: depth={depth}',
    ],
    'FATAL': [
        'OOM: cannot allocate {size}MB, heap exhausted',
        'shutting down: {reason}',
        'pool fully dead: {count} connections all broken',
        'stack overflow: depth={depth}',
        'disk full: {mount} 0 bytes free',
        'double free: addr=0x{addr:016x}',
        'corrupted memory: {check} mismatch at 0x{addr:016x}',
        'uncaught exception: {error}',
        'SIGSEGV: addr=0x{addr:016x} ip=0x{addr:016x}',
        'kernel panic: {error}',
    ],
}


def _make_kwargs():
    return {
        'func': random.choice(['handleRequest', 'processData', 'dispatchEvent', 'parseInput', 'workerLoop', 'queryDb', 'cacheGet', 'cacheSet', 'writeLog', 'sendResponse', 'initModule', 'checkHealth', 'loadConfig', 'hashPassword', 'encrypt', 'decrypt', 'serialize', 'deserialize', 'authenticate', 'authorize', 'acquireLock', 'releaseLock', 'allocate', 'deallocate', 'garbageCollect', 'flushBuffer', 'rotateLog', 'compress', 'decompress']),
        'retval': random.choice(['0', '1', '-1', 'nullptr', 'true', 'false', '{status:ok}', '{error:"timeout"}', 'std::string("done")']),
        'args': f'({random.choice(["int","char*","void*","size_t","bool"])} a={random.randint(1,999)}, const char* s="{"{"}{random.choice(["hello","world","test"])}{"}"}")',
        'lock': random.choice(['m_mutex', 'm_rwLock', 'm_spinLock', 'g_dbLock', 'g_cacheLock', 'g_ioLock', 'm_allocMutex']),
        'waitMs': random.randint(1, 5000),
        'instr': random.choice(['MOV', 'ADD', 'SUB', 'MUL', 'DIV', 'CMP', 'JMP', 'CALL', 'RET', 'PUSH', 'POP', 'LEA', 'XOR', 'AND', 'OR', 'SHL', 'SHR']),
        'addr': random.randint(0x1000, 0xFFFFFFFF),
        'sp': f'0x{random.randint(0x7FFF0000, 0x7FFFFFFF):016x}',
        'bp': f'0x{random.randint(0x7FFF0000, 0x7FFFFFFF):016x}',
        'reg': random.choice(['RAX', 'RBX', 'RCX', 'RDX', 'RSI', 'RDI', 'RBP', 'RSP', 'R8', 'R9', 'R10', 'RIP']),
        'val': f'0x{random.randint(0, 0xFFFFFFFFFFFFFFFF):016x}',
        'stage': random.choice(['fetch', 'decode', 'execute', 'memory', 'writeback']),
        'next': random.choice(['decode', 'execute', 'memory', 'writeback', 'commit']),
        'sql': f'SELECT * FROM {random.choice(["users","orders","logs","sessions","metrics"])} WHERE id = {random.randint(1,99999)}',
        'rows': random.randint(0, 100),
        'cost': random.randint(1, 5000),
        'body': '{"status":"ok","data":[...]}',
        'headers': '{Content-Type: application/json, X-Request-Id: ' + f'{random.randint(10000,99999)}' + ', Authorization: Bearer ***}',
        'field': random.choice(['email', 'phone', 'amount', 'status', 'page', 'sort']),
        'value': random.choice(['test@example.com', '13800138000', '99.99', 'active', '1', 'name_asc']),
        'valid': random.choice(['true', 'false']),
        'txId': f'tx-{random.randint(100000, 999999)}',
        'status': random.choice(['active', 'committed', 'rolled_back']),
        'bean': random.choice(['dbPool', 'cacheClient', 'httpClient', 'messageQueue', 'allocator', 'logger']),
        'target': random.choice(['HttpServer', 'WorkerPool', 'Database', 'CacheManager', 'Scheduler', 'Monitor']),
        'used': random.randint(100, 4096),
        'total': random.choice([4096, 8192, 16384, 32768]),
        'segments': random.randint(1, 16),
        'active': random.randint(1, 20),
        'idle': random.randint(5, 30),
        'max': random.choice([64, 128, 256, 512]),
        'fd': random.randint(3, 1024),
        'events': random.choice(['POLLIN', 'POLLOUT', 'POLLIN|POLLOUT', 'POLLERR', 'POLLHUP']),
        'waiting': random.randint(1, 100),
        'method': random.choice(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
        'url': random.choice(['/api/users', '/api/orders', '/api/health', '/api/metrics', '/api/config']),
        'status': random.choice(['200', '201', '204', '301', '400', '401', '403', '404', '500', '502', '503']),
        'duration': random.randint(1, 5000),
        'task': random.choice(['cleanExpired', 'refreshCache', 'syncToES', 'dailyReport', 'backupDb', 'rotateLogs', 'defragPool']),
        'count': random.randint(1, 5000),
        'key': random.choice(['user:42', 'order:777', 'session:abc', 'config:db', 'lock:refresh', 'counter:hits']),
        'hitRate': round(random.uniform(60, 99.9), 1),
        'service': random.choice(['db-service', 'cache-service', 'auth-service', 'worker-pool', 'io-loop']),
        'latency': random.randint(1, 200),
        'file': random.choice(['report.pdf', 'data.csv', 'dump.core', 'trace.log', 'config.yml']),
        'size': random.randint(100, 99999),
        'topic': random.choice(['order.created', 'payment.done', 'user.registered', 'cache.invalidated', 'task.queued']),
        'msgId': f'mid-{random.randint(100000, 999999)}',
        'index': random.choice(['logs-2026.08', 'orders-2026.08', 'metrics-2026.08']),
        'docCount': random.randint(100, 50000),
        'user': random.choice(['admin', 'john', 'alice', 'bob', 'api-gateway', 'system']),
        'pid': random.randint(1000, 9999),
        'port': random.randint(8000, 9999),
        'reason': random.choice(['SIGTERM', 'SIGINT', 'health failed', 'config reload', 'OOM']),
        'threshold': 500,
        'pct': round(random.uniform(70, 98), 1),
        'attempt': random.randint(1, 3),
        'maxRetry': 3,
        'operation': random.choice(['httpCall', 'dbQuery', 'rpcInvoke', 'cacheGet', 'fileRead', 'tcpConnect']),
        'api': random.choice(['/api/users', '/api/orders', '/api/health', '/api/metrics']),
        'qps': random.randint(100, 5000),
        'domain': random.choice(['api.example.com', 'cdn.example.com', 'www.example.com']),
        'days': random.randint(1, 30),
        'pool': random.choice(['http-pool', 'db-pool', 'rpc-pool', 'thread-pool']),
        'queueSize': random.randint(10, 500),
        'disk': random.randint(70, 98),
        'free': random.randint(1, 50),
        'key_cfg': random.choice(['app.old-feature', 'db.old-pool', 'cache.ttl-old']),
        'newKey': random.choice(['app.new-feature', 'db.new-pool', 'cache.ttl']),
        'avg': random.randint(50, 2000),
        'p99': random.randint(500, 5000),
        'error': random.choice(['Connection refused', 'Timeout', '500 Internal Server Error', 'UnknownHostException', 'SocketException', 'Broken pipe', 'Resource temporarily unavailable', 'Address already in use', 'Connection reset', 'Too many open files']),
        'timeout': random.choice([5000, 10000, 30000, 60000]),
        'cls': random.choice(['UserDTO', 'OrderDTO', 'ResponseDTO', 'Metric', 'Session']),
        'cause': random.choice(['type mismatch', 'unknown field', 'invalid format', 'buffer overflow', 'null pointer', 'use after free']),
        'ip': f'{random.randint(10,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}',
        'cmd': random.choice(['GET', 'SET', 'DEL', 'EXPIRE', 'INCR', 'HGET', 'HSET', 'ZADD', 'LPUSH', 'RPOP']),
        'path': random.choice(['/var/log/app.log', '/etc/config.yml', '/data/db.sqlite', '/tmp/cache.bin', '/proc/self/maps', '/dev/shm/pool']),
        'line': random.randint(1, 9999),
        'param': random.choice(['userId', 'amount', 'pageSize', 'sortBy', 'timeout', 'retries']),
        'rpcMethod': random.choice(['UserService.GetById', 'OrderService.Create', 'PaymentService.Process', 'CacheService.Get', 'AuthService.Verify']),
        'depth': random.randint(100, 10000),
        'mount': random.choice(['/data', '/var', '/opt', '/tmp']),
        'fdCount': random.randint(100, 10000),
        'sig': random.choice(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL', 'SIGSYS']),
        'expr': random.choice(['ptr != nullptr', 'idx < size', 'size <= capacity', 'fd >= 0', 'result == 0', 'count > 0']),
        'check': random.choice(['canary', 'crc32', 'checksum', 'magic', 'guard']),
    }


def pick_level():
    return random.choices(LEVELS, weights=LEVEL_WEIGHTS, k=1)[0]


def random_message(level):
    return random.choice(CPP_MESSAGES.get(level, CPP_MESSAGES['INFO']))


def generate_line(timestamp, level, tid, tag, pid, source_file, func, line_num, message):
    """生成 Bracket Log 格式: [ts +0800][LEVEL][PID][TID][TAG][source] msg"""
    ts = timestamp.strftime('%Y-%m-%d %H:%M:%S,') + f'{timestamp.microsecond // 1000:03d} +0800'
    source = f'{source_file}:{func}:{line_num}'
    return f'[{ts}][{level}][{pid}][{tid}][{tag}][{source}] {message}'


def main():
    num_lines = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LINES
    out_name = sys.argv[2] if len(sys.argv) > 2 else 'timeline_demo_cpp.log'
    if not out_name.endswith('.log'):
        out_name += '.log'
    out_path = os.path.join(OUTPUT_DIR, out_name)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    base_time = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)
    current_time = base_time
    lines = []

    print(f'生成 {num_lines:,} 条 C++ 风格日志, {len(CPP_THREADS)} 个线程, {len(CPP_SOURCES)} 个源文件...')

    for i in range(num_lines):
        level = pick_level()
        thread = random.choice(CPP_THREADS)
        pid = CPP_THREAD_PID_MAP.get(thread, 9999)
        tid = CPP_THREAD_TID.get(thread, 9999)
        tag = CPP_THREAD_TAG.get(thread, 'OTHER')
        source_file, funcs = random.choice(CPP_SOURCES)
        func = random.choice(funcs)
        line_num = random.randint(10, 9999)
        tmpl = random_message(level)
        kwargs = _make_kwargs()
        try:
            message = tmpl.format(**kwargs)
        except (KeyError, ValueError):
            message = tmpl
        lines.append(generate_line(current_time, level, tid, tag, pid, source_file, func, line_num, message))

        gap = random.choices(
            [0, 1, 5, 10, 50, 100, 200, 500, 2000, 5000],
            weights=[5, 10, 15, 20, 20, 15, 8, 4, 2, 1],
            k=1
        )[0]
        current_time += timedelta(milliseconds=gap)

        if (i + 1) % 10000 == 0:
            print(f'  已生成 {i+1:,} 条...')

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    elapsed = (current_time - base_time).total_seconds()
    file_size = os.path.getsize(out_path)
    print(f'\n完成! 输出: {out_path}')
    print(f'  行数: {num_lines:,}')
    print(f'  时间跨度: {elapsed:.0f}s ({elapsed/60:.1f}min)')
    print(f'  文件大小: {file_size / 1024 / 1024:.1f} MB')
    print(f'  线程数: {len(CPP_THREADS)}')
    print(f'  源文件数: {len(CPP_SOURCES)}')
    print(f'\n启动服务器: python3 server.py')
    print(f'打开 http://localhost:8321, 选择 {out_name} 文件')


if __name__ == '__main__':
    main()