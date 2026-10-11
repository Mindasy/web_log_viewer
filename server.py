#!/usr/bin/env python3
"""Web Log Viewer 本地服务器

用法:
  python3 server.py                                   # 仅托管 Web 应用（默认 8765）
  python3 server.py --project <源码目录>               # 同时提供源码索引与文件（/source/*）
  python3 server.py --project <dir> --no-static        # 仅提供 /source/* 后端接口，不托管静态页面
  python3 server.py --project <dir> --port 9000 --no-browser

以 --project 启动时新增两个只读路由，供前端「服务端数据源」拉取源码：
  GET /source/index.json          → 源码索引（?refresh=1 强制重建）
  GET /source/files/<相对路径>     → 源码文件内容（相对 project 根目录，含目录穿越防护）

无论是否 --project，均提供「服务端标识」发现接口（供前端识别是否为 Web Log Viewer 服务端，
静态打开的页面可跨域访问）：
  GET /source/ping                → {"app":"web-log-viewer","marker":"wlv-source","source":<bool>,...}
所有 /source/* 响应带 Access-Control-Allow-Origin: *，支持 file:// 静态页面跨域调用。

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


def is_excluded_dir(rel_path):
    return any(p in DEFAULT_EXCLUDE_DIRS for p in rel_path.split('/'))


def is_excluded_file(name):
    lower = name.lower()
    return any(fnmatch.fnmatch(lower, p.lower()) for p in DEFAULT_EXCLUDE_FILES)


def is_source_file(name):
    return os.path.splitext(name)[1].lower() in SOURCE_EXTS


def collect_files(root):
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
            if is_excluded_dir(rel):
                if len(excluded_dirs) < MAX_EXCLUDED_RECORDS:
                    excluded_dirs.append(rel)
            else:
                kept.append(d)
        dirnames[:] = kept
        for name in filenames:
            rel = name if not rel_dir else rel_dir + '/' + name
            scanned += 1
            if is_excluded_file(name) or not is_source_file(name):
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


def build_index(root):
    """扫描 root 生成源码索引（供 /source/index.json 与前端 SourceLink 使用）"""
    files, scanned, excluded_dirs, excluded_files = collect_files(root)
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


class SourceService:
    """--project 模式下的源码索引与文件解析"""

    def __init__(self, project):
        self.project = os.path.abspath(project)
        self._index = None

    def refresh(self):
        self._index = build_index(self.project)
        return self._index

    def index(self):
        if self._index is None:
            self.refresh()
        return self._index

    def resolve_file(self, rel):
        """把请求相对路径解析为项目内的真实文件路径；越界/不存在返回 None"""
        rel = urllib.parse.unquote(rel or '')
        rel = posixpath.normpath('/' + rel.replace('\\', '/')).lstrip('/')
        if not rel or rel == '.' or rel.startswith('..'):
            return None
        abspath = os.path.abspath(os.path.join(self.project, rel.replace('/', os.sep)))
        if abspath != self.project and not abspath.startswith(self.project + os.sep):
            return None
        if not os.path.isfile(abspath):
            return None
        return abspath


class ReuseAddrServer(socketserver.TCPServer):
    allow_reuse_address = True


class Handler(http.server.SimpleHTTPRequestHandler):
    source_service = None  # 由 main 注入（--project 时非空）
    serve_static = True    # --no-static 时置 False：仅提供 /source/* 后端接口

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

    def _handle_source(self, path, query):
        # 服务端标识：无论是否启用源码服务都响应，供前端识别
        if path == PING_ROUTE:
            svc = self.source_service
            self._send_json({
                'app': 'web-log-viewer',
                'marker': SERVER_MARKER,
                'schema': 1,
                'source': svc is not None,
                'project': os.path.basename(svc.project) if svc else '',
                'files': svc.index()['stats']['indexed'] if svc else 0,
            })
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

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == PING_ROUTE or path == SOURCE_INDEX_ROUTE or path.startswith(SOURCE_FILES_PREFIX):
            self._handle_source(path, parsed.query)
            return
        if not self.serve_static:
            self._send_json({'error': '此服务仅提供后端接口（/source/*），未启用静态文件服务'}, 404)
            return
        super().do_GET()

    def do_OPTIONS(self):
        # 跨域预检（静态 file:// 页面访问服务端时需要）
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == PING_ROUTE or path == SOURCE_INDEX_ROUTE or path.startswith(SOURCE_FILES_PREFIX):
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
    parser.add_argument('--port', type=int, default=PORT, help=f'监听端口（默认 {PORT}）')
    parser.add_argument('--no-browser', action='store_true', help='启动后不自动打开浏览器')
    parser.add_argument('--no-static', action='store_true',
                        help='仅提供 /source/* 后端接口，不托管 Web 静态文件')
    args = parser.parse_args()

    Handler.serve_static = not args.no_static

    if args.project:
        if not os.path.isdir(args.project):
            print(f'错误: 项目目录不存在: {args.project}', file=sys.stderr)
            sys.exit(1)
        Handler.source_service = SourceService(args.project)
        st = Handler.source_service.refresh()['stats']
        print(f"源码服务已启用: {Handler.source_service.project}")
        print(f"  索引 {st['indexed']} 个源码文件（扫描 {st['scanned']}）→ /source/index.json")

    with ReuseAddrServer(("", args.port), Handler) as httpd:
        url = f"http://localhost:{args.port}"
        print(f"Web view logger's Web 已启动: {url}")
        if args.no_static:
            print("  模式: 仅后端接口（/source/*），未托管静态页面")
        print("按 Ctrl+C 停止服务器")
        try:
            if not args.no_browser and not args.no_static:
                webbrowser.open(url)
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")


if __name__ == '__main__':
    main()
