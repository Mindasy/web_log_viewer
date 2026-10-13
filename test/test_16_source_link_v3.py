"""test_16_source_link_v3.py — 源码关联 v3（服务端模式 + 数据源抽象 + 规则管理）测试用例

覆盖（按 doc/source_code_link_design.md v3 设计）：
  - server.py：--project/--port/--no-browser/--no-static + /source/index.json 与 /source/files/<path> 路由（含防穿越）
  - source_link.js：数据源抽象 zip/dir/server/http + importFromServer/importFromHttp + fetch 懒加载
  - source_viewer.js / index.html / css：远程导入入口 + 排除规则管理 UI
"""

import json
import os
import py_compile
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

from test_runner import ROOT, SAMPLES_DIR, TestSuite

suite = TestSuite("源码关联 v3 (Source Link v3)")

SAMPLE_PROJECT = os.path.join(SAMPLES_DIR, 'source_link', 'mini_cpp_demo')
SERVER = os.path.join(ROOT, 'server.py')
V3_PORT = 8773


def _get(url, timeout=5):
    """返回 (status, body)；HTTP 错误也返回其响应体，网络异常返回 (0, '')"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read().decode('utf-8', errors='replace')
        except Exception:
            return e.code, ''
    except Exception:
        return 0, ''


def _head(url, timeout=5):
    """返回 (status, headers)；失败返回 (0, {})"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)
    except Exception:
        return 0, {}


@suite.test("server.py：参数与 /source 路由（静态）")
def _(t, flags):
    t.check(os.path.exists(SERVER), "server.py 存在")
    try:
        py_compile.compile(SERVER, doraise=True)
        t.ok("server.py 语法正确 (py_compile)")
    except py_compile.PyCompileError as e:
        t.fail(f"server.py 语法错误: {e}")
        return
    src = open(SERVER, encoding='utf-8').read()
    for frag, desc in [
        ("'--project'", "--project 参数"),
        ("'--port'", "--port 参数"),
        ("'--no-browser'", "--no-browser 参数"),
        ("'--no-static'", "--no-static 参数（仅后端）"),
        ("'/source/ping'", "/source/ping 服务端标识路由"),
        ("'/source/index.json'", "/source/index.json 路由"),
        ("'/source/files/'", "/source/files/<path> 路由"),
        ("SERVER_MARKER = 'wlv-source'", "服务端特殊标志 wlv-source"),
        ("'Access-Control-Allow-Origin', '*'", "跨域 CORS 头"),
        ('def do_OPTIONS', "跨域预检 OPTIONS"),
        ('def resolve_file', "文件解析方法"),
        ('def _resolve_under', "通用目录穿越防护（/source/files 与 /api/logs 共用）"),
        ('startswith(root + os.sep)', "目录穿越防护"),
        ('serve_static', "静态文件服务开关"),
    ]:
        t.check(frag in src or frag.replace("'", '"') in src, f"server.py 含 {desc}")
    t.check('def build_index' in src, "server.py 内置 build_index 生成索引（无外部依赖）")


