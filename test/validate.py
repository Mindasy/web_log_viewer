#!/usr/bin/env python3
"""validate.py — 项目验证入口

运行方式:
  python3 test/validate.py              # 执行全部检查
  python3 test/validate.py --fast        # 跳过服务器启动测试
  python3 test/validate.py --server      # 仅启动服务器进行手动测试

框架: test_runner.py     (测试注册/发现/报表)
用例: test_html.py       (HTML 结构)
      test_css.py        (CSS 结构)
      test_js.py         (JS 文件完整性)
      test_parser.py     (日志解析格式)
      test_server.py     (服务器冒烟)
"""

import argparse
import os
import sys

if __name__ == '__main__':
    # 确保 test/ 在 sys.path 中，方便相对导入
    test_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)))
    if test_dir not in sys.path:
        sys.path.insert(0, test_dir)

    parser = argparse.ArgumentParser(description='Web Log Viewer 验证工具')
    parser.add_argument('--fast', action='store_true', help='跳过服务器测试')
    parser.add_argument('--server', action='store_true', help='仅启动服务器')
    args = parser.parse_args()

    if args.server:
        os.chdir(os.path.dirname(test_dir))
        os.environ['DISPLAY'] = ''
        import webbrowser
        webbrowser.open = lambda url: None
        exec(open(os.path.join(os.path.dirname(test_dir), 'server.py')).read())
        sys.exit(0)

    from test_runner import run_all
    run_all(fast=args.fast)
