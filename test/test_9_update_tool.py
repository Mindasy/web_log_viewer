"""test_9_update_tool.py — 下载/更新工具脚本 测试用例

验证 tools/ 下的三个下载/更新工具脚本（zsh / bash / bat）：
  - 文件存在性与语法正确性
  - 核心功能（代理检测、GitHub API、下载、解压）
  - 发布配置（package.sh 打入 tools/，release.yml 上传三个脚本为附件）
"""

import os
import re
import shutil
import subprocess

from test_runner import ROOT, TestSuite

suite = TestSuite("下载/更新工具验证")

TOOLS = {
    'update-tool.sh': 'bash 版本',
    'update-tool.zsh': 'zsh 版本',
    'update-tool.bat': 'Windows bat 版本',
}


@suite.test("三个工具脚本存在")
def _(t, flags):
    for name, desc in TOOLS.items():
        path = os.path.join(ROOT, 'tools', name)
        t.check(os.path.exists(path), f"{desc} ({name}) 存在")
        if os.path.exists(path):
            t.check(os.path.getsize(path) > 1000, f"{name} 内容非空 ({(os.path.getsize(path))} 字节)")


@suite.test("shell 脚本语法正确")
def _(t, flags):
    sh = os.path.join(ROOT, 'tools', 'update-tool.sh')
    zsh = os.path.join(ROOT, 'tools', 'update-tool.zsh')
    for path, shell in [(sh, 'bash'), (zsh, 'zsh')]:
        if not os.path.exists(path):
            t.fail(f"{os.path.basename(path)} 不存在")
            continue
        # CI 环境（如 ubuntu-latest）可能未安装 zsh，此时跳过 zsh 语法检查
        if shutil.which(shell) is None:
            t.ok(f"{shell} 不可用，跳过 {os.path.basename(path)} 语法检查（CI 环境可能未安装）")
            continue
        r = subprocess.run([shell, '-n', path], capture_output=True, text=True, timeout=10)
        t.check(r.returncode == 0, f"{shell} -n {os.path.basename(path)} 语法检查通过")
        if r.returncode != 0:
            t.fail(f"  错误: {r.stderr.strip()[:200]}")

    # 可执行权限
    for path in [sh, zsh]:
        if os.path.exists(path):
            t.check(os.access(path, os.X_OK), f"{os.path.basename(path)} 具有可执行权限")


@suite.test("脚本核心功能标记")
def _(t, flags):
    """三个脚本均包含: 代理检测、GitHub latest API、下载、解压"""
    for name, desc in TOOLS.items():
        path = os.path.join(ROOT, 'tools', name)
        if not os.path.exists(path):
            continue
        src = open(path, encoding='utf-8').read()
        checks = {
            'GitHub API': 'releases/latest' in src or '/releases/latest' in src,
            '下载': 'curl' in src,
            '解压': 'tar' in src,
            '代理检测': 'Proxy' in src or 'proxy' in src or 'PROXY' in src,
            '默认仓库': 'Mindasy/web_log_viewer' in src,
        }
        for feat, ok in checks.items():
            t.check(ok, f"{desc}: 包含 {feat}")
            if not ok:
                t.fail(f"  {name} 缺少 {feat}")

    # bat 版本使用 PowerShell 解析 JSON（Windows 无 python3 依赖）
    bat = open(os.path.join(ROOT, 'tools', 'update-tool.bat'), encoding='utf-8').read()
    t.check('ConvertFrom-Json' in bat, "bat 使用 PowerShell 解析 JSON")
    t.check('--ssl-no-revoke' in bat, "bat 使用 --ssl-no-revoke 规避 Windows SSL 校验问题")


