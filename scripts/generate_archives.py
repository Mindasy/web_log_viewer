#!/usr/bin/env python3
"""生成不同压缩格式的测试日志文件"""
import io
import os
import gzip
import tarfile
import zipfile
from datetime import datetime, timedelta

EXAMPLE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'example')

LOG_CONTENT = None

def _get_sample_log():
    global LOG_CONTENT
    if LOG_CONTENT:
        return LOG_CONTENT

    lines = []
    base = datetime(2026, 1, 15, 8, 0, 0)

    samples = [
        ('INFO', 'com.example.web.UserController', '用户 admin 登录成功，IP: 192.168.1.100'),
        ('INFO', 'com.example.web.OrderController', '订单 #102345 创建成功，金额 ¥299.00'),
        ('DEBUG', 'com.example.dao.UserDao', '查询用户信息: SELECT * FROM users WHERE id=42'),
        ('WARN', 'com.example.cache.RedisCache', '缓存命中率下降: 当前 72.3%'),
        ('ERROR', 'com.example.service.PaymentService', '支付回调超时: orderId=102345, 重试第 2 次'),
        ('INFO', 'com.example.mq.MessageConsumer', '消费消息: topic=order.created, offset=15003'),
        ('DEBUG', 'com.example.util.HttpClient', '请求 /api/external/notify 耗时 234ms'),
        ('INFO', 'com.example.scheduler.TaskScheduler', '定时任务 dataSync 开始执行'),
        ('INFO', 'com.example.scheduler.TaskScheduler', '定时任务 dataSync 执行完成，耗时 1.2s'),
        ('WARN', 'com.example.config.DatabaseConfig', '数据库连接池使用率: 45/50'),
        ('ERROR', 'com.example.web.OrderController', '订单查询失败: 数据库连接超时'),
        ('FATAL', 'com.example.cache.RedisCache', 'Redis 集群不可用: 所有节点连接失败'),
        ('INFO', 'com.example.service.InventoryService', '库存更新: productId=88, 减 2, 剩余 156'),
        ('DEBUG', 'com.example.dao.OrderDao', '执行 SQL: UPDATE orders SET status=1 WHERE id=102345'),
        ('INFO', 'com.example.web.UserController', '用户 jane 注册成功，邮箱 jane@example.com'),
        ('WARN', 'com.example.util.HttpClient', '请求重试: GET /api/payment/status, 第 3 次'),
        ('ERROR', 'com.example.service.NotificationService', '邮件发送失败: SMTP 连接拒绝'),
        ('INFO', 'com.example.mq.MessageProducer', '消息发送成功: topic=inventory.updated, msgId=mid-998877'),
        ('DEBUG', 'com.example.cache.RedisCache', '缓存 key=user:42:profile 过期，重新加载'),
        ('INFO', 'com.example.web.OrderController', '订单 #102346 支付成功，金额 ¥899.00'),
    ]

    for level, source, msg in samples:
        ts = base.strftime('%Y-%m-%d %H:%M:%S,') + f'{base.microsecond // 1000:03d}'
        line = f'[{ts} +0800][{level}][1234][567][WEB-API][{source}] {msg}'
        lines.append(line)
        base += timedelta(seconds=2)

    LOG_CONTENT = '\n'.join(lines)
    return LOG_CONTENT


def generate_zip(log_name, output_dir):
    content = _get_sample_log()
    path = os.path.join(output_dir, f'{log_name}.zip')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f'{log_name}.log', content)
    size = os.path.getsize(path)
    print(f'  ✅ {os.path.basename(path)}  ({size / 1024:.1f} KB)')
    return path


def generate_tar_gz(log_name, output_dir):
    content = _get_sample_log()
    path = os.path.join(output_dir, f'{log_name}.tar.gz')
    with tarfile.open(path, 'w:gz') as tar:
        buf = io.BytesIO(content.encode('utf-8'))
        info = tarfile.TarInfo(name=f'{log_name}.log')
        info.size = len(buf.getvalue())
        info.mtime = int(datetime.now().timestamp())
        tar.addfile(info, buf)
    size = os.path.getsize(path)
    print(f'  ✅ {os.path.basename(path)}  ({size / 1024:.1f} KB)')
    return path


