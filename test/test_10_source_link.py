"""test_10_source_link.py — 日志与代码行关联 测试用例

覆盖：
  - CLI 工具 tools/source_link/index_source.py（存在/语法/真实运行生成源码包）
  - 排除规则（依赖目录/构建产物/配置文件/非源码扩展名）
  - 前端结构（index.html 面板与按钮、app.js 初始化、script 引入）
  - source_link.js 解析与匹配逻辑（静态断言 4 种 source 格式 + 匹配策略）
  - 源码查看器样式
"""

import json
import os
import py_compile
import re
import subprocess
import tempfile
import zipfile

from test_runner import ROOT, SAMPLES_DIR, TestSuite

suite = TestSuite("日志与代码行关联 (Source Link)")

SAMPLE_PROJECT = os.path.join(SAMPLES_DIR, 'source_link', 'mini_cpp_demo')
CLI_TOOL = os.path.join(ROOT, 'tools', 'source_link', 'index_source.py')

# 样例项目中应被索引的源码文件
EXPECTED_INDEXED = [
    'src/main.cpp', 'src/http.cpp', 'src/order.cpp',
    'src/cache.cpp', 'src/db.cpp', 'include/order.h',
]
# 样例项目中应被排除的文件
EXPECTED_EXCLUDED = [
    'node_modules/fake-lib/index.js',
    'build/main.o',
    '.git/config',
    'config/app.ini',
    'README.md',
]


@suite.test("CLI 工具存在且语法正确")
def _(t, flags):
    t.check(os.path.exists(CLI_TOOL), "tools/source_link/index_source.py 存在")
    if os.path.exists(CLI_TOOL):
        try:
            py_compile.compile(CLI_TOOL, doraise=True)
            t.ok("index_source.py 语法正确 (py_compile)")
        except py_compile.PyCompileError as e:
            t.fail(f"index_source.py 语法错误: {e}")


@suite.test("CLI 真实运行生成源码包")
def _(t, flags):
    if not os.path.isdir(SAMPLE_PROJECT):
        t.fail(f"样例项目不存在（先运行 bash test/generate_samples.sh）: {SAMPLE_PROJECT}")
        return
    with tempfile.TemporaryDirectory() as tmp:
        out_zip = os.path.join(tmp, 'source-bundle.zip')
        r = subprocess.run(
            ['python3', CLI_TOOL, SAMPLE_PROJECT, '-o', out_zip],
            capture_output=True, text=True, timeout=30,
        )
        t.check(r.returncode == 0, "index_source.py 运行成功")
        if r.returncode != 0:
            t.fail(f"  错误: {r.stderr.strip()[:300]}")
            return
        t.check(os.path.exists(out_zip), "源码包 zip 已生成")
        if not os.path.exists(out_zip):
            return

        with zipfile.ZipFile(out_zip) as zf:
            names = zf.namelist()
            t.check('source-index.json' in names, "zip 内含 source-index.json")
            t.check('src/main.cpp' in names, "zip 内含源码文件 src/main.cpp")

            index = json.loads(zf.read('source-index.json'))
            t.check(index.get('schema') == 1, "index schema == 1")
            t.check(index.get('project') == 'mini_cpp_demo', f"index.project = {index.get('project')}")
            t.check(index.get('generatedAt'), "index 含 generatedAt")
            files = index['files']
            paths = [f['path'] for f in files]
            for p in EXPECTED_INDEXED:
                t.check(p in paths, f"已索引: {p}")
            t.check(len(files) == len(EXPECTED_INDEXED),
                    f"索引文件数 {len(files)} == 期望 {len(EXPECTED_INDEXED)}")

            for fe in files:
                for key in ('path', 'basename', 'size', 'lines', 'lang'):
                    t.check(key in fe, f"索引条目含字段 {key} ({fe.get('path', '?')})")

            # main.cpp 行数断言（main 定义在第 10 行）
            main_entry = next((f for f in files if f['path'] == 'src/main.cpp'), None)
            t.check(main_entry and main_entry.get('lines') == 33,
                    f"src/main.cpp lines == 33 (实际 {main_entry.get('lines') if main_entry else 'N/A'})")

            # 排除验证：被排除的路径不得出现在 files
            all_names = ' | '.join(paths)
            for bad in EXPECTED_EXCLUDED:
                t.check(bad not in paths, f"已排除: {bad}")
            # excluded 明细记录（目录级排除：node_modules / build / .git）
            excluded_paths = [e['path'] for e in index.get('excluded', [])]
            for d in ('node_modules', 'build', '.git'):
                t.check(any(d in p for p in excluded_paths), f"excluded 记录含 {d} 目录")
            # 统计字段
            st = index.get('stats', {})
            t.check(st.get('indexed') == len(EXPECTED_INDEXED), f"stats.indexed == {len(EXPECTED_INDEXED)}")
            t.check('scanned' in st and 'excludedDirs' in st and 'excludedFiles' in st,
                    "stats 含 scanned/excludedDirs/excludedFiles")


