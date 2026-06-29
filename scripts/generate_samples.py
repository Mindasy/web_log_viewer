#!/usr/bin/env python3
"""生成 bracket log 格式的样本 ZIP 文件"""
import os
import random
import zipfile
from datetime import datetime, timedelta

EXAMPLE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'example')
LINES_PER_FILE = 100000
NUM_ZIPS = 25
TIMEZONE_OFFSET = '+0800'

LEVELS = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']
LEVEL_WEIGHTS = [1, 5, 10, 50, 25, 9]

SOURCES = [
    'com.example.web.controller.UserController',
    'com.example.web.controller.OrderController',
    'com.example.web.controller.ProductController',
    'com.example.service.UserService',
    'com.example.service.OrderService',
    'com.example.service.PaymentService',
    'com.example.service.InventoryService',
    'com.example.dao.UserDao',
    'com.example.dao.OrderDao',
    'com.example.dao.ProductDao',
    'com.example.config.SecurityConfig',
    'com.example.config.DatabaseConfig',
    'com.example.cache.RedisCacheManager',
    'com.example.mq.MessageConsumer',
    'com.example.mq.MessageProducer',
    'com.example.scheduler.TaskScheduler',
    'com.example.util.HttpClientUtil',
    'com.example.util.JsonUtil',
]

TAGS = [
    'WEB-API', 'RPC', 'DB', 'CACHE', 'MQ', 'SCHEDULE',
    'AUTH', 'BIZ', 'SYSTEM', 'NETWORK',
]

THREAD_NAMES = [
    'http-nio-8080-exec-1', 'http-nio-8080-exec-2', 'http-nio-8080-exec-3',
    'http-nio-8080-exec-4', 'http-nio-8080-exec-5', 'http-nio-8080-exec-6',
    'http-nio-8080-exec-7', 'http-nio-8080-exec-8',
    'scheduling-1', 'scheduling-2',
    'mq-consumer-1', 'mq-consumer-2', 'mq-consumer-3',
    'async-task-1', 'async-task-2',
    'main',
]

MESSAGES_BY_LEVEL = {
    'FATAL': [
        'OutOfMemoryError: Java heap space - unable to allocate {size}MB for thread {thread}',
        'System shutting down due to unrecoverable error: {error}',
        'Fatal error in {component}: {msg} - process will exit',
        'Critical: database connection pool exhausted, all {count} connections in use and queue full',
        'Stack overflow detected in thread {thread}, aborting',
    ],
    'ERROR': [
        'Failed to process request {requestId}: {error}',
        'Database query timeout after {timeout}ms, SQL: {sql}',
        'Connection pool exhausted: {used}/{total} connections in use',
        'HTTP request {method} {path} failed with status {status}',
        'Redis operation failed: {error}',
        'Serialization error for object {className}: {msg}',
        'Transaction rollback due to {error}',
        'Unable to send message to queue {queue}: {error}',
        'File {path} not found or not readable',
        'Authentication failed for user {user} from IP {ip}',
    ],
    'WARN': [
        'Slow query detected: {duration}ms, SQL: {sql}',
        'Memory usage high: {used}MB/{total}MB ({used_percent}%)',
        'Deprecated method {method} called from {caller}',
        'Retry attempt {attempt}/{maxAttempts} for request {requestId}',
        'Rate limit exceeded for API key {apiKey}',
        'Connection to {host}:{port} is stale, reconnecting',
        'Configuration key {key} is deprecated, use {newKey} instead',
        'Thread pool {pool} queue size: {size}, active threads: {active}',
        'Certificate for {domain} expires in {days} days',
        'Disk usage warning: {usedGB}/{totalGB} GB on {mount}',
    ],
    'INFO': [
        'Application started in {startupTime}ms',
        'Request {method} {path} completed in {duration}ms, status={status}',
        'User {user} logged in from IP {ip}',
        'Order #{orderId} created successfully, total={amount}',
        'Cache refresh completed: {count} entries updated in {duration}ms',
        'Scheduled task {taskName} executed successfully',
        'Message published to topic {topic}, messageId={msgId}',
        'Database migration version {version} applied successfully',
        'Loaded configuration from {path} with {count} properties',
        'Health check passed: all {count} services are healthy',
        'Connection pool initialized: min={minSize}, max={maxSize}',
        'Session created for user {user}, sessionId={sessionId}',
        'File upload completed: {fileName} ({size} bytes)',
        'WebSocket connection established: {sessionId}',
        'Background job {jobName} started',
        'Background job {jobName} completed in {duration}ms',
    ],
    'DEBUG': [
        'Entering method {method} with args: {args}',
        'Exiting method {method}, returning: {result}',
        'SQL executed: {sql} - {rowCount} rows affected',
        'Cache lookup for key {key}: {hit}',
        'Request headers: {headers}',
        'Response body: {body}',
        'Parsing JSON: {json}',
        'Mapping {source_cls} to {target_cls}: {fields}',
        'Injecting dependency {beanName} into {targetClass}',
        'Transaction [{txId}] status: {status}',
    ],
    'TRACE': [
        'Method call stack: {method} <- {caller} <- {rootCaller}',
        'Variable state: {varName}={varValue}',
        'Event dispatched: {eventType} from {source_event}',
        'Lock acquired: {lockName}, wait time={waitTime}ms',
        'Buffer flush: {size} bytes written to {target}',
        'Thread context: {context}',
        'Aspect before: {joinPoint}',
        'Aspect after: {joinPoint}, result={result}',
        'Loop iteration: {iter}/{total_iter} in {method}',
        'Condition evaluation: {condition} = {result_cond}',
    ],
}

