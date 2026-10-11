"""test_10_source_link.py — 日志与代码行关联 测试用例

覆盖：
  - server.py 内置索引逻辑（排除规则/源码白名单/统计，无外部依赖，可单文件部署）
  - 前端结构（index.html 面板与按钮、app.js 初始化、script 引入）
  - source_link.js 解析与匹配逻辑（静态断言 4 种 source 格式 + 匹配策略）
  - 源码查看器样式
"""

import importlib.util
import os
import py_compile
import re

from test_runner import ROOT, SAMPLES_DIR, TestSuite

suite = TestSuite("日志与代码行关联 (Source Link)")

SAMPLE_PROJECT = os.path.join(SAMPLES_DIR, 'source_link', 'mini_cpp_demo')
SERVER_PY = os.path.join(ROOT, 'server.py')


def _load_server():
    """以模块方式加载 server.py（顶层不启动服务），复用其内置 build_index"""
    spec = importlib.util.spec_from_file_location('wlv_server', SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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


@suite.test("server.py 内置索引逻辑（自包含、无外部依赖）")
def _(t, flags):
    t.check(os.path.exists(SERVER_PY), "server.py 存在")
    if not os.path.exists(SERVER_PY):
        return
    try:
        py_compile.compile(SERVER_PY, doraise=True)
        t.ok("server.py 语法正确 (py_compile)")
    except py_compile.PyCompileError as e:
        t.fail(f"server.py 语法错误: {e}")
    src = open(SERVER_PY, encoding='utf-8').read()
    for frag, desc in [
        ('def build_index', '内置 build_index'),
        ('def collect_files', '内置 collect_files'),
        ('def read_source', '内置 read_source'),
        ('DEFAULT_EXCLUDE_DIRS', '内置排除目录规则'),
        ('DEFAULT_EXCLUDE_FILES', '内置排除文件规则'),
        ('SOURCE_EXTS', '内置源码白名单'),
        ('LANG_MAP', '内置语言映射'),
        ('MAX_EXCLUDED_RECORDS', 'excluded 明细上限'),
    ]:
        t.check(frag in src, f"server.py 含 {desc}")
    # 不再依赖外部工具（降低部署成本：server.py 单文件即可运行）
    t.check('_load_index_source' not in src, "已移除运行时加载外部工具函数")
    t.check('import index_source' not in src, "server.py 不再 import index_source")
    t.check(not os.path.exists(os.path.join(ROOT, 'tools', 'source_link')),
            "已删除 tools/source_link 工具目录")


@suite.test("内置 build_index 生成索引正确性")
def _(t, flags):
    if not os.path.isdir(SAMPLE_PROJECT):
        t.fail(f"样例项目不存在（先运行 bash test/generate_samples.sh）: {SAMPLE_PROJECT}")
        return
    index = _load_server().build_index(SAMPLE_PROJECT)
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

    # main.cpp 行数断言
    main_entry = next((f for f in files if f['path'] == 'src/main.cpp'), None)
    t.check(main_entry and main_entry.get('lines') == 33,
            f"src/main.cpp lines == 33 (实际 {main_entry.get('lines') if main_entry else 'N/A'})")

    # 排除验证：被排除的路径不得出现在 files
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


@suite.test("发布配置 — server.py 自包含、工具不再随 Release 发布")
def _(t, flags):
    rel = open(os.path.join(ROOT, '.github', 'workflows', 'release.yml'), encoding='utf-8').read()
    t.check('index_source.py' not in rel, "release.yml 不再上传已删除的工具")
    t.check('weblogviewer.tar.gz' in rel, "release.yml 仍发布主包")
    pkg = open(os.path.join(ROOT, 'scripts', 'package.sh'), encoding='utf-8').read()
    t.check('server.py' in pkg, "package.sh 打包 server.py（单文件可部署）")
    t.check("--exclude='tools'" in pkg, "package.sh 排除 tools/")