@suite.test("发布配置 — tools/ 不打包进 tar.gz")
def _(t, flags):
    pkg = open(os.path.join(ROOT, 'scripts', 'package.sh'), encoding='utf-8').read()

    # tools/ 不应作为 tar 输入参数（下载/更新工具只作为独立 Release 附件）
    tar_m = re.search(r'tar -czf(.*?)index\.html', pkg, re.S)
    t.check(tar_m is None or 'tools/' not in tar_m.group(1),
            "tools/ 不作为 tar 打包输入")
    if tar_m and 'tools/' in tar_m.group(1):
        t.fail("  tools/ 出现在打包清单中")

    # tools/ 不参与 package.sh 任何打包逻辑（既不在输入也不在排除列表）
    t.check('tools/' not in pkg, "tools/ 不参与 package.sh 打包逻辑")
    # 确保打包清单仅含运行时文件
    for f in ['index.html', 'server.py', 'css/', 'lib/', 'js/']:
        t.check(f in pkg, f"打包清单包含 {f}")


@suite.test("发布配置 — 三个脚本作为 Release 附件")
def _(t, flags):
    rel = open(os.path.join(ROOT, '.github', 'workflows', 'release.yml'), encoding='utf-8').read()
    for name in TOOLS:
        t.check(f'tools/{name}' in rel, f"release.yml 上传 {name} 为 Release 附件")
    t.check('action-gh-release' in rel, "使用 softprops/action-gh-release")
    # 附件与 tar.gz 归档同批上传
    t.check('weblogviewer.tar.gz' in rel or 'out.archive' in rel, "同时上传 tar.gz 归档")


@suite.test("CI 配置 — actions 使用 Node 24 版本（避免 Node 20 弃用告警）")
def _(t, flags):
    """全部 actions 均需使用基于 Node 24 的版本，避免 Node 20 弃用告警"""
    pr = open(os.path.join(ROOT, '.github', 'workflows', 'pr.yml'), encoding='utf-8').read()
    rel = open(os.path.join(ROOT, '.github', 'workflows', 'release.yml'), encoding='utf-8').read()
    for wf, name in [(pr, 'pr.yml'), (rel, 'release.yml')]:
        t.check('checkout@v6' in wf, f"{name} checkout 使用 Node 24 版本 (@v6)")
        t.check('setup-python@v6' in wf, f"{name} setup-python 使用 Node 24 版本 (@v6)")
    t.check('action-gh-release@v3' in rel, "release.yml action-gh-release 使用 Node 24 版本 (@v3)")
    # Pages 部署 actions（configure-pages / upload-pages-artifact / deploy-pages）
    t.check('configure-pages@v6' in rel, "release.yml configure-pages 使用 Node 24 版本 (@v6)")
    t.check('upload-pages-artifact@v5' in rel, "release.yml upload-pages-artifact 使用 Node 24 版本 (@v5)")
    t.check('deploy-pages@v5' in rel, "release.yml deploy-pages 使用 Node 24 版本 (@v5)")


@suite.test("CI 配置 — 安装 zsh 用于 zsh 脚本语法检查")
def _(t, flags):
    """PR 验证与 Release 发布流水线均安装 zsh，使 update-tool.zsh 语法检查真实执行"""
    for wf in ['pr.yml', 'release.yml']:
        path = os.path.join(ROOT, '.github', 'workflows', wf)
        if not os.path.exists(path):
            t.fail(f"{wf} 不存在")
            continue
        content = open(path, encoding='utf-8').read()
        t.check('install -y zsh' in content or 'zsh' in content.lower(),
                f"{wf} 配置 zsh 安装")
        if 'install -y zsh' not in content:
            t.fail(f"  {wf} 缺少 sudo apt-get install -y zsh")

    # 语法检查逻辑保留降级：zsh 不可用时应跳过而非崩溃（CI/本地环境差异）
    test_src = open(os.path.join(ROOT, 'test', 'test_9_update_tool.py'), encoding='utf-8').read()
    t.check('shutil.which(shell)' in test_src, "测试保留 zsh 不可用时的跳过降级")
    t.check('shutil' in test_src, "测试已引入 shutil 模块")