@suite.test("CLI 自定义排除与配置参数")
def _(t, flags):
    if not os.path.isdir(SAMPLE_PROJECT):
        t.fail("样例项目不存在（先运行 bash test/generate_samples.sh）")
        return
    with tempfile.TemporaryDirectory() as tmp:
        # --exclude-dir 追加排除 src 目录 → 应只剩 include/order.h
        out1 = os.path.join(tmp, 'a.zip')
        r = subprocess.run(
            ['python3', CLI_TOOL, SAMPLE_PROJECT, '-o', out1, '--exclude-dir', 'src'],
            capture_output=True, text=True, timeout=30,
        )
        t.check(r.returncode == 0, "--exclude-dir 运行成功")
        if r.returncode == 0 and os.path.exists(out1):
            with zipfile.ZipFile(out1) as zf:
                index = json.loads(zf.read('source-index.json'))
                paths = [f['path'] for f in index['files']]
                t.check(paths == ['include/order.h'], f"--exclude-dir src 后仅剩 include/order.h (实际 {paths})")
        # --config 追加 includeExts：app.ini 变为可索引
        cfg = os.path.join(tmp, 'cfg.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'includeExts': ['.ini']}, f)
        out2 = os.path.join(tmp, 'b.zip')
        r = subprocess.run(
            ['python3', CLI_TOOL, SAMPLE_PROJECT, '-o', out2, '--config', cfg],
            capture_output=True, text=True, timeout=30,
        )
        t.check(r.returncode == 0, "--config 运行成功")
        if r.returncode == 0 and os.path.exists(out2):
            with zipfile.ZipFile(out2) as zf:
                index = json.loads(zf.read('source-index.json'))
                paths = [f['path'] for f in index['files']]
                t.check('config/app.ini' in paths, "--config includeExts 后 app.ini 被索引")


@suite.test("index.html 前端结构（面板/按钮/script）")
def _(t, flags):
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    for frag, desc in [
        ('id="btn-source"', '工具栏「源码」按钮'),
        ('id="source-viewer-panel"', '源码查看器面板'),
        ('id="btn-source-import-archive"', '导入源码包按钮'),
        ('id="btn-source-import-dir"', '导入目录按钮'),
        ('id="source-archive-input"', '源码包文件输入'),
        ('id="source-dir-input"', '目录选择输入 (webkitdirectory)'),
        ('id="btn-view-source"', '详情面板查看代码按钮'),
        ('js/source_link.js', '引入 source_link.js'),
        ('js/source_viewer.js', '引入 source_viewer.js'),
    ]:
        t.check(frag in html, f"index.html 包含 {desc}")


@suite.test("app.js 初始化与详情面板联动")
def _(t, flags):
    js = open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()
    t.check('SourceLink.init()' in js, "app.js 调用 SourceLink.init()")
    t.check('SourceViewer.init()' in js, "app.js 调用 SourceViewer.init()")
    t.check("f.key === 'source'" in js, "showDetail 对 source 字段特殊处理")
    t.check("'btn-view-source'" in js, "showDetail 控制 btn-view-source 显隐")


@suite.test("source_link.js 过滤规则")
def _(t, flags):
    js = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    # 排除目录
    for d in ['node_modules', 'build', '.git', 'target', 'dist', 'vendor', 'site-packages', '__pycache__']:
        t.check(f"'{d}'" in js, f"EXCLUDE_DIRS 含 {d}")
    # 排除文件
    for f in ['*.o', '*.class', 'package-lock.json', '.DS_Store']:
        t.check(f"'{f}'" in js, f"EXCLUDE_FILES 含 {f}")
    # 白名单扩展名
    for e in ['.cpp', '.java', '.py', '.go', '.h', '.sh']:
        t.check(f"'{e}'" in js, f"SOURCE_EXTS 含 {e}")
    t.check('_shouldSkip' in js, "存在 _shouldSkip 过滤函数")
    t.check('importArchive' in js and 'importDirectory' in js, "支持压缩包与目录两种导入")


@suite.test("source_link.js source 解析（4 种格式 + 边界）")
def _(t, flags):
    js = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()

    # 用源码内容直接断言各分支存在
    branches = {
        "文件:行号": r'\(\.\+\?\):\(\\d\+\)\$',
        "文件:方法:行号": r'\(\.\+\?\):\(\[A-Za-z_\]\\w\*\):\(\\d\+\)\$',
        "包.类.方法": r'\(\.\+\?\)\\\.\(\[a-z\]\[A-Za-z0-9_\]\*\)\$',
        "纯包名/类名整体处理": r"return \{ file: raw, method: ''",
        "扩展名结尾（纯文件）": r'\\\.\(c\|cc\|cpp',
        "空 source 兜底": r"if \(!raw\) return",
    }
    for desc, pat in branches.items():
        t.check(re.search(pat, js), f"parseSource 处理 {desc}")


@suite.test("source_link.js 匹配策略")
def _(t, flags):
    js = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    checks = {
        '_byPath.get(file)': '精确路径匹配',
        "p.endsWith('/' + file)": '尾部路径匹配',
        'this._byBasename.get(base)': 'basename 匹配',
        "file.replace(/\\./g, '/') + '.java'": 'Java 包名映射',
        'findMethodLine': '无行号时定位方法定义行',
        'getFileText': '文件内容懒加载',
    }
    for frag, desc in checks.items():
        t.check(frag in js, f"resolve 支持 {desc}")


@suite.test("source_viewer.js 渲染能力")
def _(t, flags):
    js = open(os.path.join(ROOT, 'js', 'source_viewer.js'), encoding='utf-8').read()
    for frag, desc in [
        ('renderTree', '文件树渲染'),
        ('sv-line-target', '目标行高亮类'),
        ('_highlightLine', '轻量语法高亮'),
        ('_countRelated', '相关日志统计'),
        ('_onStatusClick', '状态栏过滤该文件日志'),
        ('scrollIntoView', '目标行滚动定位'),
        ('_applyView', '虚拟滚动视口计算（v2 替代 MVP 截断）'),
    ]:
        t.check(frag in js, f"source_viewer.js 包含 {desc}")


@suite.test("源码查看器样式")
def _(t, flags):
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    for frag, desc in [
        ('#source-viewer-panel', '面板容器样式'),
        ('.sv-line-target', '目标行高亮样式'),
        ('@keyframes sv-target-pulse', '高亮呼吸动画'),
        ('.sv-key', '关键字高亮'),
        ('.sv-str', '字符串高亮'),
        ('.sv-com', '注释高亮'),
        ('#sv-status', '状态栏样式'),
        ('#btn-view-source', '详情面板查看按钮样式'),
    ]:
        t.check(frag in css, f"style.css 包含 {desc}")


@suite.test("发布配置 — index_source.py 随 Release 发布")
def _(t, flags):
    rel = open(os.path.join(ROOT, '.github', 'workflows', 'release.yml'), encoding='utf-8').read()
    t.check('tools/source_link/index_source.py' in rel, "release.yml 上传 tools/source_link/index_source.py")
    pkg = open(os.path.join(ROOT, 'scripts', 'package.sh'), encoding='utf-8').read()
    t.check("--exclude='tools'" in pkg, "package.sh 继续排除 tools/（工具不打进 tar.gz）")
