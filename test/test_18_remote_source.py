"""test_18_remote_source.py — 远端日志加载（v3-1）测试用例

覆盖：
  - server.py：/api/logs、/api/logs/list、--logs-root/--token、
               排除规则迁移（--exclude-dir/--exclude-file/--config）、_resolve_under 通用防护
  - server 运行时：正常读取、防穿越、二进制拒绝、binary=1、token 401/200、CORS/OPTIONS
  - server 运行时：实时追踪增量（from=、X-Log-Size、X-Log-Reset、非法 from）
  - 前端：index.html 入口/面板、remote_logs.js、LogParser.mergeTexts、binary=1 走 ArchiveHandler
  - 前端：实时追踪控件（btn-rl-tail）、readFrom/startTail/appendTail、旧 btn-tail 已移除
  - node 运行时：mergeTexts 解析含 \\r\\n 的文本、空文本计入跳过清单、全空抛错、追加模式
  - node 运行时：appendTail 仅追加有效新行、编号连续、来源标记
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from test_runner import ROOT, TestSuite

suite = TestSuite("远端日志加载（v3-1）")

SERVER = os.path.join(ROOT, 'server.py')
LOG_PORT = 8801


def _load_server():
    spec = importlib.util.spec_from_file_location('wlv_server_t18', SERVER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _req(url, method='GET', headers=None):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


@suite.test("server.py 结构：/api/logs 路由与排除规则迁移")
def _(t, flags):
    src = open(SERVER, encoding='utf-8').read()
    for frag, desc in [
        ("'/api/logs'", "/api/logs 路由常量"),
        ("'/api/logs/list'", "/api/logs/list 路由常量"),
        ("'--logs-root'", "--logs-root 参数"),
        ("'--token'", "--token 参数"),
        ("'--exclude-dir'", "--exclude-dir 参数（排除规则迁移）"),
        ("'--exclude-file'", "--exclude-file 参数（排除规则迁移）"),
        ("'--config'", "--config 参数（排除规则迁移）"),
        ('def _resolve_under', "_resolve_under 通用穿越防护"),
        ('def load_excludes', "load_excludes 规则合并"),
        ('class LogService', "LogService 远端日志服务"),
        ('MAX_LOG_BYTES', "日志体积上限常量"),
        ('def _handle_logs', "日志路由处理"),
        ('def _send_tail', "实时追踪增量响应"),
        ("X-Log-Size", "增量响应头 X-Log-Size"),
        ("X-Log-Reset", "增量响应头 X-Log-Reset"),
        ("Access-Control-Expose-Headers", "暴露自定义响应头（跨域可读）"),
    ]:
        t.check(frag in src, f"server.py 含 {desc}")


@suite.test("排除规则迁移：命令行 + 配置文件 → build_index")
def _(t, flags):
    mod = _load_server()
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, 'src'))
        os.makedirs(os.path.join(root, 'skipme'))
        open(os.path.join(root, 'src', 'main.py'), 'w').write('print(1)\n')
        open(os.path.join(root, 'skipme', 'inner.py'), 'w').write('print(2)\n')
        open(os.path.join(root, 'gen.gen.py'), 'w').write('print(3)\n')

        # 仅默认规则：三个 .py 全部索引
        base = mod.build_index(root)
        t.check(base['stats']['indexed'] == 3, f"默认索引 3 个文件（实际 {base['stats']['indexed']}）")
        t.check('totalBytes' in base['stats'], "stats 含 totalBytes")

        # 命令行追加排除目录 + 文件 glob
        idx = mod.build_index(root, {'skipme'}, {'*.gen.py'})
        paths = [f['path'] for f in idx['files']]
        t.check(paths == ['src/main.py'], f"命令行排除生效（实际 {paths}）")

        # 配置文件合并
        cfg_path = os.path.join(root, '.sourcelink.json')
        with open(cfg_path, 'w', encoding='utf-8') as f:
            json.dump({'excludeDirs': ['skipme'], 'excludeFiles': ['*.gen.py']}, f)
        d, fl = mod.load_excludes(cfg_path, [], [])
        t.check(d == {'skipme'} and fl == {'*.gen.py'}, f"配置文件解析（{d} / {fl}）")

        # 不存在配置：不抛错、不加载
        d2, fl2 = mod.load_excludes(os.path.join(root, 'nope.json'), ['a'], [])
        t.check(d2 == {'a'} and fl2 == set(), "缺失配置仅忽略并保留命令行规则")

    # 穿越防护
    with tempfile.TemporaryDirectory() as root:
        open(os.path.join(root, 'x.log'), 'w').write('a\n')
        t.check(mod._resolve_under(root, 'x.log') is not None, "_resolve_under 命中普通文件")
        t.check(mod._resolve_under(root, '../etc/passwd') is None, "_resolve_under 拦截穿越")
        t.check(mod._resolve_under(root, '../../') is None, "_resolve_under 拦截目录")


@suite.test("server 运行时：/api/logs 读取 / 防穿越 / 二进制 / token")
def _(t, flags):
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, 'sub'))
        open(os.path.join(root, 'a.log'), 'w', encoding='utf-8').write('2026-01-01 INFO hello\n' * 3)
        open(os.path.join(root, 'sub', 'b.txt'), 'w', encoding='utf-8').write('line\n')
        open(os.path.join(root, 'bin.log'), 'wb').write(b'\x00\x01\x02BIN')
        open(os.path.join(root, 'skip.ini'), 'w').write('nope\n')

        proc = subprocess.Popen(
            [sys.executable, SERVER, '--logs-root', root, '--port', str(LOG_PORT),
             '--no-browser', '--no-static', '--token', 'secret'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT,
        )
        base = f'http://localhost:{LOG_PORT}'
        try:
            ready = False
            for _ in range(30):
                time.sleep(0.2)
                try:
                    st, _b, _h = _req(base + '/source/ping')
                    if st == 200:
                        ready = True
                        break
                except Exception:
                    pass
            if not ready:
                t.fail("服务端未能启动（/source/ping 无响应）")
                return

            # ping 无需 token，且标记 logs 已启用
            st, body, _h = _req(base + '/source/ping')
            info = json.loads(body)
            t.check(st == 200 and info.get('marker') == 'wlv-source', "ping 返回标识 wlv-source")
            t.check(info.get('logs') is True, "ping 标记日志服务已启用")

            # 无 token → 401
            st, _b, _h = _req(base + '/api/logs/list')
            t.check(st == 401, f"列表无 token 返回 401（实际 {st}）")

            # 带 token → 列表
            st, body, hdrs = _req(base + '/api/logs/list?token=secret')
            data = json.loads(body)
            names = sorted(f['path'] for f in data['files'])
            t.check(st == 200, "列表带 token 返回 200")
            t.check(names == ['a.log', 'bin.log', 'sub/b.txt'], f"候选清单正确（{names}）")
            t.check(hdrs.get('Access-Control-Allow-Origin') == '*', "列表响应含 CORS 头")

            # 文本读取（头部 token）
            st, body, _h = _req(base + '/api/logs?file=a.log', headers={'X-Auth-Token': 'secret'})
            t.check(st == 200 and body.decode('utf-8').count('hello') == 3, "文本读取内容正确")

            # 防穿越
            st, _b, _h = _req(base + '/api/logs?file=../../etc/passwd&token=secret')
            t.check(st == 404, f"目录穿越返回 404（实际 {st}）")

            # 二进制拒绝 / binary=1
            st, _b, _h = _req(base + '/api/logs?file=bin.log&token=secret')
            t.check(st == 415, f"二进制文本读取被拒（实际 {st}）")
            st, body, _h = _req(base + '/api/logs?file=bin.log&binary=1&token=secret')
            t.check(st == 200 and body == b'\x00\x01\x02BIN', "binary=1 返回原始字节")

            # 缺少 file / 文件不存在
            t.check(_req(base + '/api/logs?token=secret')[0] == 400, "缺少 file 参数返回 400")
            t.check(_req(base + '/api/logs?file=nope.log&token=secret')[0] == 404, "不存在文件返回 404")

            # 实时追踪增量（from=）
            full = open(os.path.join(root, 'a.log'), 'rb').read()
            fsize = len(full)
            st, body, hdrs = _req(base + '/api/logs?file=a.log&from=0&token=secret')
            t.check(st == 200 and body == full, "from=0 返回完整内容")
            t.check(hdrs.get('X-Log-Size') == str(fsize),
                    f"响应头 X-Log-Size 正确（{hdrs.get('X-Log-Size')}）")
            t.check('X-Log-Size' in (hdrs.get('Access-Control-Expose-Headers') or ''),
                    "增量响应暴露 X-Log-Size 供跨域读取")

            # 从文件末尾起：无新增 → 空
            st, body, _h = _req(base + f'/api/logs?file=a.log&from={fsize}&token=secret')
            t.check(st == 200 and body == b'', "from=文件末尾 无新增返回空")

            # 追加内容后仅返回增量
            appended = b'2026-01-01 10:00:09 WARN appended\n'
            with open(os.path.join(root, 'a.log'), 'ab') as f:
                f.write(appended)
            st, body, hdrs = _req(base + f'/api/logs?file=a.log&from={fsize}&token=secret')
            t.check(body == appended, f"from=末尾 仅返回新增字节（{body!r}）")
            t.check(int(hdrs.get('X-Log-Size') or 0) == fsize + len(appended),
                    "增量响应更新 X-Log-Size")

            # 越界（截断/轮转）→ 从头返回并标记重置
            st, body, hdrs = _req(base + f'/api/logs?file=a.log&from={fsize + 9999}&token=secret')
            t.check(hdrs.get('X-Log-Reset') == '1', "from 越界标记 X-Log-Reset=1")
            t.check(body.startswith(b'2026-01-01 INFO hello'), "重置时从头返回内容")

            # 非法 from
            t.check(_req(base + '/api/logs?file=a.log&from=abc&token=secret')[0] == 400,
                    "非法 from 返回 400")

            # OPTIONS 预检
            st, _b, hdrs = _req(base + '/api/logs', method='OPTIONS')
            t.check(st == 204, f"OPTIONS 预检返回 204（实际 {st}）")
            t.check(hdrs.get('Access-Control-Allow-Origin') == '*', "预检含 CORS 头")
        finally:
            proc.terminate()
            proc.wait()


@suite.test("前端接入：入口 / 面板 / 模块 / mergeTexts")
def _(t, flags):
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    t.check('id="btn-remote-logs"' in html, "工具栏含「🌐 远程日志」按钮")
    t.check('id="remote-logs-panel"' in html, "含远程日志面板")
    t.check('src="js/remote_logs.js"' in html, "index.html 引入 remote_logs.js")
    # 友好选择相关控件
    for eid, desc in [('rl-filter', '过滤输入框'), ('rl-ext-chips', '扩展名快捷筛选'),
                      ('rl-select-all', '全选'), ('btn-rl-sel-invert', '反选'),
                      ('btn-rl-sel-none', '取消选择'), ('rl-sel-count', '已选计数')]:
        t.check(f'id="{eid}"' in html, f"面板含{desc} #{eid}")

    rl = open(os.path.join(ROOT, 'js', 'remote_logs.js'), encoding='utf-8').read()
    for frag, desc in [
        ("'/api/logs/list'", "调用列表接口"),
        ('binary=1', "压缩包走 binary=1"),
        ('LogParser.mergeTexts', "解析交给 mergeTexts"),
        ('ArchiveHandler', "压缩包复用 ArchiveHandler"),
        ("wlv-source", "识别服务端标识"),
        ('/source/ping', "探测服务端"),
        ('_RENDER_CAP', "列表渲染上限（大列表保护）"),
        ('invertFiltered', "反选"),
        ('clearFiltered', "取消选择"),
        ('setAllFiltered', "全选（作用于筛选结果）"),
        ('_filtered()', "筛选结果计算"),
        ('async readFrom(', "增量读取（from=）"),
        ('async startTail(', "开始实时追踪"),
        ('stopTail(', "停止实时追踪"),
        ('LogParser.appendTail', "新增行交给 appendTail"),
        ('App.refreshTail', "追加后收尾刷新"),
        ('X-Log-Size', "读取增量响应头"),
        ('X-Log-Reset', "处理文件轮转/截断"),
        ('_consumeChunk', "半行缓冲（跨块/多字节）"),
        ('_tailBusy', "轮询去重（防重叠请求）"),
    ]:
        t.check(frag in rl, f"remote_logs.js 含 {desc}")

    # 实时追踪面板控件；旧工具栏模拟按钮应已移除
    t.check('id="btn-rl-tail"' in html and 'id="rl-tail-state"' in html,
            "面板含「▶ 跟踪」「停止」与状态位")
    t.check('id="btn-tail"' not in html, "已移除工具栏模拟「实时追踪」按钮")

    parser = open(os.path.join(ROOT, 'js', 'parser.js'), encoding='utf-8').read()
    t.check('async mergeTexts(' in parser, "parser.js 提供 mergeTexts")
    t.check('_lastSkipped' in parser and 'consumeSkipped' in parser, "mergeTexts 复用跳过清单机制")
    t.check('appendTail(name, lines)' in parser, "parser.js 提供 appendTail")

    app = open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()
    t.check('RemoteLogs.init()' in app, "app.js 初始化 RemoteLogs")
    t.check('refreshTail()' in app, "app.js 提供实时追踪收尾刷新")
    t.check('toggleTail' not in app, "已移除模拟 toggleTail")

    grid = open(os.path.join(ROOT, 'js', 'grid.js'), encoding='utf-8').read()
    t.check('refreshTail()' in grid, "grid.js 提供增量刷新（保留位置/跟随底部）")

    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    t.check('#remote-logs-panel' in css and '.rl-list' in css, "css 含远程日志面板样式")
    t.check('.rl-chip' in css and '.rl-filter' in css, "css 含过滤框 / 扩展名 chip 样式")
    t.check('.rl-tail-state' in css and '#btn-rl-tail' in css, "css 含实时追踪控件样式")


@suite.test("选择交互：过滤 / 扩展名判定 / 批量（node 运行时）")
def _(t, flags):
    if not shutil.which('node'):
        t.ok("未检测到 node，跳过运行时用例")
        return
    rl_path = os.path.join(ROOT, 'js', 'remote_logs.js')
    script = r"""
