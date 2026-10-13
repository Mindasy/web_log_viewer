#!/usr/bin/env python3
"""Web Log Viewer 本地服务器

用法:
  python3 server.py                                   # 仅托管 Web 应用（默认 8765）
  python3 server.py --project <源码目录>               # 同时提供源码索引与文件（/source/*）
  python3 server.py --project <dir> --no-static        # 仅提供后端接口，不托管静态页面
  python3 server.py --project <dir> --logs-root <日志目录>   # 额外提供远端日志接口（/api/logs）
  python3 server.py --project <dir> --token <口令>            # 为后端接口启用 token 鉴权
  python3 server.py --project <dir> --exclude-dir dist --exclude-file '*.min.js'
  python3 server.py --project <dir> --port 9000 --no-browser

以 --project 启动时新增只读源码路由，供前端「服务端数据源」拉取源码：
  GET /source/index.json          → 源码索引（?refresh=1 强制重建）
  GET /source/files/<相对路径>     → 源码文件内容（相对 project 根目录，含目录穿越防护）

远端日志路由（v3-1，供前端「远程日志」加载远端日志；日志根默认 = --project，未设则当前目录）：
  GET /api/logs?file=<相对路径>             → 日志文件文本（text/plain; utf-8）
  GET /api/logs?file=<相对路径>&binary=1    → 原始字节（application/octet-stream，供前端解压 zip/tar.gz）
  GET /api/logs/list                        → 候选日志文件清单（扩展名白名单，最多 N 条）

无论是否 --project，均提供「服务端标识」发现接口（供前端识别是否为 Web Log Viewer 服务端，
静态打开的页面可跨域访问）：
  GET /source/ping                → {"app":"web-log-viewer","marker":"wlv-source","source":<bool>,...}
所有 /source/* 与 /api/logs 响应带 Access-Control-Allow-Origin: *，支持 file:// 静态页面跨域调用。
设置 --token 后，除 /source/ping 外的后端接口需带 X-Auth-Token 头或 ?token=，否则返回 401。

索引逻辑（排除规则、源码白名单、行数/语言统计）内置于本文件：服务端单文件即可部署，无外部依赖。
"""
import argparse
import fnmatch
import http.server
import json
import os
import posixpath
import socketserver
import sys
import urllib.parse
import webbrowser
from datetime import datetime

PORT = 8765
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

PING_ROUTE = '/source/ping'
SOURCE_INDEX_ROUTE = '/source/index.json'
SOURCE_FILES_PREFIX = '/source/files/'
SERVER_MARKER = 'wlv-source'   # 前端识别服务端的特殊标志

# ===== 远端日志接口（v3-1） =====
LOGS_ROUTE = '/api/logs'
LOGS_LIST_ROUTE = '/api/logs/list'
MAX_LOG_BYTES = 200 * 1024 * 1024      # 单文件上限 200MB（与前端大文件警告一致）
MAX_LOG_LIST = 2000                    # /api/logs/list 最多返回条数
# 候选日志扩展名白名单（与前端可打开的日志/压缩格式一致）
LOG_EXT_WHITELIST = (
    '.log', '.txt', '.out', '.err', '.trace', '.json', '.csv', '.xml',
    '.gz', '.tgz', '.tar', '.zip',
)
DEFAULT_CONFIG_NAME = '.sourcelink.json'   # 排除规则配置文件默认名


# ===== 源码索引规则（与前端 js/source_link.js 保持一致） =====

# 默认排除目录（按路径片段匹配，任意层级命中即排除）
DEFAULT_EXCLUDE_DIRS = {
    '.git', '.svn', '.hg', '.idea', '.vscode', 'node_modules', 'bower_components',
    'vendor', '.venv', 'venv', 'site-packages', '__pycache__', '.gradle', '.m2',
    '.cargo', 'target', 'build', 'dist', 'out', 'bin', 'obj', 'CMakeFiles',
    '.next', '.nuxt', 'Pods', 'DerivedData', '.egg-info', '.pytest_cache',
    '.cache', 'logs', 'tmp', 'temp',
}

# 默认排除文件（basename glob 匹配，忽略大小写）
DEFAULT_EXCLUDE_FILES = {
    '*.o', '*.obj', '*.a', '*.so', '*.dylib', '*.dll', '*.exe', '*.class',
    '*.pyc', '*.pyo', '*.jar', '*.war', '*.zip', '*.tar', '*.gz', '*.tgz',
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg', '*.woff', '*.woff2',
    '*.ttf', '*.eot', '*.map', '*.lock', 'package-lock.json', 'yarn.lock',
    'pnpm-lock.yaml', 'Cargo.lock', 'composer.lock', 'Gemfile.lock',
    '.DS_Store', 'Thumbs.db',
}

