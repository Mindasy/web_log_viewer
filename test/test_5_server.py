"""test_server.py — 服务器冒烟测试用例"""

import os
import subprocess
import sys
import time
import urllib.request

from test_runner import ROOT, SERVER_PORT, TestSuite

suite = TestSuite("服务器冒烟测试")


@suite.test("HTTP 200 与页面渲染")
def _(t, flags):
    if flags.get('fast'):
        return

    proc = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, 'server.py')],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={**os.environ, 'DISPLAY': ''}
    )

    time.sleep(2)

    try:
        resp = urllib.request.urlopen(f'http://localhost:{SERVER_PORT}/', timeout=10)
        html = resp.read().decode('utf-8')
        t.check(resp.status == 200, "HTTP 200")

        key_checks = {
            '工具栏': 'id="toolbar"',
            '过滤栏': 'id="filter-bar"',
            '日志面板': 'id="log-panel"',
            '网格头部': 'id="grid-header"',
            '状态栏': 'id="status-bar"',
            '关于面板': 'id="about-panel"',
            '发布构建时间': 'id="about-release-time"',
        }
        for name, marker in key_checks.items():
            t.check(marker in html, f"页面包含 {name}")

        for js in ['js/app.js', 'js/utils.js', 'js/parser.js']:
            try:
                r = urllib.request.urlopen(f'http://localhost:{SERVER_PORT}/{js}', timeout=5)
                t.check(r.status == 200, f"{js} 可访问")
            except Exception as e:
                t.fail(f"{js} 不可访问: {e}")

    except Exception as e:
        t.fail(f"服务器测试失败: {e}")
    finally:
        proc.terminate()
        proc.wait(timeout=5)