const fs = require('fs');
const RL = eval(fs.readFileSync(%s, 'utf8') + '\n;RemoteLogs');
RL._files = [
  { path: 'app/error.log', size: 10 },
  { path: 'app/info.log', size: 20 },
  { path: 'bundle/archive.tar.gz', size: 30 },
  { path: 'noext', size: 5 },
];
const out = {};
out.ext_targz = RL._extOf('bundle/archive.tar.gz');
out.ext_log = RL._extOf('app/error.log');
out.ext_none = RL._extOf('noext');
RL._filter = '';
out.all = RL._filtered().length;
RL._filter = 'log error';
out.and = RL._filtered().map(f => f.path);
RL._filter = '.log';
out.extFilter = RL._filtered().length;
console.log(JSON.stringify(out));
""" % json.dumps(rl_path)

    proc = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=15)
    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr.strip()[:300]}")
        return
    try:
        res = json.loads(proc.stdout.strip())
    except ValueError:
        t.fail(f"输出非 JSON: {proc.stdout.strip()[:200]}")
        return
    t.check(res['ext_targz'] == '.tar.gz', f".tar.gz 扩展名识别（{res['ext_targz']}）")
    t.check(res['ext_log'] == '.log', f".log 扩展名识别（{res['ext_log']}）")
    t.check(res['ext_none'] == '(无扩展名)', f"无扩展名识别（{res['ext_none']}）")
    t.check(res['all'] == 4, f"无过滤返回全部（{res['all']}）")
    t.check(res['and'] == ['app/error.log'], f"空格分词 AND 过滤（{res['and']}）")
    t.check(res['extFilter'] == 2, f"扩展名过滤生效（{res['extFilter']}）")


@suite.test("mergeTexts 运行时：\\r\\n / 空文件跳过 / 全空抛错 / 追加")
def _(t, flags):
    if not shutil.which('node'):
        t.ok("未检测到 node，跳过运行时用例")
        return
    utils_path = os.path.join(ROOT, 'js', 'utils.js')
    parser_path = os.path.join(ROOT, 'js', 'parser.js')
    script = r"""