# 源码白名单扩展名（白名单之外一律排除）
SOURCE_EXTS = {
    '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.java', '.py',
    '.go', '.rs', '.js', '.jsx', '.ts', '.tsx', '.kt', '.kts', '.swift', '.cs',
    '.rb', '.php', '.scala', '.lua', '.pl', '.sh', '.sql',
}

LANG_MAP = {
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp',
    '.h': 'cpp', '.hh': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
    '.java': 'java', '.py': 'py', '.go': 'go', '.rs': 'rs',
    '.js': 'js', '.jsx': 'js', '.ts': 'ts', '.tsx': 'ts',
    '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift', '.cs': 'cs',
    '.rb': 'rb', '.php': 'php', '.scala': 'scala', '.lua': 'lua',
    '.pl': 'pl', '.sh': 'sh', '.sql': 'sql',
}

MAX_EXCLUDED_RECORDS = 500  # excluded 明细上限，防止超大项目索引膨胀


def is_excluded_dir(rel_path, extra_dirs=None):
    parts = rel_path.split('/')
    if extra_dirs and any(p in extra_dirs for p in parts):
        return True
    return any(p in DEFAULT_EXCLUDE_DIRS for p in parts)


def is_excluded_file(name, extra_files=None):
    lower = name.lower()
    if extra_files and any(fnmatch.fnmatch(lower, p.lower()) for p in extra_files):
        return True
    return any(fnmatch.fnmatch(lower, p.lower()) for p in DEFAULT_EXCLUDE_FILES)


def is_source_file(name):
    return os.path.splitext(name)[1].lower() in SOURCE_EXTS


def load_excludes(config_path, exclude_dirs=None, exclude_files=None):
    """合并排除规则：命令行 `--exclude-dir/--exclude-file` + 配置文件（如 .sourcelink.json）

    返回 (extra_dirs:set, extra_files:set)；配置文件缺失时仅告警，不中断。
    """
    extra_dirs = set(exclude_dirs or [])
    extra_files = set(exclude_files or [])
    if config_path:
        if not os.path.isfile(config_path):
            print(f"警告: 排除规则配置文件不存在，已忽略: {config_path}", file=sys.stderr)
            return extra_dirs, extra_files
        try:
            with open(config_path, encoding='utf-8') as f:
                cfg = json.load(f)
        except (OSError, ValueError) as e:
            print(f"警告: 读取配置文件失败，已忽略: {config_path} ({e})", file=sys.stderr)
            return extra_dirs, extra_files
        extra_dirs |= set(cfg.get('excludeDirs') or cfg.get('exclude_dirs') or [])
        extra_files |= set(cfg.get('excludeFiles') or cfg.get('exclude_files') or [])
    return extra_dirs, extra_files


def collect_files(root, extra_dirs=None, extra_files=None):
    """遍历项目，返回 (源码文件相对路径列表, 扫描总数, 被排除目录, 被排除文件)"""
    files = []
    scanned = 0
    excluded_dirs = []
    excluded_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = '' if rel_dir == '.' else rel_dir.replace(os.sep, '/')
        kept = []
        for d in dirnames:
            rel = d if not rel_dir else rel_dir + '/' + d
            if is_excluded_dir(rel, extra_dirs):
                if len(excluded_dirs) < MAX_EXCLUDED_RECORDS:
                    excluded_dirs.append(rel)
            else:
                kept.append(d)
        dirnames[:] = kept
        for name in filenames:
            rel = name if not rel_dir else rel_dir + '/' + name
            scanned += 1
            if is_excluded_file(name, extra_files) or not is_source_file(name):
                if len(excluded_files) < MAX_EXCLUDED_RECORDS:
                    excluded_files.append(rel)
                continue
            files.append(rel)
    files.sort()
    return files, scanned, excluded_dirs, excluded_files


