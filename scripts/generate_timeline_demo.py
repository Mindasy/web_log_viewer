#!/usr/bin/env python3
"""生成时间线演示日志 — Log4j 格式 + file:func:linenum source

用法:
  python3 scripts/generate_timeline_demo.py              # 生成 50000 行, 输出到 example/timeline_demo.log
  python3 scripts/generate_timeline_demo.py 100000       # 自定义行数
  python3 scripts/generate_timeline_demo.py 100000 out.log  # 自定义输出路径
"""

import os
import random
import sys
from datetime import datetime, timedelta

# ── 配置 ──────────────────────────────────────────────────────────────────────

DEFAULT_LINES = 50000
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'example')

# PID 分配：模拟 3 个进程，每个进程包含若干线程
THREAD_PID_MAP = {
    'http-nio-8080-exec-1': 1001, 'http-nio-8080-exec-2': 1001, 'http-nio-8080-exec-3': 1001,
    'http-nio-8080-exec-4': 1001, 'http-nio-8080-exec-5': 1001, 'http-nio-8080-exec-6': 1001,
    'scheduling-1': 1001, 'scheduling-2': 1001,
    'mq-consumer-order': 2002, 'mq-consumer-notify': 2002, 'mq-consumer-log': 2002,
    'async-task-worker-1': 2002, 'async-task-worker-2': 2002, 'async-task-worker-3': 2002,
    'grpc-server-pool-1': 3003, 'grpc-server-pool-2': 3003,
    'main': 3003,
}
THREADS = [
    'http-nio-8080-exec-1', 'http-nio-8080-exec-2', 'http-nio-8080-exec-3',
    'http-nio-8080-exec-4', 'http-nio-8080-exec-5', 'http-nio-8080-exec-6',
    'scheduling-1', 'scheduling-2',
    'mq-consumer-order', 'mq-consumer-notify', 'mq-consumer-log',
    'async-task-worker-1', 'async-task-worker-2', 'async-task-worker-3',
    'grpc-server-pool-1', 'grpc-server-pool-2',
    'main',
]

# source 格式：pkg.Class:method:linenum
SOURCES = [
    # Web 层
    ('com.example.web.controller.UserController', ['login', 'logout', 'getProfile', 'updateProfile', 'listUsers']),
    ('com.example.web.controller.OrderController', ['createOrder', 'cancelOrder', 'getOrder', 'listOrders', 'refund']),
    ('com.example.web.controller.ProductController', ['search', 'getDetail', 'getStock', 'listByCategory']),
    ('com.example.web.controller.PaymentController', ['pay', 'queryPayResult', 'refund', 'callback']),
    ('com.example.web.filter.AuthFilter', ['doFilter', 'validateToken', 'refreshToken']),
    ('com.example.web.filter.RateLimitFilter', ['doFilter', 'checkQuota', 'acquireToken']),
    # Service 层
    ('com.example.service.UserService', ['authenticate', 'register', 'sendVerifyCode', 'resetPassword']),
    ('com.example.service.OrderService', ['createOrder', 'checkInventory', 'calculatePrice', 'applyCoupon']),
    ('com.example.service.PaymentService', ['createPayment', 'verifySignature', 'handleCallback', 'closeOrder']),
    ('com.example.service.InventoryService', ['deduct', 'restore', 'checkStock', 'batchDeduct']),
    ('com.example.service.NotificationService', ['sendSMS', 'sendEmail', 'sendPush', 'batchNotify']),
    # DAO 层
    ('com.example.dao.UserDao', ['findById', 'insert', 'update', 'deleteById', 'findByEmail']),
    ('com.example.dao.OrderDao', ['findById', 'insert', 'updateStatus', 'findByUserId', 'countByStatus']),
    ('com.example.dao.ProductDao', ['findById', 'search', 'updateStock', 'findByCategory']),
    ('com.example.dao.PaymentDao', ['findByOrderId', 'insert', 'updateStatus', 'findPending']),
    # 缓存 & MQ
    ('com.example.cache.RedisCacheManager', ['get', 'set', 'del', 'expire', 'incr', 'hGet', 'hSet']),
    ('com.example.mq.MessageProducer', ['send', 'sendBatch', 'sendDelay', 'sendTransaction']),
    ('com.example.mq.MessageConsumer', ['onMessage', 'processOrder', 'processNotify', 'processLog']),
    # 调度 & 工具
    ('com.example.scheduler.TaskRunner', ['cleanExpiredSessions', 'refreshCache', 'syncToElasticsearch', 'generateDailyReport']),
    ('com.example.util.HttpClientUtil', ['get', 'post', 'put', 'delete', 'executeWithRetry']),
    ('com.example.util.JsonUtil', ['toJson', 'fromJson', 'validate', 'toPrettyJson']),
]

LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
LEVEL_WEIGHTS = [3, 25, 50, 12, 7, 3]  # 大部分 INFO/DEBUG, 少量 ERROR/WARN

MESSAGES = [
    # INFO
    '请求处理完成, 耗时 {duration}ms',
    '用户 {user} 登录成功',
    '订单 #{orderId} 创建成功, 金额={amount}',
    '缓存命中: key={key}, 命中率={hitRate}%',
    '定时任务 {task} 执行完成, 处理 {count} 条记录',
    'HTTP {method} {url} -> {status}',
    '数据库连接池状态: 活跃={active}, 空闲={idle}, 等待={waiting}',
    '消息发送成功: topic={topic}, msgId={msgId}',
    '配置热加载完成: 更新 {count} 项',
    '健康检查通过: {service} ({latency}ms)',
    '文件上传完成: {file} ({size}KB)',
    'WebSocket 连接建立: session={session}',
    'RPC 调用 {rpcMethod} 返回: {result}',
    'Elasticsearch 索引完成: {index}, 文档数 {docCount}',
    'Token 刷新成功: userId={user}',
    # DEBUG
    '进入方法: 参数 {args}',
    '退出方法: 返回值 {result}',
    'SQL 执行: {sql} — 影响 {rows} 行, 耗时 {cost}ms',
    '请求头: {headers}',
    '响应体: {body}',
    '参数校验: {field}={value} -> {valid}',
    'AOP 前置: {joinPoint}',
    'AOP 后置: {joinPoint}, 耗时 {duration}ms',
    '事务状态: txId={txId}, status={status}',
    'Bean 注入: {bean} -> {target}',
    # TRACE
    '调用栈: {method} <- {caller}',
    '变量快照: {var}={val}',
    '锁获取: {lock}, 等待 {waitMs}ms',
    '缓冲区刷新: {bytes} bytes -> {dest}',
    '循环进度: {i}/{total} in {loop}',
    # WARN
    '慢查询告警: {sql} 耗时 {cost}ms, 阈值 {threshold}ms',
    '内存使用率高: {used}MB/{max}MB ({pct}%)',
    '重试 #{attempt}/{maxRetry}: {operation}',
    '连接池接近耗尽: {used}/{total}',
    '限流触发: API={api}, 当前 QPS={qps}',
    '证书即将过期: {domain}, 剩余 {days} 天',
    '线程池队列积压: {pool} queue={queueSize}',
    '磁盘使用率: {disk}% ({free}GB 可用)',
    '配置项 {key} 已废弃, 请迁移到 {newKey}',
    '响应时间偏高: {url} avg={avg}ms p99={p99}ms',
    # ERROR
    '处理请求失败: {error}',
    '数据库查询超时: {sql}, 等待 {timeout}ms',
    'HTTP 调用失败: {method} {url} -> {error}',
    '序列化异常: 类={cls}, 原因={cause}',
    '事务回滚: txId={txId}, 原因={error}',
    '消息发送失败: topic={topic}, 重试 {attempt}/{maxRetry}',
    '身份验证失败: user={user}, IP={ip}',
    'Redis 操作异常: {cmd} {key} -> {error}',
    '文件读取失败: {path} ({error})',
    'RPC 超时: {rpcMethod}, 超时 {timeout}ms',
    'NullPointerException: {method} 第 {line} 行',
    'IllegalArgumentException: 参数 {param} 值非法: {value}',
    # FATAL
    'OutOfMemoryError: 无法分配 {size}MB, 堆已满',
    '系统即将关闭: 原因 {reason}',
    '数据库连接池完全耗尽: {count} 连接全部在使用中',
    'StackOverflowError: 递归深度 {depth}',
    '磁盘空间耗尽: {mount} 剩余 0 字节',
]