const fs = require('fs');
let src = '';
for (const f of [%s, %s]) src += fs.readFileSync(f, 'utf8') + '\n';
const LP = eval(src + '\n;LogParser');
LP.config = Object.assign({}, LP.config, { preset: 'generic', encoding: 'UTF-8' });
(async () => {
  const out = {};
  const line = (t, lv) => t + ' ' + lv + ' message';
  const textA = '2026-01-01 10:00:00 INFO first\r\n2026-01-01 10:00:01 WARN second\r\n';
  await LP.mergeTexts([{ name: 'a.log', text: textA }, { name: 'empty.log', text: '' }]);
  out.count = LP.entries.length;
  out.skipped = LP.consumeSkipped();
  out.sources = LP.sourceFiles.map(f => f.name);
  out.fileInfo = LP.fileInfo.name;

  // 追加模式
  await LP.mergeTexts([{ name: 'b.log', text: '2026-01-01 10:00:02 ERROR third\n' }], {}, true);
  out.appended = LP.entries.length;
  out.appendSkipped = LP.consumeSkipped();

  // 全空 → 抛错
  try {
    await LP.mergeTexts([{ name: 'x.log', text: '' }]);
    out.err = null;
  } catch (e) {
    out.err = String(e.message || e);
  }
  console.log(JSON.stringify(out));
})();
""" % (json.dumps(utils_path), json.dumps(parser_path))

    proc = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=20)
    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr.strip()[:400]}")
        return
    try:
        res = json.loads(proc.stdout.strip())
    except ValueError:
        t.fail(f"输出非 JSON: {proc.stdout.strip()[:200]}")
        return

    t.check(res['count'] == 2, f"mergeTexts 解析 2 条（\\r\\n 兼容，实际 {res['count']}）")
    t.check(res['skipped'] == ['empty.log'], f"空文件计入跳过清单（{res['skipped']}）")
    t.check(res['sources'] == ['a.log'], f"仅记录有效文件（{res['sources']}）")
    t.check('remote' in str(res['fileInfo']) or '远程' in str(res['fileInfo']),
            f"fileInfo 标记为远程（{res['fileInfo']}）")
    t.check(res['appended'] == 3, f"追加模式累加条目（实际 {res['appended']}）")
    t.check(res['appendSkipped'] == [], f"追加无跳过（{res['appendSkipped']}）")
    t.check(bool(res['err']) and '全部' in res['err'], f"全空文件抛错（{res['err']}）")


@suite.test("appendTail 运行时：仅追加新行 / 跳过空行 / 不重排既有条目")
def _(t, flags):
    if not shutil.which('node'):
        t.ok("未检测到 node，跳过运行时用例")
        return
    utils_path = os.path.join(ROOT, 'js', 'utils.js')
    parser_path = os.path.join(ROOT, 'js', 'parser.js')
    script = r"""