def read_source(path, rel):
    with open(path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    lines = content.count('\n')
    if content and not content.endswith('\n'):
        lines += 1
    lang = LANG_MAP.get(os.path.splitext(rel)[1].lower(), 'text')
    return content, lines, lang


def build_index(root, extra_dirs=None, extra_files=None):
    """扫描 root 生成源码索引（供 /source/index.json 与前端 SourceLink 使用）"""
    files, scanned, excluded_dirs, excluded_files = collect_files(root, extra_dirs, extra_files)
    entries = []
    total_size = 0
    for rel in files:
        abspath = os.path.join(root, rel.replace('/', os.sep))
        try:
            content, lines, lang = read_source(abspath, rel)
        except OSError:
            continue
        size = len(content.encode('utf-8', errors='replace'))
        total_size += size
        entries.append({
            'path': rel,
            'basename': os.path.basename(rel),
            'size': size,
            'lines': lines,
            'lang': lang,
        })
    return {
        'schema': 1,
        'project': os.path.basename(os.path.abspath(root)) or root,
        'generatedAt': datetime.now().astimezone().isoformat(timespec='seconds'),
        'stats': {
            'scanned': scanned,
            'indexed': len(entries),
            'totalBytes': total_size,
            'excludedDirs': len(excluded_dirs),
            'excludedFiles': len(excluded_files),
        },
        'excluded': (
            [{'type': 'dir', 'path': p} for p in excluded_dirs] +
            [{'type': 'file', 'path': p} for p in excluded_files]
        ),
        'files': entries,
    }


def _resolve_under(root, rel):
    """把请求相对路径解析为 root 内的真实文件路径；越界/目录/不存在返回 None

    `/source/files` 与 `/api/logs` 共用同一套目录穿越防护。
    """
    if not root:
        return None
    root = os.path.abspath(root)
    rel = urllib.parse.unquote(rel or '')
    rel = posixpath.normpath('/' + rel.replace('\\', '/')).lstrip('/')
    if not rel or rel == '.' or rel.startswith('..'):
        return None
    abspath = os.path.abspath(os.path.join(root, rel.replace('/', os.sep)))
    if abspath != root and not abspath.startswith(root + os.sep):
        return None
    if not os.path.isfile(abspath):
        return None
    return abspath


class SourceService:
    """--project 模式下的源码索引与文件解析"""

    def __init__(self, project, extra_dirs=None, extra_files=None):
        self.project = os.path.abspath(project)
        self.extra_dirs = set(extra_dirs or [])
        self.extra_files = set(extra_files or [])
        self._index = None

    def refresh(self):
        self._index = build_index(self.project, self.extra_dirs, self.extra_files)
        return self._index

    def index(self):
        if self._index is None:
            self.refresh()
        return self._index

    def resolve_file(self, rel):
        """把请求相对路径解析为项目内的真实文件路径；越界/不存在返回 None"""
        return _resolve_under(self.project, rel)


def _is_log_candidate(name):
    lower = name.lower()
    return any(lower.endswith(ext) for ext in LOG_EXT_WHITELIST)


class LogService:
    """远端日志服务（v3-1）：在日志根内解析并列出候选日志文件"""

    def __init__(self, root):
        self.root = os.path.abspath(root)

    def resolve_file(self, rel):
        return _resolve_under(self.root, rel)

    def list_logs(self):
        """列出日志根内候选日志文件（扩展名白名单，最多 MAX_LOG_LIST 条），按路径排序"""
        items = []
        truncated = False
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames.sort()
            rel_dir = os.path.relpath(dirpath, self.root)
            rel_dir = '' if rel_dir == '.' else rel_dir.replace(os.sep, '/')
            for name in sorted(filenames):
                if not _is_log_candidate(name):
                    continue
                rel = name if not rel_dir else rel_dir + '/' + name
                if len(items) >= MAX_LOG_LIST:
                    truncated = True
                    break
                try:
                    st = os.stat(os.path.join(dirpath, name))
                except OSError:
                    continue
                items.append({
                    'path': rel,
                    'size': st.st_size,
                    'mtime': int(st.st_mtime),
                })
            if truncated:
                break
        return {
            'root': os.path.basename(self.root) or self.root,
            'count': len(items),
            'truncated': truncated,
            'limit': MAX_LOG_LIST,
            'files': items,
        }


class ReuseAddrServer(socketserver.TCPServer):
    allow_reuse_address = True


class Handler(http.server.SimpleHTTPRequestHandler):
    source_service = None  # 由 main 注入（--project 时非空）
    log_service = None     # 由 main 注入（远端日志服务，v3-1）
    auth_token = ''        # --token 时非空：后端接口需带 X-Auth-Token 或 ?token=
    serve_static = True    # --no-static 时置 False：仅提供后端接口

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")

    # ---- /source/* 路由 ----

    def _send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _send_text(self, text, status=200):
        data = text.encode('utf-8', errors='replace')
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _send_tail(self, data, size, reset=False):
        """实时追踪增量响应：返回自 from 偏移起的字节，并附带当前文件大小"""
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        # 跨域时前端需读取自定义响应头，必须显式暴露
        self.send_header('Access-Control-Expose-Headers', 'X-Log-Size, X-Log-Reset')
        self.send_header('X-Log-Size', str(size))
        if reset:
            self.send_header('X-Log-Reset', '1')
        self.end_headers()
        if data:
            self.wfile.write(data)

    def _check_token(self, query):
        """--token 时校验 X-Auth-Token 头或 ?token= 参数；未设置则始终通过"""
        if not self.auth_token:
            return True
        if self.headers.get('X-Auth-Token') == self.auth_token:
            return True
        q = urllib.parse.parse_qs(query or '')
        return (q.get('token') or [''])[0] == self.auth_token

    def _handle_source(self, path, query):
        # 服务端标识：无论是否启用源码服务都响应，供前端识别
        if path == PING_ROUTE:
            svc = self.source_service
            logs = self.log_service
            self._send_json({
                'app': 'web-log-viewer',
                'marker': SERVER_MARKER,
                'schema': 1,
                'source': svc is not None,
                'project': os.path.basename(svc.project) if svc else '',
                'files': svc.index()['stats']['indexed'] if svc else 0,
                'logs': logs is not None,
                'logsRoot': os.path.basename(logs.root) if logs else '',
            })
            return
        if not self._check_token(query):
            self._send_json({'error': '未授权：缺少或错误的 token'}, 401)
            return
        if self.source_service is None:
            self._send_json({'error': '未启用源码服务（请用 --project 启动 server.py）'}, 404)
            return
        try:
            if path == SOURCE_INDEX_ROUTE:
                if 'refresh=1' in (query or ''):
                    self.source_service.refresh()
                self._send_json(self.source_service.index())
                return
            rel = path[len(SOURCE_FILES_PREFIX):]
            abspath = self.source_service.resolve_file(rel)
            if not abspath:
                self._send_json({'error': '文件不存在或越界: ' + rel}, 404)
                return
            with open(abspath, encoding='utf-8', errors='replace') as f:
                self._send_text(f.read())
        except Exception as e:  # noqa: BLE001 — 兜底，避免单个请求打断服务
            self._send_json({'error': str(e)}, 500)

    def _handle_logs(self, path, query):
        if not self._check_token(query):
            self._send_json({'error': '未授权：缺少或错误的 token'}, 401)
            return
        svc = self.log_service
        if svc is None:
            self._send_json({'error': '未启用远端日志服务（请用 --logs-root/--project 启动 server.py）'}, 404)
            return
        try:
            if path == LOGS_LIST_ROUTE:
                self._send_json(svc.list_logs())
                return
            q = urllib.parse.parse_qs(query or '')
            rel = (q.get('file') or [''])[0]
            if not rel:
                self._send_json({'error': '缺少 file 参数'}, 400)
                return
            abspath = svc.resolve_file(rel)
            if not abspath:
                self._send_json({'error': '文件不存在或越界: ' + rel}, 404)
                return
            size = os.path.getsize(abspath)
            if size > MAX_LOG_BYTES:
                self._send_json(
                    {'error': f'文件过大（{size} 字节，上限 {MAX_LOG_BYTES}）'}, 413)
                return
            binary = (q.get('binary') or [''])[0] in ('1', 'true', 'yes')
            from_raw = (q.get('from') or [''])[0]
            if from_raw != '':
                # 增量读取（实时追踪）：仅返回自 from 字节偏移起的内容
                try:
                    start = int(from_raw)
                except ValueError:
                    self._send_json({'error': 'from 参数需为字节偏移整数'}, 400)
                    return
                start = max(0, start)
                reset = start > size  # 文件被截断/轮转：从头返回并标记重置
                if reset:
                    start = 0
                with open(abspath, 'rb') as f:
                    f.seek(start)
                    data = f.read()
                self._send_tail(data, size, reset)
                return
            with open(abspath, 'rb') as f:
                data = f.read()
            if binary:
                self._send_bytes(data, 'application/octet-stream')
                return
            if b'\x00' in data[:8192]:
                self._send_json({'error': '目标疑似二进制文件，请使用 binary=1'}, 415)
                return
            self._send_text(data.decode('utf-8', errors='replace'))
        except Exception as e:  # noqa: BLE001 — 兜底，避免单个请求打断服务
            self._send_json({'error': str(e)}, 500)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == PING_ROUTE or path == SOURCE_INDEX_ROUTE or path.startswith(SOURCE_FILES_PREFIX):
            self._handle_source(path, parsed.query)
            return
        if path == LOGS_ROUTE or path == LOGS_LIST_ROUTE:
            self._handle_logs(path, parsed.query)
            return
        if not self.serve_static:
            self._send_json({'error': '此服务仅提供后端接口（/source/*、/api/logs），未启用静态文件服务'}, 404)
            return
        super().do_GET()

    def _is_backend_route(self, path):
        return (path == PING_ROUTE or path == SOURCE_INDEX_ROUTE
                or path.startswith(SOURCE_FILES_PREFIX)
                or path == LOGS_ROUTE or path == LOGS_LIST_ROUTE)

    def do_OPTIONS(self):
        # 跨域预检（静态 file:// 页面访问服务端时需要）
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if self._is_backend_route(path):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.send_header('Access-Control-Max-Age', '600')
            self.end_headers()
            return
        self.send_error(405, 'Method Not Allowed')


def main():
    parser = argparse.ArgumentParser(description='Web Log Viewer 本地服务器')
    parser.add_argument('--project', help='源码项目目录（启用 /source/* 源码索引与文件服务）')
    parser.add_argument('--logs-root', help='远端日志根目录（启用 /api/logs；默认 = --project，未设则当前目录）')
    parser.add_argument('--token', help='后端接口鉴权口令（设置后需带 X-Auth-Token 头或 ?token=）')
    parser.add_argument('--exclude-dir', action='append', default=[], metavar='NAME',
                        help='追加排除目录名（可重复）')
    parser.add_argument('--exclude-file', action='append', default=[], metavar='GLOB',
                        help='追加排除文件 glob（可重复）')
    parser.add_argument('--config', help=f'排除规则配置文件（默认自动读取 {DEFAULT_CONFIG_NAME}）')
    parser.add_argument('--port', type=int, default=PORT, help=f'监听端口（默认 {PORT}）')
    parser.add_argument('--no-browser', action='store_true', help='启动后不自动打开浏览器')
    parser.add_argument('--no-static', action='store_true',
                        help='仅提供后端接口（/source/*、/api/logs），不托管 Web 静态文件')
    args = parser.parse_args()

    Handler.serve_static = not args.no_static
    Handler.auth_token = args.token or ''

    # 排除规则：命令行 --exclude-dir/--exclude-file + 配置文件（默认 .sourcelink.json）
    config_path = args.config
    if config_path is None:
        for base in (args.project, os.getcwd()):
            if base:
                cand = os.path.join(base, DEFAULT_CONFIG_NAME)
                if os.path.isfile(cand):
                    config_path = cand
                    break
    extra_dirs, extra_files = load_excludes(config_path, args.exclude_dir, args.exclude_file)
    if extra_dirs or extra_files:
        origin = f"（配置文件 {config_path}）" if config_path else ""
        print(f"排除规则: 追加 {len(extra_dirs)} 个目录 / {len(extra_files)} 个文件模式 {origin}")

    if args.project:
        if not os.path.isdir(args.project):
            print(f'错误: 项目目录不存在: {args.project}', file=sys.stderr)
            sys.exit(1)
        Handler.source_service = SourceService(args.project, extra_dirs, extra_files)
        st = Handler.source_service.refresh()['stats']
        print(f"源码服务已启用: {Handler.source_service.project}")
        print(f"  索引 {st['indexed']} 个源码文件（扫描 {st['scanned']}）→ /source/index.json")

    # 远端日志服务（v3-1）：默认日志根 = --project，未设则当前目录
    logs_root = args.logs_root or args.project or os.getcwd()
    if not os.path.isdir(logs_root):
        print(f'错误: 日志根目录不存在: {logs_root}', file=sys.stderr)
        sys.exit(1)
    Handler.log_service = LogService(logs_root)
    print(f"远端日志服务已启用: {Handler.log_service.root} → /api/logs")
    if not args.logs_root and not args.project:
        print("  提示: 未指定 --logs-root/--project，日志根回退为当前目录；可用 --logs-root 限定范围")
    if Handler.auth_token:
        print("  已启用 token 鉴权：后端接口需带 X-Auth-Token 头或 ?token=")

    with ReuseAddrServer(("", args.port), Handler) as httpd:
        url = f"http://localhost:{args.port}"
        print(f"Web view logger's Web 已启动: {url}")
        if args.no_static:
            print("  模式: 仅后端接口（/source/*、/api/logs），未托管静态页面")
        print("按 Ctrl+C 停止服务器")
        try:
            if not args.no_browser and not args.no_static:
                webbrowser.open(url)
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")


if __name__ == '__main__':
    main()