def pick_weighted(items, weights):
    total = sum(weights)
    r = random.random() * total
    cumulative = 0
    for item, w in zip(items, weights):
        cumulative += w
        if r <= cumulative:
            return item
    return items[-1]

def _make_msg_kwargs():
    """生成所有消息模板可能用到的 format 参数"""
    return {
        'size': random.randint(128, 4096),
        'thread': random.choice(THREAD_NAMES),
        'error': random.choice(['NullPointerException', 'IllegalArgumentException', 'IOException', 'RuntimeException', 'TimeoutException', 'SQLException']),
        'component': random.choice(['CacheManager', 'DbPool', 'Scheduler', 'HttpClient', 'QueueConsumer']),
        'msg': random.choice(['resource not available', 'invalid state', 'connection refused', 'operation timed out', 'permission denied']),
        'count': random.randint(100, 500),
        'requestId': random.randint(10000, 99999),
        'timeout': random.randint(1000, 30000),
        'sql': f'SELECT * FROM {random.choice(["users","orders","products","config"])} WHERE id = ?',
        'used': random.randint(10, 80),
        'total': random.randint(50, 100),
        'method': random.choice(['GET', 'POST', 'PUT', 'DELETE']),
        'path': random.choice(['/api/users', '/api/orders', '/api/products', '/api/config', '/api/health']),
        'status': random.choice([200, 201, 204, 301, 400, 401, 403, 404, 500, 502, 503]),
        'className': random.choice(['User', 'Order', 'Product', 'Config', 'Response']),
        'queue': random.choice(['order.queue', 'notification.queue', 'log.queue', 'event.queue']),
        'path_file': random.choice(['/var/log/app.log', '/etc/config.yml', '/data/db.sqlite', '/tmp/cache.bin']),
        'user': random.choice(['admin', 'john', 'jane', 'test_user', 'api_client']),
        'ip': f'{random.randint(10,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}',
        'duration': random.randint(10, 5000),
        'orderId': random.randint(100000, 999999),
        'amount': round(random.uniform(10, 9999.99), 2),
        'count_cache': random.randint(100, 10000),
        'taskName': random.choice(['cleanExpiredSessions', 'refreshCache', 'syncData', 'generateReport']),
        'topic': random.choice(['order.created', 'payment.received', 'user.registered', 'inventory.updated']),
        'msgId': f'mid-{random.randint(100000, 999999)}',
        'version': random.randint(1, 100),
        'host': random.choice(['db-primary-01', 'cache-01', 'app-01', 'mq-01']),
        'port': random.randint(1024, 65535),
        'apiKey': f'key_{random.randint(1000,9999)}',
        'pool': random.choice(['http-pool', 'db-pool', 'rpc-pool']),
        'size_file': random.randint(100, 99999),
        'domain': random.choice(['example.com', 'api.example.com', 'cdn.example.com']),
        'days': random.randint(1, 30),
        'usedGB': random.randint(50, 500),
        'totalGB': random.randint(500, 2000),
        'mount': random.choice(['/data', '/var', '/opt', '/home']),
        'startupTime': random.randint(1000, 30000),
        'caller': random.choice(['UserService', 'OrderService', 'Controller', 'Filter', 'Interceptor']),
        'maxAttempts': 3,
        'attempt': random.randint(1, 3),
        'newKey': random.choice(['app.new-feature', 'db.new-pool', 'cache.ttl']),
        'key': random.choice(['app.old-feature', 'db.old-pool', 'cache.ttl-old']),
        'active': random.randint(1, 20),
        'sessionId': f'sess-{random.randint(10000,99999)}',
        'fileName': random.choice(['report.pdf', 'photo.jpg', 'data.csv', 'backup.zip']),
        'jobName': random.choice(['dataSync', 'reportGeneration', 'cacheWarmup', 'logRotation']),
        'minSize': random.randint(5, 20),
        'maxSize': random.randint(50, 200),
        'args': f'[{random.randint(1,100)}, "{random.choice(["a","b","c"])}", true]',
        'result': random.choice(['true', 'false', 'null', '{id: 1, name: "test"}']),
        'rowCount': random.randint(0, 1000),
        'hit': random.choice(['HIT', 'MISS']),
        'headers': '{Accept: application/json, Authorization: Bearer ***}',
        'body': '{"status": "ok", "data": [...]}',
        'json': '{"key": "value", "count": 42}',
        'source_cls': random.choice(['UserDTO', 'OrderDTO', 'Entity']),
        'target_cls': random.choice(['UserVO', 'OrderVO', 'Response']),
        'fields': random.choice(['id, name, email', 'id, amount, status', 'all fields']),
        'beanName': random.choice(['userService', 'orderDao', 'cacheManager']),
        'targetClass': random.choice(['UserController', 'OrderService', 'PaymentHandler']),
        'txId': f'tx-{random.randint(100000, 999999)}',
        'status_tx': random.choice(['active', 'committed', 'rolled_back', 'preparing']),
        'rootCaller': random.choice(['DispatcherServlet', 'Scheduler', 'MessageListener']),
        'varName': random.choice(['counter', 'total', 'pageSize', 'offset']),
        'varValue': random.choice(['0', '100', '"hello"', 'true', 'null']),
        'eventType': random.choice(['UserLoginEvent', 'OrderCreatedEvent', 'CacheRefreshEvent']),
        'source_event': random.choice(['UserService', 'OrderService', 'Scheduler']),
        'lockName': random.choice(['db:lock:orders', 'cache:lock:refresh', 'dist:lock:sync']),
        'waitTime': random.randint(1, 1000),
        'target': random.choice(['stdout', '/var/log/app.log', 'kafka:log-topic']),
        'context': random.choice(['{tenantId: 1, userId: 42}', '{requestId: "req-123"}']),
        'joinPoint': random.choice(['execution(UserService.getUserById)', 'execution(OrderService.createOrder)']),
        'iter': random.randint(1, 1000),
        'total_iter': 1000,
        'condition': random.choice(['user != null', 'order.getAmount() > 100', 'cache.get(key) == null']),
        'result_cond': random.choice(['true', 'false']),
        'used_percent': random.randint(10, 95),
    }