const fs = require('fs');
let src = '';
for (const f of [%s, %s]) src += fs.readFileSync(f, 'utf8') + '\n';
const LP = eval(src + '\n;LogParser');
LP.config = Object.assign({}, LP.config, { preset: 'generic', encoding: 'UTF-8' });
(async () => {
  const out = {};
  await LP.mergeTexts([{ name: 'a.log', text: '2026-01-01 10:00:00 INFO first\n' }]);
  out.before = LP.entries.length;

  const added = LP.appendTail('a.log', [
    '2026-01-01 10:00:01 WARN second',
    '',
    '2026-01-01 10:00:02 ERROR third',
  ]);
  out.added = added;
  out.total = LP.entries.length;
  out.indices = LP.entries.map(e => e.index);
  out.sources = LP.entries.map(e => e.sourceFile);
  out.levels = LP.entries.map(e => e.level);

  // 再次追加不破坏已有编号
  out.added2 = LP.appendTail('a.log', ['2026-01-01 10:00:03 DEBUG fourth']);
  out.indices2 = LP.entries.map(e => e.index);
  console.log(JSON.stringify(out));
})();
""" % (json.dumps(utils_path), json.dumps(parser_path))

    proc = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=20)
    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr.strip()[:400]}")
        return
    try:
        res = json.loads(proc.stdout.strip())
    except ValueError:
        t.fail(f"输出非 JSON: {proc.stdout.strip()[:200]}")
        return

    t.check(res['before'] == 1, f"初始 1 条（实际 {res['before']}）")
    t.check(res['added'] == 2, f"appendTail 仅追加 2 条有效行（跳过空行，实际 {res['added']}）")
    t.check(res['total'] == 3, f"追加后共 3 条（实际 {res['total']}）")
    t.check(res['indices'] == [0, 1, 2], f"编号连续（{res['indices']}）")
    t.check(res['levels'] == ['INFO', 'WARN', 'ERROR'], f"级别解析正确（{res['levels']}）")
    t.check(all(s == 'a.log' for s in res['sources']), f"新增行标记来源文件（{res['sources']}）")
    t.check(res['added2'] == 1 and res['indices2'] == [0, 1, 2, 3],
            f"二次追加保持既有编号（{res['indices2']}）")


@suite.test("半行缓冲（_consumeChunk）：跨块拼接 / 仅返回完整行 / 单行兜底")
def _(t, flags):
    if not shutil.which('node'):
        t.ok("未检测到 node，跳过运行时用例")
        return
    rl_path = os.path.join(ROOT, 'js', 'remote_logs.js')
    script = r"""