def _make_kwargs():
    """生成消息模板参数"""
    return {
        'duration': random.randint(1, 5000),
        'user': random.choice(['admin', 'john', 'alice', 'bob', 'api-gateway']),
        'orderId': random.randint(100000, 999999),
        'amount': round(random.uniform(9.9, 9999), 2),
        'key': random.choice(['user:42', 'order:777', 'product:99', 'session:abc', 'config:db']),
        'hitRate': round(random.uniform(60, 99.9), 1),
        'task': random.choice(['cleanExpiredSessions', 'refreshCache', 'syncToES', 'dailyReport']),
        'count': random.randint(1, 5000),
        'method': random.choice(['GET', 'POST', 'PUT', 'DELETE']),
        'url': random.choice(['/api/users', '/api/orders', '/api/products', '/api/payments', '/api/health']),
        'status': random.choice(['200', '201', '301', '400', '401', '403', '404', '500', '502', '503']),
        'active': random.randint(1, 20),
        'idle': random.randint(5, 30),
        'waiting': random.randint(0, 5),
        'topic': random.choice(['order.created', 'payment.paid', 'user.registered', 'inventory.low']),
        'msgId': f'mid-{random.randint(100000, 999999)}',
        'service': random.choice(['user-service', 'order-service', 'payment-service', 'cache-service']),
        'latency': random.randint(1, 200),
        'file': random.choice(['report.pdf', 'photo.jpg', 'data.csv', 'dump.sql']),
        'size': random.randint(100, 99999),
        'session': f'sess-{random.randint(10000, 99999)}',
        'rpcMethod': random.choice(['UserService.getById', 'OrderService.create', 'PaymentService.pay']),
        'result': random.choice(['{id:42, name:"test"}', 'true', 'false', 'null', '{status:"ok"}']),
        'index': random.choice(['logs-2026.08', 'orders-2026.08', 'users']),
        'docCount': random.randint(100, 50000),
        'args': f'[id={random.randint(1,999)}, name="{random.choice(["a","b","c"])}", flag={random.choice(["true","false"])}]',
        'sql': f'SELECT * FROM {random.choice(["users","orders","products","payments"])} WHERE id = {random.randint(1,99999)}',
        'rows': random.randint(0, 100),
        'cost': random.randint(1, 5000),
        'headers': '{Accept:application/json, Authorization:Bearer ***, X-Request-Id:' + f'{random.randint(10000,99999)}' + '}',
        'body': '{"status":"ok","data":[...]}',
        'field': random.choice(['email', 'phone', 'amount', 'status']),
        'value': random.choice(['test@example.com', '13800138000', '99.99', 'active']),
        'valid': random.choice(['true', 'false']),
        'joinPoint': random.choice(['execution(UserService.login)', 'execution(OrderService.create)', 'execution(Dao.find)']),
        'txId': f'tx-{random.randint(100000, 999999)}',
        'status_tx': random.choice(['active', 'committed', 'rolled_back']),
        'bean': random.choice(['userDao', 'redisClient', 'httpClient', 'messageProducer']),
        'target': random.choice(['UserController', 'OrderService', 'PaymentHandler', 'CacheManager']),
        'caller': random.choice(['DispatcherServlet', 'Scheduler', 'MessageListener', 'GrpcInterceptor']),
        'var': random.choice(['count', 'total', 'pageSize', 'offset', 'enabled']),
        'val': random.choice(['0', '100', '"hello"', 'true', 'null']),
        'lock': random.choice(['db:lock:order:777', 'cache:lock:refresh', 'dist:lock:sync:task']),
        'waitMs': random.randint(1, 5000),
        'bytes': random.randint(1024, 1048576),
        'dest': random.choice(['stdout', '/var/log/app.log', 'kafka:log-topic']),
        'i': random.randint(1, 1000),
        'total': 1000,
        'loop': random.choice(['processBatch', 'scanRecords', 'exportData']),
        'threshold': 500,
        'used': random.randint(500, 4096),
        'max': random.choice([4096, 8192, 16384]),
        'pct': round(random.uniform(70, 98), 1),
        'attempt': random.randint(1, 3),
        'maxRetry': 3,
        'operation': random.choice(['httpCall', 'dbQuery', 'rpcInvoke', 'cacheGet']),
        'api': random.choice(['/api/users', '/api/orders/search', '/api/products/batch']),
        'qps': random.randint(100, 5000),
        'domain': random.choice(['api.example.com', 'cdn.example.com', 'www.example.com']),
        'days': random.randint(1, 30),
        'pool': random.choice(['http-pool', 'db-pool', 'rpc-pool', 'grpc-pool']),
        'queueSize': random.randint(10, 500),
        'disk': random.randint(70, 98),
        'free': random.randint(1, 50),
        'key_cfg': random.choice(['app.old-feature', 'db.old-pool', 'cache.ttl-old']),
        'newKey': random.choice(['app.new-feature', 'db.new-pool', 'cache.ttl']),
        'avg': random.randint(50, 2000),
        'p99': random.randint(500, 5000),
        'error': random.choice(['Connection refused', 'Timeout', '500 Internal Server Error', 'UnknownHostException', 'SocketException']),
        'timeout': random.choice([5000, 10000, 30000]),
        'cls': random.choice(['UserDTO', 'OrderDTO', 'ResponseDTO']),
        'cause': random.choice(['type mismatch', 'unknown field', 'invalid format']),
        'ip': f'{random.randint(10,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}',
        'cmd': random.choice(['GET', 'SET', 'DEL', 'EXPIRE', 'INCR', 'HGET', 'HSET']),
        'path': random.choice(['/var/log/app.log', '/etc/config.yml', '/data/db.sqlite', '/tmp/cache.bin']),
        'line': random.randint(1, 999),
        'param': random.choice(['userId', 'amount', 'pageSize', 'sortBy']),
        'reason': random.choice(['SIGTERM received', 'health check failed', 'config reload', 'OOM triggered']),
        'depth': random.randint(100, 10000),
        'mount': random.choice(['/data', '/var', '/opt']),
        'pid': random.randint(1000, 9999),
        'tid': random.randint(100, 999),
    }


