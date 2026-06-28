"""test_runner.py — 测试框架

提供测试上下文、注册、运行和报告能力。
测试模块可通过 `register(suite)` 向 TestSuite 注册测试用例。
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_DIR = os.path.join(ROOT, 'test')
SAMPLES_DIR = os.path.join(TEST_DIR, 'samples')
SERVER_PORT = 8765


class TestContext:
    """测试上下文 — 每个测试用例的检查工具"""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def ok(self, msg):
        self.passed += 1
        print(f"  ✅ {msg}")

    def fail(self, msg):
        self.failed += 1
        self.errors.append(msg)
        print(f"  ❌ {msg}")

    def check(self, cond, msg):
        if cond:
            self.ok(msg)
        else:
            self.fail(msg)


class TestSuite:
    """测试套件 — 管理一组相关测试用例"""

    def __init__(self, name):
        self.name = name
        self.cases = []  # [(case_name, run_func), ...]

    def test(self, name):
        """装饰器模式: @suite.test('描述')"""
        def decorator(func):
            self.cases.append((name, func))
            return func
        return decorator

    def run(self, ctx, flags):
        """运行套件内所有用例，共用同一个 ctx"""
        print(f"\n[{self.name}]")
        for case_name, func in self.cases:
            func(ctx, flags)


def discover():
    """自动发现 test/ 下所有 test_*.py 模块并获取其 suite"""
    suites = []
    for f in sorted(os.listdir(TEST_DIR)):
        if not f.startswith('test_') or not f.endswith('.py'):
            continue
        if f == 'test_runner.py':
            continue
        mod_name = f[:-3]
        spec = import_module(mod_name)
        if hasattr(spec, 'suite'):
            suites.append(spec.suite)
    return suites


def import_module(mod_name):
    """动态导入 test/ 下的模块"""
    import importlib.util as importlib_util
    spec = importlib_util.spec_from_file_location(
        mod_name, os.path.join(TEST_DIR, mod_name + '.py')
    )
    mod = importlib_util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


def report(ctx):
    total = ctx.passed + ctx.failed
    print(f"\n{'=' * 40}")
    print(f"  总计: {total}  通过: {ctx.passed}  失败: {ctx.failed}")
    print(f"{'=' * 40}")
    if ctx.failed > 0:
        print("\n失败项:")
        for e in ctx.errors:
            print(f"  • {e}")
        sys.exit(1)
    else:
        print("  所有检查通过 ✅\n")


def run_all(fast=False):
    """运行所有发现的测试套件"""
    print(f"📋 Web Log Viewer 项目验证")
    print(f"   项目目录: {ROOT}")
    print(f"   Python: {sys.version.split()[0]}")

    flags = {'fast': fast}

    suites = discover()
    ctx = TestContext()
    for suite in suites:
        if fast and '服务器' in suite.name:
            continue
        suite.run(ctx, flags)

    if fast:
        print(f"\n[服务器冒烟测试] (已跳过 --fast)")

    report(ctx)