def random_message(level):
    tmpl = random.choice(MESSAGES_BY_LEVEL[level])
    kwargs = _make_msg_kwargs()
    return tmpl.format(**kwargs)

def generate_log_lines(start_time, num_lines):
    pid = random.randint(1000, 9999)
    tid_base = random.randint(100, 999)
    lines = []
    current_time = start_time
    for i in range(num_lines):
        level = pick_weighted(LEVELS, LEVEL_WEIGHTS)
        tag = random.choice(TAGS)
        source = random.choice(SOURCES)
        thread = random.choice(THREAD_NAMES)
        tid = tid_base + random.randint(1, 50)
        message = random_message(level)
        ts = current_time.strftime('%Y-%m-%d %H:%M:%S,') + f'{current_time.microsecond // 1000:03d}'
        line = f'[{ts} {TIMEZONE_OFFSET}][{level}][{pid}][{tid}][{tag}][{source}] {message}'
        lines.append(line)
        # 时间推进：大部分行间隔 0~500ms，偶尔有较长的间隔
        current_time += timedelta(milliseconds=random.randint(0, 500))
        if random.random() < 0.005:
            current_time += timedelta(seconds=random.randint(1, 30))
    return lines

def main():
    os.makedirs(EXAMPLE_DIR, exist_ok=True)
    base_time = datetime(2025, 6, 1, 0, 0, 0)

    for i in range(1, NUM_ZIPS + 1):
        print(f'生成第 {i}/{NUM_ZIPS} 个 ZIP 文件...')
        log_name = f'app_{i}.log'
        zip_name = f'app_{i}.zip'
        zip_path = os.path.join(EXAMPLE_DIR, zip_name)
        lines = generate_log_lines(base_time, LINES_PER_FILE)
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            content = '\n'.join(lines)
            zf.writestr(log_name, content)
        file_size = os.path.getsize(zip_path)
        print(f'  -> {zip_name}: {len(lines)} 条日志, {file_size / 1024 / 1024:.1f} MB')
        base_time += timedelta(hours=6 + random.randint(0, 12))

    print(f'\n所有文件已生成到 {EXAMPLE_DIR}/')

if __name__ == '__main__':
    main()