def pick_level():
    return random.choices(LEVELS, weights=LEVEL_WEIGHTS, k=1)[0]


def random_message(level):
    """根据级别选择消息模板"""
    level_prefixes = {
        'FATAL': ['OutOfMemoryError', '系统即将关闭', '数据库连接池完全耗尽', 'StackOverflowError', '磁盘空间耗尽'],
        'ERROR': ['处理请求失败', '数据库查询超时', 'HTTP 调用失败', '序列化异常', '事务回滚', '消息发送失败', '身份验证失败', 'Redis 操作异常', '文件读取失败', 'RPC 超时', 'NullPointerException', 'IllegalArgumentException'],
        'WARN': ['慢查询告警', '内存使用率高', '重试', '连接池接近耗尽', '限流触发', '证书即将过期', '线程池队列积压', '磁盘使用率', '配置项', '响应时间偏高'],
        'INFO': ['请求处理完成', '登录成功', '订单', '缓存命中', '定时任务', 'HTTP', '数据库连接池状态', '消息发送成功', '配置热加载', '健康检查', '文件上传', 'WebSocket', 'RPC 调用', 'Elasticsearch', 'Token'],
        'DEBUG': ['进入方法', '退出方法', 'SQL 执行', '请求头', '响应体', '参数校验', 'AOP', '事务状态', 'Bean 注入'],
        'TRACE': ['调用栈', '变量快照', '锁获取', '缓冲区刷新', '循环进度'],
    }
    prefixes = level_prefixes.get(level, [''])
    matching = [m for m in MESSAGES if any(m.startswith(p) for p in prefixes)]
    if not matching:
        matching = MESSAGES
    tmpl = random.choice(matching)
    kwargs = _make_kwargs()
    try:
        return tmpl.format(**kwargs)
    except KeyError:
        return tmpl


def generate_line(timestamp, level, thread, pid, pkg, func, line_num, message):
    """生成一条 Log4j 格式日志行"""
    ts = timestamp.strftime('%Y-%m-%d %H:%M:%S,') + f'{timestamp.microsecond // 1000:03d}'
    source = f'{pkg}:{func}:{line_num}'
    return f'{ts} {level:<5} [{thread}] {source} - [pid={pid}] {message}'


def main():
    num_lines = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LINES
    out_name = sys.argv[2] if len(sys.argv) > 2 else 'timeline_demo.log'
    if not out_name.endswith('.log'):
        out_name += '.log'
    out_path = os.path.join(OUTPUT_DIR, out_name)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 时间起点：今天
    base_time = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)
    current_time = base_time
    lines = []

    print(f'生成 {num_lines:,} 条日志, {len(THREADS)} 个线程, {len(SOURCES)} 个源类...')

    for i in range(num_lines):
        level = pick_level()
        thread = random.choice(THREADS)
        pid = THREAD_PID_MAP.get(thread, 9999)
        pkg, funcs = random.choice(SOURCES)
        func = random.choice(funcs)
        line_num = random.randint(10, 999)
        message = random_message(level)
        lines.append(generate_line(current_time, level, thread, pid, pkg, func, line_num, message))

        # 时间推进：模拟真实场景，大部分间隔 0-200ms，偶尔有突发密集或间隔
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
    print(f'  线程数: {len(THREADS)}')
    print(f'  源类数: {len(SOURCES)}')
    print(f'\n启动服务器查看: python3 server.py')
    print(f'然后打开 http://localhost:8321, 选择 {out_name} 文件')


if __name__ == '__main__':
    main()