@suite.test("server.py --project 冒烟：索引 / 源码 / 越界")
def _(t, flags):
    if not os.path.isdir(SAMPLE_PROJECT):
        t.ok("样例项目不存在，跳过服务端冒烟（先运行 bash test/generate_samples.sh）")
        return
    proc = subprocess.Popen(
        [sys.executable, SERVER, '--project', SAMPLE_PROJECT, '--port', str(V3_PORT), '--no-browser'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        cwd=ROOT,
    )
    try:
        status, body = 0, ''
        for _ in range(30):
            time.sleep(0.3)
            status, body = _get(f'http://localhost:{V3_PORT}/source/index.json')
            if status == 200:
                break
        t.check(status == 200, "GET /source/index.json 返回 200")
        # 服务端标识 API（特殊标志）
        pst, pbody = _get(f'http://localhost:{V3_PORT}/source/ping')
        t.check(pst == 200, "GET /source/ping 返回 200")
        try:
            info = json.loads(pbody)
            t.check(info.get('marker') == 'wlv-source', "ping 返回特殊标志 wlv-source")
            t.check(info.get('source') is True, "ping 标记源码服务已启用")
        except ValueError:
            t.fail(f"ping 响应非 JSON: {pbody[:120]}")
        _, headers = _head(f'http://localhost:{V3_PORT}/source/index.json')
        t.check(headers.get('Access-Control-Allow-Origin') == '*', "索引响应带 CORS 头（静态页面可跨域）")
        if status == 200:
            index = json.loads(body)
            t.check(index.get('schema') == 1, "索引 schema == 1")
            paths = [f.get('path') for f in index.get('files', [])]
            t.check('src/main.cpp' in paths, "索引含 src/main.cpp")
            t.check('node_modules/fake-lib/index.js' not in paths, "索引已排除 node_modules")

        st2, src_txt = _get(f'http://localhost:{V3_PORT}/source/files/src/main.cpp')
        t.check(st2 == 200, "GET /source/files/src/main.cpp 返回 200")
        t.check('main' in src_txt, "源码文件内容可读取")

        st3, _ = _get(f'http://localhost:{V3_PORT}/source/files/%2e%2e%2f%2e%2e%2fserver.py')
        t.check(st3 != 200, "目录穿越请求被拒绝（非 200）")

        # 无 --project 时 /source/* 应 404（此处用当前实例验证不存在路径）
        st4, body4 = _get(f'http://localhost:{V3_PORT}/source/files/does_not_exist.cpp')
        t.check(st4 != 200, "不存在的文件返回非 200")
        try:
            t.check('error' in json.loads(body4), "404 响应含 error 字段（前端可透出提示）")
        except ValueError:
            t.fail(f"404 响应非 JSON: {body4[:120]}")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


@suite.test("source_link.js 数据源抽象（server / http）")
def _(t, flags):
    js = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    for frag, desc in [
        ('importFromServer', 'importFromServer 方法'),
        ('importFromHttp', 'importFromHttp 方法'),
        ("'/source/index.json'", '服务端索引路由'),
        ("'/source/files/'", '服务端文件路由'),
        ('_importFromIndexUrl', '统一索引加载'),
        ("'server'", "server 数据源模式"),
        ("'http'", "http 数据源模式"),
        ('fetch(', '使用 fetch 拉取'),
        ('entry.url', 'getFileText 支持 url 懒加载'),
        ('encodeURIComponent', '路径段 URL 编码'),
    ]:
        t.check(frag in js, f"source_link.js 含 {desc}")


@suite.test("source_link.js 排除规则管理")
def _(t, flags):
    js = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    for frag, desc in [
        ('_userExcludeDirs', '用户排除目录'),
        ('_userExcludeFiles', '用户排除文件'),
        ('_rawEntries', '保留原始条目'),
        ('addExcludeRule', '添加规则'),
        ('removeExcludeRule', '移除规则'),
        ('clearExcludeRules', '清空规则'),
        ('reapplyExclusions', '重新过滤'),
    ]:
        t.check(frag in js, f"source_link.js 含 {desc}")
    # _shouldSkip 使用用户规则
    t.check('this._userExcludeDirs.includes(p)' in js, "_shouldSkip 命中用户排除目录")
    t.check('this.EXCLUDE_FILES.concat(this._userExcludeFiles)' in js,
            "_shouldSkip 命中用户排除文件 glob")


@suite.test("前端结构：远程入口 + 排除规则 UI")
def _(t, flags):
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    sv = open(os.path.join(ROOT, 'js', 'source_viewer.js'), encoding='utf-8').read()
    sl = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    for frag, desc in [
        ('id="btn-source-import-server"', '服务端导入按钮'),
        ('id="btn-source-import-http"', 'HTTP 索引导入按钮'),
        ('id="sv-remote-url"', '远程 URL 输入框'),
        ('id="sv-exclude-bar"', '排除规则条'),
        ('id="sv-excl-input"', '排除规则输入框'),
        ('id="btn-sv-excl-add"', '添加规则按钮'),
        ('id="btn-sv-excl-reset"', '重置规则按钮'),
        ('class="sv-toolbar"', '两行工具栏容器'),
        ('sv-toolbar-row', '工具栏分行'),
    ]:
        t.check(frag in html, f"index.html 含 {desc}")
    t.check('sv-import-actions' not in html, "已移除单行拥挤的旧工具栏容器")
    t.check("getElementById('btn-source-import-server')" in sl, "app 绑定服务端按钮")
    t.check("getElementById('btn-source-import-http')" in sl, "app 绑定 HTTP 按钮")
    t.check('renderExcludeBar' in sv, "source_viewer 渲染排除规则条")
    t.check("getElementById('btn-sv-excl-add')" in sv, "source_viewer 绑定添加按钮")
    for frag, desc in [
        ('.sv-remote-url', '远程 URL 样式'),
        ('.sv-server-state', '服务端状态样式'),
        ('.sv-toolbar', '两行工具栏样式'),
        ('.sv-toolbar-row', '工具栏分行样式'),
        ('#sv-exclude-bar', '排除规则条样式'),
        ('.sv-excl-chip', '规则 chip 样式'),
    ]:
        t.check(frag in css, f"css 含 {desc}")


@suite.test("未配置 server 时：应用可用、/source 提示未启用")
def _(t, flags):
    """离线为默认：不带 --project 时应用照常可用，仅 /source/* 提示未启用"""
    proc = subprocess.Popen(
        [sys.executable, SERVER, '--port', '8774', '--no-browser'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT,
    )
    try:
        status = 0
        for _ in range(30):
            time.sleep(0.3)
            status, _ = _get('http://localhost:8774/')
            if status == 200:
                break
        t.check(status == 200, "未配置 server 时应用页面仍可用（离线为主）")
        # 标识 API 仍可用，但标记 source=false（供前端区分「服务端在跑但未启用源码」）
        pst, pbody = _get('http://localhost:8774/source/ping')
        t.check(pst == 200, "未配置 --project 时 /source/ping 仍可用（用于识别）")
        try:
            t.check(json.loads(pbody).get('source') is False, "ping 标记 source=false")
        except ValueError:
            t.fail(f"ping 响应非 JSON: {pbody[:120]}")
        st, body = _get('http://localhost:8774/source/index.json')
        t.check(st == 404, "/source/index.json 返回 404")
        try:
            msg = json.loads(body).get('error', '')
            t.check('未启用源码服务' in msg, "404 说明提示用 --project 启动")
        except ValueError:
            t.fail(f"404 响应非 JSON: {body[:120]}")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


@suite.test("服务端识别（特殊标志）与状态透出")
def _(t, flags):
    sl = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    for frag, desc in [
        ('_serverBase', '已配置的服务端地址'),
        ("'/source/ping'", '使用标识 API 探测'),
        ("'wlv-source'", '校验服务端特殊标志'),
        ('detectServer', '服务端探测方法'),
        ('updateServerState', '服务端状态更新方法'),
        ('_serverState', '记录服务端探测状态'),
        ('_persistServerBase', '服务端地址持久化'),
        ("'sv-server-base'", 'localStorage 键名'),
        ('body.error', '透出服务端返回的 error 说明'),
    ]:
        t.check(frag in sl, f"source_link.js 含 {desc}")
    t.check("'ready'" in sl and "'disabled'" in sl and "'offline'" in sl, "三种探测状态")
    t.check('id="sv-server-state"' in html, "index.html 含服务端状态提示位")
    t.check('.sv-server-state' in css, "css 含服务端状态样式")
    t.check('服务端地址' in html, "输入框提示静态打开需填服务端地址")


@suite.test("数据源徽标与切换提示")
def _(t, flags):
    sl = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    sv = open(os.path.join(ROOT, 'js', 'source_viewer.js'), encoding='utf-8').read()
    for frag, desc in [
        ('MODE_LABELS', '数据源标签表'),
        ("zip: '📦 本地包'", '本地包标签'),
        ("dir: '📁 本地目录'", '本地目录标签'),
        ("server: '🖥 服务端'", '服务端标签'),
        ("http: '🔗 HTTP 索引'", 'HTTP 索引标签'),
        ('MODE_TITLES', '数据源标题表'),
        ('_switchNote', '数据源切换提示方法'),
        ('数据源已切换', '切换提示文案'),
    ]:
        t.check(frag in sl, f"source_link.js 含 {desc}")
    t.check('SourceLink.MODE_LABELS' in sv, "projectLabel 使用数据源徽标")
    t.check("=== 'dir' ? '项目目录' : '源码包'" not in sv,
            "已移除 server/http 被误标为「源码包」的逻辑")


@suite.test("server.py --no-static：仅后端接口，不托管静态页面")
def _(t, flags):
    if not os.path.isdir(SAMPLE_PROJECT):
        t.ok("样例项目不存在，跳过 --no-static 冒烟")
        return
    port = 8776
    proc = subprocess.Popen(
        [sys.executable, SERVER, '--project', SAMPLE_PROJECT, '--port', str(port),
         '--no-static', '--no-browser'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT,
    )
    try:
        status = 0
        for _ in range(30):
            time.sleep(0.3)
            status, _ = _get(f'http://localhost:{port}/source/index.json')
            if status == 200:
                break
        t.check(status == 200, "--no-static 下 /source/index.json 仍可用")
        st_ping, pbody = _get(f'http://localhost:{port}/source/ping')
        t.check(st_ping == 200, "--no-static 下 /source/ping 仍可用")
        try:
            t.check(json.loads(pbody).get('source') is True, "ping 仍标记源码服务已启用")
        except ValueError:
            t.fail(f"ping 响应非 JSON: {pbody[:120]}")
        # 静态页面不再提供（仅保留后端功能）
        st_root, _ = _get(f'http://localhost:{port}/')
        t.check(st_root != 200, "--no-static 下不提供静态首页（非 200）")
        st_html, _ = _get(f'http://localhost:{port}/index.html')
        t.check(st_html != 200, "--no-static 下不提供 index.html（非 200）")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


@suite.test("内存优化：索引不常驻 + 元信息固化 + 来源名驻留")
def _(t, flags):
    sl = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    ps = open(os.path.join(ROOT, 'js', 'parser.js'), encoding='utf-8').read()
    sv = open(os.path.join(ROOT, 'js', 'source_viewer.js'), encoding='utf-8').read()
    app = open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()

    # 1) 不再常驻整份 index / excluded（与 files 等量、且会复制路径字符串）
    t.check('this.index = index' not in sl, "不再常驻整份 source-index 对象")
    t.check('this.excluded' not in sl, "不再常驻 excluded 明细")
    t.check('SourceLink.index' not in sl and 'SourceLink.index' not in sv
            and 'SourceLink.index' not in app, "外部未依赖 SourceLink.index")

    # 2) CLI 索引元信息固化到原始条目 → reapply 无需回传 index
    t.check('en.lines = m.lines' in sl and 'en.lang = m.lang' in sl,
            "CLI 索引元信息固化到原始条目")
    t.check('this._buildIndex(this._rawEntries, null,' in sl,
            "reapplyExclusions 不再回传 index")

    # 3) getFileText 解码文本 LRU 上限
    t.check('TEXT_CACHE_MAX' in sl, "解码文本缓存上限常量")
    t.check('_textLRU' in sl, "LRU 记录表")
    t.check('_touchText' in sl, "LRU 维护方法")
    t.check('old._text = undefined' in sl, "超限淘汰最久未用条目")

    # 4) 压缩包解析：逐文件流式解析（来源名每文件拼接一次，不累积并行大数组）
    t.check('const srcName = file.name' in ps, "来源名每文件拼接一次并复用")
    t.check('const allLines' not in ps and 'const fileLineMap' not in ps
            and 'allLines.push' not in ps and 'fileLineMap.push' not in ps,
            "已移除 allLines/fileLineMap 并行大数组（逐文件流式解析）")


@suite.test("内存优化：解码文本 LRU 运行时行为")
def _(t, flags):
    """运行时执行 _touchText，验证超限淘汰最久未用条目。"""
    if not shutil.which('node'):
        t.ok("未检测到 node，跳过运行时用例")
        return
    js_path = os.path.join(ROOT, 'js', 'source_link.js')
    script = r"""
const fs = require('fs');
const SL = eval(fs.readFileSync(%s, 'utf8') + '\n;SourceLink');
SL.TEXT_CACHE_MAX = 2;
const a = { path: 'a' }, b = { path: 'b' }, c = { path: 'c' };
a._text = 'A'; SL._touchText(a);
b._text = 'B'; SL._touchText(b);
c._text = 'C'; SL._touchText(c);
const kept = [a, b, c].map(e => e.path + ':' + (e._text !== undefined)).join(',');
console.log(JSON.stringify({ kept, order: SL._textLRU.map(e => e.path) }));
""" % json.dumps(js_path)
    proc = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr.strip()[:300]}")
        return
    try:
        res = json.loads(proc.stdout.strip())
    except ValueError:
        t.fail(f"输出非 JSON: {proc.stdout.strip()[:200]}")
        return
    # 上限 2：a 最旧被淘汰，b/c 保留；LRU 顺序为 c,b
    t.check(res['kept'] == 'a:false,b:true,c:true',
            f"超限淘汰最久未用条目 ({res['kept']})")
    t.check(res['order'] == ['c', 'b'], f"LRU 顺序为最近使用在前 ({res['order']})")