def generate_tgz(log_name, output_dir):
    content = _get_sample_log()
    path = os.path.join(output_dir, f'{log_name}.tgz')
    with tarfile.open(path, 'w:gz') as tar:
        buf = io.BytesIO(content.encode('utf-8'))
        info = tarfile.TarInfo(name=f'{log_name}.log')
        info.size = len(buf.getvalue())
        info.mtime = int(datetime.now().timestamp())
        tar.addfile(info, buf)
    size = os.path.getsize(path)
    print(f'  ✅ {os.path.basename(path)}  ({size / 1024:.1f} KB)')
    return path


def generate_tar(log_name, output_dir):
    content = _get_sample_log()
    path = os.path.join(output_dir, f'{log_name}.tar')
    with tarfile.open(path, 'w') as tar:
        buf = io.BytesIO(content.encode('utf-8'))
        info = tarfile.TarInfo(name=f'{log_name}.log')
        info.size = len(buf.getvalue())
        info.mtime = int(datetime.now().timestamp())
        tar.addfile(info, buf)
    size = os.path.getsize(path)
    print(f'  ✅ {os.path.basename(path)}  ({size / 1024:.1f} KB)')
    return path


def generate_gz(log_name, output_dir):
    content = _get_sample_log()
    path = os.path.join(output_dir, f'{log_name}.log.gz')
    with gzip.open(path, 'wt', encoding='utf-8') as f:
        f.write(content)
    size = os.path.getsize(path)
    print(f'  ✅ {os.path.basename(path)}  ({size / 1024:.1f} KB)')
    return path


def generate_multi_file_zip(log_name, output_dir):
    content = _get_sample_log()
    path = os.path.join(output_dir, f'{log_name}_multi.zip')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f'{log_name}_1.log', content)
        zf.writestr(f'{log_name}_2.log', content)
        zf.writestr(f'{log_name}_3.log', content)
    size = os.path.getsize(path)
    print(f'  ✅ {os.path.basename(path)}  ({size / 1024:.1f} KB, 3 个文件)')
    return path


def generate_multi_file_tar_gz(log_name, output_dir):
    content = _get_sample_log()
    path = os.path.join(output_dir, f'{log_name}_multi.tar.gz')
    with tarfile.open(path, 'w:gz') as tar:
        for i in range(1, 4):
            buf = io.BytesIO(content.encode('utf-8'))
            info = tarfile.TarInfo(name=f'{log_name}_{i}.log')
            info.size = len(buf.getvalue())
            info.mtime = int(datetime.now().timestamp())
            tar.addfile(info, buf)
    size = os.path.getsize(path)
    print(f'  ✅ {os.path.basename(path)}  ({size / 1024:.1f} KB, 3 个文件)')
    return path


def main():
    os.makedirs(EXAMPLE_DIR, exist_ok=True)
    log_name = 'test_log'

    print('生成压缩测试文件...\n')

    print(f'[ZIP]   单个 .log 文件:')
    generate_zip(log_name, EXAMPLE_DIR)
    print()

    print(f'[ZIP]   多个 .log 文件:')
    generate_multi_file_zip(log_name, EXAMPLE_DIR)
    print()

    print(f'[tar.gz] 单个文件:')
    generate_tar_gz(log_name, EXAMPLE_DIR)
    print()

    print(f'[tgz]   单个文件:')
    generate_tgz(log_name, EXAMPLE_DIR)
    print()

    print(f'[tar.gz] 多个文件:')
    generate_multi_file_tar_gz(log_name, EXAMPLE_DIR)
    print()

    print(f'[tar]   单个文件（未压缩）:')
    generate_tar(log_name, EXAMPLE_DIR)
    print()

    print(f'[gz]    单个文件:')
    generate_gz(log_name, EXAMPLE_DIR)
    print()

    print(f'所有文件已生成到 {EXAMPLE_DIR}/')
    for f in sorted(os.listdir(EXAMPLE_DIR)):
        fp = os.path.join(EXAMPLE_DIR, f)
        if os.path.isfile(fp):
            print(f'  {f:40s} {os.path.getsize(fp) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