const fs = require('fs');
globalThis.LogParser = { _splitLines: (s) => s.split('\n') };
const RL = eval(fs.readFileSync(%s, 'utf8') + '\n;RemoteLogs');
const out = {};
// 跨块：半行被缓冲，直到换行到齐才产出
RL._tailPending = '';
out.s1 = RL._consumeChunk('abc', false);
out.s2 = RL._consumeChunk('def\nghi', false);
out.s3 = RL._consumeChunk('jkl\n', false);
out.pending = RL._tailPending;
// 单行文件（整段无换行）兜底：初始整体返回
RL._tailPending = '';
out.single = RL._consumeChunk('onlyline', true);
console.log(JSON.stringify(out));
""" % json.dumps(rl_path)

    proc = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=15)
    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr.strip()[:300]}")
        return
    try:
        res = json.loads(proc.stdout.strip())
    except ValueError:
        t.fail(f"输出非 JSON: {proc.stdout.strip()[:200]}")
        return
    t.check(res['s1'] == [], f"未换行时不产出完整行（{res['s1']}）")
    t.check(res['s2'] == ['abcdef'], f"换行到齐后拼出完整行（{res['s2']}）")
    t.check(res['s3'] == ['ghijkl'], f"跨块续行正确拼接（{res['s3']}）")
    t.check(res['pending'] == '', f"缓冲清空（{res['pending']!r}）")
    t.check(res['single'] == ['onlyline'], f"单行文件兜底整体返回（{res['single']}）")
